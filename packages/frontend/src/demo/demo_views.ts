// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Boxes, FlaskConical, Grid2X2, Mountain, Package, Swords } from 'lucide-react'

export type DemoView = 'assets' | 'world' | 'fight' | 'boards' | 'content' | 'biomes' | 'ui'
export const DEMO_VIEWS: readonly DemoView[] = Object.freeze(
  import.meta.env.DEV
    ? ['world', 'assets', 'fight', 'boards', 'content', 'biomes', 'ui']
    : ['world', 'assets', 'fight', 'boards', 'ui']
)
export const VIEW_ICONS = Object.freeze({
  assets: Boxes,
  ui: Grid2X2,
  world: FlaskConical,
  fight: Swords,
  boards: Grid2X2,
  content: Package,
  biomes: Mountain,
})
export const demo_view = (fragment: string): DemoView => {
  const [hash = ''] = fragment.slice(1).split('/')
  return (DEMO_VIEWS as readonly string[]).includes(hash) ? (hash as DemoView) : 'world'
}
