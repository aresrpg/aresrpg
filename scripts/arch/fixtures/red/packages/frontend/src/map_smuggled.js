// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — L-D2: store writes smuggled into functor mappings.
// Expected: arch-map-smuggled-store-write 2 (setState inside .map, getState mutation inside .filter);
// x-arch-writer-def 2 (rows/survivors are incidentally writer defs — no async ref, so no join).
import { use_thing } from './laundered_write.js'

export const rows = (items) =>
  items.map((item) => {
    use_thing.setState({ hp: item.hp })
    return item.id
  })

export const survivors = (items) =>
  items.filter((item) => {
    use_thing.getState().hp = item.hp
    return item.alive
  })
