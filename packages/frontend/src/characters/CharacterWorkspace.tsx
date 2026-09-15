// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'

import { FitViewport } from '../components/FitViewport.tsx'

const WORKSPACE_WIDTHS = {
  stats: { width: 600, dense_width: 1000 },
  spells: { width: 1280, dense_width: 1280 },
  runeforge: { width: 1440, dense_width: 1100 },
} as const

export const CharacterWorkspace = ({
  kind,
  children,
}: Readonly<{ kind: keyof typeof WORKSPACE_WIDTHS; children: ReactNode }>) => (
  <FitViewport class_name="character-workspace" workspace={kind} {...WORKSPACE_WIDTHS[kind]}>
    {children}
  </FitViewport>
)
