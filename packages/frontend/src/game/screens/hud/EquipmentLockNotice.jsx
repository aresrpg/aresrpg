// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/** Equipment refusal with an in-place refresh action: a digest-proven (gas may have spent) failure, or a
 *  zero-gas local-read-staleness refusal (issue #15) — either way the SAME refresh_equip_state() resolves it. */
export function EquipmentLockNotice({ copy, refresh_label, on_refresh }) {
  return (
    <div
      role="note"
      style={{
        margin: '0 0 8px',
        padding: '7px 10px',
        border: '1px solid rgba(251,191,36,0.4)',
        background: 'rgba(251,191,36,0.08)',
        color: '#fbbf24',
        fontSize: 10,
        letterSpacing: '0.06em',
        lineHeight: 1.4,
      }}
    >
      {copy}
      {on_refresh && (
        <button type="button" className="hud-btn" onClick={on_refresh}>
          {refresh_label}
        </button>
      )}
    </div>
  )
}
