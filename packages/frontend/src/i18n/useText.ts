// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useAppStore } from '../store.ts'

import { copy_text } from './copy.ts'

export const useText = () => {
  const copy = useAppStore((state) => state.copy)
  return copy_text(copy ?? {})
}
