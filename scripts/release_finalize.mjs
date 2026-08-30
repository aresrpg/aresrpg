// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const changelog = new URL('../changelog/', import.meta.url)
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version ${String(version)}`)

const files = await readdir(changelog)
const last =
  files
    .flatMap((name) => name.match(/^(\d{3})-RELEASE-/)?.[1] ?? [])
    .map(Number)
    .sort((a, b) => a - b)
    .at(-1) ?? 0
const source = await readFile(new URL('NEXT.md', changelog), 'utf8')
const title = source.match(/^#\s+(.+)$/m)?.[1]
if (!title || title === 'Next release') throw new Error('changelog/NEXT.md needs a player-facing title')
const matching_releases = files.filter((name) => name.endsWith(`-RELEASE-v${version}.md`))
if (matching_releases.length > 1) throw new Error(`Several changelog files already target v${version}`)
const release_name = matching_releases[0] ?? `${String(last + 1).padStart(3, '0')}-RELEASE-v${version}.md`
const release_source = source.replace(/^#\s+.+$/m, `# v${version} — ${title}`)
await writeFile(new URL(release_name, changelog), release_source)
await writeFile(
  new URL('NEXT.md', changelog),
  '# Next release\n\nReplace this file with player-facing release notes before running `bun pm version patch`.\n'
)
execFileSync('git', ['add', '--', `changelog/${release_name}`, 'changelog/NEXT.md'], {
  cwd: fileURLToPath(root),
})
