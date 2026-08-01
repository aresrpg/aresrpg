// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #853: the policy in `vercel.json` ENFORCES. A report-only header observes and never blocks, so
// nothing mechanical can tell a correct policy from a policy that would white-screen every player
// — the only difference is the header name. This test pins the enforcing name, the exact source
// inventory `docs/CSP.md` justifies row by row, and the one value in the policy that can go stale
// on its own: the `script-src` hashes of the inline scripts in `index.html`. A stale hash under
// enforcement is a blank page for everyone, so the hashes are re-derived here rather than trusted.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const vercel_config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf-8'))
const site_wide = vercel_config.headers.find(({ source }) => source === '/(.*)')
const csp_header = site_wide.headers.find(({ key }) => key.toLowerCase() === 'content-security-policy')

const parse_policy = (value) =>
  Object.fromEntries(
    value
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/)
        return [name, sources]
      })
  )

const inline_script_hashes = [
  ...readFileSync(new URL('../index.html', import.meta.url), 'utf-8').matchAll(
    /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g
  ),
].map(([, body]) => `'sha256-${createHash('sha256').update(body, 'utf-8').digest('base64')}'`)

// Every source here has a provenance row in `docs/CSP.md`. A source in the header without a row
// (or a row without the header) is the drift this table exists to refuse.
const census = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'form-action': ["'self'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'", ...inline_script_hashes],
  'worker-src': ["'self'", 'blob:'],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'blob:', 'https://assets.aresrpg.world'],
  'media-src': ["'self'", 'data:', 'blob:', 'https://assets.aresrpg.world'],
  'connect-src': [
    "'self'",
    'data:',
    'blob:',
    'https://rpc.aresrpg.world',
    'https://sponsor.aresrpg.world',
    'https://assets.aresrpg.world',
    'https://api.enoki.mystenlabs.com',
    'https://fullnode.testnet.sui.io',
    'https://graphql.testnet.sui.io',
    'https://fullnode.mainnet.sui.io',
    'https://sui-mainnet.mystenlabs.com',
    'https://testnet.mvr.mystenlabs.com',
    'https://mainnet.mvr.mystenlabs.com',
    'https://o4508074408214528.ingest.de.sentry.io',
    'wss://relay.aresrpg.world',
  ],
}

test('the site-wide policy is enforcing, not report-only', () => {
  expect(csp_header).toBeDefined()
  expect(csp_header.key).toBe('Content-Security-Policy')

  // Shipping both names would duplicate the policy string, and with no report endpoint the
  // report-only copy buys nothing an enforced violation does not already log.
  expect(site_wide.headers.map(({ key }) => key)).not.toContain('Content-Security-Policy-Report-Only')
})

test('the enforcing policy carries exactly the census sources', () => {
  expect(parse_policy(csp_header.value)).toEqual(census)
})

test('the script-src hashes match the inline scripts index.html actually ships', () => {
  // Two inline classic scripts: the mobile manifest swap and the D146 boot shim. Vite copies them
  // into `dist/index.html` byte-for-byte, so the source file is the honest thing to hash.
  expect(inline_script_hashes).toHaveLength(2)
  for (const hash of inline_script_hashes) expect(csp_header.value).toContain(hash)
})
