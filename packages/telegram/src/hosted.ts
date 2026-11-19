// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { random_token, type BotClient, type BotIdentity, type BotResult } from '@aresrpg/protocol/hosted-bot-client'
import type { StrategyScript } from '@aresrpg/protocol/strategies'

import { binding_of } from './link.ts'

export type Bot = ReturnType<BotClient['session']>
type Row = Readonly<Record<string, any>>
type Revisions = Readonly<{ decision_revision: number; observation_revision: number }>
export type Hero = Readonly<{
  id: string
  name: string
  /** A strategy can be set for it: in its kiosk, or in a fight it is seated in, and in no dungeon. */
  usable: boolean
  activity: 'fight' | 'ambush' | 'idle' | 'observation_unknown'
  /** The bot's own row: the authoritative checkpoint a strategy is bound to. */
  row: Row
}>
/** One hero's run: its status, and the catalogue entry its tree was bound from; null for an authored tree. */
export type Run = Readonly<{ status: string; strategy: string | null }>
/** What the hosted bot reports now. It is read once per update and nothing of it is kept. */
export type View = Readonly<{
  /** Everything the login acts for; a card or review of another binding is stale. */
  binding: string
  balance: string | null
  /** Unknown inventory stays null: it is never shown as an empty bag. */
  items: readonly Row[] | null
  /** Every run the wallet hosts, by hero id, whichever client started it. */
  runs: Readonly<Record<string, Run>>
  /** Null until the bot's authenticated baseline is ready. */
  roster: Readonly<{ heroes: readonly Hero[]; revisions: Revisions }> | null
}>

const activity_of = (row: Row): Hero['activity'] => {
  if (row.active_fight || row.custody === 'fight') return 'fight'
  if (row.ambush) return 'ambush'
  return row.custody === 'kiosk' && !row.dungeon_run ? 'idle' : 'observation_unknown'
}
const hero_of = (row: Row): Hero => ({
  id: row.id,
  name: row.name,
  usable: Boolean((row.custody === 'kiosk' || (row.custody === 'fight' && row.active_fight)) && !row.dungeon_run),
  activity: activity_of(row),
  row,
})
/** Heroes the agent holds: in its kiosk or in a fight. Game data is untrusted: a malformed row is no hero. */
const heroes_of = (rows: readonly unknown[]): readonly Hero[] =>
  rows
    .filter((row): row is Row => typeof (row as Row | null)?.id === 'string' && typeof (row as Row).name === 'string')
    .filter(({ custody }) => custody === 'kiosk' || custody === 'fight')
    .map(hero_of)
/** Every listed run by hero id. Game data is untrusted: a malformed row is no run. */
const listed_runs = (rows: unknown): View['runs'] =>
  Object.fromEntries(
    (Array.isArray(rows) ? (rows as readonly (Row | null)[]) : []).flatMap((run) =>
      typeof run?.character_id === 'string' && typeof run.status === 'string'
        ? [[run.character_id, { status: run.status, strategy: typeof run.strategy === 'string' ? run.strategy : null }]]
        : []
    )
  )
const revision = (value: unknown) => (Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null)
const roster_of = (raw: Row): View['roster'] => {
  const [decision_revision, observation_revision] = [
    revision(raw.decision_revision),
    revision(raw.observation_revision),
  ]
  const ready = [raw.ready === true, raw.status !== 'pending', Array.isArray(raw.characters)].every(Boolean)
  if (!ready || decision_revision === null || observation_revision === null) return null
  return { heroes: heroes_of(raw.characters), revisions: { decision_revision, observation_revision } }
}

const format_native_sui = (mist: string, scale: string) => {
  const value = BigInt(mist)
  const denominator = BigInt(scale)
  const whole = value / denominator
  const fraction = (value % denominator)
    .toString()
    .padStart(scale.length - 1, '0')
    .replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} SUI`
}
/** The agent multisig's own fresh SUI sample, or nothing: a foreign, stale or rescaled balance is unknown. */
const verified_balance = (raw: Row, address: string): string | null => {
  const { balance } = raw
  if (!balance) return null
  const scale = balance.mist_per_sui
  if (
    ![
      raw.ready === true,
      raw.status !== 'pending',
      balance.address === address,
      balance.unit === 'MIST',
      /^\d+$/.test(balance.balance_mist),
      balance.clock === 'monotonic_ms',
      balance.sampled_at <= raw.sampled_at,
      raw.sampled_at < balance.expires_at,
      scale === '1000000000',
      [raw.sampled_at, balance.sampled_at, balance.expires_at].every((value) => Number.isFinite(value) && value >= 0),
    ].every(Boolean)
  )
    return null
  return format_native_sui(balance.balance_mist, scale)
}

/** One fresh observation per update: every card and every request of that update derives from it. */
export const read_view = async (bot: Bot, identity: BotIdentity): Promise<BotResult<View>> => {
  const observed = await bot.call('bot_observe', { view: 'full' })
  if (!observed.ok) return observed
  const raw: Row = observed.value
  const roster = roster_of(raw)
  const { inventory } = raw
  const view: View = {
    binding: binding_of(identity),
    balance: verified_balance(raw, identity.address),
    items: roster && inventory?.loaded === true && Array.isArray(inventory.items) ? inventory.items : null,
    runs: listed_runs(raw.runs),
    roster,
  }
  return { ok: true, value: view }
}

export type Action = Readonly<
  (
    | { type: 'start'; script: StrategyScript; revisions: Revisions }
    | { type: 'replace'; script: StrategyScript; character: string; revisions: Revisions }
    | { type: 'stop'; character: string }
    | { type: 'pause' }
    | { type: 'resume'; revisions: Revisions }
  ) & {
    /** Who the outcome line is about; empty for the whole wallet. */
    subject: string
  }
>
/** One request to the hosted bot, sent once. A mutation is never sent again, whatever its answer. */
export const perform = async (bot: Bot, action: Action): Promise<BotResult<Row>> => {
  switch (action.type) {
    case 'start':
      return bot.call('bot_start_behavior', {
        script: action.script,
        idempotency_key: random_token(),
        ...action.revisions,
      })
    case 'replace': {
      // The bot replaces a tree only at its current revision, read here right before the request.
      const run = await bot.call('bot_behavior_status', { character_id: action.character })
      if (!run.ok) return run
      return bot.call('bot_replace_behavior', {
        script: action.script,
        character_id: action.character,
        expected_revision: run.value.revision,
        ...action.revisions,
      })
    }
    case 'stop':
      return bot.call('bot_stop_behavior', { character_id: action.character })
    case 'pause':
      return bot.call('bot_pause')
    case 'resume':
      return bot.call('bot_resume', action.revisions)
  }
}
