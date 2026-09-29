// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const source = (path: string): string => readFileSync(new URL(`../../../src/${path}`, import.meta.url), 'utf8')

test('profession announcements render the shared progression view and retain acknowledgement', () => {
  expect(source('PlayerRuntime.tsx')).toContain('<JobLevelUpCard copy={copy} />')
  expect(source('game/jobs/JobLevelUpCard.tsx')).toContain('<JobLevelUpView')
  expect(source('game/jobs/JobLevelUpCard.tsx')).toContain("type: 'job_level_up/acknowledged'")
  expect(source('game/jobs/JobLevelUpView.tsx')).toContain('<ProgressionCard')
})
