// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { get_quality_profile, QUALITY_OPTIONS } from '@aresrpg/engine'
import { Button, SettingRow, Slider, Toggle, Select } from '@aresrpg/ui'

import {
  effective_render_distance,
  RENDER_DISTANCE_MIN,
  RENDER_DISTANCE_MAX,
  type GameSettings,
} from '../game/core/settings.ts'
import { master_volume_from } from '../game/core/audio_volume.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { JourneySettings } from '../journey/JourneySettings.tsx'

type SettingsFieldsProps = Readonly<{
  copy: AppCopy
  settings: GameSettings
  change: (patch: Partial<GameSettings>) => void
}>

export const GraphicsSettings = ({ copy, settings, change }: SettingsFieldsProps) => {
  const text = copy_text(copy.settings_page)
  const distance = effective_render_distance(
    get_quality_profile(settings.quality).chunks.far_radius,
    settings.render_distance
  )
  return (
    <>
      <div className="settings-mobile-quality">
        <SettingRow title={copy.quality}>
          <div className="settings-actions">
            {QUALITY_OPTIONS.map((quality) => (
              <Button key={quality} aria-pressed={settings.quality === quality} onClick={() => change({ quality })}>
                {copy[quality]}
              </Button>
            ))}
          </div>
        </SettingRow>
      </div>
      <SettingRow title={text('render_distance_label')} description={text('render_distance_hint')}>
        <Slider
          label={text('render_distance_label')}
          value={distance}
          min={RENDER_DISTANCE_MIN}
          max={RENDER_DISTANCE_MAX}
          on_change={(render_distance) => change({ render_distance })}
        />
      </SettingRow>
      <SettingRow title={text('day_night_cycle_label')} description={text('day_night_cycle_hint')}>
        <Toggle
          label={text('day_night_cycle_label')}
          checked={settings.day_night_cycle_enabled !== false}
          on_change={(day_night_cycle_enabled) => change({ day_night_cycle_enabled })}
        />
      </SettingRow>
    </>
  )
}

export const AudioSettings = ({ copy, settings, change }: SettingsFieldsProps) => {
  const text = copy_text(copy.settings_page)
  return (
    <>
      <SettingRow title={text('master_volume_label')} description={text('master_volume_hint')}>
        <Slider
          label={text('master_volume_label')}
          value={Math.round(master_volume_from(settings.master_volume) * 100)}
          on_change={(value) => change({ master_volume: value / 100 })}
        />
      </SettingRow>
      <SettingRow title={text('music_label')} description={text('music_hint')}>
        <Toggle
          label={text('music_label')}
          checked={settings.music_enabled}
          on_change={(music_enabled) => change({ music_enabled })}
        />
      </SettingRow>
      <SettingRow title={text('footsteps_label')} description={text('footsteps_hint')}>
        <Toggle
          label={text('footsteps_label')}
          checked={settings.footsteps_enabled !== false}
          on_change={(footsteps_enabled) => change({ footsteps_enabled })}
        />
      </SettingRow>
    </>
  )
}

export const GameplaySettings = ({ copy, settings, change }: SettingsFieldsProps) => {
  const text = copy_text(copy.settings_page),
    tutorial = copy_text(copy.tutorial)
  const characters = useAppStore((state) => state.session.characters)
  const crafter = characters.find(({ id }) => id === settings.always_craft_from_character_id)?.id ?? ''
  return (
    <>
      <SettingRow title={text('auto_switch_fighter_label')} description={text('auto_switch_fighter_hint')}>
        <Toggle
          label={text('auto_switch_fighter_label')}
          checked={settings.auto_switch_fighter !== false}
          on_change={(auto_switch_fighter) => change({ auto_switch_fighter })}
        />
      </SettingRow>
      <SettingRow title={text('always_craft_from_label')} description={text('always_craft_from_hint')}>
        <Select
          label={text('always_craft_from_picker')}
          value={crafter}
          onChange={(event) => change({ always_craft_from_character_id: event.target.value || null })}
          options={[
            { value: '', label: text('always_craft_from_none') },
            ...characters.map((character) => ({
              value: character.id,
              label: `${character.name} · ${copy_text(copy.encyclopedia_page)('level_short', { level: character.level })}`,
            })),
          ]}
        />
      </SettingRow>
      <SettingRow title={tutorial('reset_title')} description={tutorial('reset_hint')}>
        <Button onClick={() => change({ completed_tutorials: [] })}>{tutorial('reset_action')}</Button>
      </SettingRow>
      <JourneySettings copy={copy} />
    </>
  )
}
