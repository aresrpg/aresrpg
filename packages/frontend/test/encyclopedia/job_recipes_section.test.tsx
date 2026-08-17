// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { job_groups } from '@aresrpg/immutable'

import { encyclopedia_catalog } from '../../src/content/catalog.ts'

test('job recipes reuse the item-tab cards in the shared responsive grid', async () => {
  const source = await Bun.file(new URL('../../src/encyclopedia/JobRecipesSection.tsx', import.meta.url)).text()
  const component_source = await Bun.file(new URL('../../src/encyclopedia/components.tsx', import.meta.url)).text()
  const jobs_source = await Bun.file(new URL('../../src/encyclopedia/JobsTab.tsx', import.meta.url)).text()

  expect(source).toContain('<EntityGrid>')
  expect(source).toContain('<EntityButton')
  expect(source).toContain("text('level_short'")
  expect(source).not.toContain("text('required_level'")
  expect(source).not.toContain("text('xp_suffix'")
  expect(component_source).toContain('grid-cols-[repeat(auto-fill,minmax(280px,1fr))]')
  expect(component_source).toContain('text-[#77d99a]')
  expect(jobs_source).not.toContain('max-w-2xl')
  expect(job_groups.gathering.every((job) => (encyclopedia_catalog.job(job)?.recipes.length ?? 0) > 0)).toBeTrue()
})
