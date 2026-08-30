// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const branch = git('branch', '--show-current')
if (branch !== 'edge') throw new Error(`Releases must be versioned from edge, not ${branch || 'detached HEAD'}`)
if (git('status', '--porcelain')) throw new Error('Release versioning requires a clean Git index and worktree')
git('fetch', 'origin', 'edge', '--tags')
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/edge'))
  throw new Error('Local edge must exactly match origin/edge before versioning')
const current_version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const [latest_tag] = git('tag', '--merged', 'HEAD', '--list', 'v[0-9]*', '--sort=-version:refname')
  .split('\n')
  .filter(Boolean)
if (latest_tag && latest_tag !== `v${current_version}`)
  throw new Error(`Root version ${String(current_version)} must match latest release ${latest_tag} before bumping`)
