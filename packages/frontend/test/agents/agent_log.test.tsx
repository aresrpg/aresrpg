// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { HeroEvent, HeroLogs } from '../../src/agents/activity.ts'
import { AgentActivityLog } from '../../src/agents/AgentActivity.tsx'
import { AgentLogView, shown_hero } from '../../src/agents/AgentLog.tsx'
import { dapp_text } from '../../src/dapp/copy.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'

import { account, bran, mira, pushed, run, type Account } from './log_fixture.ts'

const copy = en as AppCopy
const NONE: HeroLogs = {}
/** What the player reads: the markup with every tag and attribute removed. */
const read = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const view = (held: Partial<Account>, logs: HeroLogs = NONE, picked: string | null = null): string =>
  renderToStaticMarkup(
    <AgentLogView copy={copy} locale="en" account={account(held)} logs={logs} picked={picked} pick={() => {}} />
  )
const logged = (...list: readonly HeroEvent[]) =>
  list.map((event, index) => ({ id: index + 1, at: Date.UTC(2026, 10, 21, 14, index), event }))

test('the hero selector is one shared control per hero, and picking a hero shows that hero’s log', () => {
  const heroes = [mira({ level: 13 }), bran({ level: 9 })]
  const logs = { mira: logged({ kind: 'level', level: 13 }), bran: logged({ kind: 'travel' }) }
  const first = view({ characters: heroes }, logs)
  expect(first).toContain('class="aui-segments" role="group"')
  expect(first).toContain(`aria-label="${copy.dapp_page.heroes_title}"`)
  expect(first.match(/<button/g)).toHaveLength(2)
  expect(first).toMatch(/<button[^>]*aria-pressed="true"[^>]*>(<img[^>]*>)?Mira · Level 13<\/button>/)
  expect(first).toMatch(/<button[^>]*aria-pressed="false"[^>]*>(<img[^>]*>)?Bran · Level 9<\/button>/)
  expect(read(first)).toContain('Reached level 13')
  expect(read(first)).not.toContain(copy.ui.agent_activity_travel)
  const second = view({ characters: heroes }, logs, 'bran')
  expect(second).toMatch(/<button[^>]*aria-pressed="true"[^>]*>(<img[^>]*>)?Bran · Level 9<\/button>/)
  expect(second).toContain(`aria-label="${copy.ui.agent_activity_label} · Bran"`)
  expect(read(second)).toContain(copy.ui.agent_activity_travel)
  expect(read(second)).not.toContain('Reached level 13')
  // A picked hero that left the account falls back to the first hero the account holds.
  expect(shown_hero(heroes, 'gone')?.id).toBe('mira')
  expect(shown_hero(heroes, 'bran')?.id).toBe('bran')
  expect(shown_hero([], 'bran')).toBeNull()
})

test('the log is a live region with timed lines oldest first and the line in progress marked last', () => {
  const html = view({}, { mira: logged({ kind: 'fight_entered' }, { kind: 'experience', gained: '1250' }) })
  expect(html).toContain('role="log"')
  expect(html).toContain('aria-live="polite"')
  expect(html).toContain('tabindex="0"')
  expect(html).toContain('<time dateTime="2026-11-21T14:00:00.000Z">')
  expect(html).toContain('<time dateTime="2026-11-21T14:01:00.000Z">')
  const text = read(html)
  expect(text.indexOf(copy.ui.agent_activity_fight_entered!)).toBeLessThan(text.indexOf(copy.dapp_page.position_xp!))
  expect(text).toContain('+1,250')
  // The line in progress is what the bot says of the hero now: it has no time, and a mark that is a shape.
  const current = html.slice(html.indexOf('aria-current="true"'))
  expect(current).toContain(copy.ui.agent_activity_idle)
  expect(current).toContain('class="agent-log-cursor" aria-hidden="true"')
  expect(current).not.toContain('<time')
  expect(html.match(/aria-current/g)).toHaveLength(1)
  expect(text).toContain('Read only. Your AI assistant decides what happens here.')
})

test('a connected agent that did nothing yet shows one quiet waiting line', () => {
  const html = view({})
  expect(html.match(/class="agent-log-row"/g)).toHaveLength(1)
  expect(read(html)).toContain(copy.ui.agent_activity_idle)
  expect(html).not.toContain('<time')
  // Until the bot speaks, the hero's own row says where it is.
  expect(read(view({ status: null }))).toContain(copy.ui.agent_activity_world)
  expect(read(view({ status: null, characters: [mira({ active_fight: { id: 'fight', seat: 0 } })] }))).toContain(
    copy.ui.agent_activity_fight
  )
})

test('a run that cannot continue shows the run notice sentence under its title, never the bot’s code', () => {
  const blocked = (issue: string, status = 'waiting') =>
    view({ status: pushed({ state: 'waiting', runs: [run({ status, issue, strategy: 'gather_craft' })] }) })
  const funding = blocked('funding_required')
  expect(read(funding)).toContain(`Herbalist level 30 ${copy.dapp_page.run_notice_funding}`)
  expect(funding).toContain('data-tone="alert"')
  expect(read(blocked('gathering_tool_required'))).toContain(copy.dapp_page.run_notice_requirement)
  expect(read(blocked('any words of its author', 'awaiting_ai'))).toContain(copy.dapp_page.run_notice_plan)
  // An ordinary wait is the run's state, in the status words the overlay already uses.
  const waiting = blocked('travel_not_ready')
  expect(read(waiting)).toContain(`Herbalist level 30 ${copy.ui.agent_activity_waiting}`)
  expect(waiting).not.toContain('data-tone')
  for (const html of [
    funding,
    waiting,
    blocked('gathering_tool_required'),
    blocked('any words of its author', 'awaiting_ai'),
  ])
    for (const raw of [
      'funding_required',
      'travel_not_ready',
      'gathering_tool_required',
      'any words',
      'gather_craft',
      'awaiting_ai',
    ])
      expect(html).not.toContain(raw)
})

test('every line kind reads as plain words: no bot code, enum value or item id reaches the page', () => {
  const lines = logged(
    { kind: 'run', title: 'Gather quartz', phase: 'working' },
    { kind: 'run', title: null, phase: 'plan' },
    { kind: 'run', title: 'Hunt together', phase: 'ended' },
    { kind: 'run', title: 'Raid ten times', phase: 'ended', ending: 'run_cap_reached' },
    { kind: 'command', error: null },
    { kind: 'command', error: 'listing_changed_or_ineligible' },
    { kind: 'command', error: 'a_code_added_tomorrow' },
    { kind: 'command', error: '' },
    { kind: 'fight_won' },
    { kind: 'fight_lost' },
    { kind: 'loot', drops: [{ item_type: 'aloe_vera', qty: 2 }] },
    { kind: 'dungeon', dungeon: 'gilded_lorito', room: 2 },
    { kind: 'dungeon_left' },
    { kind: 'profession' },
    { kind: 'fight_left' }
  )
  const html = view({}, { mira: lines })
  const text = read(html)
  for (const said of [
    `Gather quartz ${copy.dapp_page.position_running}`,
    `${copy.dapp_page.activity_other} ${copy.dapp_page.run_notice_plan}`,
    `Hunt together ${copy.dapp_page.position_finished}`,
    `Raid ten times ${dapp_text(copy, 'run_ended_run_cap_reached')}`,
    `Action asked by your assistant ${copy.dapp_page.position_finished}`,
    copy.dapp_page.error_listing_changed_or_ineligible!,
    copy.dapp_page.error_unknown!,
    copy.fight_hud.result_victory!,
    copy.fight_hud.result_defeat!,
    'Loot 2 × Aloe Vera',
    'Gilded Lorito · room 2',
    'Left the dungeon',
    copy.ui.agent_activity_profession!,
    copy.ui.agent_activity_fight_left!,
  ])
    expect(text).toContain(said)
  for (const raw of [
    'listing_changed_or_ineligible',
    'a_code_added_tomorrow',
    'gilded_lorito',
    'aloe_vera',
    'fight_won',
    'dungeon_left',
    'working',
    'undefined',
    'null',
    '{',
  ])
    expect(html).not.toContain(raw)
  // A refusal is said in words and marked as a problem; colour is not its only signal.
  expect(html.match(/data-tone="alert"/g)).toHaveLength(4)
})

test('an account with no hero names its wait, says a failure, and tells an empty account what to do', () => {
  const loading = view({ phase: 'loading', characters: [] })
  expect(loading).toContain('role="status"')
  expect(loading).toContain('aria-busy="true"')
  expect(read(loading)).toContain(copy.dapp_page.reading_heroes)
  const failed = view({ phase: 'failed', characters: [] })
  expect(failed).toContain('role="alert"')
  expect(read(failed)).toContain(copy.dapp_page.heroes_failed)
  const empty = view({ characters: [] })
  expect(read(empty)).toContain(copy.dapp_page.empty_title)
  expect(read(empty)).toContain(copy.dapp_page.empty_body)
  expect(empty).not.toContain('href=')
  for (const html of [loading, failed, empty]) {
    expect(html).not.toContain('role="log"')
    expect(html).not.toContain('aui-segments')
    expect(read(html)).toContain('Read only.')
  }
  // Heroes that arrived before the bag are shown at once: the page never waits for the whole account.
  expect(view({ phase: 'loading' })).toContain('role="log"')
  // A read that fails after heroes were shown keeps them and says so.
  const stale = view({ phase: 'failed' })
  expect(stale).toContain('role="log"')
  expect(read(stale)).toContain(copy.dapp_page.heroes_failed)
})

test('the in-game card reads the same lines from the same words', () => {
  const html = renderToStaticMarkup(
    <AgentActivityLog
      copy={copy}
      character={mira()}
      locale="en"
      history={[
        { kind: 'experience', gained: '1250' },
        { kind: 'dungeon', dungeon: 'gilded_lorito', room: 1 },
      ]}
    />
  )
  expect(read(html)).toContain(`${copy.dapp_page.position_xp} +1,250`)
  expect(read(html)).toContain('Gilded Lorito · room 1')
  expect(html).not.toContain('gilded_lorito')
})
