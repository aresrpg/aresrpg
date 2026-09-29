// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Public composition lab. It owns controls only; every rendered fact crosses a production boundary.

import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'
import { type EngineQuality, type EngineStatus } from '@aresrpg/engine'
import { class_names } from '@aresrpg/immutable'
import { FlaskConical, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { WorldLoading } from '../components/WorldLoading.tsx'
import { FpsPanel } from '../components/FpsPanel.tsx'
import { fight_lab_surface } from '../components/app_layout.ts'
import { HudPanel } from '../components/ui/HudPanel.tsx'
import { content_catalog, titleize } from '../content/catalog.ts'
import { client_world_position, worlds_source, world_terrain } from '../content/worlds.ts'
import { load_pet_companion } from '../content/pet_models.ts'
import { worn_equipment_options } from '../content/worn_equipment.ts'
import { create_world } from '../game/core/world.ts'
import type { SceneHandle } from '../game/core/scene_feed.ts'
import { WorldStage } from '../game/core/WorldStage.tsx'
import { load_character_appearance, character_aura } from '../game/character_entities.ts'
import { FightLayer } from '../game/fight/FightLayer.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { dungeon_portal_markers } from '../modules/world_spawns.ts'
import { DungeonPortalPrompt } from '../components/DungeonPortalPrompt.tsx'
import { dispatch_app, useAppStore } from '../store.ts'
import SimulatorPage from '../simulator/SimulatorPage.tsx'

import { AtmosphereControls } from './AtmosphereControls.tsx'
import { AssetWorkshop } from './AssetWorkshop.tsx'
import { BoardGallery } from './BoardGallery.tsx'
import { CharacterCrowdLab } from './CharacterCrowdLab.tsx'
import { UiWorkshop } from './UiWorkshop.tsx'
import { DemoCheckbox } from './DemoCheckbox.tsx'
import { DemoDevPage } from './DemoDevPage.tsx'
import { DEMO_VIEWS, VIEW_ICONS, demo_view, type DemoView } from './demo_views.ts'
import { demo_world_coordinate } from './world_target.ts'

const initial_target = (): string => globalThis.location.hash.slice(1).split('/')[1] ?? ''
type DemoWorld = ReturnType<typeof create_world>

const renderable_worlds = Object.freeze(content_catalog.worlds.filter(({ terrain }) => terrain !== undefined))
const initial_world = renderable_worlds[0] ?? null
const DEFAULT_COLORS = Object.freeze(['#f3eadb', '#2f8fe8', '#d9af57'] as const)
const { hats, cloaks } = worn_equipment_options
const pets = Object.freeze(content_catalog.items.filter(({ category }) => category === 'pet'))

const WorldCrowdLab = ({
  text,
  world_api,
}: Readonly<{
  text: AppCopy['demo_page']
  world_api: DemoWorld | null
}>) => {
  if (!world_api) return null
  return <CharacterCrowdLab ground_height={world_api.ground_height} submit={world_api.set_entities} text={text} />
}

const field_class =
  'h-9 min-w-0 border border-white/10 bg-bg px-2 text-[9px] text-[#d5d2cb] outline-none focus:border-[#4a9eff]/45'
const label_class = 'grid gap-1.5 text-[7px] tracking-[0.16em] text-[#777b86] uppercase'
const button_class =
  'flex h-9 cursor-pointer items-center justify-center gap-2 border border-[#4a9eff]/30 bg-[#4a9eff]/7 px-3 text-[8px] tracking-[0.14em] text-[#67adff] uppercase hover:border-[#4a9eff]/60 disabled:cursor-not-allowed disabled:opacity-30'

const FightLabSurface = ({ copy, scene }: Readonly<{ copy: AppCopy; scene: SceneHandle }>) => {
  const surface = fight_lab_surface(useAppStore((state) => state.fight.mounted))
  return surface === 'fight' ? <FightLayer copy={copy} scene={scene} /> : <SimulatorPage copy={copy} scene={scene} />
}

const WorldLab = ({ active, copy }: Readonly<{ active: boolean; copy: AppCopy }>) => {
  const text = copy.demo_page
  const settings = useAppStore((state) => state.settings)
  const [canvas, set_canvas] = useState<HTMLCanvasElement | null>(null)
  const [world_id, set_world_id] = useState(initial_world?.world ?? '')
  const [target, set_target] = useState(initial_target)
  const [world_api, set_world_api] = useState<ReturnType<typeof create_world> | null>(null)
  const [status, set_status] = useState<EngineStatus>({ state: 'initializing', backend: 'none' })
  const [time, set_time] = useState(0.31)
  const [live_time, set_live_time] = useState(true)
  const [clouds_visible, set_clouds_visible] = useState(true)
  const [classe, set_classe] = useState<(typeof class_names)[number]>('senshi')
  const [male, set_male] = useState(true)
  const [colors, set_colors] = useState<readonly [string, string, string]>(DEFAULT_COLORS)
  const [character_enabled, set_character_enabled] = useState(false)
  const [hat, set_hat] = useState('')
  const [cloak, set_cloak] = useState('')
  const [title, set_title] = useState('')
  const [admin_preview, set_admin_preview] = useState(false)
  const [pet, set_pet] = useState('')
  const [riding, set_riding] = useState(false)
  const selected_world = content_catalog.world(world_id)

  useEffect(() => {
    const update_target = (): void => set_target(initial_target())
    globalThis.addEventListener('hashchange', update_target)
    return () => globalThis.removeEventListener('hashchange', update_target)
  }, [])

  useEffect(() => {
    // THE LAB'S ENGINE IS LAZY (owner 2026-08-21): every pane on this page stays mounted and is
    // only hidden by CSS, so building the world eagerly meant a second live WebGPU engine — and a
    // second publisher of the one scene — for anyone who never opened the biome editor at all.
    if (!active || !canvas || !selected_world?.terrain) return undefined
    const terrain = world_terrain(selected_world.world)
    if (!terrain) return undefined
    const city = selected_world.cities.find(({ city: slug }) => slug === target)
    const initial_focus = city ? client_world_position(city.x, city.z) : demo_world_coordinate(target)
    const created = create_world({
      canvas,
      world: terrain,
      quality: settings.quality,
      ...(initial_focus ? { initial_focus } : {}),
    })
    created.set_dungeon_portals(dungeon_portal_markers(selected_world.world))
    const unsubscribe = created.subscribe_status(set_status)
    set_world_api(created)
    return () => {
      unsubscribe()
      created.dispose()
      set_world_api((current) => (current === created ? null : current))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, canvas, target, world_id])

  useEffect(() => {
    world_api?.set_active(active)
    world_api?.set_interactive(active)
  }, [active, world_api])

  useEffect(() => {
    world_api?.set_quality(settings.quality, settings.render_distance)
  }, [settings.quality, settings.render_distance, world_api])

  useEffect(() => {
    world_api?.set_time_of_day(live_time ? null : time)
  }, [live_time, time, world_api])

  useEffect(() => world_api?.set_clouds_visible(clouds_visible), [clouds_visible, world_api])

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
      loadout: Object.freeze({ ...(hat ? { hat } : {}), ...(cloak ? { cloak } : {}), ...(title ? { title } : {}) }),
    })
    void load_character_appearance(source).then(
      (appearance) => {
        if (!current) return
        world_api.set_character(
          Object.freeze({
            id: source.id,
            appearance,
            aura: character_aura(title, admin_preview ? DEFAULT_ADMIN_ADDRESS : null),
          })
        )
      },
      (error: unknown) => console.error('The demo character model failed to load.', error)
    )
    return () => {
      current = false
    }
  }, [character_enabled, classe, cloak, colors, hat, male, title, admin_preview, world_api])

  // handing over control spawns at the camera's current focus — never a hardcoded origin;
  // worn-equipment re-renders keep the character exactly where it stands
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
    const toggle = (event: Readonly<KeyboardEvent>): void => {
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

  const change_quality = (quality: EngineQuality): void =>
    dispatch_app({ type: 'settings/changed', settings: Object.freeze({ ...settings, quality }) })
  const update_color = (index: number, value: string): void =>
    set_colors(
      Object.freeze(colors.map((color, color_index) => (color_index === index ? value : color))) as typeof colors
    )

  return (
    <section className={`absolute inset-0 ${active ? 'visible opacity-100' : 'invisible opacity-0'}`}>
      <canvas className="absolute inset-0 size-full touch-none" ref={set_canvas} />
      <DungeonPortalPrompt copy={copy} />
      <WorldLoading source={world_api} quality={settings.quality} render_distance={settings.render_distance} />
      <div className="pointer-events-none absolute inset-0 z-10 p-3">
        <FpsPanel
          active={active}
          change_quality={change_quality}
          copy={copy}
          fight_access={null}
          party_available={false}
          quality={settings.quality}
          toggle_fight_access={() => undefined}
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

          <WorldCrowdLab text={text} world_api={world_api} />

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
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
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
              <DemoCheckbox checked={live_time} label={text.live} on_change={set_live_time} />
              <DemoCheckbox checked={clouds_visible} label="Clouds" on_change={set_clouds_visible} />
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
              {copy.ui.design_titles}
              <select className={field_class} onChange={(event) => set_title(event.target.value)} value={title}>
                <option value="">{text.none}</option>
                {content_catalog.items
                  .filter(({ category }) => category === 'title')
                  .map(({ item_type, name }) => (
                    <option key={item_type} value={item_type}>
                      {name}
                    </option>
                  ))}
              </select>
            </label>
            <DemoCheckbox checked={admin_preview} label={copy.admin} on_change={set_admin_preview} />
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

          <AtmosphereControls key={world_id} world={world_api} quality={settings.quality} text={text} />
        </HudPanel>
        {character_enabled && pet ? (
          <button
            className="pointer-events-auto absolute bottom-24 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-2 border border-[#c8963c]/35 bg-[linear-gradient(165deg,var(--color-surface),var(--color-bg))] px-3.5 py-2 font-mono text-[9px] tracking-[0.18em] uppercase shadow-[0_0_0_1px_rgba(200,150,60,0.08)] transition hover:border-[#c8963c] hover:shadow-[0_0_20px_rgba(200,150,60,0.35)]"
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
  const [view, set_view] = useState<DemoView>(() => demo_view(globalThis.location.hash))
  const text = copy.demo_page
  const seed_changed = useRef(false)
  useEffect(() => {
    const restore_view = () => set_view(demo_view(globalThis.location.hash))
    globalThis.addEventListener('hashchange', restore_view)
    return () => globalThis.removeEventListener('hashchange', restore_view)
  }, [])
  useEffect(() => {
    if (view === 'boards' || view === 'content' || view === 'biomes') dispatch_app({ type: 'editor/load' })
  }, [view])
  // Seed saves no longer full-reload (the vite plugin suppresses the JSON invalidation and sends
  // this event instead): while editing, the editor state IS the fresh truth; the reload is owed
  // only when a lab tab needs the rebuilt seed imports — deferred to the next tab switch.
  useEffect(() => {
    const on_seed_changed = (): void => {
      const editing = ['#boards', '#content', '#biomes'].some((hash) => globalThis.location.hash.startsWith(hash))
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
    if (seed_changed.current && next !== 'boards' && next !== 'content' && next !== 'biomes') {
      globalThis.location.reload()
      return
    }
    set_view(next)
  }
  const view_label = (candidate: DemoView): string =>
    ({
      ui: copy.ui.design_library,
      world: text.world_lab,
      assets: text.asset_gallery,
      fight: text.fight_lab,
      boards: text.fight_board,
      content: 'Content',
      biomes: 'Biomes',
    })[candidate]

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg font-mono text-[#e8e4dc]">
      <WorldLab active={view === 'world'} copy={copy} />
      {view === 'fight' && (
        <section className="absolute inset-0">
          <WorldStage quality={quality} terrain={worlds_source[0]?.terrain}>
            {(scene) => <FightLabSurface copy={copy} scene={scene} />}
          </WorldStage>
        </section>
      )}
      {view === 'assets' && <AssetWorkshop copy={copy} />}
      {view === 'boards' && <BoardGallery text={text} />}
      <DemoDevPage view={view} />
      {view === 'ui' && <UiWorkshop copy={copy} />}
      <HudPanel
        className={`pointer-events-auto fixed top-3 left-1/2 z-50 flex max-w-[calc(100vw-16px)] -translate-x-1/2 overflow-x-auto text-[8px] tracking-[0.16em] uppercase`}
      >
        {DEMO_VIEWS.map((candidate) => {
          const ViewIcon = VIEW_ICONS[candidate]
          return (
            <button
              className={`flex min-h-11 shrink-0 cursor-pointer items-center gap-2 px-4 py-2.5 ${
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
      <div
        hidden={view === 'ui'}
        className="pointer-events-none fixed inset-0 z-40 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(200,150,60,0.014)_2px,rgba(200,150,60,0.014)_4px)]"
      />
    </main>
  )
}
export default DemoPage
