import { useNavigate, useLocation } from 'react-router-dom'
import { useCallback } from 'react'

import { type Page, PAGE_PATHS, path_to_page } from '../constants/navigation'

export function use_navigate_page() {
  const navigate = useNavigate()
  return useCallback(
    (page: Page) => {
      navigate(PAGE_PATHS[page])
    },
    [navigate]
  )
}

export function use_active_page(): Page {
  const { pathname } = useLocation()
  return path_to_page(pathname) ?? 'characters'
}
