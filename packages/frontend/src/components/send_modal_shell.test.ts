// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

test('item and SUI send modals share one shell while remaining separate modals', () => {
  const item = readFileSync(new URL('./item_send_modal.tsx', import.meta.url), 'utf8')
  const sui = readFileSync(new URL('./send_sui_modal.tsx', import.meta.url), 'utf8')
  const shell = readFileSync(new URL('./send_modal_shell.tsx', import.meta.url), 'utf8')

  for (const modal of [item, sui]) {
    expect(modal).toContain("from './send_modal_shell'")
    expect(modal).not.toContain('createPortal')
    expect(modal).not.toContain('function Shell')
  }
  expect(shell).toContain('export function SendModalShell')
  expect(item).toContain('export function ItemSendModal')
  expect(sui).toContain('export function SendSuiModal')
})
