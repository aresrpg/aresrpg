// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The jobs tab reads the player's own characters, or the ones a session adapter names: whom it advises
// as a better crafter, and that it advises nobody for a driver that names no roster.
import { expect, spyOn, test } from 'bun:test'
import { job_xp_for_level } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import type { CharacterSession } from '../../src/characters/character_session.ts'
import JobsTab from '../../src/characters/JobsTab.tsx'
import { sample_character, sample_character_row } from '../../src/demo/sample.ts'
import { copy_text, type AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import { initial_app_state, type AppState } from '../../src/store.ts'

const copy = en as AppCopy
const t = copy_text(copy.characters_page)
const crafter = (id: string, name: string, farmer_level: number): CharacterRow => ({
  ...sample_character_row(sample_character()),
  id,
  name,
  jobs: { FARMER: String(job_xp_for_level(farmer_level) ?? 0) },
})
const viewed = crafter('viewed', 'Mira', 2)
const own_better = crafter('own', 'Okami', 9)
const session_better = crafter('theirs', 'Bran', 6)
const base = initial_app_state({} as AppState['settings'])
/** The player's own store: their characters, and whether the settings lock crafting to one of them. */
const store_of = (locked: boolean): AppState => ({
  ...base,
  copy,
  settings: { ...base.settings, always_craft_from_character_id: locked ? own_better.id : null },
  session: { ...base.session, characters: [viewed, own_better] },
})
const render = (node: ReactNode, state: AppState): string => {
  const read = ((_store: unknown, selector?: (state: AppState) => unknown) =>
    selector ? selector(state) : state) as typeof zustand.useStore
  const mocked = spyOn(zustand, 'useStore').mockImplementation(read)
  try {
    return renderToStaticMarkup(node)
  } finally {
    mocked.mockRestore()
  }
}
const advised = (html: string): readonly string[] =>
  [...html.matchAll(/data-better-job-character="(\w+)"/g)].map(([, id]) => id!)
const SESSION: CharacterSession = { inventory: [], commit: () => undefined, raise_stats: () => undefined }

test('a session that names no roster is advised nobody, whatever the player’s own characters are', () => {
  const html = render(<JobsTab character={viewed} copy={copy} session={SESSION} />, store_of(false))
  expect(advised(html)).toEqual([])
  expect(html).not.toContain(t('jobs.switch'))
  // The tab itself still reads: the professions, the level of the viewed character and its recipes.
  expect(html).toContain('data-tutorial-target="character_jobs"')
  expect(html).toContain(t('jobs.lv_badge', { level: 2 }))
  expect(html).toContain(t('jobs.recipes.best_progress'))
})

test('a session is advised among the characters it names, never among the player’s own', () => {
  const roster = { characters: [viewed, session_better], select: () => undefined }
  const html = render(<JobsTab character={viewed} copy={copy} session={{ ...SESSION, roster }} />, store_of(false))
  expect(advised(html)).toEqual([session_better.id])
  expect(html).toContain(t('jobs.switch_to_character', { name: 'Bran' }))
  expect(html).not.toContain('Okami')
  // A crafter locked in the player's settings is the player's own rule: it does not silence a session.
  const locked = render(<JobsTab character={viewed} copy={copy} session={{ ...SESSION, roster }} />, store_of(true))
  expect(advised(locked)).toEqual([session_better.id])
})

test('the player’s own tab advises their best character, and nobody while a crafter is locked', () => {
  const html = render(<JobsTab character={viewed} copy={copy} />, store_of(false))
  expect(advised(html)).toEqual([own_better.id])
  expect(html).toContain(t('jobs.better_character', { name: 'Okami', job: 'Farmer', level: 9 }))
  expect(advised(render(<JobsTab character={viewed} copy={copy} />, store_of(true)))).toEqual([])
  // The best character has nobody above it.
  expect(advised(render(<JobsTab character={own_better} copy={copy} />, store_of(false)))).toEqual([])
})
