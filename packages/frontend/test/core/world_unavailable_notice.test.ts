// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { graphics_notice_visible } from '../../src/components/app_layout.ts'

test('an unavailable world notice is dismissible without hiding fatal renderer failures', () => {
  expect(graphics_notice_visible(false, false, true, false, false)).toBeTrue()
  expect(graphics_notice_visible(false, false, true, true, false)).toBeFalse()
  expect(graphics_notice_visible(false, true, false, true, false)).toBeTrue()
  expect(graphics_notice_visible(true, true, false, false, false)).toBeFalse()
})
