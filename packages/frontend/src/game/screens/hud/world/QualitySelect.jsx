// D157 — the WORLD-tab render-quality dropdown. A tiny 3-step ladder (low / medium / high) [S-85]
// that pins the voxel engine's manual tier via render_quality.js (engine.set_tier). Empty value = the
// no-override default (the engine's auto-governor stays in charge). Persists to localStorage; the world
// mount (GameWorldHud) re-applies the saved tier. Native <select> so it's keyboard/OS-accessible and
// carries zero deps — styled to the house terminal DNA (gold-on-near-black, monospace, uppercase, sharp).

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { QUALITY_OPTIONS, get_saved_quality, set_quality } from './render_quality.js'

/** @returns {import('react').ReactElement} */
export function QualitySelect() {
  const { t } = useTranslation()
  const [value, set_value] = useState(get_saved_quality)

  const on_change = (/** @type {import('react').ChangeEvent<HTMLSelectElement>} */ e) => {
    const next = e.target.value
    const previous = value
    set_value(next) // optimistic — the live re-boot is instant to kick off (world re-streams behind the veil)
    // set_quality returns false only when a live dungeon run blocks the swap (it toasts); revert so the
    // dropdown reflects the tier actually running, never a pick that didn't apply.
    if (set_quality(next) === false) set_value(previous)
  }

  return (
    <label className="gw-quality gw-panel" title={t('world.quality_label')}>
      <span className="gw-quality__k">{t('world.quality_label')}</span>
      <select className="gw-quality__sel" value={value} onChange={on_change}>
        {/* '' = the engine's auto-governor (no manual pin) — the default until the player picks a rung. */}
        <option value="">{t('world.quality_auto')}</option>
        {QUALITY_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {t(`world.quality_${opt}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
