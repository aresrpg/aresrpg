// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_caption_target } from '../../src/game/core/caption_target.ts'

test('retired caption targets cannot paint or clear a replacement scene', () => {
  const writes: unknown[] = []
  const old = create_caption_target((value) => writes.push(value))
  old.set({ name: 'Old' })
  old.dispose()
  const next = create_caption_target((value) => writes.push(value))
  next.set({ name: 'New' })
  old.set({ name: 'Late old UI effect' })
  old.set(null)
  old.dispose()
  expect(writes).toEqual([{ name: 'Old' }, null, { name: 'New' }])
  next.dispose()
})
