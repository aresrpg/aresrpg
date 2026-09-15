// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useAppStore } from '../store.ts'

import { player_error_hint } from './player_error.ts'

export const PlayerError = ({ error }: Readonly<{ error: unknown }>) => {
  const copy = useAppStore((state) => state.copy)
  return copy ? player_error_hint(copy, error) : null
}
