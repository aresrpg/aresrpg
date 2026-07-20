import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const sell_panel_source = readFileSync(new URL('./sell_panel.tsx', import.meta.url), 'utf8')

describe('marketplace sell panel', () => {
  test('does not expose stack-shaping plumbing or readiness states', () => {
    for (const forbidden of [
      'data-shape-your-stack',
      'submit_split_stack',
      'submit_merge_stacks',
      'marketplace.lots.stack_ready',
      'marketplace.lots.shape_title',
      'marketplace.lots.shape_hint',
      'marketplace.lots.split_action',
      'marketplace.lots.split_unavailable',
      'marketplace.lots.merge_action',
      'marketplace.lots.merge_unavailable',
    ]) {
      expect(sell_panel_source).not.toContain(forbidden)
    }
  })
})
