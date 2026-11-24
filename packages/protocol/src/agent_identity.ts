// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/** AI-authored presentation only; never executable steps or inferred completion. */
export type HostedObjective = Readonly<{
  title: string
  description?: string
  steps?: readonly string[]
}>
export type AgentSignerMode = 'disposable' | 'host-persistent'
export type AgentPairingIdentity = Readonly<{
  address: string
  multisig_public_key: string
  signer_mode: AgentSignerMode
}>
export type AgentObservation = Readonly<{
  pairing: AgentPairingIdentity
  public_identifier: string
  character_id: string | null
}>
export const valid_agent_observation = (value: unknown): value is AgentObservation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  const pairing = row.pairing as Record<string, unknown> | null
  return (
    typeof row.public_identifier === 'string' &&
    (row.character_id === null || /^0x[0-9a-f]{64}$/.test(String(row.character_id))) &&
    !!pairing &&
    typeof pairing.multisig_public_key === 'string' &&
    /^0x[0-9a-f]{64}$/.test(String(pairing.address)) &&
    (pairing.signer_mode === 'disposable' || pairing.signer_mode === 'host-persistent')
  )
}

/** Why a hosted run ended by itself, as its bot tells its owner. `completed` is an authored end that
 * names none of the other reasons. A run its player stopped has no ending. The bot sends these codes
 * only, and every reader gives each its own sentence. */
export const RUN_ENDINGS = ['objective_reached', 'fee_cap_reached', 'run_cap_reached', 'completed'] as const
export type RunEnding = (typeof RUN_ENDINGS)[number]
/** The listed ending a code names. Any other value names none: a reader then tells a plain end. */
export const run_ending = (code: unknown): RunEnding | undefined => RUN_ENDINGS.find((ending) => ending === code)

/** What only a hosted bot knows about its own wallet: what the wallet is doing as a whole, its hero
 * runs and its one direct command. The bot sends it on its own socket when it changes, and when a
 * watching owner asks; the server relays it to the verified owner and stores nothing. It is the one
 * owner-facing status of a bot: no client reads these facts another way. `event_fence` then
 * `sampled_at` order two statuses of one wallet. */
export type AgentStatus = Readonly<{
  ready: boolean
  event_fence: number
  sampled_at: number
  state: 'idle' | 'active' | 'waiting' | 'awaiting_ai' | 'paused' | 'unavailable'
  runs: readonly Readonly<{
    id: string
    character_id: string
    status: string
    issue?: string
    /** The AI-authored presentation of the run's goal; absent for a run of a retired shape. */
    objective?: HostedObjective
    /** Net network fees this run paid since its tree was started or replaced, in MIST. */
    fees_mist?: string
    /** Dungeon runs this run saw end since its tree was started or replaced. */
    dungeon_runs?: number
    /** Set on a run that ended by itself, to its `RunEnding`. Such a run holds no hero; the bot keeps
     * telling it until that hero starts again. */
    ended?: string
  }>[]
  direct: Readonly<{
    id: string
    kind: string
    status: string
    error?: string
    payload: Readonly<Record<string, unknown>>
  }> | null
  /** Net network fees of every transaction this wallet's bot settled, in MIST. */
  fees_mist?: string
}>
/** The statuses of a direct command the wallet still holds: the bot admits no other direct command
 * meanwhile, and an owner's page locks its one-off actions by the same list. */
export const DIRECT_UNSETTLED: readonly string[] = ['accepted', 'executing']
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const STATES: readonly unknown[] = ['idle', 'active', 'waiting', 'awaiting_ai', 'paused', 'unavailable']
const text = (value: unknown): boolean => typeof value === 'string'
const optional_text = (value: unknown): boolean => value === undefined || text(value)
/** A sum of net fees in MIST: a storage rebate can make it negative. */
const optional_mist = (value: unknown): boolean => value === undefined || (text(value) && /^-?\d+$/.test(String(value)))
const optional_count = (value: unknown): boolean =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0)
const valid_objective = (value: unknown): boolean =>
  value === undefined ||
  (plain(value) &&
    [
      text(value.title),
      optional_text(value.description),
      value.steps === undefined || (Array.isArray(value.steps) && value.steps.every(text)),
    ].every(Boolean))
const valid_run = (value: unknown): boolean =>
  plain(value) &&
  [
    text(value.id),
    text(value.character_id),
    text(value.status),
    optional_text(value.issue),
    valid_objective(value.objective),
    optional_mist(value.fees_mist),
    optional_count(value.dungeon_runs),
    optional_text(value.ended),
  ].every(Boolean)
const valid_direct = (value: unknown): boolean =>
  value === null ||
  (plain(value) &&
    [text(value.id), text(value.kind), text(value.status), optional_text(value.error), plain(value.payload)].every(
      Boolean
    ))
/** The door a status enters by: the owner's page renders it, so every field it reads is checked here. */
export const valid_agent_status = (value: unknown): value is AgentStatus =>
  plain(value) &&
  [
    typeof value.ready === 'boolean',
    Number.isSafeInteger(value.event_fence),
    Number.isFinite(value.sampled_at),
    STATES.includes(value.state),
    Array.isArray(value.runs) && value.runs.every(valid_run),
    valid_direct(value.direct),
    optional_mist(value.fees_mist),
  ].every(Boolean)
