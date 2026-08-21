// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Public composition lab. It owns controls only; every rendered fact crosses a production boundary.
import type { EngineQuality, EngineStatus } from '@aresrpg/engine'
import { class_names } from '@aresrpg/immutable'
import { Boxes, FlaskConical, Mountain, Package, RotateCcw, Swords, UserRound, UsersRound } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { FpsPanel } from '../components/FpsPanel.tsx'
import { HudPanel } from '../components/ui/HudPanel.tsx'
import { content_catalog, titleize, type SeedWorld } from '../content/catalog.ts'
import { worlds_source } from '../content/worlds.ts'
import { load_pet_companion } from '../content/pet_models.ts'
import { worn_cosmetic_options } from '../content/worn_cosmetics.ts'
import { create_world } from '../game/core/world.ts'
import { WorldStage } from '../game/core/WorldStage.tsx'
import { load_character_appearance } from '../game/character_entities.ts'
import { FightLayer } from '../game/fight/FightLayer.tsx'
import { mob_entities } from '../game/mob_entities.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import SimulatorPage from '../simulator/SimulatorPage.tsx'

// The seed editors ship only in the dev bundle: the /__seed doors exist only on the local Vite
// process, so production emits no editor chunks at all (the DEV check is static).
const ContentPage = import.meta.env.DEV
  ? lazy(() => import('../editor/ContentPage.tsx').then((m) => ({ default: m.ContentPage })))
  : (): null => null
const BiomePage = import.meta.env.DEV
  ? lazy(() => import('../editor/BiomePage.tsx').then((m) => ({ default: m.BiomePage })))
  : (): null => null

type DemoView = 'world' | 'fight' | 'content' | 'biomes'
const DEMO_VIEWS: readonly DemoView[] = Object.freeze(
  import.meta.env.DEV ? ['world', 'fight', 'content', 'biomes'] : ['world', 'fight']
)
const VIEW_ICONS = Object.freeze({ world: FlaskConical, fight: Swords, content: Package, biomes: Mountain })
const initial_view = (): DemoView => {
  const hash = globalThis.location.hash.slice(1)
  return (DEMO_VIEWS as readonly string[]).includes(hash) ? (hash as DemoView) : 'world'
}
type SpawnedGroup = Readonly<{ mob_type: string; amount: number; serial: number }>

const renderable_worlds = Object.freeze(content_catalog.worlds.filter(({ terrain }) => terrain !== undefined))
const initial_world = renderable_worlds[0] ?? null
const initial_mob = initial_world?.mobs[0]?.mob_type ?? content_catalog.mobs[0]?.mob_type ?? ''
const DEFAULT_COLORS = Object.freeze(['#f3eadb', '#2f8fe8', '#d9af57'] as const)
const { hats, cloaks } = worn_cosmetic_options
const pets = Object.freeze(content_catalog.items.filter(({ category }) => category === 'pet'))

const field_class =
  'h-9 min-w-0 border border-white/10 bg-[#08090e] px-2 text-[9px] text-[#d5d2cb] outline-none focus:border-[#4a9eff]/45'
const label_class = 'grid gap-1.5 text-[7px] tracking-[0.16em] text-[#777b86] uppercase'
const button_class =
  'flex h-9 cursor-pointer items-center justify-center gap-2 border border-[#4a9eff]/30 bg-[#4a9eff]/7 px-3 text-[8px] tracking-[0.14em] text-[#67adff] uppercase hover:border-[#4a9eff]/60 disabled:cursor-not-allowed disabled:opacity-30'

const world_mob_rows = (world: SeedWorld | null) =>
  Object.freeze(
    (world?.mobs ?? []).flatMap(({ mob_type }) => {
      const mob = content_catalog.mob(mob_type)?.mob
      return mob ? [Object.freeze({ mob_type, name: mob.name })] : []
    })
  )

const WorldLab = ({ active, copy }: Readonly<{ active: boolean; copy: AppCopy }>) => {
  const text = copy.demo_page
  const settings = useAppStore((state) => state.settings)
  const [canvas, set_canvas] = useState<HTMLCanvasElement | null>(null)
  const [world_id, set_world_id] = useState(initial_world?.world ?? '')
  const [world_api, set_world_api] = useState<ReturnType<typeof create_world> | null>(null)
  const [status, set_status] = useState<EngineStatus>({ state: 'initializing', backend: 'none' })
  const [time, set_time] = useState(0.31)
  const [live_time, set_live_time] = useState(true)
  const [classe, set_classe] = useState<(typeof class_names)[number]>('senshi')
  const [male, set_male] = useState(true)
  const [colors, set_colors] = useState<readonly [string, string, string]>(DEFAULT_COLORS)
  const [character_enabled, set_character_enabled] = useState(false)
  const [hat, set_hat] = useState('')
  const [cloak, set_cloak] = useState('')
  const [pet, set_pet] = useState('')
  const [riding, set_riding] = useState(false)
  const [mob_type, set_mob_type] = useState(initial_mob)
  const [mob_amount, set_mob_amount] = useState(3)
  const [spawned_group, set_spawned_group] = useState<SpawnedGroup | null>(null)
  const selected_world = content_catalog.world(world_id)
  const mob_rows = useMemo(() => world_mob_rows(selected_world), [selected_world])
  const resource_rows = useMemo(
    () =>
      Object.freeze(
        (selected_world?.resources ?? []).map(({ item_type }) =>
          Object.freeze({ item_type, name: content_catalog.item(item_type)?.item.name ?? titleize(item_type) })
        )
      ),
    [selected_world]
  )

  useEffect(() => {
    if (!mob_rows.some((row) => row.mob_type === mob_type)) set_mob_type(mob_rows[0]?.mob_type ?? '')
  }, [mob_rows, mob_type])

  useEffect(() => {
    // THE LAB'S ENGINE IS LAZY (owner 2026-08-21): every pane on this page stays mounted and is
    // only hidden by CSS, so building the world eagerly meant a second live WebGPU engine — and a
    // second publisher of the one scene — for anyone who never opened the biome editor at all.
    if (!active || !canvas || !selected_world?.terrain) return undefined
    const created = create_world({ canvas, world: selected_world.terrain, quality: settings.quality })
    const unsubscribe = created.subscribe_status(set_status)
    set_world_api(created)
    return () => {
      unsubscribe()
      created.dispose()
      set_world_api((current) => (current === created ? null : current))
    }
    // World identity is the lifetime boundary; settings update through their own production doors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, canvas, world_id])

  useEffect(() => {
    world_api?.set_active(active)
    world_api?.set_interactive(active)
  }, [active, world_api])

  useEffect(() => {
    world_api?.set_quality(settings.quality, settings.render_distance)
    world_api?.set_flattened(settings.flat_mode)
  }, [settings.flat_mode, settings.quality, settings.render_distance, world_api])

  useEffect(() => {
    world_api?.set_time_of_day(live_time ? null : time)
  }, [live_time, time, world_api])

  useEffect(() => {
    if (!world_api || !character_enabled) {
      world_api?.set_character(null)
      world_api?.release()
      return undefined
    }
    let current = true
    const source = Object.freeze({
      id: 'demo_character',
      classe,
      male,
      colors,
      loadout: Object.freeze({ ...(hat ? { hat } : {}), ...(cloak ? { cloak } : {}) }),
    })
    void load_character_appearance(source).then(
      (appearance) => {
        if (!current) return
        world_api.set_character(Object.freeze({ id: source.id, appearance }))
      },
      (error: unknown) => console.error('The demo character model failed to load.', error)
    )
    return () => {
      current = false
    }
  }, [character_enabled, classe, cloak, colors, hat, male, world_api])

  // handing over control spawns at the camera's current focus — never a hardcoded origin;
  // cosmetic re-renders keep the character exactly where it stands
  useEffect(() => {
    if (!world_api || !character_enabled) return
    world_api.point_at(world_api.camera_focus())
  }, [character_enabled, world_api])

  useEffect(() => {
    set_riding(false)
    world_api?.set_riding(false)
    if (!world_api || !character_enabled || !pet) {
      world_api?.set_pet(null)
      return undefined
    }
    let current = true
    void load_pet_companion('demo_pet', pet).then((companion) => {
      if (current && companion) world_api.set_pet(companion)
    })
    return () => {
      current = false
      world_api.set_pet(null)
    }
  }, [character_enabled, pet, world_api])

  useEffect(() => {
    if (!active || !world_api || !character_enabled || !pet) return undefined
    const toggle = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyX' || event.repeat) return
      event.preventDefault()
      set_riding((current) => {
        world_api.set_riding(!current)
        return world_api.riding()
      })
    }
    globalThis.addEventListener('keydown', toggle)
    return () => globalThis.removeEventListener('keydown', toggle)
  }, [active, character_enabled, pet, world_api])

  useEffect(() => {
    if (!world_api || !spawned_group) {
      world_api?.set_entities(Object.freeze([]))
      return
    }
    const entities = mob_entities(
      Array.from({ length: spawned_group.amount }, (_, index) => {
        const angle = (index / spawned_group.amount) * Math.PI * 2
        const x = Math.cos(angle) * 5
        const z = Math.sin(angle) * 5
        return Object.freeze({
          id: `demo_mob_${spawned_group.serial}_${index}`,
          mob_type: spawned_group.mob_type,
          anchor: Object.freeze({
            kind: 'world' as const,
            position: Object.freeze([x, world_api.ground_height(x, z), z] as const),
          }),
          facing: Object.freeze({ kind: 'yaw' as const, yaw: Math.atan2(-x, -z) }),
        })
      })
    )
    world_api.set_entities(entities)
  }, [spawned_group, world_api])

  const change_quality = (quality: EngineQuality): void =>
    dispatch_app({ type: 'settings/changed', settings: Object.freeze({ ...settings, quality }) })
  const toggle_flattened = (): void =>
    dispatch_app({
      type: 'settings/changed',
      settings: Object.freeze({ ...settings, flat_mode: !settings.flat_mode }),
    })
  const update_color = (index: number, value: string): void =>
    set_colors(
      Object.freeze(colors.map((color, color_index) => (color_index === index ? value : color))) as typeof colors
    )

  return (
    <section className={`absolute inset-0 ${active ? 'visible opacity-100' : 'invisible opacity-0'}`}>
      <canvas className="absolute inset-0 size-full touch-none" ref={set_canvas} />
      <div className="pointer-events-none absolute inset-0 z-10 p-3">
        <FpsPanel
          active={active}
          change_quality={change_quality}
          copy={copy}
          flattened={settings.flat_mode}
          quality={settings.quality}
          toggle_flattened={toggle_flattened}
        />
        <HudPanel className="pointer-events-auto absolute top-3 right-3 flex max-h-[calc(100%-24px)] w-[270px] flex-col overflow-y-auto p-3">
          <div className="flex items-center gap-2 border-b border-white/8 pb-3">
            <FlaskConical className="text-[#c8963c]" size={14} />
            <div className="min-w-0 flex-1">
              <h1 className="text-[10px] font-semibold tracking-[0.18em] uppercase">{text.title}</h1>
              <p className="mt-1 text-[7px] tracking-[0.12em] text-[#6b7280] uppercase">
                {status.backend} · {status.state}
              </p>
            </div>
          </div>

          <div className="grid gap-3 border-b border-white/8 py-3">
            <label className={label_class}>
              {copy.world}
              <select className={field_class} onChange={(event) => set_world_id(event.target.value)} value={world_id}>
                {content_catalog.worlds.map((world) => (
                  <option disabled={!world.terrain} key={world.world} value={world.world}>
                    {titleize(world.world)}
                    {world.terrain ? '' : ` · ${text.no_terrain}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <label className={label_class}>
                {text.time}
                <input
                  className="h-9 cursor-pointer accent-[#4a9eff]"
                  disabled={live_time}
                  max={1}
                  min={0}
                  onChange={(event) => set_time(Number(event.target.value))}
                  step={0.01}
                  type="range"
                  value={time}
                />
              </label>
              <label className="flex cursor-pointer items-end gap-2 pb-2 text-[7px] tracking-[0.14em] text-[#777b86] uppercase">
                {text.live}
                <input
                  checked={live_time}
                  className="cursor-pointer accent-[#4a9eff]"
                  onChange={(event) => set_live_time(event.target.checked)}
                  type="checkbox"
                />
              </label>
            </div>
          </div>

          <div className="grid gap-3 border-b border-white/8 py-3">
            <h2 className="flex items-center gap-2 text-[8px] tracking-[0.18em] text-[#c8963c] uppercase">
              <UserRound size={12} /> {copy.characters}
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <label className={label_class}>
                {copy.class_label}
                <select
                  className={field_class}
                  onChange={(event) => set_classe(event.target.value as typeof classe)}
                  value={classe}
                >
                  {class_names.map((name) => (
                    <option key={name} value={name}>
                      {name.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label_class}>
                {copy.sex_label}
                <select
                  className={field_class}
                  onChange={(event) => set_male(event.target.value === 'male')}
                  value={male ? 'male' : 'female'}
                >
                  <option value="male">{copy.male}</option>
                  <option value="female">{copy.female}</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {colors.map((color, index) => (
                <input
                  aria-label={`${copy.appearance_label} ${index + 1}`}
                  className="h-8 w-full cursor-pointer border border-white/10 bg-transparent p-1"
                  key={index}
                  onChange={(event) => update_color(index, event.target.value)}
                  type="color"
                  value={color}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className={label_class}>
                {text.hat}
                <select className={field_class} onChange={(event) => set_hat(event.target.value)} value={hat}>
                  <option value="">{text.none}</option>
                  {hats.map(({ item_type, name }) => (
                    <option key={item_type} value={item_type}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label_class}>
                {text.cloak}
                <select className={field_class} onChange={(event) => set_cloak(event.target.value)} value={cloak}>
                  <option value="">{text.none}</option>
                  {cloaks.map(({ item_type, name }) => (
                    <option key={item_type} value={item_type}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={label_class}>
              {text.pet}
              <select className={field_class} onChange={(event) => set_pet(event.target.value)} value={pet}>
                <option value="">{text.none}</option>
                {pets.map(({ item_type, name }) => (
                  <option key={item_type} value={item_type}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button className={button_class} onClick={() => set_character_enabled((enabled) => !enabled)} type="button">
              {character_enabled ? text.remove_character : text.control_character}
            </button>
          </div>

          <div className="grid gap-3 border-b border-white/8 py-3">
            <h2 className="flex items-center gap-2 text-[8px] tracking-[0.18em] text-[#c8963c] uppercase">
              <UsersRound size={12} /> {text.mob_group}
            </h2>
            <label className={label_class}>
              {text.mob}
              <select className={field_class} onChange={(event) => set_mob_type(event.target.value)} value={mob_type}>
                {mob_rows.map((mob) => (
                  <option key={mob.mob_type} value={mob.mob_type}>
                    {mob.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label_class}>
              {text.amount}
              <input
                className={field_class}
                max={8}
                min={1}
                onChange={(event) => set_mob_amount(Number(event.target.value))}
                type="number"
                value={mob_amount}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={button_class}
                disabled={!mob_type}
                onClick={() =>
                  set_spawned_group((group) =>
                    Object.freeze({
                      mob_type,
                      amount: Math.min(8, Math.max(1, Math.trunc(mob_amount) || 1)),
                      serial: (group?.serial ?? 0) + 1,
                    })
                  )
                }
                type="button"
              >
                {text.spawn_group}
              </button>
              <button className={button_class} onClick={() => set_spawned_group(null)} type="button">
                <RotateCcw size={11} /> {text.clear}
              </button>
            </div>
          </div>

          <div className="grid gap-2 pt-3">
            <h2 className="flex items-center gap-2 text-[8px] tracking-[0.18em] text-[#c8963c] uppercase">
              <Boxes size={12} /> {text.resources}
            </h2>
            {resource_rows.map(({ item_type, name }) => (
              <div className="border border-white/8 bg-black/18 px-2 py-2 text-[8px] text-[#a3a5ad]" key={item_type}>
                {name}
              </div>
            ))}
            <p className="text-[8px] leading-4 text-[#777b86]">{text.resources_missing}</p>
          </div>
        </HudPanel>
        {character_enabled && pet ? (
          <button
            className="pointer-events-auto absolute bottom-24 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-2 border border-[#c8963c]/35 bg-[linear-gradient(165deg,#12121a,#0a0a0f)] px-3.5 py-2 font-mono text-[9px] tracking-[0.18em] uppercase shadow-[0_0_0_1px_rgba(200,150,60,0.08)] transition hover:border-[#c8963c] hover:shadow-[0_0_20px_rgba(200,150,60,0.35)]"
            onClick={() => {
              world_api?.set_riding(!riding)
              set_riding(world_api?.riding() ?? false)
            }}
            type="button"
          >
            <kbd className="flex h-5 min-w-5 items-center justify-center border border-[#c8963c] px-1 text-[9px] font-semibold text-[#c8963c] shadow-[inset_0_0_8px_rgba(200,150,60,0.2)]">
              X
            </kbd>
            <span className="text-[#e8c878]">{riding ? text.dismount_pet : text.ride_pet}</span>
          </button>
        ) : (
          <HudPanel className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-2 text-[8px] tracking-[0.15em] text-[#a3a5ad] uppercase">
            {character_enabled ? text.control_hint : copy.drag_hint}
          </HudPanel>
        )}
      </div>
    </section>
  )
}

export const DemoPage = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const quality = useAppStore((state) => state.settings.quality)
  const [view, set_view] = useState<DemoView>(initial_view)
  const text = copy.demo_page
  const seed_changed = useRef(false)
  // the seed corpus loads on first editor-tab open, never on a plain lab visit (reducer ignores
  // the input unless the editor is still idle)
  useEffect(() => {
    if (view === 'content' || view === 'biomes') dispatch_app({ type: 'editor/load' })
  }, [view])
  // Seed saves no longer full-reload (the vite plugin suppresses the JSON invalidation and sends
  // this event instead): while editing, the editor state IS the fresh truth; the reload is owed
  // only when a lab tab needs the rebuilt seed imports — deferred to the next tab switch.
  useEffect(() => {
    const on_seed_changed = (): void => {
      const editing = globalThis.location.hash === '#content' || globalThis.location.hash === '#biomes'
      if (editing) {
        // eslint-disable-next-line functional/immutable-data -- a React ref is the sanctioned mutable cell
        seed_changed.current = true
        return
      }
      globalThis.location.reload()
    }
    import.meta.hot?.on('aresrpg:seed-changed', on_seed_changed)
    return () => import.meta.hot?.off('aresrpg:seed-changed', on_seed_changed)
  }, [])
  // the hash survives any reload — you land back on your tab
  const select_view = (next: DemoView): void => {
    globalThis.history.replaceState(null, '', `#${next}`)
    if (seed_changed.current && next !== 'content' && next !== 'biomes') {
      globalThis.location.reload()
      return
    }
    set_view(next)
  }
  const view_label = (candidate: DemoView): string =>
    candidate === 'world'
      ? text.world_lab
      : candidate === 'fight'
        ? text.fight_lab
        : candidate === 'content'
          ? 'Content'
          : 'Biomes'

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#08090e] font-mono text-[#e8e4dc]">
      <WorldLab active={view === 'world'} copy={copy} />
      {/* UNMOUNTED, not merely hidden: a surface you cannot see must not exist, and a mounted
          one would keep a whole world alive behind the tab you are actually looking at. */}
      {view === 'fight' && (
        <section className="absolute inset-0">
          {/* ONE stage, handed to both children. The setup board and any live fight draw into
              the SAME world, and neither can reach the biome lab's. */}
          <WorldStage quality={quality} terrain={worlds_source[0]?.terrain}>
            {(scene) => (
              <>
                <SimulatorPage copy={copy} scene={scene} />
                <FightLayer copy={copy} scene={scene} />
              </>
            )}
          </WorldStage>
        </section>
      )}
      {import.meta.env.DEV && (view === 'content' || view === 'biomes') && (
        <section className="absolute inset-0 flex flex-col bg-[#0d0d14] pt-14">
          <Suspense
            fallback={
              <div className="grid flex-1 place-items-center text-[9px] tracking-[0.18em] text-[#c8963c] uppercase">
                Loading seed files…
              </div>
            }
          >
            {view === 'content' ? <ContentPage /> : <BiomePage />}
          </Suspense>
        </section>
      )}
      <HudPanel className="pointer-events-auto fixed top-3 left-1/2 z-50 flex -translate-x-1/2 overflow-hidden text-[8px] tracking-[0.16em] uppercase">
        {DEMO_VIEWS.map((candidate) => {
          const ViewIcon = VIEW_ICONS[candidate]
          return (
            <button
              className={`flex cursor-pointer items-center gap-2 px-4 py-2.5 ${
                view === candidate ? 'bg-[#4a9eff]/12 text-[#67adff]' : 'text-[#777b86] hover:text-[#d5d2cb]'
              }`}
              key={candidate}
              onClick={() => select_view(candidate)}
              type="button"
            >
              <ViewIcon size={11} />
              {view_label(candidate)}
            </button>
          )
        })}
        <a className="border-l border-white/10 px-4 py-2.5 text-[#c8963c] hover:bg-[#c8963c]/8" href="/">
          {text.back}
        </a>
      </HudPanel>
      <div className="pointer-events-none fixed inset-0 z-40 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(200,150,60,0.014)_2px,rgba(200,150,60,0.014)_4px)]" />
    </main>
  )
}

export default DemoPage
