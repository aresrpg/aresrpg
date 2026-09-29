// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { Workspace } from '@aresrpg/ui'

import { EncyclopediaPage } from '../../encyclopedia/EncyclopediaPage.tsx'
import type { AppCopy } from '../../i18n/copy.ts'

import { WorkshopSurface } from './shared.tsx'
export const EncyclopediaExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [pathname, navigate] = useState('/encyclopedia/items')
  return (
    <WorkshopSurface copy={copy} title={copy.encyclopedia} icon={<BookOpen />}>
      {(header) => (
        <Workspace {...header} className="aui-feature-port aui-codex-port">
          <EncyclopediaPage copy={copy} pathname={pathname} navigate={navigate} />
        </Workspace>
      )}
    </WorkshopSurface>
  )
}
