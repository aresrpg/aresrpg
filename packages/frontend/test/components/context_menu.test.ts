// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'

import { expect, test } from 'bun:test'

// Native guards for the CSS sizing contract; browser diagnostics measure the rendered result.
test('context menus use their content width without an arbitrary minimum', async () => {
  const source = await readFile(new URL('../../src/components/ContextMenu.tsx', import.meta.url), 'utf8')
  expect(source).toContain(' w-max ')
  expect(source).not.toContain('min-w-')
  expect(source).toContain('max-w-[calc(100vw-16px)]')
  expect(source).toContain('max-h-[calc(100dvh-16px)]')
  expect(source).toContain('overflow-y-auto')
})

test('character menu rows contribute the longest label rather than the sum of inline buttons', async () => {
  const source = await readFile(new URL('../../src/components/CharacterTabs.tsx', import.meta.url), 'utf8')
  const wrapper = source.match(/<div[^>]*data-character-tab-menu=""[^>]*>/)?.[0]
  const classes = wrapper?.match(/className="([^"]*)"/)?.[1]?.split(/\s+/)
  expect(classes ?? []).toContain('grid')
})
