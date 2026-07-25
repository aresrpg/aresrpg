// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Settings as SettingsIcon, Fuel, Monitor, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { use_auth, type AuthState } from '../auth'
import { use_sponsor_allowance } from '../rpc/use_sponsor_allowance'
import { use_settings } from '../stores/settings'
import { format_mist_to_sui } from '../utils/sui_mist'
import {
  get_saved_ambience,
  get_saved_sun_follow,
  get_saved_sky_couple,
  get_saved_taau_medium,
  get_saved_hack_mode,
  get_saved_far_field_experimental,
  get_saved_reveal_style,
  REVEAL_STYLE_OPTIONS,
} from '../game/screens/hud/world/engine_flags_pref.js'
import { set_sun_follow, set_sky_couple, set_taau_medium, set_hack_mode } from '../game/screens/hud/world/engine_flags.js'
import {
  is_music_enabled,
  start as start_music,
  stop as stop_music,
  is_fight_music_enabled,
  set_fight_music_enabled,
} from '../game/core/audio/ambient_music.js'
import { is_sfx_enabled, set_sfx_enabled } from '../game/core/audio/sfx.js'

// Settings meta-tab: a settings page with a simple toggle enabled by
// default. Holds THREE sections today — sponsored gameplay, the graduated engine graphics flags (the
// FLAGS → SETTINGS PAGE lane 2679: if you really want these flags, add them in the settings
// page), and audio (MUSIC / FIGHT MUSIC / SOUND EFFECTS, each already owned by its own
// audio module — this page only reads/writes them) — and is the future home for any other client-side
// preference that outgrows a single HUD widget (render-QUALITY / HP-display stay put: they are in-context
// toggles next to what they affect — world/quality_pref.js, hud/hp_display_pref.js; these are a DIFFERENT
// set of engine dev-URL flags with no in-context HUD widget of their own).
//
// Routing: app.tsx has `<Route path="/settings" element={<SettingsPage />} />` and
// constants/navigation.ts carries the NAV_ITEMS entry.

// One boolean settings row — factored out of the sponsor toggle's markup below (byte-identical render
// output) because the graphics section needs it 5 times; the sponsor row itself is untouched/unmoved
// (frozen surface — this is additive, never a drive-by refactor of working code).
function ToggleRow({
  label,
  hint,
  checked,
  disabled = false,
  on_change = () => {},
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  on_change?: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-text text-[11px] tracking-wide">{label}</span>
        <span className="text-muted text-[9px] tracking-wide leading-relaxed">{hint}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => on_change(!checked)}
        className="shrink-0 relative w-9 h-5 border cursor-pointer transition-colors hover:shadow-[0_0_12px_rgba(200,150,60,0.25)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-none"
        style={{
          borderColor: checked ? '#c8963c' : 'rgba(255,255,255,0.15)',
          background: checked ? 'rgba(200,150,60,0.15)' : 'rgba(255,255,255,0.03)',
        }}
      >
        <span
          className="absolute top-0.5 h-3.5 w-3.5 transition-all"
          style={{
            left: checked ? '18px' : '2px',
            background: checked ? '#c8963c' : '#6b7280',
            boxShadow: checked ? '0 0 6px rgba(200,150,60,0.6)' : 'none',
          }}
        />
      </button>
    </div>
  )
}

// One enum settings row (first-load reveal style — a select, not a toggle). Same label/hint left column as
// ToggleRow; the control swaps to a native <select> styled off the house @theme tokens (index.css) since no
// Tailwind-styled <select> precedent exists on a player-facing page yet — a boring native form control, not
// a new visual pattern.
function SelectRow({
  label,
  hint,
  value,
  options,
  disabled = false,
  on_change = () => {},
}: {
  label: string
  hint: string
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  on_change?: (next: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-text text-[11px] tracking-wide">{label}</span>
        <span className="text-muted text-[9px] tracking-wide leading-relaxed">{hint}</span>
      </div>
      <select
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => on_change(e.target.value)}
        className="shrink-0 bg-bg border border-border text-text text-[10px] tracking-wide uppercase px-2 py-1 cursor-pointer focus:border-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const enabled = use_settings((s) => s.sponsored_gameplay_enabled)
  const set_enabled = use_settings((s) => s.set_sponsored_gameplay_enabled)
  const address = use_auth((s: AuthState) => s.address)
  const allowance = use_sponsor_allowance()

  // Graduated engine graphics flags (FLAGS → SETTINGS PAGE, owner 2679 law). The 3 with a live engine hook (sun_follow/sky_couple/
  // taau_medium — engine_flags_pref.js's header survey) apply LIVE via a same-tier session reboot,
  // optimistic-update-then-revert exactly like QualitySelect.jsx's on_change: a live dungeon fight owns
  // the board/cave and refuses the swap, so the setter returns false and the row reverts to what's
  // actually running rather than lying. The other 3 (ambience/far-field/reveal) have no engine hook at
  // all yet (needs-a-setter) — their rows below stay disabled; useState still hydrates them so the saved
  // preference is visible even though it can't be edited here today.
  const [ambience] = useState(get_saved_ambience)
  const [sun_follow, set_sun_follow_state] = useState(get_saved_sun_follow)
  const [sky_couple, set_sky_couple_state] = useState(get_saved_sky_couple)
  const [taau_medium, set_taau_medium_state] = useState(get_saved_taau_medium)
  const [hack_mode, set_hack_mode_state] = useState(get_saved_hack_mode)
  const [far_field_experimental] = useState(get_saved_far_field_experimental)
  const [reveal_style] = useState(get_saved_reveal_style)

  // AUDIO (independently disabling music, fight music, and sound effects in settings) — three
  // independent preferences, each already owned by its own audio module (ambient_music.js / sfx.js); this
  // page just reads/writes them, same optimistic-local-state idiom as the graphics rows above (no revert
  // needed — these setters never fail).
  const [music_on, set_music_on] = useState(is_music_enabled)
  const [fight_music_on, set_fight_music_on] = useState(is_fight_music_enabled)
  const [sfx_on, set_sfx_on] = useState(is_sfx_enabled)

  const on_music_toggle = (next: boolean) => {
    set_music_on(next)
    if (next) start_music()
    else stop_music()
  }
  const on_fight_music_toggle = (next: boolean) => {
    set_fight_music_on(next)
    set_fight_music_enabled(next)
  }
  const on_sfx_toggle = (next: boolean) => {
    set_sfx_on(next)
    set_sfx_enabled(next)
  }

  const on_sun_follow = async (next: boolean) => {
    set_sun_follow_state(next)
    if ((await set_sun_follow(next)) === false) set_sun_follow_state(!next)
  }
  const on_sky_couple = async (next: boolean) => {
    set_sky_couple_state(next)
    if ((await set_sky_couple(next)) === false) set_sky_couple_state(!next)
  }
  const on_taau_medium = async (next: boolean) => {
    set_taau_medium_state(next)
    if ((await set_taau_medium(next)) === false) set_taau_medium_state(!next)
  }
  const on_hack_mode = async (next: boolean) => {
    set_hack_mode_state(next)
    if ((await set_hack_mode(next)) === false) set_hack_mode_state(!next)
  }

  return (
    <div className="app-page p-3 lg:p-8">
      <div className="app-page-header mb-4 lg:mb-8 flex items-center gap-2.5">
        <SettingsIcon size={14} className="text-gold opacity-60" />
        <div>
          <div className="app-page-title text-gradient text-[13px] tracking-[0.3em] uppercase font-semibold">
            {t('settings.title')}
          </div>
          <div className="app-page-subtitle text-muted text-[10px] tracking-wide mt-1">{t('settings.subtitle')}</div>
        </div>
      </div>

      <div className="glass-panel max-w-lg p-4 lg:p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-gold text-[10px] tracking-[0.2em] uppercase font-semibold">
          <Fuel size={12} className="opacity-60" />
          {t('sponsor.settings_section_title')}
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-text text-[11px] tracking-wide">{t('sponsor.settings_toggle_label')}</span>
            <span className="text-muted text-[9px] tracking-wide leading-relaxed">
              {t('sponsor.settings_toggle_hint')}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t('sponsor.settings_toggle_label')}
            onClick={() => set_enabled(!enabled)}
            className="shrink-0 relative w-9 h-5 border cursor-pointer transition-colors hover:shadow-[0_0_12px_rgba(200,150,60,0.25)]"
            style={{
              borderColor: enabled ? '#c8963c' : 'rgba(255,255,255,0.15)',
              background: enabled ? 'rgba(200,150,60,0.15)' : 'rgba(255,255,255,0.03)',
            }}
          >
            <span
              className="absolute top-0.5 h-3.5 w-3.5 transition-all"
              style={{
                left: enabled ? '18px' : '2px',
                background: enabled ? '#c8963c' : '#6b7280',
                boxShadow: enabled ? '0 0 6px rgba(200,150,60,0.6)' : 'none',
              }}
            />
          </button>
        </div>

        {/* Running daily-spend line — same poll the sidebar gauge already runs (use_sponsor_allowance),
            no new fetch. Hidden logged-out / before the first real poll resolves. */}
        {address && allowance && allowance.resets_at != null && (
          <div className="pt-2.5 border-t border-border flex items-center justify-between">
            <span className="text-muted text-[9px] tracking-[0.15em] uppercase">
              {t('sponsor.settings_spent_today')}
            </span>
            <span className="text-text text-[10px] font-mono tabular-nums">
              {format_mist_to_sui(allowance.spent_mist, 2)} / {format_mist_to_sui(allowance.allowance_mist, 2)}
            </span>
          </div>
        )}
      </div>

      <div className="glass-panel max-w-lg p-4 lg:p-5 flex flex-col gap-3 mt-4 lg:mt-8">
        <div className="flex items-center gap-2 text-gold text-[10px] tracking-[0.2em] uppercase font-semibold">
          <Monitor size={12} className="opacity-60" />
          {t('world.render_options_section_title')}
        </div>

        <ToggleRow
          label={t('world.ambience_particles_label')}
          hint={`${t('world.ambience_particles_hint')} ${t('world.render_options_pending_hint')}`}
          checked={ambience}
          disabled
        />
        <ToggleRow
          label={t('world.sun_follow_label')}
          hint={t('world.sun_follow_hint')}
          checked={sun_follow}
          on_change={on_sun_follow}
        />
        <ToggleRow
          label={t('world.sky_couple_label')}
          hint={t('world.sky_couple_hint')}
          checked={sky_couple}
          on_change={on_sky_couple}
        />
        <ToggleRow
          label={t('world.taau_medium_label')}
          hint={t('world.taau_medium_hint')}
          checked={taau_medium}
          on_change={on_taau_medium}
        />
        <ToggleRow
          label={t('world.hack_mode_label')}
          hint={t('world.hack_mode_hint')}
          checked={hack_mode}
          on_change={on_hack_mode}
        />
        <ToggleRow
          label={t('world.far_field_experimental_label')}
          hint={`${t('world.far_field_experimental_hint')} ${t('world.render_options_pending_hint')}`}
          checked={far_field_experimental}
          disabled
        />
        <SelectRow
          label={t('world.reveal_style_label')}
          hint={`${t('world.reveal_style_hint')} ${t('world.render_options_pending_hint')}`}
          value={reveal_style}
          disabled
          options={REVEAL_STYLE_OPTIONS.map((opt) => ({ value: opt, label: t(`world.reveal_style_${opt}`) }))}
        />
      </div>

      <div className="glass-panel max-w-lg p-4 lg:p-5 flex flex-col gap-3 mt-4 lg:mt-8">
        <div className="flex items-center gap-2 text-gold text-[10px] tracking-[0.2em] uppercase font-semibold">
          <Volume2 size={12} className="opacity-60" />
          {t('audio.settings_section_title')}
        </div>

        <ToggleRow
          label={t('audio.music_toggle_label')}
          hint={t('audio.music_toggle_hint')}
          checked={music_on}
          on_change={on_music_toggle}
        />
        <ToggleRow
          label={t('audio.fight_music_toggle_label')}
          hint={t('audio.fight_music_toggle_hint')}
          checked={fight_music_on}
          on_change={on_fight_music_toggle}
        />
        <ToggleRow
          label={t('audio.sfx_toggle_label')}
          hint={t('audio.sfx_toggle_hint')}
          checked={sfx_on}
          on_change={on_sfx_toggle}
        />
      </div>
    </div>
  )
}
