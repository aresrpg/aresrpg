// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { get_quality_profile } from '@aresrpg/engine'
import {
  Footprints,
  Hammer,
  Mountain,
  Music2,
  RotateCcw,
  Settings as SettingsIcon,
  Swords,
  Volume2,
} from 'lucide-react'

import {
  effective_render_distance,
  RENDER_DISTANCE_MAX,
  RENDER_DISTANCE_MIN,
  type GameSettings,
} from '../game/core/settings.ts'
import { master_volume_from } from '../game/core/audio_volume.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

const Toggle = ({
  checked,
  label,
  change,
}: Readonly<{ checked: boolean; label: string; change: (checked: boolean) => void }>) => (
  <button
    aria-checked={checked}
    aria-label={label}
    className={`relative h-6 w-11 shrink-0 cursor-pointer border transition-colors ${checked ? 'border-gold bg-gold/15' : 'border-white/15 bg-white/3'}`}
    onClick={() => change(!checked)}
    role="switch"
    type="button"
  >
    <span
      className={`absolute top-0.5 size-[18px] transition-all ${checked ? 'left-[21px] bg-gold shadow-[0_0_7px_rgba(200,150,60,0.6)]' : 'left-0.5 bg-muted'}`}
    />
  </button>
)

export default function SettingsPage({ copy, settings }: Readonly<{ copy: AppCopy; settings: GameSettings }>) {
  const t = copy_text(copy.settings_page)
  const tutorial = copy_text(copy.tutorial)
  const characters = useAppStore(({ session }) => session.characters)
  const selected_character_id = useAppStore(({ session }) => session.selected_character_id)
  const craft_character_id = characters.find(({ id }) => id === settings.always_craft_from_character_id)?.id ?? null
  const default_craft_character_id =
    characters.find(({ id }) => id === selected_character_id)?.id ?? characters[0]?.id ?? null
  const change_music = (music_enabled: boolean): void =>
    dispatch_app({ type: 'settings/changed', settings: Object.freeze({ ...settings, music_enabled }) })
  const change_master_volume = (master_volume: number): void =>
    dispatch_app({ type: 'settings/changed', settings: Object.freeze({ ...settings, master_volume }) })
  const change_footsteps = (footsteps_enabled: boolean): void =>
    dispatch_app({ type: 'settings/changed', settings: Object.freeze({ ...settings, footsteps_enabled }) })
  const change_auto_switch = (auto_switch_fighter: boolean): void =>
    dispatch_app({ type: 'settings/changed', settings: Object.freeze({ ...settings, auto_switch_fighter }) })
  const change_render_distance = (render_distance: number): void =>
    dispatch_app({ type: 'settings/changed', settings: Object.freeze({ ...settings, render_distance }) })
  const change_craft_character = (always_craft_from_character_id: string | null): void =>
    dispatch_app({
      type: 'settings/changed',
      settings: Object.freeze({ ...settings, always_craft_from_character_id }),
    })
  const reset_tutorials = (): void =>
    dispatch_app({
      type: 'settings/changed',
      settings: Object.freeze({ ...settings, completed_tutorials: Object.freeze([]) }),
    })
  const render_distance = effective_render_distance(
    get_quality_profile(settings.quality).chunks.far_radius,
    settings.render_distance
  )
  const master_volume_percent = Math.round(master_volume_from(settings.master_volume) * 100)

  return (
    <section className="pointer-events-auto min-h-full flex-1 overflow-y-auto border border-border bg-bg/97 p-3 lg:p-8">
      <header className="mb-4 flex items-center gap-2.5 lg:mb-8">
        <SettingsIcon className="text-gold opacity-60" size={14} />
        <div>
          <h1 className="bg-[linear-gradient(135deg,#f5d0a9,#c8963c,#f0c474)] bg-clip-text text-[13px] font-semibold tracking-[0.3em] text-transparent uppercase">
            {t('title')}
          </h1>
          <p className="mt-1 text-[10px] tracking-wide text-muted">{t('subtitle')}</p>
        </div>
      </header>

      <div className="mt-4 flex max-w-lg items-center justify-between gap-5 border border-border bg-surface/80 p-4 lg:mt-8 lg:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <Volume2 className="shrink-0 text-gold opacity-70" size={15} />
          <div className="min-w-0">
            <div className="text-[11px] tracking-wide text-text">{t('master_volume_label')}</div>
            <div className="mt-1 text-[9px] leading-5 tracking-wide text-muted">{t('master_volume_hint')}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <input
            aria-label={t('master_volume_label')}
            className="w-32 cursor-pointer accent-gold"
            max={100}
            min={0}
            onChange={(event) => change_master_volume(Number(event.target.value) / 100)}
            step={5}
            type="range"
            value={master_volume_percent}
          />
          <output className="min-w-8 text-right text-[11px] text-gold tabular-nums">{master_volume_percent}%</output>
        </div>
      </div>

      <div className="mt-4 flex max-w-lg items-center justify-between gap-5 border border-border bg-surface/80 p-4 lg:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <Music2 className="shrink-0 text-gold opacity-70" size={15} />
          <div className="min-w-0">
            <div className="text-[11px] tracking-wide text-text">{t('music_label')}</div>
            <div className="mt-1 text-[9px] leading-5 tracking-wide text-muted">{t('music_hint')}</div>
          </div>
        </div>
        <Toggle change={change_music} checked={settings.music_enabled} label={t('music_label')} />
      </div>

      <div className="mt-4 flex max-w-lg items-center justify-between gap-5 border border-border bg-surface/80 p-4 lg:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <Footprints className="shrink-0 text-gold opacity-70" size={15} />
          <div className="min-w-0">
            <div className="text-[11px] tracking-wide text-text">{t('footsteps_label')}</div>
            <div className="mt-1 text-[9px] leading-5 tracking-wide text-muted">{t('footsteps_hint')}</div>
          </div>
        </div>
        <Toggle change={change_footsteps} checked={settings.footsteps_enabled !== false} label={t('footsteps_label')} />
      </div>

      <div className="mt-4 flex max-w-lg items-center justify-between gap-5 border border-border bg-surface/80 p-4 lg:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <Swords className="shrink-0 text-gold opacity-70" size={15} />
          <div className="min-w-0">
            <div className="text-[11px] tracking-wide text-text">{t('auto_switch_fighter_label')}</div>
            <div className="mt-1 text-[9px] leading-5 tracking-wide text-muted">{t('auto_switch_fighter_hint')}</div>
          </div>
        </div>
        <Toggle
          change={change_auto_switch}
          checked={settings.auto_switch_fighter !== false}
          label={t('auto_switch_fighter_label')}
        />
      </div>

      <div className="mt-4 flex max-w-lg items-center justify-between gap-5 border border-border bg-surface/80 p-4 lg:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <Hammer className="shrink-0 text-gold opacity-70" size={15} />
          <div className="min-w-0">
            <div className="text-[11px] tracking-wide text-text">{t('always_craft_from_label')}</div>
            <div className="mt-1 text-[9px] leading-5 tracking-wide text-muted">{t('always_craft_from_hint')}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <select
            aria-label={t('always_craft_from_picker')}
            className="min-w-40 border border-border bg-bg px-2 py-1.5 text-[9px] text-text disabled:opacity-40"
            disabled={craft_character_id === null}
            onChange={(event) => change_craft_character(event.target.value || null)}
            value={craft_character_id ?? ''}
          >
            <option value="">{t('always_craft_from_none')}</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} · LV.{character.level}
              </option>
            ))}
          </select>
          <Toggle
            change={(checked) => change_craft_character(checked ? default_craft_character_id : null)}
            checked={craft_character_id !== null}
            label={t('always_craft_from_label')}
          />
        </div>
      </div>

      <div className="mt-4 flex max-w-lg items-center justify-between gap-5 border border-border bg-surface/80 p-4 lg:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <Mountain className="shrink-0 text-gold opacity-70" size={15} />
          <div className="min-w-0">
            <div className="text-[11px] tracking-wide text-text">{t('render_distance_label')}</div>
            <div className="mt-1 text-[9px] leading-5 tracking-wide text-muted">{t('render_distance_hint')}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <input
            aria-label={t('render_distance_label')}
            className="w-32 cursor-pointer accent-gold"
            max={RENDER_DISTANCE_MAX}
            min={RENDER_DISTANCE_MIN}
            onChange={(event) => change_render_distance(Number(event.target.value))}
            step={1}
            type="range"
            value={render_distance}
          />
          <output className="min-w-4 text-right text-[11px] text-gold tabular-nums">{render_distance}</output>
        </div>
      </div>

      <div className="mt-4 flex max-w-lg items-center justify-between gap-5 border border-border bg-surface/80 p-4 lg:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <RotateCcw className="shrink-0 text-gold opacity-70" size={15} />
          <div className="min-w-0">
            <div className="text-[11px] tracking-wide text-text">{tutorial('reset_title')}</div>
            <div className="mt-1 text-[9px] leading-5 tracking-wide text-muted">{tutorial('reset_hint')}</div>
          </div>
        </div>
        <button className="btn-outline shrink-0 px-3 py-2 text-[9px] uppercase" onClick={reset_tutorials} type="button">
          {tutorial('reset_action')}
        </button>
      </div>
    </section>
  )
}
