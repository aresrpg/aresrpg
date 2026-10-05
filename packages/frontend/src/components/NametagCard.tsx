// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// World prompts share the UI panel and action controls; their owners retain positioning and admission.

import { Button, Panel } from '@aresrpg/ui'
import type { ReactNode } from 'react'

import './nametag_card.css'

export type NametagLine = Readonly<{
  key: string
  text: ReactNode
  title?: boolean
  muted?: boolean
  activate?: () => void
}>

export const NametagCard = ({
  name,
  lines = [],
  tone = 'gold',
  children,
}: Readonly<{ name?: ReactNode; lines?: readonly NametagLine[]; tone?: 'gold' | 'muted'; children?: ReactNode }>) => (
  <div className="pointer-events-none flex -translate-y-full flex-col items-center gap-2">
    {children}
    <Panel className="world-prompt-card" data-tone={tone}>
      {name !== undefined && <strong className="world-prompt-card__name">{name}</strong>}
      {lines.map((line) =>
        line.activate ? (
          <Button key={line.key} data-world-interaction className="world-prompt-card__action" onClick={line.activate}>
            {line.text}
          </Button>
        ) : (
          <span
            key={line.key}
            className="world-prompt-card__line"
            data-muted={line.muted || undefined}
            data-title={line.title || undefined}
          >
            {line.text}
          </span>
        )
      )}
    </Panel>
  </div>
)
