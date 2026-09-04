// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const source = (path: string): string => readFileSync(new URL(`../../../src/${path}`, import.meta.url), 'utf8')

test('the global profession card uses a cyan identity distinct from fight level-up', () => {
  const app = source('app.tsx')
  const card = source('game/jobs/JobLevelUpCard.tsx')
  const css = source('game/jobs/job_level_up.css')

  expect(app).toContain('<JobLevelUpCard copy={copy} />')
  expect(card).toContain("type: 'job_level_up/acknowledged'")
  expect(css).toContain('--job-level-accent: #48cfcf')
  expect(css).not.toContain('#c8963c')
})
