// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Class swatch colors — the 12-class UI color vocabulary (mirrors the approved character-create
// presentation map's swatches; UI metadata, never game data). ONE home: marketplace character rows,
// sell-side character cells, and any future class-colored chip all import from here.

export const CLASS_COLORS: Record<string, string> = {
  senshi: '#e0533a',
  yajin: '#4ec97a',
  yogen: '#2bb6a8',
  tomoda: '#caa14a',
  ikari: '#c0334a',
  mori: '#7faa45',
  tokei: '#5a8fe0',
  shugo: '#b07a3a',
  rojin: '#9c7b52',
  shusen: '#54c0a0',
  asobi: '#c95aa8',
  iyashi: '#6fc6e0',
}

export const class_color = (classe: string | null | undefined): string => CLASS_COLORS[classe ?? ''] ?? '#6b7280'
