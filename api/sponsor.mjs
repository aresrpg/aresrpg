// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Station-only: zkLogin client reserves/signs; the internal gas station signs/submits exactly once.
import { readFileSync as read_file } from 'node:fs'

import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, normalizeSuiAddress, toBase64 } from '@mysten/sui/utils'
import { SuiGrpcClient } from '@mysten/sui/grpc'

import checked_in_release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

import { init_reporting, report_error } from './report.js'
import { assert_zklogin_challenge } from './zklogin_auth.mjs'
import {
  ADDR_DAILY_CAP_MIST,
  ADDR_RL_MAX,
  PER_TX_BUDGET_CEILING_MIST,
  RL_WINDOW_MS,
  SELF_PAY_MIST,
  SHARED_STORE_ERROR,
  SHARED_STORE_REASON,
  addr_daily_hold,
  addr_rate_limited,
  rate_limited,
  release_daily_hold,
  settle_daily_hold,
  shared_store_ready,
  stash_reservation,
  take_reservation,
  utc_date,
} from './sponsor_state.mjs'
export {
  ADDR_DAILY_CAP_MIST,
  PER_TX_BUDGET_CEILING_MIST,
  SHARED_STORE_ERROR,
  SHARED_STORE_REASON,
  shared_store_ready,
  addr_daily_hold,
  addr_daily_spent,
  addr_rate_limited,
  addr_rl_key,
  addr_spent_key,
  ip_rl_key,
  rate_limited,
  release_daily_hold,
  stash_reservation,
} from './sponsor_state.mjs'

init_reporting() // error reporting (report.js) — hard no-op without SENTRY_DSN

const NETWORK = process.env.VITE_NETWORK || 'testnet'
const release = process.env.SPONSOR_RELEASE_PATH
  ? JSON.parse(read_file(process.env.SPONSOR_RELEASE_PATH, 'utf8'))
  : checked_in_release
const GRPC_URL = process.env.SPONSOR_GRPC_URL || `https://fullnode.${NETWORK}.sui.io:443`
const client = new SuiGrpcClient({ network: NETWORK, baseUrl: GRPC_URL })
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-max-age': '86400',
}
const RESERVE_DURATION_SECS = Number(process.env.SPONSOR_RESERVE_DURATION_SECS || 60)
const CHALLENGE_TTL_MS = Number(process.env.SPONSOR_CHALLENGE_TTL_MS || 5 * 60_000)
// A hung simulate must REFUSE, never park a sponsored request forever holding an inbound connection.
const SIMULATE_TIMEOUT_MS = Number(process.env.SPONSOR_SIMULATE_TIMEOUT_MS || 15_000)
// Request-size rails. The sponsor parses, authenticates and SIMULATES whatever arrives, so an unbounded body is
// unbounded work per request; the per-IP/per-address throttles bound the RATE, never the SIZE. Both are base64 /
// JSON character bounds — generous multiples of a real PTB (a fat create-character kind is ~2 KB).
const MAX_BODY_CHARS = Number(process.env.SPONSOR_MAX_BODY_CHARS || 256 * 1024)
const MAX_TX_KIND_CHARS = Number(process.env.SPONSOR_MAX_TX_KIND_CHARS || 64 * 1024)
const OVERSIZE_BODY_ERROR = `sponsor-oversize: request body exceeds the ${MAX_BODY_CHARS}-character limit — refusing`
/** true when a declared or measured body length is over the bound (a missing/unparseable length is not). */
const oversized = (length) => Number(length) > MAX_BODY_CHARS
const normalize_set = (csv) =>
  new Set(
    String(csv)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => normalizeSuiAddress(value))
  )

const network_release = release.networks[NETWORK]
const package_releases = Object.values(network_release?.packages ?? {})
const release_package_ids = [
  ...package_releases.flatMap(({ origin, latest }) => [origin, latest]),
  network_release?.rules_package,
].filter(Boolean)
const outdated_package_ids = package_releases.flatMap(({ previous }) => previous ?? [])

const SUI_ADDRESS_RE = /^0x[0-9a-f]{64}$/
// The PTB-scope allowlist: SPONSOR_ARESRPG_PACKAGES env (comma-separated 0x ids) wins when SET, so
// a ceremony/republish is a config change, never an image rebuild (the 07-20 scope-bake outage).
// Unset falls back to the release.json derivation below (dev/local convenience). FAIL CLOSED: a
// SET-but-empty env, or any entry that isn't a full 0x + 64-hex address, refuses to boot with the
// bad entry named — never a silent fallback (a typo'd allowlist must never quietly sponsor the
// wrong scope).
function resolve_aresrpg_packages() {
  const env = process.env.SPONSOR_ARESRPG_PACKAGES
  if (env == null) {
    const ids = normalize_set(release_package_ids.join(','))
    console.log(`sponsor allowlist: release.json(${ids.size})`)
    return ids
  }
  const entries = env
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toLowerCase())
  if (!entries.length)
    throw new Error('sponsor-misconfig: SPONSOR_ARESRPG_PACKAGES is set but empty — refusing to boot (fail-closed)')
  const bad_entry = entries.find((value) => !SUI_ADDRESS_RE.test(value))
  if (bad_entry)
    throw new Error(
      `sponsor-misconfig: SPONSOR_ARESRPG_PACKAGES has a malformed entry "${bad_entry}" (want 0x + 64 hex chars) — refusing to boot (fail-closed)`
    )
  const ids = new Set(entries)
  console.log(`sponsor allowlist: env(${ids.size})`)
  return ids
}
const ARESRPG_PACKAGES = resolve_aresrpg_packages()
const OUTDATED_PACKAGES = normalize_set(outdated_package_ids.join(','))
const FRAMEWORK_PACKAGES = normalize_set((network_release?.system.sponsor_framework_packages ?? []).join(','))
export const OUTDATED_PACKAGE_REASON = 'outdated-package'
const OUTDATED_PACKAGE_ERROR_PREFIX = `sponsor-scope: ${OUTDATED_PACKAGE_REASON}`
export const WOULD_ABORT_REASON = 'would-abort'
export const WOULD_ABORT_ERROR_PREFIX = `sponsor-${WOULD_ABORT_REASON}:`
// A simulation we cannot READ is not a simulation that said "this aborts" — and neither is an RPC that never
// answered. Three distinct machine classes, because the client's honest copy differs for each and conflating
// them once let an unreadable result be priced as a clean success.
export const SIMULATION_UNREADABLE_REASON = 'simulation-unreadable'
export const SIMULATION_INFRASTRUCTURE_REASON = 'simulation-infrastructure'
// The two refusals that gate the PLAYER'S OWN money, and the two the client must branch on without reading a
// word of English: SELF_PAY is the funded-wallet balance rule (the client silently self-pays the same PTB),
// DAILY_CAP is the free-tier ceiling (the client blocks rather than spend a ≤0.2-SUI wallet's dust). Both carry
// their reason for the same rule as every other machine reason here: a copy edit must never be able to un-tag a
// money refusal. The strings below stay the human diagnostic, nothing more.
export const SELF_PAY_REASON = 'self-pay-required'
export const DAILY_CAP_REASON = 'daily-cap'

/**
 * Build a refusal that carries its MACHINE reason ON THE ERROR — never re-derived by matching the message text
 * (a copy edit must not be able to silently un-tag a money refusal). `sponsor_chain_error` carries the chain's
 * own failure string as a STRUCTURAL field so the client never has to strip a prefix back off the message.
 */
function sponsor_refusal(reason, message, chain_error = null) {
  const error = new Error(message)
  error.sponsor_reason = reason
  if (chain_error != null) error.sponsor_chain_error = chain_error
  return error
}

export function sponsor_error_response(error) {
  const error_message = String(error?.message ?? error)
  const reason = typeof error?.sponsor_reason === 'string' ? error.sponsor_reason : null
  if (!reason) return { error: error_message }
  const chain_error = typeof error?.sponsor_chain_error === 'string' ? error.sponsor_chain_error : null
  return chain_error ? { error: error_message, reason, chain_error } : { error: error_message, reason }
}

// ── BOOT REFUSAL: a dev bypass may never share a process with the gas-station credentials ──────────────
// api/server.mjs runs the sponsor and the courier in ONE process, and every `*_DEV_BYPASS_*` switch disarms an
// identity check on the container that also holds the station bearer. Off localnet the two must never coexist:
// the process refuses to boot instead of serving money with an auth rail switched off. Localnet is exempt by
// construction — a throwaway chain and a throwaway pool (test/gold/compose.gold.yml drives exactly that).
const DEV_BYPASS_KEY_RE = /_DEV_BYPASS_/
const FALSEY_ENV = new Set(['', '0', 'false', 'off', 'no'])
export const armed_dev_bypasses = (env = process.env) =>
  Object.keys(env)
    .filter(
      (key) =>
        DEV_BYPASS_KEY_RE.test(key) &&
        !FALSEY_ENV.has(
          String(env[key] ?? '')
            .trim()
            .toLowerCase()
        )
    )
    .sort()

export function assert_no_dev_bypass_with_station_credentials(env = process.env) {
  if (!env.GAS_STATION_URL?.trim() || !env.GAS_STATION_AUTH?.trim()) return
  const network = env.VITE_NETWORK || 'testnet'
  if (network === 'localnet') return
  const armed = armed_dev_bypasses(env)
  if (armed.length)
    throw new Error(
      `sponsor-misconfig: development bypass switch(es) [${armed.join(', ')}] are set on a process that holds ` +
        `gas-station credentials (network=${network}) — refusing to boot (fail-closed). Unset them, or run localnet.`
    )
}
assert_no_dev_bypass_with_station_credentials()

export function require_station_config() {
  if (!process.env.GAS_STATION_URL?.trim() || !process.env.GAS_STATION_AUTH?.trim())
    throw new Error('sponsor-misconfig: GAS_STATION_URL + GAS_STATION_AUTH required — refusing to boot (fail-closed)')
}

// ── THE COMMAND GRAPH ─────────────────────────────────────────────────────────────────────────────────
// The package allowlist answers "may this be CALLED" — it says nothing about the rest of the PTB, and the rest
// of the PTB rides on a gas coin belonging to the STATION. So the whole graph is checked, on two axes:
//
//   KINDS — an allowlist of what the game's own composers actually emit (censused from
//   packages/sdk/src/sui/write/**: MoveCall and SplitCoins, nothing else). The check used to inspect MoveCalls
//   and `continue` past every other command, which made "unrecognised" mean "allowed" — the widest possible
//   default, on the money path. A shape the sponsor does not understand now refuses instead of riding along,
//   and a composer that starts emitting a new kind reddens api/sponsor.command_graph.test.js first.
//
//   THE GAS COIN — a sponsor pays for EXECUTION, never for the transaction's own value. The gas coin of a
//   sponsored PTB is the station's, and a `SplitCoins(GasCoin, …)` takes real SUI out of it — so the game's
//   paid PTBs (mint price, shop buy, pledge, royalty, escrow) are self-pay compositions by construction, and a
//   sponsored request carrying one is refused before signing rather than billed to the pool. Refusing the gas
//   coin as an ARGUMENT anywhere is what makes that one rule instead of a taint-tracking exercise: no command
//   can obtain gas value, so no later command can move it.
export const SPONSORABLE_COMMAND_KINDS = ['MoveCall', 'SplitCoins']
const SPONSORABLE_KINDS = new Set(SPONSORABLE_COMMAND_KINDS)

/** Every argument a command consumes, flattened. */
function command_arguments(command) {
  switch (command.$kind) {
    case 'MoveCall':
      return command.MoveCall.arguments ?? []
    case 'SplitCoins':
      return [command.SplitCoins.coin, ...(command.SplitCoins.amounts ?? [])]
    default:
      return []
  }
}

/**
 * Refuse any PTB whose command graph is not sponsorable: a command kind outside the allowlist, or any command
 * drawing value from the sponsored gas coin. Pure over the decoded command list, so it is testable without a
 * chain, a station or a store.
 */
export function assert_command_graph(commands) {
  commands.forEach((command, index) => {
    if (command.$kind === 'Publish' || command.$kind === 'Upgrade')
      throw new Error('sponsor-scope: PTB publishes/upgrades a package — never sponsored')
    if (!SPONSORABLE_KINDS.has(command.$kind))
      throw new Error(
        `sponsor-scope: PTB command #${index} is a ${command.$kind} — only ${SPONSORABLE_COMMAND_KINDS.join('/')} commands are sponsored`
      )
    if (command_arguments(command).some((argument) => argument?.$kind === 'GasCoin'))
      throw new Error(
        `sponsor-scope: PTB command #${index} draws value from the sponsored gas coin — a sponsor pays for execution, never for the transaction's own value`
      )
  })
}

export function assert_ptb_scope(txKindBytes) {
  let commands
  try {
    ;({ commands } = Transaction.fromKind(fromBase64(txKindBytes)).getData())
  } catch (error) {
    throw new Error(`sponsor-scope: unparseable PTB (${error?.message ?? error}) — refusing`)
  }
  assert_command_graph(commands)
  let aresrpg_calls = 0
  for (const command of commands) {
    if (command.$kind !== 'MoveCall') continue
    const package_id = normalizeSuiAddress(command.MoveCall.package)
    // RETIRED FIRST, unconditionally. The allowlist answers "may this be called"; release.json answers "is this
    // id retired" — and the retired answer is the upgrade tooth, so allowlist membership may never short-circuit
    // it. It could before: SPONSOR_ARESRPG_PACKAGES is pasted by a human at ceremony time, and a paste one id
    // wider than the release derivation silently re-opened a retired package (the two homes disagreed, the
    // wider one won). Now they cannot disagree in the permissive direction.
    if (OUTDATED_PACKAGES.has(package_id))
      throw sponsor_refusal(
        OUTDATED_PACKAGE_REASON,
        `${OUTDATED_PACKAGE_ERROR_PREFIX}: MoveCall targets retired package ${package_id}::${command.MoveCall.module} — refresh to upgrade`
      )
    const is_framework = FRAMEWORK_PACKAGES.has(package_id)
    const is_allowlisted = ARESRPG_PACKAGES.has(package_id)
    if (!is_allowlisted && !is_framework)
      throw new Error(
        `sponsor-scope: MoveCall targets non-allowlisted package ${package_id}::${command.MoveCall.module} — only aresrpg + composed framework packages are sponsored`
      )
    // A framework id is NEVER an aresrpg call, even when the deployed allowlist happens to list it too — the
    // ≥1-aresrpg-call rule is what stops a bare framework PTB (kiosk/transfer only) from being sponsored, and a
    // wide paste must not be able to satisfy it.
    if (is_allowlisted && !is_framework) aresrpg_calls += 1
  }
  if (!aresrpg_calls)
    throw new Error(
      'sponsor-scope: PTB has no aresrpg MoveCall — bare-transfer / framework-only PTBs are not sponsored'
    )
}

async function assert_sponsor_zklogin_challenge(sender, challenge, signature) {
  // Env-gated QA escape hatch, default off, with a deliberately loud warning.
  if (process.env.SPONSOR_DEV_BYPASS_ZKLOGIN === '1') {
    console.warn('[sponsor] ⚠️ DEV zkLogin bypass ON — QA/dev throwaway only, never prod')
    return
  }
  await assert_zklogin_challenge({
    sender,
    challenge,
    signature,
    purpose: 'aresrpg-sponsor',
    client,
    ttl_ms: CHALLENGE_TTL_MS,
  })
}

/**
 * THE SIMULATE GATE (#1385). A simulation that ABORTS is a REFUSAL, never a price quote — before this existed
 * the sponsor read `gasUsed` off `Transaction ?? FailedTransaction` and happily priced, reserved, co-signed and
 * SUBMITTED a PTB its own dry-run had just proven would abort: the player burned sponsor gas on a chain failure,
 * and the pool was grief-able by construction (an attacker submits aborting PTBs all day, each one a real spend).
 * The gRPC core union tags a failed simulation `FailedTransaction`; a failed-but-untagged result still carries
 * `status.success === false`; no effects at all means we learned nothing. All three refuse.
 * SINGLE-VERDICT LAW: this is the same decision as the client's `gas_guard_decision` sim_failed arm
 * (packages/frontend/src/game/core/gas_guard.js) — the sponsor image ships as three standalone files (api/Dockerfile)
 * so it cannot import it; `api/sponsor.simulate_gate.test.js` runs BOTH over one fixture corpus and fails on any
 * divergence, which is what keeps the two honest.
 *
 * ALLOW-BY-EXCEPTION (the floor-2 review finding): the gate's ACCEPT arm is the narrow one. Only an explicitly
 * clean success — union tag `Transaction` AND `effects.status.success === true` — is priceable. Everything else
 * refuses, in one of two DISTINCT classes, because they are not the same fact and must not share copy or a
 * counter: `would-abort` is the chain telling us this PTB fails, `simulation-unreadable` is us not knowing.
 * The earlier shape ("refuse when it looks failed, otherwise price it") accepted a missing status, an unknown
 * union tag and a non-boolean `success` — shapes carrying no success verdict at all — and read `gasUsed` off them.
 * @param {any} simulation grpc simulateTransaction result
 * @returns {{ ok: true, effects: any }
 *   | { ok: false, reason: 'would-abort', chain_error: string }
 *   | { ok: false, reason: 'simulation-unreadable', detail: string }}
 */
export function classify_simulation(simulation) {
  const effects = (simulation?.Transaction ?? simulation?.FailedTransaction)?.effects
  if (effects && (simulation?.$kind === 'FailedTransaction' || effects?.status?.success === false))
    return {
      ok: false,
      reason: WOULD_ABORT_REASON,
      chain_error: String(effects?.status?.error ?? 'simulation reported failure'),
    }
  if (simulation?.$kind === 'Transaction' && effects?.status?.success === true) return { ok: true, effects }
  return {
    ok: false,
    reason: SIMULATION_UNREADABLE_REASON,
    detail: effects
      ? `simulation returned no clean success verdict (kind=${String(simulation?.$kind ?? 'none')})`
      : 'simulation returned no effects',
  }
}

/**
 * Bound an in-flight RPC. Nothing is reserved or signed at this point, so a deadline is pure upside: a fullnode
 * that stops answering becomes a fast, classified refusal instead of a request parked until the client gives up.
 */
async function with_deadline(promise, timeout_ms, label) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded the ${timeout_ms}ms deadline`)), timeout_ms)
  })
  try {
    return await Promise.race([promise, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** A gas field the chain sends as a decimal string → MIST, or null when it is not a number at all. */
function mist_or_null(value) {
  try {
    return BigInt(value ?? 0)
  } catch {
    return null
  }
}

export function derive_budget_mist(gas_used) {
  const computation = mist_or_null(gas_used?.computationCost)
  const storage = mist_or_null(gas_used?.storageCost)
  // Unreadable gas numbers are an UNPRICED budget, not a zero one — refuse with the same honest reason rather
  // than letting a raw BigInt conversion error escape as an unclassified 400.
  if (computation == null || storage == null)
    throw new Error('sponsor-unpriceable: simulation returned unreadable gas numbers — refusing')
  const gross = computation + storage
  if (gross <= 0n)
    throw new Error('sponsor-unpriceable: simulation returned no gas — refusing (never sign an unpriced budget)')
  const budget = (gross * 3n) / 2n
  if (budget > PER_TX_BUDGET_CEILING_MIST)
    throw new Error(
      `sponsor-over-ceiling: derived gas budget ${(Number(budget) / 1e9).toFixed(4)} SUI exceeds the ` +
        `${(Number(PER_TX_BUDGET_CEILING_MIST) / 1e9).toFixed(3)} SUI per-tx ceiling — refusing (client PTB too gas-heavy)`
    )
  return budget
}
// Never THROWS: this runs on POST-EXECUTION effects, where a throw would lose the receipt of a transaction whose
// gas is already burned. An unreadable field counts as 0 — for the rebate that charges the full gross (never less
// than reality), and the ledger stays honest rather than the call failing on a cosmetic field.
export function real_charge_mist(gas_used) {
  const computation = mist_or_null(gas_used?.computationCost) ?? 0n
  const storage = mist_or_null(gas_used?.storageCost) ?? 0n
  const rebate = mist_or_null(gas_used?.storageRebate) ?? 0n
  const net = computation + storage - rebate
  return net < computation ? computation : net
}

const initial_refusals = () => ({
  zklogin: 0,
  scope: 0,
  balance: 0,
  rate: 0,
  daily: 0,
  ceiling: 0,
  store: 0,
  abort: 0,
  sim_unreadable: 0,
  sim_infra: 0,
  station: 0,
  mismatch: 0,
  execreject: 0,
})
const stats = {
  day: '',
  reserved: 0,
  sponsored: 0,
  spent: 0n,
  charged_total: 0n,
  refused: initial_refusals(),
  addresses: new Set(),
}
function roll_stats() {
  const day = utc_date()
  if (day === stats.day) return
  if (stats.day)
    console.log(
      `[sponsor] DAILY ${stats.day} — sponsored=${stats.sponsored} refused=${JSON.stringify(stats.refused)} unique_addrs=${stats.addresses.size} spent≈${(Number(stats.spent) / 1e9).toFixed(4)} SUI`
    )
  Object.assign(stats, {
    day,
    reserved: 0,
    sponsored: 0,
    spent: 0n,
    charged_total: 0n,
    refused: initial_refusals(),
    addresses: new Set(),
  })
}
export function sponsor_stats() {
  roll_stats()
  return {
    day: stats.day,
    mode: 'station',
    reserved: stats.reserved,
    sponsored: stats.sponsored,
    refused: stats.refused,
    unique_addresses: stats.addresses.size,
    spent_sui: +(Number(stats.spent) / 1e9).toFixed(6),
    charged_total_sui: +(Number(stats.charged_total) / 1e9).toFixed(6),
    per_address_max_per_window: ADDR_RL_MAX,
    per_address_window_min: Math.round(RL_WINDOW_MS / 60_000),
    self_pay_over_sui: Number(SELF_PAY_MIST) / 1e9,
    per_player_daily_cap_sui: Number(ADDR_DAILY_CAP_MIST) / 1e9,
    per_tx_budget_ceiling_sui: Number(PER_TX_BUDGET_CEILING_MIST) / 1e9,
  }
}

export async function station_reserve({ gas_budget, reserve_duration_secs }) {
  require_station_config()
  let response
  try {
    response = await fetch(`${process.env.GAS_STATION_URL}/v1/reserve_gas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GAS_STATION_AUTH}` },
      body: JSON.stringify({ gas_budget, reserve_duration_secs }),
    })
  } catch (error) {
    throw new Error(`sponsor-station-down: reserve_gas unreachable (${error?.message ?? error}) — refusing`)
  }
  if (!response.ok) throw new Error(`sponsor-station-error: reserve_gas HTTP ${response.status} — refusing`)
  const body = await response.json().catch(() => ({}))
  if (body?.error || !body?.result)
    throw new Error(`sponsor-reserve-failed: ${body?.error ?? 'no reservation returned'} — refusing`)
  const { sponsor_address, reservation_id, gas_coins } = body.result
  if (!sponsor_address || reservation_id == null || !Array.isArray(gas_coins) || !gas_coins.length)
    throw new Error('sponsor-reserve-failed: malformed reservation (missing sponsor/id/coins) — refusing')
  return { sponsor_address, reservation_id, gas_coins }
}
async function station_execute({ reservation_id, tx_bytes, user_sig }) {
  require_station_config()
  let response
  try {
    response = await fetch(`${process.env.GAS_STATION_URL}/v1/execute_tx`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GAS_STATION_AUTH}` },
      body: JSON.stringify({ reservation_id, tx_bytes, user_sig }),
    })
  } catch (error) {
    throw new Error(`sponsor-station-down: execute_tx unreachable (${error?.message ?? error}) — refusing`)
  }
  if (!response.ok) throw new Error(`sponsor-station-error: execute_tx HTTP ${response.status} — refusing`)
  const body = await response.json().catch(() => ({}))
  return { effects: body?.effects ?? null, error: body?.error ?? null }
}

export function assert_tx_matches_reservation(tx_bytes, reservation) {
  let data
  try {
    data = TransactionDataBuilder.fromBytes(fromBase64(tx_bytes))
  } catch (error) {
    throw new Error(`sponsor-tx-invalid: unparseable tx bytes (${error?.message ?? error}) — refusing`)
  }
  const address = (value) => normalizeSuiAddress(String(value ?? ''))
  if (address(data.sender) !== address(reservation.sender))
    throw new Error('sponsor-tx-mismatch: sender does not match the reservation — refusing')
  if (address(data.gasData?.owner) !== address(reservation.sponsor_address))
    throw new Error('sponsor-tx-mismatch: gas owner is not the reserved sponsor — refusing')
  if (String(data.gasData?.budget ?? '') !== String(reservation.budget))
    throw new Error('sponsor-tx-mismatch: gas budget does not match the reserved budget — refusing')
  const expected_coins = new Set((reservation.gas_coins || []).map((coin) => address(coin.objectId)))
  const actual_coins = new Set((data.gasData?.payment || []).map((coin) => address(coin.objectId)))
  if (expected_coins.size !== actual_coins.size || [...expected_coins].some((id) => !actual_coins.has(id)))
    throw new Error('sponsor-tx-mismatch: gas payment coins are not the reserved coins — refusing')
  if (toBase64(data.build({ onlyTransactionKind: true })) !== reservation.kind)
    throw new Error('sponsor-tx-mismatch: transaction kind differs from what was priced (scope-bypass) — refusing')
}

/** No shared store, no sponsorship — the one refusal both money doors take before doing anything else. */
async function assert_shared_store() {
  if (await shared_store_ready()) return
  stats.refused.store += 1
  throw sponsor_refusal(SHARED_STORE_REASON, SHARED_STORE_ERROR)
}

export async function reserveSponsored({ txKindBytes, sender, challenge, signature }) {
  require_station_config()
  if (!txKindBytes || !sender) throw new Error('txKindBytes + sender required')
  // SIZE BEFORE WORK: parsing, zkLogin verification and simulation all scale with the PTB, and the throttles
  // bound the request RATE, never its size. One home for the bound — both transports route through here.
  if (typeof txKindBytes !== 'string' || txKindBytes.length > MAX_TX_KIND_CHARS)
    throw new Error(`sponsor-oversize: PTB kind exceeds the ${MAX_TX_KIND_CHARS}-character limit — refusing`)
  roll_stats()
  // THE FIRST GATE, and the cheapest: every anti-drain limit below (rate window, daily cap, the once-only
  // reservation) is a limit only while all instances read one store. Without it they become per-process
  // allowances that multiply by instance count — so refuse here, before any verification, balance read or
  // simulation, rather than sponsor against counters that cannot hold.
  await assert_shared_store()
  try {
    await assert_sponsor_zklogin_challenge(sender, challenge, signature)
  } catch (error) {
    stats.refused.zklogin += 1
    throw error
  }
  const { balance } = await client.core.getBalance({ owner: sender })
  if (BigInt(balance.balance) > SELF_PAY_MIST) {
    stats.refused.balance += 1
    throw sponsor_refusal(SELF_PAY_REASON, 'self-pay-required: balance exceeds 0.2 SUI — sign with your own gas')
  }
  try {
    assert_ptb_scope(txKindBytes)
  } catch (error) {
    stats.refused.scope += 1
    throw error
  }
  if (await addr_rate_limited(sender)) {
    stats.refused.rate += 1
    throw new Error('rate-limited: too many sponsorships for this address, retry later')
  }
  let simulation
  try {
    const transaction = Transaction.fromKind(fromBase64(txKindBytes))
    transaction.setSender(sender)
    transaction.setGasBudget(Number(PER_TX_BUDGET_CEILING_MIST))
    simulation = await with_deadline(
      client.core.simulateTransaction({ transaction, include: { effects: true } }),
      SIMULATE_TIMEOUT_MS,
      'simulateTransaction'
    )
  } catch (error) {
    // INFRASTRUCTURE, not a verdict: the RPC threw or never answered, so the chain said nothing about this PTB.
    stats.refused.sim_infra += 1
    throw sponsor_refusal(
      SIMULATION_INFRASTRUCTURE_REASON,
      `sponsor-unpriceable: simulation failed (${error?.message ?? error}) — refusing`
    )
  }
  // THE GATE — refuse HERE: nothing reserved, nothing co-signed, nothing executed, zero gas anywhere. A
  // would-abort sends the chain's own error back (the client decodes it through its ONE abort-copy table); an
  // unreadable result sends its own reason, because "this will fail" and "we could not tell" are different facts.
  const verdict = classify_simulation(simulation)
  if (!verdict.ok) {
    if (verdict.reason === WOULD_ABORT_REASON) {
      stats.refused.abort += 1
      throw sponsor_refusal(
        WOULD_ABORT_REASON,
        `${WOULD_ABORT_ERROR_PREFIX} ${verdict.chain_error}`,
        verdict.chain_error
      )
    }
    stats.refused.sim_unreadable += 1
    throw sponsor_refusal(SIMULATION_UNREADABLE_REASON, `sponsor-unpriceable: ${verdict.detail} — refusing`)
  }
  const gas_used = verdict.effects.gasUsed
  let budget
  try {
    budget = derive_budget_mist(gas_used)
  } catch (error) {
    stats.refused.ceiling += 1
    throw error
  }
  // THE DAILY CAP, BOOKED — not merely consulted. The budget about to be reserved is charged against the day
  // counter HERE, atomically, so a pipelined burst of reserves cannot each read the same pre-burst total and all
  // pass (see sponsor_state.mjs). The hold rides in the reservation and is settled to the REAL charge at execute;
  // every path that ends the reservation early releases it, and an abandoned one is released at its expiry.
  const daily_hold = await addr_daily_hold(sender, budget)
  if (daily_hold == null) {
    stats.refused.daily += 1
    throw sponsor_refusal(
      DAILY_CAP_REASON,
      'daily free gameplay limit reached — transactions now require your own gas until tomorrow'
    )
  }
  let reservation
  try {
    reservation = await station_reserve({ gas_budget: Number(budget), reserve_duration_secs: RESERVE_DURATION_SECS })
  } catch (error) {
    await release_daily_hold(daily_hold, sender) // no reservation exists ⇒ nothing is owed against the cap
    stats.refused.station += 1
    throw error
  }
  const { sponsor_address, reservation_id, gas_coins } = reservation
  if (normalizeSuiAddress(sender) === normalizeSuiAddress(sponsor_address)) {
    await release_daily_hold(daily_hold, sender)
    throw new Error('sender must differ from @server (ctx.sponsor() would be None)')
  }
  // A reservation only THIS process can find is not a reservation — the execute call may land anywhere. If it
  // cannot be parked where every instance sees it, nothing is signed: release the cap hold and refuse, and the
  // station's own reservation lapses at its expiry (no signature, no gas).
  const stashed = await stash_reservation(reservation_id, {
    sender,
    sponsor_address,
    gas_coins,
    budget: String(budget),
    kind: txKindBytes,
    daily_hold,
  })
  if (!stashed) {
    await release_daily_hold(daily_hold, sender)
    stats.refused.store += 1
    throw sponsor_refusal(SHARED_STORE_REASON, SHARED_STORE_ERROR)
  }
  stats.reserved += 1
  stats.addresses.add(sender)
  return {
    reservationId: reservation_id,
    sponsorAddress: sponsor_address,
    gasCoins: gas_coins,
    gasBudget: Number(budget),
  }
}

export async function executeSponsored({ reservationId, txBytes, userSig }) {
  require_station_config()
  if (reservationId == null || !txBytes || !userSig) throw new Error('reservationId + txBytes + userSig required')
  roll_stats()
  // Same first gate: the hold this call settles, and the once-only reservation it consumes, both live in the
  // shared store. Refuse honestly instead of executing against state only this instance can see.
  await assert_shared_store()
  const reservation = await take_reservation(reservationId)
  if (!reservation)
    throw new Error(
      'sponsor-reservation-unknown: no such reservation (expired, already used, or foreign) — reserve again'
    )
  // The reservation is consumed, so its cap hold is this call's to settle: released whole on every path that
  // charges nothing, corrected to the executed charge on the one path that does.
  try {
    assert_tx_matches_reservation(txBytes, reservation)
  } catch (error) {
    await release_daily_hold(reservation.daily_hold, reservation.sender)
    stats.refused.mismatch += 1
    throw error
  }
  // Exactly one execute call: effects mean gas burned, so this path never auto-retries. A THROW here (station
  // unreachable / HTTP error) is the one shape that cannot prove non-execution, so the hold is deliberately NOT
  // released: it lapses at its own expiry, and until then the player's cap counts a spend that may be real.
  const { effects, error } = await station_execute({
    reservation_id: reservationId,
    tx_bytes: txBytes,
    user_sig: userSig,
  })
  if (!effects) {
    await release_daily_hold(reservation.daily_hold, reservation.sender)
    stats.refused.execreject += 1
    throw new Error(`sponsor-exec-rejected: ${error ?? 'no effects'} — pre-execution rejection, no gas charged`)
  }
  const charge = real_charge_mist(effects.gasUsed)
  await settle_daily_hold(reservation.daily_hold, reservation.sender, charge)
  stats.sponsored += 1
  stats.spent += charge
  stats.charged_total += charge
  stats.addresses.add(reservation.sender)
  return { effects, digest: effects?.transactionDigest ?? null }
}

async function handle_sponsor_post(pathname, body) {
  if (pathname.endsWith('/reserve')) return { status: 200, json: await reserveSponsored(body) }
  if (pathname.endsWith('/execute')) return { status: 200, json: await executeSponsored(body) }
  return { status: 410, json: { error: 'sponsor-two-call-upgrade' } }
}

export default async function handler(request, response) {
  Object.entries(CORS).forEach(([key, value]) => response.setHeader(key, value))
  if (request.method === 'OPTIONS') return response.status(204).end()
  if (request.method === 'GET') return response.status(200).json(sponsor_stats())
  if (request.method !== 'POST') return response.status(405).json({ error: 'POST only' })
  try {
    require_station_config()
  } catch (error) {
    report_error(error, { area: 'sponsor', action: 'station_config' })
    return response.status(503).json({ error: String(error?.message ?? error) })
  }
  // Ahead of the throttle on purpose: with no shared store the throttle itself cannot answer, and "rate
  // limited" would be a false explanation for an outage.
  if (!(await shared_store_ready()))
    return response.status(503).json({ error: SHARED_STORE_ERROR, reason: SHARED_STORE_REASON })
  const ip =
    String(request.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() ||
    request.socket?.remoteAddress ||
    'unknown'
  if (await rate_limited(ip)) return response.status(429).json({ error: 'rate limited — retry shortly' })
  if (oversized(request.headers['content-length'])) return response.status(413).json({ error: OVERSIZE_BODY_ERROR })
  if (typeof request.body === 'string' && oversized(request.body.length))
    return response.status(413).json({ error: OVERSIZE_BODY_ERROR })
  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const [pathname] = String(request.url || '/api/sponsor').split('?')
    const result = await handle_sponsor_post(pathname, body)
    response.status(result.status).json(result.json)
  } catch (error) {
    report_error(error, { area: 'sponsor', action: 'handle_post' })
    response.status(400).json(sponsor_error_response(error))
  }
}

export async function sponsor_fetch(request) {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (url.pathname === '/') return new Response('OK', { headers: CORS })
  if ((url.pathname === '/stats' || url.pathname === '/api/stats') && request.method === 'GET')
    return Response.json(sponsor_stats(), { headers: CORS })
  if (
    request.method === 'POST' &&
    ['/api/sponsor', '/api/sponsor/reserve', '/api/sponsor/execute'].includes(url.pathname)
  ) {
    if (!(await shared_store_ready()))
      return Response.json({ error: SHARED_STORE_ERROR, reason: SHARED_STORE_REASON }, { status: 503, headers: CORS })
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local'
    if (await rate_limited(ip)) return Response.json({ error: 'rate limited' }, { status: 429, headers: CORS })
    // Declared size first (refuse before reading a byte), then the real body — a lying/absent content-length
    // must not buy an unbounded read.
    if (oversized(request.headers.get('content-length')))
      return Response.json({ error: OVERSIZE_BODY_ERROR }, { status: 413, headers: CORS })
    const body_text = await request.text()
    if (oversized(body_text.length))
      return Response.json({ error: OVERSIZE_BODY_ERROR }, { status: 413, headers: CORS })
    try {
      const result = await handle_sponsor_post(url.pathname, JSON.parse(body_text))
      return Response.json(result.json, { status: result.status, headers: CORS })
    } catch (error) {
      report_error(error, { area: 'sponsor', action: 'handle_post' })
      return Response.json(sponsor_error_response(error), { status: 400, headers: CORS })
    }
  }
  return Response.json({ error: 'not found' }, { status: 404, headers: CORS })
}

if (typeof Bun !== 'undefined' && import.meta.main) {
  const port = Number(process.env.SPONSOR_PORT || 9528)
  require_station_config()
  console.log(`[sponsor] station-only net=${NETWORK} :${port}`)
  Bun.serve({
    port,
    fetch: sponsor_fetch,
    // The one surface fetch()'s own try/catch doesn't cover (e.g. `new URL()` on a malformed
    // request line): report_error no-ops without SENTRY_DSN — same response either way.
    error(error) {
      report_error(error, { area: 'fetch' })
      return Response.json({ error: 'internal_error' }, { status: 500, headers: CORS })
    },
  })
}
