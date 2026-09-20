// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One batched overlay for passive text. DOM remains only for accessibility and interactive prompts.
import {
  Box2,
  CanvasTexture,
  Color,
  ColorManagement,
  NoToneMapping,
  DataTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type WebGLRenderer,
} from 'three'

import { caption_raster_key, create_caption_raster } from './caption_raster.ts'
import {
  CAPTION_ATLAS_SIZE,
  CAPTION_CELL_WIDTH,
  CAPTION_ROW_HEIGHT,
  create_caption_slots,
  type CaptionSlot,
} from './caption_slots.ts'
import { create_caption_material } from './caption_material.ts'
import type { WorldCaption } from './caption_types.ts'

const MAX_ATLAS_BYTES = 128 * 1024 * 1024
const MAX_INSTANCES = 4096
type Renderer<Target> = Pick<
  WebGLRenderer,
  'copyTextureToTexture' | 'render' | 'clearDepth' | 'autoClear' | 'toneMapping' | 'outputColorSpace'
> & {
  getRenderTarget: () => Target | null
  setRenderTarget: (target: Target | null) => void
}
type Page = ReturnType<typeof create_page>
type Tile = {
  allocation: Readonly<{ page: Page; slot: CaptionSlot }> | null
  width: number
  height: number
  body_width: number
  ratio: number
  refs: number
}
type Entry = {
  caption: WorldCaption
  anchor: () => Vector3 | null
  key: string
  tile: Tile | null
  accessible: HTMLElement
  visible: boolean
}

const create_page = (scene: Scene, webgpu: boolean, size: number, empty: Uint8Array) => {
  const atlas = new DataTexture(empty, size, size)
  atlas.colorSpace = SRGBColorSpace
  atlas.minFilter = LinearFilter
  atlas.magFilter = LinearFilter
  atlas.generateMipmaps = false
  atlas.needsUpdate = true
  const geometry = new PlaneGeometry(1, 1)
  const rectangles = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4).setUsage(DynamicDrawUsage)
  const tints = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4).setUsage(DynamicDrawUsage)
  geometry.setAttribute('caption_uv', rectangles)
  geometry.setAttribute('caption_tint', tints)
  const material = create_caption_material(atlas, webgpu)
  const mesh = new InstancedMesh(geometry, material, MAX_INSTANCES)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.count = 0
  scene.add(mesh)
  const slots = create_caption_slots(size)
  return {
    size,
    atlas,
    geometry,
    material,
    mesh,
    rectangles,
    tints,
    slots,
    dispose: () => {
      scene.remove(mesh)
      mesh.dispose()
      geometry.dispose()
      material.dispose()
      atlas.dispose()
    },
  }
}
const upload = (attribute: InstancedBufferAttribute, count: number): void => {
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(0, count * attribute.itemSize)
  attribute.needsUpdate = true
}

export const create_caption_layer = <Target>({
  renderer,
  canvas,
  camera,
  webgpu,
}: Readonly<{
  renderer: Renderer<Target>
  canvas: HTMLCanvasElement
  camera: Camera
  webgpu: boolean
}>) => {
  const scene = new Scene()
  const overlay_camera = new OrthographicCamera(-1, 1, 1, -1, -1, 1)
  const raster = create_caption_raster()
  const scratch = new CanvasTexture(raster.canvas)
  scratch.colorSpace = SRGBColorSpace
  scratch.flipY = false
  scratch.generateMipmaps = false
  scratch.minFilter = LinearFilter
  const pages: Page[] = []
  const empty_atlases = new Map<number, Uint8Array>()
  const tiles = new Map<string, Tile>()
  const entries = new Map<string, Entry>()
  const clip = new Vector4()
  const matrix = new Matrix4()
  const color = new Color()
  const region = new Box2(new Vector2(), new Vector2())
  const destination = new Vector2()
  const accessible = document.createElement('div')
  accessible.setAttribute('role', 'list')
  accessible.style.cssText =
    'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;pointer-events:none'
  let ratio = Math.min(2, globalThis.devicePixelRatio || 1)
  let revision = 0
  let disposed = false
  const font_changed = (): void => {
    revision++
  }
  document.fonts?.addEventListener('loadingdone', font_changed)
  canvas.addEventListener('webglcontextrestored', font_changed)
  void document.fonts?.ready
    .then(() => {
      if (!disposed) font_changed()
    })
    .catch((error: unknown) => console.warn('Caption font readiness failed', error))

  const release = (entry: Entry): void => {
    if (!entry.tile) return
    entry.tile.refs--
    if (entry.tile.refs === 0) {
      if (entry.tile.allocation) entry.tile.allocation.page.slots.release(entry.tile.allocation.slot)
      tiles.delete(entry.key)
    }
    entry.tile = null
  }
  const copy = (page: Page, x: number, y: number, width: number, height: number): void => {
    scratch.needsUpdate = true
    region.max.set(width, height)
    destination.set(x, y)
    renderer.copyTextureToTexture(scratch, page.atlas, region, destination)
  }
  const add_page = (height: number): Page | null => {
    const wanted = Math.max(
      512,
      Math.sqrt(entries.size * CAPTION_CELL_WIDTH * CAPTION_ROW_HEIGHT),
      height + CAPTION_ROW_HEIGHT
    )
    const size = Math.min(CAPTION_ATLAS_SIZE, 2 ** Math.ceil(Math.log2(wanted)))
    const bytes = size * size * 4
    if (pages.reduce((total, page) => total + page.size ** 2 * 4, 0) + bytes > MAX_ATLAS_BYTES) return null
    let empty = empty_atlases.get(size)
    if (!empty) {
      empty = new Uint8Array(bytes)
      empty.fill(255, 0, 4) // Reserved solid texel also survives native GPU context restoration.
      empty_atlases.set(size, empty)
    }
    const page = create_page(scene, webgpu, size, empty)
    pages.push(page)
    const context = raster.canvas.getContext('2d')!
    context.resetTransform()
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 1, 1)
    copy(page, 0, 0, 1, 1)
    return page
  }
  const definition = (entry: Entry): Tile => {
    const key = `${revision}:${ratio}:${caption_raster_key(entry.caption)}`
    if (entry.tile && entry.key === key) return entry.tile
    release(entry)
    entry.key = key
    let tile = tiles.get(key)
    if (!tile) {
      const { width, height, body_width } = raster.measure(entry.caption)
      tile = { allocation: null, width, height, body_width, ratio, refs: 0 }
      tiles.set(key, tile)
    }
    tile.refs++
    entry.tile = tile
    return tile
  }
  const allocate = (tile: Tile, caption: WorldCaption): void => {
    if (tile.allocation) return
    const pixel_width = Math.ceil(tile.width * tile.ratio)
    const pixel_height = Math.ceil(tile.height * tile.ratio)
    let page: Page | undefined
    let slot: CaptionSlot | null = null
    for (const candidate of pages) {
      slot = candidate.slots.allocate(pixel_height)
      if (slot) {
        page = candidate
        break
      }
    }
    if (!page) {
      page = add_page(pixel_height) ?? undefined
      slot = page?.slots.allocate(pixel_height) ?? null
    }
    if (!page || !slot) return
    raster.paint(caption, tile.ratio)
    copy(page, slot.column * CAPTION_CELL_WIDTH, slot.row * CAPTION_ROW_HEIGHT, pixel_width, pixel_height)
    tile.allocation = { page, slot }
  }
  const quad = (
    page: Page,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    rect: readonly number[],
    tint: readonly number[]
  ): boolean => {
    const { count: index } = page.mesh
    if (index >= MAX_INSTANCES) return false
    matrix.makeScale(width, height, 1)
    matrix.setPosition(x, y, z)
    page.mesh.setMatrixAt(index, matrix)
    page.rectangles.setXYZW(index, rect[0]!, rect[1]!, rect[2]!, rect[3]!)
    page.tints.setXYZW(index, tint[0]!, tint[1]!, tint[2]!, tint[3]!)
    page.mesh.count++
    return true
  }
  const project = (entry: Entry, width: number, height: number) => {
    const anchor = entry.anchor()
    if (!anchor) return
    clip
      .set(anchor.x, anchor.y, anchor.z, 1)
      .applyMatrix4(camera.matrixWorldInverse)
      .applyMatrix4(camera.projectionMatrix)
    if (clip.w <= 0 || clip.z > clip.w || clip.z < (webgpu ? 0 : -clip.w)) return
    const tile = definition(entry)
    const pixels = (height * camera.projectionMatrix.elements[5]!) / (2 * clip.w)
    const dimensions = entry.caption.world_size
      ? { width: entry.caption.world_size[0] * pixels, height: entry.caption.world_size[1] * pixels, offset: 0 }
      : { width: tile.width, height: tile.height, offset: tile.height / 2 + 6 }
    const { width: w, height: h, offset } = dimensions
    const x = ((clip.x / clip.w) * width) / 2
    const y = ((clip.y / clip.w) * height) / 2 + offset
    if (Math.abs(x) > width / 2 + w || Math.abs(y) > height / 2 + h) return
    return { entry, tile, x, y, z: -clip.z / clip.w, w, h }
  }
  const draw = ({ entry, tile, x, y, z, w, h }: NonNullable<ReturnType<typeof project>>): void => {
    allocate(tile, entry.caption)
    if (!tile.allocation) return
    const { page, slot } = tile.allocation
    const opacity = entry.caption.opacity ?? 1
    const rect = [
      slot.column * CAPTION_CELL_WIDTH,
      slot.row * CAPTION_ROW_HEIGHT,
      tile.width * tile.ratio,
      tile.height * tile.ratio,
    ].map((value) => value / page.size)
    entry.visible = quad(page, x, y, z, w, h, rect, [1, 1, 1, opacity])
    if (entry.caption.health) {
      const fraction = Math.min(1, Math.max(0, entry.caption.health.fraction))
      color.set(entry.caption.health.color)
      const track_width = ((tile.body_width - 24) * w) / tile.width
      const bar_width = track_width * fraction
      quad(
        page,
        x - (track_width - bar_width) / 2,
        y - h / 2 + 13,
        z,
        bar_width,
        4,
        [0.5 / page.size, 0.5 / page.size, 0, 0],
        [color.r, color.g, color.b, opacity]
      )
    }
  }
  return Object.freeze({
    set: (id: string, caption: WorldCaption | null, anchor: () => Vector3 | null): void => {
      if (disposed) return
      const current = entries.get(id)
      if (!caption) {
        if (current) {
          release(current)
          current.accessible.remove()
          entries.delete(id)
        }
        if (!entries.size) {
          pages.forEach((page) => page.dispose())
          pages.length = 0
          empty_atlases.clear()
          accessible.remove()
        }
        return
      }
      const entry = current ?? {
        caption,
        anchor,
        key: '',
        tile: null,
        accessible: document.createElement('span'),
        visible: false,
      }
      entry.caption = caption
      entry.anchor = anchor
      const text = [
        caption.name,
        ...(caption.suffix ?? []).map((line) => line.text),
        ...(caption.lines ?? []).map((line) => line.text),
        caption.speech,
      ]
        .filter(Boolean)
        .join(' · ')
      if (entry.accessible.textContent !== text) entry.accessible.textContent = text
      entry.accessible.setAttribute('role', 'listitem')
      if (!current) {
        entry.accessible.hidden = true
        if (!accessible.isConnected) canvas.parentElement?.appendChild(accessible)
        accessible.appendChild(entry.accessible)
        entries.set(id, entry)
      }
    },
    render: (): void => {
      if (disposed || !entries.size) return
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width <= 0 || height <= 0) return
      ratio = Math.min(2, globalThis.devicePixelRatio || 1)
      camera.updateMatrixWorld()
      pages.forEach((page) => {
        page.mesh.count = 0
      })
      const frames = [...entries.values()].flatMap((entry) => {
        entry.visible = false
        const frame = project(entry, width, height)
        return frame ? [frame] : []
      })
      frames.forEach(({ tile, entry }) => allocate(tile, entry.caption))
      // Reclaim offscreen allocations only when the atlas budget cannot fit visible text.
      if (frames.some(({ tile }) => !tile.allocation)) {
        const wanted = new Set(frames.map(({ tile }) => tile))
        tiles.forEach((tile) => {
          if (!wanted.has(tile) && tile.allocation) {
            tile.allocation.page.slots.release(tile.allocation.slot)
            tile.allocation = null
          }
        })
      }
      frames.forEach(draw)
      entries.forEach((entry) => {
        const hidden = !entry.visible || entry.caption.accessible === false
        if (entry.accessible.hidden !== hidden) entry.accessible.hidden = hidden
      })
      for (let index = pages.length - 1; index >= 0; index--) {
        const page = pages[index]!
        if (page.slots.empty()) {
          page.dispose()
          pages.splice(index, 1)
          continue
        }
        upload(page.mesh.instanceMatrix, page.mesh.count)
        upload(page.rectangles, page.mesh.count)
        upload(page.tints, page.mesh.count)
      }
      overlay_camera.left = -width / 2
      overlay_camera.right = width / 2
      overlay_camera.top = height / 2
      overlay_camera.bottom = -height / 2
      overlay_camera.updateProjectionMatrix()
      const auto_clear = renderer.autoClear
      const target = renderer.getRenderTarget()
      const tone_mapping = renderer.toneMapping
      const output_color_space = renderer.outputColorSpace
      try {
        renderer.setRenderTarget(null)
        renderer.autoClear = false
        // The world is already display-mapped. Avoid Three's intermediate framebuffer/blit.
        renderer.toneMapping = NoToneMapping
        renderer.outputColorSpace = ColorManagement.workingColorSpace
        renderer.clearDepth()
        renderer.render(scene, overlay_camera)
      } finally {
        renderer.autoClear = auto_clear
        renderer.toneMapping = tone_mapping
        renderer.outputColorSpace = output_color_space
        renderer.setRenderTarget(target)
      }
    },
    stats: () => ({
      labels: entries.size,
      pages: pages.length,
      tiles: tiles.size,
      instances: pages.reduce((sum, page) => sum + page.mesh.count, 0),
    }),
    dispose: (): void => {
      disposed = true
      document.fonts?.removeEventListener('loadingdone', font_changed)
      canvas.removeEventListener('webglcontextrestored', font_changed)
      entries.clear()
      tiles.clear()
      pages.forEach((page) => page.dispose())
      pages.length = 0
      empty_atlases.clear()
      scratch.dispose()
      accessible.remove()
    },
  })
}
export type CaptionLayer = ReturnType<typeof create_caption_layer>
