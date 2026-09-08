// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useCallback } from 'react'

import { titleize } from '../content/catalog.ts'
import { useAppStore } from '../store.ts'

export const useItemCategoryName = () => {
  const names = useAppStore((state) => state.copy?.item_categories)
  return useCallback((category: string): string => names?.[category] ?? titleize(category), [names])
}
