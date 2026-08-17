// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The legacy compact effect line. Fight tooltips and turn cards share this exact renderer.

import type { ReactNode } from 'react'

import './effect_line.css'

export type EffectLineView = Readonly<{
  icon?: string
  dot?: string
  glyph?: ReactNode
  pre: string
  value: string | null
  tone: string
  post: string
  meta: string | null
}>

export const EffectLine = ({ view, compact = false }: Readonly<{ view: EffectLineView; compact?: boolean }>) => (
  <div className={`fxl${compact ? ' fxl--compact' : ''}`}>
    {view.icon ? (
      <img alt="" aria-hidden="true" className="fxl__ic" draggable={false} src={view.icon} />
    ) : view.dot ? (
      <span aria-hidden="true" className="fxl__dot" style={{ background: view.dot, color: view.dot }} />
    ) : view.glyph ? (
      <span aria-hidden="true" className="fxl__vector" style={{ color: view.tone }}>
        {view.glyph}
      </span>
    ) : (
      <span aria-hidden="true" className="fxl__gap" />
    )}
    <span className="fxl__txt">
      {view.pre}
      {view.value !== null && (
        <b className="fxl__val" style={{ color: view.tone }}>
          {view.value}
        </b>
      )}
      {view.post}
      {view.meta && <span className="fxl__meta">{compact ? ` (${view.meta})` : ` · ${view.meta}`}</span>}
    </span>
  </div>
)
