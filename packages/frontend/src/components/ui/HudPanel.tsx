// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ComponentPropsWithoutRef } from 'react'

export const HUD_PANEL_CLASS =
  'rounded-[5px] border border-border bg-surface-low/91 shadow-[0_10px_28px_rgba(0,0,0,0.22)] backdrop-blur-lg'

type HudPanelProps = Readonly<ComponentPropsWithoutRef<'div'>>

export const HudPanel = ({ className = '', ...props }: HudPanelProps) => (
  <div className={`${HUD_PANEL_CLASS} ${className}`} {...props} />
)
