// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Run the author's shader unchanged at its effect boundaries, between world and caption rendering.
import { CanvasTexture, ColorManagement, LinearFilter, Matrix4, NoColorSpace, NoToneMapping, type Camera } from 'three'
import { MeshBasicNodeMaterial, QuadMesh, type Renderer } from 'three/webgpu'
import { texture, uv } from 'three/tsl'

import { create_source, type ClaudeSpellRuntime } from './generated/claude_spell_source.js'
import { create_spell_gl, type SpellUniforms } from './claude_spell_gl.ts'
import { create_spell_actor_mask } from './claude_spell_actor_mask.ts'
import { spell_space } from './claude_spell_space.ts'
import { spell_effect_size } from './quality.ts'
import { spell_effect_timing, type SpellEffectRecipe, type SpellEffectTiming } from './spell_effect_recipe.ts'
import type { create_entity_layer } from './entities.ts'
import type { EngineQuality, FightBoardRender, FightPresentationCue, Vec3 } from './types.ts'

type CastCue = Extract<FightPresentationCue, { type: 'cast' }>
type ZoneCue = Extract<FightPresentationCue, { type: 'zone' }>
type Anchors = Pick<
  ReturnType<typeof create_entity_layer>,
  'cell_anchor' | 'entity_position' | 'spell_context' | 'prepare_models'
>
type ActiveCast = {
  source: ClaudeSpellRuntime
  recipe: SpellEffectRecipe
  timing: SpellEffectTiming
  space: ReturnType<typeof spell_space>
  caster_id: string
  started_at: number
  resolve: ((shown: boolean) => void) | null
}

const authored_frame = (cast: ActiveCast, now: number, width: number, height: number, reduced: boolean) => {
  const age = (now - cast.started_at) / 1000
  const { preset, triggered } = cast.recipe
  const time = triggered ? preset.cast + preset.fly + (preset.trap ? cast.source.trap_wait : 0) + age : age
  return cast.source.frame(time, width, height, 1, reduced)
}

export const create_spell_effect_layer = ({
  camera,
  renderer,
  anchors,
  quality = () => 'high',
  reduced_motion = () => false,
}: Readonly<{
  camera: Camera
  renderer: Renderer
  anchors: Anchors
  quality?: () => EngineQuality
  reduced_motion?: () => boolean
}>) => {
  // Native contexts belong to the prepared gameplay world, never to module import or the menu.
  let native: Awaited<ReturnType<typeof create_spell_gl>> | null = null
  let mask: Awaited<ReturnType<typeof create_spell_actor_mask>> | null = null
  let copied: CanvasTexture | null = null
  let quad: QuadMesh | null = null
  let compiled: Promise<void> | null = null
  const active: ActiveCast[] = []
  let previous_tick = performance.now()
  let disposed = false
  const lifetime = new AbortController()
  const clear = (): void => {
    active.forEach((cast) => cast.resolve?.(false))
    active.length = 0
  }
  let preparing: Promise<void> | null = null
  const warmup = async (): Promise<void> => {
    if (!native || !mask) return
    // A linked program is not a presented pipeline. Exercise its real draws before releasing readiness.
    native.resize(2, 2)
    await anchors.prepare_models()
    lifetime.signal.throwIfAborted()
    const { roots } = anchors.spell_context()
    mask.prepare(roots)
    mask.render(roots, new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), 2, 2)
    const source = create_source()
    for (const [classe, presets] of Object.entries(source.catalog)) {
      const preset = source.select(classe, presets[0]!.name)
      const frame = {
        uniforms: { ...source.frame(preset.cast + preset.fly + 0.2, 2, 2), aresGame: 0 },
        cells: new Uint8Array(4),
        width: 1,
        height: 1,
      }
      // Overlapping casts use both offscreen targets before the canvas. Warm every target format.
      native.render(null, mask.texture, [frame, frame, frame])
      // Export completion waits for the submitted GL work without a synchronous finish/readPixels.
      const image = await createImageBitmap(native.canvas)
      image.close()
      lifetime.signal.throwIfAborted()
    }
    native.resize(...spell_effect_size(quality(), renderer.domElement.width, renderer.domElement.height))
  }
  const initialize = async (atlas_urls: readonly string[]): Promise<void> => {
    if (disposed) return
    if (!native) {
      const { claude_spell_game_shader } = await import('./claude_spell_shader.ts')
      if (disposed) return
      native = await create_spell_gl(claude_spell_game_shader(), lifetime.signal)
      mask = await create_spell_actor_mask(native.gl, lifetime.signal)
      copied = new CanvasTexture(native.canvas)
      // This is a display-mapped overlay, not a scene-linear surface.
      copied.colorSpace = NoColorSpace
      copied.flipY = false
      copied.generateMipmaps = false
      copied.minFilter = LinearFilter
      const material = new MeshBasicNodeMaterial({
        toneMapped: false,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
      material.fragmentNode = texture(copied, uv())
      quad = new QuadMesh(material)
    }
    await native.prepare(atlas_urls)
    if (disposed || !quad) return
    await warmup()
    const tone_mapping = renderer.toneMapping
    const output_color_space = renderer.outputColorSpace
    renderer.toneMapping = NoToneMapping
    renderer.outputColorSpace = ColorManagement.workingColorSpace
    try {
      compiled ??= renderer.compileAsync(quad, quad.camera)
    } finally {
      renderer.toneMapping = tone_mapping
      renderer.outputColorSpace = output_color_space
    }
    await compiled
  }
  const prepare = async (atlas_urls: readonly string[]): Promise<void> => {
    preparing ??= initialize(atlas_urls)
    await Promise.all([preparing, anchors.prepare_models()])
    if (!disposed) mask?.prepare(anchors.spell_context().roots)
  }
  const start = (recipe: SpellEffectRecipe, caster_id: string, from: Vec3, to: Vec3): Promise<boolean> => {
    const { board } = anchors.spell_context()
    if (!board || !native || disposed) return Promise.resolve(false)
    while (active.length >= 8) active.shift()?.resolve?.(false)
    const space = spell_space(board, from, to, recipe)
    const source = create_source()
    const preset = source.select(recipe.preset.cls, recipe.preset.name, {
      ...recipe.preset,
      tx: recipe.preset.cx + space.distance + (recipe.preset.path === 'tele' ? 1 : 0),
    })
    const adapted = { ...recipe, preset }
    return new Promise((resolve) =>
      active.push({
        source,
        recipe: adapted,
        timing: recipe.timing ?? spell_effect_timing(adapted),
        space,
        caster_id,
        started_at: previous_tick,
        resolve,
      })
    )
  }
  return {
    prepare,
    set_board: (board: FightBoardRender | null): void => {
      if (board === null) clear()
    },
    play: (cue: CastCue): Promise<boolean> => {
      const from = anchors.entity_position(cue.caster_id),
        to = anchors.cell_anchor(cue.target_cell, 0)
      if (!cue.effect || !from || !to) return Promise.resolve(false)
      return start(cue.effect, cue.caster_id, from, [to.x, to.y, to.z])
    },
    play_zone: (cue: ZoneCue): Promise<boolean> => {
      const at = anchors.cell_anchor(cue.effect?.zone_anchor ?? cue.cell, 0)
      if (!cue.effect || !at) return Promise.resolve(false)
      const point: Vec3 = [at.x, at.y, at.z]
      return start(cue.effect, cue.owner_id, anchors.entity_position(cue.owner_id) ?? point, point)
    },
    tick: (now: number): void => {
      previous_tick = now
      for (let index = active.length - 1; index >= 0; index -= 1) {
        const cast = active[index]!,
          age = (now - cast.started_at) / 1000
        if (age >= cast.timing.complete_seconds) {
          cast.resolve?.(true)
          cast.resolve = null
        }
        if (age >= cast.timing.end_seconds) active.splice(index, 1)
      }
    },
    camera_offset: (): Vec3 =>
      active.reduce<Vec3>(
        (previous, cast) => {
          const camera_at = authored_frame(cast, previous_tick, 2, 2, reduced_motion()).uCam as readonly number[]
          const offset = cast.space.vector(camera_at[0]!, camera_at[1]! - 8.2)
          return Math.hypot(...offset) > Math.hypot(...previous) ? offset : previous
        },
        [0, 0, 0]
      ),
    render: (): void => {
      if (!active.length || !native || !mask || !copied || !quad) return
      const canvas = renderer.domElement
      const [width, height] = spell_effect_size(quality(), canvas.width, canvas.height)
      if (native.canvas.width !== width || native.canvas.height !== height) {
        copied.dispose()
        native.resize(width, height)
      }
      const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      mask.render(anchors.spell_context().roots, projection, width, height)
      const frames = active.map((cast) => {
        const { preset, triggered } = cast.recipe
        const authored = authored_frame(cast, previous_tick, width, height, reduced_motion())
        const caster = anchors.entity_position(cast.caster_id)
        const actor: SpellUniforms = caster && !triggered ? { uCst: cast.space.point(caster) } : {}
        const trap: SpellUniforms = preset.trap && !triggered ? { uI: -1 } : {}
        return { ...cast.space, uniforms: { ...authored, ...cast.space.uniforms(camera), ...actor, ...trap } }
      })
      native.render(canvas, mask.texture, frames)
      copied.needsUpdate = true
      const tone_mapping = renderer.toneMapping
      const auto_clear = renderer.autoClear
      const output_color_space = renderer.outputColorSpace
      renderer.toneMapping = NoToneMapping
      renderer.autoClear = false
      // As with captions, bypass Three's HDR framebuffer and its output blit entirely.
      renderer.outputColorSpace = ColorManagement.workingColorSpace
      try {
        quad.render(renderer)
      } finally {
        renderer.toneMapping = tone_mapping
        renderer.autoClear = auto_clear
        renderer.outputColorSpace = output_color_space
      }
    },
    dispose: (): void => {
      disposed = true
      lifetime.abort()
      clear()
      mask?.dispose()
      native?.dispose()
      copied?.dispose()
      if (quad) (quad.material as MeshBasicNodeMaterial).dispose()
    },
  }
}
