// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo } from 'react'

import { useAppStore } from '../store.ts'
import { titleize } from '../content/catalog.ts'

import { copy_text } from './copy.ts'

export const useVocabulary = () => {
  const copy = useAppStore((state) => state.copy)
  return useMemo(() => {
    const text = copy_text(copy ?? {})
    return {
      stat: (stat: string): string => (copy ? text(`simulator_page.stat_${stat}`) : titleize(stat)),
      element: (element: string): string => (copy ? text(`encyclopedia_page.element.${element}`) : titleize(element)),
      job: (job: string): string => (copy ? text(`leaderboard_page.job_${job}`) : titleize(job)),
    }
  }, [copy])
}
