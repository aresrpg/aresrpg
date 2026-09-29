// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo } from 'react'
import { SegmentedControl } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'

import {
  ENCYCLOPEDIA_TABS,
  EncyclopediaContent,
  encyclopedia_route,
  encyclopedia_route_view,
} from './EncyclopediaContent.tsx'
import { encyclopedia_text } from './copy.ts'

import './encyclopedia.css'

export const EncyclopediaPage = ({
  copy,
  navigate,
  pathname,
}: Readonly<{ copy: AppCopy; navigate: (pathname: string) => void; pathname: string }>) => {
  const text = useMemo(() => encyclopedia_text(copy), [copy])
  const view = encyclopedia_route_view(pathname)
  return (
    <section className="enc-page pointer-events-auto z-[12] flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface/50 [&_button:not(:disabled)]:cursor-pointer">
      <SegmentedControl
        label={copy.encyclopedia}
        value={view.tab}
        on_change={(tab) => navigate(encyclopedia_route(tab))}
        options={ENCYCLOPEDIA_TABS.map((tab) => ({
          value: tab.id,
          label: tab.id === 'kares' ? copy.kares : text(tab.label),
        }))}
      />
      <EncyclopediaContent copy={copy} navigate={navigate} pathname={pathname} />
    </section>
  )
}

export default EncyclopediaPage
