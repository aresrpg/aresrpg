// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SOURCE GUARD (#833): `initReactI18next` has exactly ONE home — src/i18n/index.ts.
//
// The root cause it pins: `initReactI18next.init(instance)` is not a per-instance wiring, it is a
// PROCESS-GLOBAL write — `setI18n(instance)` plus `setDefaults(instance.options.react)`. Every
// component that calls `useTranslation()` without an `<I18nextProvider>` above it resolves through
// that global. Bun runs the whole suite in ONE process, so a test file that registers its own
// throwaway instance silently re-points every OTHER file's provider-less render at it — and whether
// that happens before or after the app's own i18n module is evaluated is directory-traversal order,
// which differs between macOS and the ubuntu runner. That is exactly how #833 read: `jobs.*` copy
// (JobsDrawer.jsx calls the app instance's `i18n.t` directly) resolved while `entity.*` (rendered
// through item_detail_view.tsx's `useTranslation`) came out as raw keys, in the same file, same run.
//
// The rule is therefore mechanical, not advisory: a test builds its instance with
// `i18next.createInstance()` and scopes it with `<I18nextProvider i18n={…}>` (or `getFixedT`).
// It never installs it globally.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const SRC = new URL('..', import.meta.url).pathname
const THE_ONE_HOME = 'i18n/index.ts'

const source_files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return source_files(path)
    return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [path] : []
  })

describe('react-i18next default instance has one home (#833)', () => {
  test('nothing outside src/i18n/index.ts registers an i18next instance globally', () => {
    const offenders = source_files(SRC)
      .filter((path) => !path.endsWith(THE_ONE_HOME) && !path.endsWith('react_default_instance.test.js'))
      .filter((path) => readFileSync(path, 'utf8').includes('initReactI18next'))
      .map((path) => path.slice(SRC.length))

    expect(offenders).toEqual([])
  })
})
