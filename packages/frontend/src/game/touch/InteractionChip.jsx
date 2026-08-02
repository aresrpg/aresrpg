// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMobileInputMode } from './mobile_input_mode.js'

export const key_cap_for_mode = (key_cap, mobile) => (mobile ? null : key_cap)

export function press_interaction(on_trigger, event) {
  event?.preventDefault?.()
  on_trigger()
}

/**
 * Shared world-interaction renderer. Desktop keeps its key cap; mobile gets a keyless tap chip whose click
 * is the exact same callback the desktop key handler invokes.
 */
export function InteractionChip({ prompt, on_trigger, class_name, mobile: mobile_override }) {
  const live_mobile = useMobileInputMode()
  const mobile = mobile_override ?? live_mobile
  const key_cap = key_cap_for_mode(prompt.key, mobile)
  const label = mobile ? (prompt.mobile_label ?? prompt.label) : prompt.label

  return (
    <button
      type="button"
      onClick={(event) => press_interaction(on_trigger, event)}
      className={class_name}
      data-mobile-interact={mobile ? prompt.id : undefined}
    >
      {key_cap && <kbd className="gw-npc-prompt__key">{key_cap}</kbd>}
      <span className="gw-npc-prompt__label">{label}</span>
    </button>
  )
}
