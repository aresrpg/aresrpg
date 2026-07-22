// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { resolve_cinematic_active } from './cinematic_mode_gate.js'

describe('resolve_cinematic_active — deployment channel gate', () => {
  test('production keeps cinematic inactive when ON is requested', () => {
    expect(resolve_cinematic_active(true, 'production')).toBe(false)
  })

  test.each(['preview', 'development', ''])('%s keeps cinematic enabled by default', (deploy_env) => {
    expect(resolve_cinematic_active(true, deploy_env)).toBe(true)
  })

  test('the user OFF path stays off in every channel', () => {
    for (const deploy_env of ['production', 'preview', 'development', ''])
      expect(resolve_cinematic_active(false, deploy_env)).toBe(false)
  })
})
