// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1368 · The auth gate owns the challenge freshness window; the sponsor consumes that exact binding.

import { readFileSync, readdirSync } from 'node:fs'

import { expect, test } from 'bun:test'

const api_root = import.meta.dir
const source_of = (file) => readFileSync(`${api_root}/${file}`, 'utf8')
const mjs_files = readdirSync(api_root, { recursive: true }).filter(
  (file) => typeof file === 'string' && file.endsWith('.mjs') && !file.startsWith('node_modules/')
)

test('#1368 · every API consumer answers with the auth-owned challenge TTL', () => {
  const default_sites = mjs_files.flatMap((file) =>
    source_of(file)
      .split('\n')
      .flatMap((line, index) => (/5\s*\*\s*60_000/.test(line) ? [`${file}:${index + 1}`] : []))
  )
  const auth = source_of('zklogin_auth.mjs')
  const sponsor = source_of('sponsor.mjs')

  expect(default_sites).toEqual(['zklogin_auth.mjs:9'])
  expect(auth).toContain('export const CHALLENGE_TTL_MS =')
  expect(auth).toContain('ttl_ms = CHALLENGE_TTL_MS')
  expect(sponsor).toMatch(/import \{[^}]*CHALLENGE_TTL_MS[^}]*\} from '\.\/zklogin_auth\.mjs'/s)
  expect(sponsor).not.toMatch(/(?:const|let|var) CHALLENGE_TTL_MS\s*=/)
  expect(sponsor.match(/ttl_ms: CHALLENGE_TTL_MS/g)).toHaveLength(2)
})
