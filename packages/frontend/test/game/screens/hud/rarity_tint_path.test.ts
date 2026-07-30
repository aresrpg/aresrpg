// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

const source_root = resolve(import.meta.dir, '../../../../src')
const quality_module = resolve(source_root, 'game/screens/hud/quality.js')
const forbidden_tint_path =
  /RARITY_COLORS|QUALITY_COLOR|quality_color|rarity_tint|rarity_color|drop_color|--q-tint|--rq|view\.tint/

test('#1764 the frontend has no rarity-derived tint path', () => {
  const offenders = [...new Bun.Glob('**/*.{css,js,jsx,ts,tsx}').scanSync({ cwd: source_root, absolute: true })]
    .filter((file) => !file.match(/\.test\.[jt]sx?$/))
    .filter((file) => forbidden_tint_path.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(source_root.length + 1))

  expect(existsSync(quality_module)).toBe(false)
  expect(offenders).toEqual([])
})
