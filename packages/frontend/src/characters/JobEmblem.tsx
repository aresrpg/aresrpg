// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  Wheat,
  Leaf,
  Pickaxe,
  Hammer,
  Axe,
  Shirt,
  Gem,
  Footprints,
  Wrench,
  FlaskConical,
  Croissant,
} from 'lucide-react'
import type { JobSlug } from '@aresrpg/immutable'
const GLYPHS = {
  FARMER: Wheat,
  HERBALIST: Leaf,
  MINER: Pickaxe,
  FORGER: Hammer,
  CARVER: Axe,
  TAILOR: Shirt,
  JEWELER: Gem,
  TANNER: Footprints,
  HANDYMAN: Wrench,
  ALCHEMIST: FlaskConical,
  BAKER: Croissant,
}
export const JobEmblem = ({ job }: Readonly<{ job: JobSlug }>) => {
  const Glyph = GLYPHS[job]
  return (
    <span className="aui-job-emblem" aria-hidden="true">
      <Glyph strokeWidth={1.6} />
    </span>
  )
}
