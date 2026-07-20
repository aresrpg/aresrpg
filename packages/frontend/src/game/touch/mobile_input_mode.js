// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useSyncExternalStore } from 'react'

import { is_mobile, on_mobile_change } from '../core/mobile_mode.js'

// React bridge for the lead-owned mobile-mode source. The callback adapter deliberately ignores the
// boolean payload: useSyncExternalStore re-reads is_mobile(), keeping one snapshot home for React and
// imperative consumers alike.
const subscribe_mobile = (listener) => on_mobile_change(() => listener())

export function use_mobile_input_mode() {
  return useSyncExternalStore(subscribe_mobile, is_mobile, () => false)
}

/** Lock root overscroll only while the live game owns a mobile viewport; drawers retain ordinary pan. */
export function use_mobile_touch_hygiene(active) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return
    document.documentElement.classList.add('mobile-game-input-active')
    return () => document.documentElement.classList.remove('mobile-game-input-active')
  }, [active])
}
