// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type CaptionLine = Readonly<{ text: string; color?: string }>
export type WorldCaption = Readonly<{
  name: string
  suffix?: readonly CaptionLine[]
  lines?: readonly CaptionLine[]
  speech?: string
  color?: string
  health?: Readonly<{ fraction: number; color: string }>
  opacity?: number
  /** Floating combat text keeps its existing world-unit sizing; cards use CSS pixels. */
  world_size?: readonly [number, number]
  accessible?: boolean
}> &
  Readonly<{ variant: 'nameplate'; tone: 'neutral' | 'green' | 'red' } | { variant?: 'card' | 'float'; tone?: never }>
export type CaptionTarget = Readonly<{ set: (caption: WorldCaption | null) => void }>
/** Shared by canvas cards and the retained interactive DOM cards. */
export const CAPTION_STYLE = Object.freeze({
  font: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  background: '#0a0a0f',
  color: '#f5d0a9',
  muted: '#a3a5ad',
  border: 'rgba(200,150,60,0.7)',
  font_size: 10,
  line_size: 7,
  padding_x: 26,
  side_padding: 0,
  top_padding: 8,
  min_width: 60,
  baseline: 'top' as const,
  center_text: false,
  padding_y: 6,
  name_weight: 400,
  format_name: (name: string) => name.toUpperCase(),
  line_weight: 400,
  name_spacing: '1.6px',
  line_spacing: '1px',
  line_height: 11,
  name_y: 8,
  line_y: 23,
  body_height: 26,
})
