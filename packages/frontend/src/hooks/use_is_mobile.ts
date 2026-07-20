// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useSyncExternalStore } from 'react'

const query = '(max-width: 1023px)'

function subscribe(callback: () => void) {
  const mql = window.matchMedia(query)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function get_snapshot() {
  return window.matchMedia(query).matches
}

function get_server_snapshot() {
  return false
}

export function use_is_mobile() {
  return useSyncExternalStore(subscribe, get_snapshot, get_server_snapshot)
}
