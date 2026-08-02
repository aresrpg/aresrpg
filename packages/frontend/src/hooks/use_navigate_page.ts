// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useNavigate, useLocation } from 'react-router-dom'
import { useCallback } from 'react'

import { type Page, PAGE_PATHS, path_to_page } from '../constants/navigation'

export function useNavigatePage() {
  const navigate = useNavigate()
  return useCallback(
    (page: Page) => {
      navigate(PAGE_PATHS[page])
    },
    [navigate]
  )
}

export function useActivePage(): Page {
  const { pathname } = useLocation()
  return path_to_page(pathname) ?? 'characters'
}
