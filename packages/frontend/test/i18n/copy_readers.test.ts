// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Every copy key has a reader. A key is read when its last segment appears in code that renders the copy, the copy's
// type declarations excluded, or when it belongs to a family that code reads through a key built at run time.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test } from 'bun:test'
import { parse } from 'yaml'

const REPO = resolve(import.meta.dir, '../../../..')
const FRONTEND = join(REPO, 'packages/frontend')
/** The site and the game, the shared UI package, and the services that read the locale files. */
const READERS = ['src', 'api', '../ui/src', '../discord/src', '../server/src']
/** They declare every key, so they read none. */
const TYPES = ['src/i18n/copy.ts', 'src/kares/copy.ts'].map((path) => join(FRONTEND, path))

/** Families read through a key built at run time, each with what builds the key. */
const DYNAMIC: readonly (readonly [RegExp, string])[] = [
  [/^spell_names\./, '`spell_name` reads a spell identity from content'],
  [/^spell_effects\./, '`spell_effect_text` builds the phrase from effect data'],
  [/^item_categories\./, 'an item category from content'],
  [/^title_names\./, '`player_caption` reads a title id from the chain'],
  [/^item_drop_sources\./, '`ItemDropSources` reads a drop source from content'],
  [
    /^encyclopedia_page\.(gameplay|element|world_role|item_descriptions|job_desc|gather_job|job_category)\./,
    'the reference views and docs read these by content id',
  ],
  [/^encyclopedia_page\.group_[a-z]+_resources$/, '`ItemFilters` builds `group_${id}_resources`'],
  [/^journey\.([a-z_]+_(title|body|objective)|chapter_[a-z_]+)$/, '`JourneyPanel` builds them from the quest id'],
  [/^tutorial\.[a-z_]+_(title|body)$/, '`TutorialHost` builds them from the step key'],
  [/^tournament_page\.(reason|action|match|from)_/, 'tournament presentation builds them from bracket state'],
  [/^agent_page\.(error|run_notice|run_ended)_/, '`activity_text` builds them from bot codes'],
  [/^allocation_page\.(error|board|source|sale)_/, 'the allocation views build them from campaign state'],
  [/^gift_page\.(error_[a-z_]+|[a-z]+_(title|body))$/, '`gift_presentation` and `GiftScene` build them from state'],
  [/^settings_page\.suins_/, '`SuinsSettings` builds them from the request state'],
  [/^demo_page\.(asset|hillaire|board_cell)_/, 'the demo workshops build them from their own tables'],
  [/^leaderboard_page\.(job_[A-Z]+|[a-z]+_description)$/, '`LeaderboardPage` builds them from the board id'],
  [/^loading_screen\.[a-z]+_(eyebrow|title|description)$/, '`LoadingPostcard` builds them from the loading context'],
  [/^kolizeum_page\.(tab|status)_/, '`KolizeumPage` builds them from the tab and lobby status'],
  [/^marketplace_page\.((prices_range|volume|group)_[a-z0-9]+|[a-z]+_(pending|success))$/, 'market views'],
  [/^trade_panel\.[a-z]+_notice$/, '`TradeDialog` builds `${operation}_notice`'],
  [/^wallet_legacy\.funding_status_/, '`FundingCheckout` builds it from the checkout stage'],
  [/^simulator_page\.(class_[a-z]+_title|stat_[a-z_]+)$/, 'class and stat names, read by identity'],
  [/^admin_page\.(range_[0-9]+d|bucket_[a-z0-9]+)$/, 'the admin overview builds them from its range and bucket'],
  [/^fight_hud\.result_wager_/, '`FightResultCard` builds it from the wager outcome'],
  [/^kares_page\.blast_/, 'the sale views build it from the sale phase'],
  [/^characters_page\.(bag_filter|refusal)_/, 'inventory filters and equipment refusals'],
  [/^ui\.(agent_activity|portrait_background|feedback)_/, 'hero activity, portrait background and feedback answer'],
  [/^ui\.agent_asset_(available|listed|equipped|reserved|sui|kares)$/, 'an item status or a token name'],
  [/^ui\.agent_guide_[a-z]+_(open|fill)$/, '`ProviderHandoff` builds them from the provider name'],
  [/^airdrop_page\.delivery\./, '`AirdropPage` reads a campaign row’s delivery kind'],
]

const files = (dir: string): readonly string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (name === 'node_modules' || name === 'locales') return []
        return statSync(path).isDirectory() ? files(path) : [path]
      })
    : []
/** The build files beside the package root render copy too (link previews, the manifest). */
const root_files = readdirSync(FRONTEND).map((name) => join(FRONTEND, name))
const code = [...READERS.flatMap((dir) => files(join(FRONTEND, dir))), ...root_files]
  .filter((path) => /\.(ts|tsx|js|mjs)$/.test(path) && !TYPES.includes(path))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

const leaf_paths = (value: unknown, prefix = ''): readonly string[] =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, child]) => leaf_paths(child, prefix ? `${prefix}.${key}` : key))
    : [prefix]
const keys = leaf_paths(parse(readFileSync(join(FRONTEND, 'src/i18n/locales/en.yaml'), 'utf8')))
const dynamic = (path: string): boolean => DYNAMIC.some(([family]) => family.test(path))

test('every copy key has a reader in product code', () => {
  expect(code).toContain('create_and_play')
  expect(keys.filter((path) => !dynamic(path) && !code.includes(path.split('.').at(-1)!))).toEqual([])
})

test('every dynamic family still names keys of the copy', () => {
  expect(DYNAMIC.filter(([family]) => !keys.some((path) => family.test(path))).map(([, reason]) => reason)).toEqual([])
})
