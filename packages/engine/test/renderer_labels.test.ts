// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_retained_values } from '../src/renderer.ts'

test('labels set before backend attachment replay when the backend arrives', () => {
  const labels = create_retained_values<string>()
  labels.set('mob', 'card')
  labels.set('removed', 'stale')
  labels.set('removed', null)
  const replayed: [string, string][] = []

  labels.replay((id, value) => replayed.push([id, value]))

  expect(replayed).toEqual([['mob', 'card']])
})
