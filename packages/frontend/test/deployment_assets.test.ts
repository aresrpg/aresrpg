// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import {
  deployment_asset_url,
  deployment_build_config,
  pin_chunk_imports,
  validate_deployment_id,
} from '../deployment_assets.ts'

test('all relative JS imports retain their deployment, without rewriting text or external imports', () => {
  const code = `import{a}from"./shared.js";export{b}from'./other.js';const x=import("./lazy.js");const y=import(\`./template.js\`);const text='import("./example.js")';import "https://example.com/external.js";`
  const result = pin_chunk_imports(code, 'ares-123-1')
  expect(result).toContain('from"./shared.js?dpl=ares-123-1"')
  expect(result).toContain('from"./other.js?dpl=ares-123-1"')
  expect(result).toContain('import("./lazy.js?dpl=ares-123-1")')
  expect(result).toContain('import("./template.js?dpl=ares-123-1")')
  expect(result).toContain(`const text='import("./example.js")'`)
  expect(result).toContain('import "https://example.com/external.js"')
})

test('asset pins preserve query parameters and reject invalid Vercel deployment IDs', () => {
  expect(deployment_asset_url('ares-123-1', '/assets/style.css')).toBe('/assets/style.css?dpl=ares-123-1')
  expect(deployment_asset_url('ares-123-1', '/assets/file.js?x=1')).toBe('/assets/file.js?x=1&dpl=ares-123-1')
  for (const id of ['', 'dpl_reserved', '../bad', 'a'.repeat(33)]) expect(() => validate_deployment_id(id)).toThrow()
})

test('the service worker precaches the same versioned URLs as the application', async () => {
  const config = deployment_build_config({ ARES_DEPLOYMENT_ID: 'ares-123-1' })
  const result = await config.precache_transforms[0]!([{ url: 'assets/app.js', revision: 'abc', size: 10 }])
  expect(result.manifest[0]!.url).toBe('assets/app.js?dpl=ares-123-1')
  expect(result.manifest[0]!.revision).toBe('abc')
  expect(() => deployment_build_config({ VERCEL: '1' })).toThrow('ARES_DEPLOYMENT_ID')
})
