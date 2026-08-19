// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pack-derived projectile silhouettes. Motion, palette, and timing remain in the fight VFX preset table.

import {
  BoxGeometry,
  ConeGeometry,
  DodecahedronGeometry,
  OctahedronGeometry,
  RingGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three'

import type { FightVfxProfile } from './fight_vfx_presets.ts'
import type { FightCastStyle } from './types.ts'

export const fight_vfx_appearance = (
  style: FightCastStyle,
  fallback: FightVfxProfile['appearance']
): FightVfxProfile['appearance'] => {
  if (style === 'trap') return 'earth'
  if (style === 'glyph' || style === 'teleport' || style === 'buff' || style === 'debuff' || style === 'state')
    return 'neutral'
  if (style === 'push' || style === 'pull') return 'air'
  if (style === 'heal') return 'heal'
  return style === 'dot' ? 'flame' : fallback
}

export const create_fight_vfx_geometries = (): Readonly<Record<FightVfxProfile['appearance'], BufferGeometry>> =>
  Object.freeze({
    flame: new ConeGeometry(0.2, 0.75, 5),
    water: new OctahedronGeometry(0.34, 0),
    air: new BoxGeometry(0.1, 0.78, 0.1),
    neutral: new TorusGeometry(0.27, 0.08, 5, 10),
    heal: new RingGeometry(0.14, 0.34, 4),
    earth: new DodecahedronGeometry(0.31, 0),
  })
