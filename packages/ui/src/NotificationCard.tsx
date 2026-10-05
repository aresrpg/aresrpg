// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'

import './notifications.css'

export type NotificationCardProps = Readonly<{
  type: string
  tone: 'gold' | 'blue'
  title: string
  subtitle: string
  image: string
  summary?: ReactNode
  children?: ReactNode
}>

/** Compact attachment; Discord's surrounding message owns the announcement and bot identity. */
export const NotificationCard = ({ type, tone, title, subtitle, image, summary, children }: NotificationCardProps) => (
  <article className={`aui-notification aui-notification--${tone}`} aria-label={`${type}: ${title}`}>
    <div className="aui-notification__hero">
      <img className="aui-notification__art" src={image} alt={title} draggable={false} />
      <div className="aui-notification__identity">
        <div className="aui-notification__meta">
          <span>{type}</span>
          {summary && <strong>{summary}</strong>}
        </div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
    {children && <div className="aui-notification__details">{children}</div>}
  </article>
)
