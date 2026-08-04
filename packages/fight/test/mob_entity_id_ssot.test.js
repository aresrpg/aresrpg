// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'bun:test'

import { mob_entity_id, mob_entity_index } from '../src/project.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
// The convention door moved to participant_identity.js (#2219): the one fold-key resolver answers both halves of
// the key space and cannot import a module that imports it, so the mob-id vocabulary joined the roster identity
// it belongs to. fight_control.js re-exports it — that is still the CONSUMER-facing path.
const DOOR = join(REPO_ROOT, 'packages/fight/src/participant_identity.js')
const SOURCE_ROOTS = [join(REPO_ROOT, 'packages/fight/src'), join(REPO_ROOT, 'packages/frontend/src')]
const HAND_WRITTEN_MOB_ID = /`mob-\$\{|['"]mob-['"]\s*\+/

const source_files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return source_files(path)
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : []
  })

describe('mob entity id SSOT', () => {
  it('publishes the constructor and inverse through project', () => {
    expect(mob_entity_id(12)).toBe('mob-12')
    expect(mob_entity_index('mob-12')).toBe(12)
  })

  it('has no hand-written runtime template outside the convention door', () => {
    const offenders = SOURCE_ROOTS.flatMap(source_files)
      .filter((file) => file !== DOOR && HAND_WRITTEN_MOB_ID.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO_ROOT, file))
    expect(offenders).toEqual([])
  })
})
