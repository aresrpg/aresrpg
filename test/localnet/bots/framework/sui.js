// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SUI JSON-RPC LAYER — construct the localnet client, submit built PTBs, read chain state for assertions.
//
// Mirrors the repo's headless convention EXACTLY (packages/move/scripts/client.js + ceremony_lib.mjs +
// qa/_qa.mjs): `SuiJsonRpcClient` (@mysten/sui/jsonRpc) + `signAndExecuteTransaction({ signer, transaction,
// options })` + `waitForTransaction({ digest })`, parsing the classic `{ effects, objectChanges, events }`.
//
// TX-RETRY LAW (money-safety, binds every caller): an EXECUTED failure (a digest exists) is NEVER retried —
// submit() returns { ok:false } with the abort and lets the caller decide; it never re-fires. Only a
// build/pre-flight throw (no digest) escapes as an exception. On disposable localnet nothing burns real SUI,
// but we keep the law so the harness models mainnet behaviour honestly.

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from './deps.js'

// Localnet is free & disposable, so a fixed generous budget is safe (and &Random txs can't be dry-run for a
// derived one). NOT a mainnet number — mainnet derives from sim×1.5 under a ceiling (see SDK builders).
export const LOCALNET_GAS_BUDGET = 1_000_000_000 // 1 SUI

/** @param {string} rpc @param {string} [network] */
export function make_client(rpc, network = 'localnet') {
  return new SuiJsonRpcClient({ url: rpc || getJsonRpcFullnodeUrl('localnet'), network })
}

/**
 * Wrap a raw JSON-RPC tx result with created-object / event lookups the assert helpers use.
 * @param {any} r the signAndExecuteTransaction result
 */
export function wrap_result(r) {
  const objectChanges = r?.objectChanges ?? []
  const events = r?.events ?? []
  const status = r?.effects?.status?.status ?? (r?.ok === false ? 'failure' : 'unknown')
  const created = objectChanges.filter((c) => c?.type === 'created')
  return {
    ok: status === 'success',
    status,
    digest: r?.digest ?? null,
    abort: r?.effects?.status?.error ?? null,
    gasMist: gas_net(r?.effects?.gasUsed),
    objectChanges,
    events,
    effects: r?.effects ?? null,
    /** first created object whose type ENDS WITH `suffix` (e.g. '::character::Character') */
    created(suffix) {
      return created.find((c) => (c.objectType || '').endsWith(suffix))?.objectId ?? null
    },
    /** first created object whose type INCLUDES `needle` (e.g. '::personal_kiosk::PersonalKioskCap') */
    createdIncl(needle, owner) {
      return (
        created.find((c) => (c.objectType || '').includes(needle) && (!owner || c.owner?.AddressOwner === owner))
          ?.objectId ?? null
      )
    },
    /** every created object id whose type INCLUDES `needle` */
    createdAll(needle) {
      return created.filter((c) => (c.objectType || '').includes(needle)).map((c) => c.objectId)
    },
    /** first event whose type ENDS WITH `suffix`, returns its parsedJson */
    event(suffix) {
      return events.find((e) => (e.type || '').endsWith(suffix))?.parsedJson ?? null
    },
  }
}

/** Net gas (comp + storage - rebate) in MIST from an effects.gasUsed block. */
function gas_net(g) {
  if (!g) return null
  const n = (x) => BigInt(x ?? 0)
  return Number(n(g.computationCost) + n(g.storageCost) - n(g.storageRebate))
}

// ── CONTENTION / RETRY CLASSIFICATION (tens of bots on shared objects → expected version conflicts) ──────
//
// Under concurrency the SAME shared objects (Fight, Pool, kiosk, FightRegistry, dungeon registry) collide.
// The framework classifies EVERY outcome so contention is VISIBLE but never red-noises the suite, and so the
// money law is mechanical (encoded once, inherited by every bot):
//   (a) PRE-EXECUTION conflict/equivocation/network — NO tx executed (no digest) → SAFE to retry (bounded,
//       jittered; a rebuild thunk re-fetches fresh object refs).
//   (b) EXECUTED failure — a digest EXISTS (gas burned) → NEVER retried (tx-retry money law), recorded RED.
//   (c) MOVE ABORT with a code — an assertable outcome (the adversary track asserts the code), not noise.

const MOVE_ABORT_RE = /MoveAbort[\s\S]*?,\s*(\d+)\)|abort(?:_code)?[^0-9]{0,8}(\d+)/i
const MOVE_MODULE_RES = [
  /name:\s*Identifier\("([^"]+)"\)/i,
  /(?:module|function)\s+[^:\s]+::([^:\s]+)::/i,
  /([a-zA-Z_][\w]*)::[a-zA-Z_][\w]*\s+at/i,
]

export function parse_move_abort(error) {
  const message = String(error ?? '')
  const code_match = MOVE_ABORT_RE.exec(message)
  const module_match = MOVE_MODULE_RES.map((pattern) => pattern.exec(message)).find(Boolean)
  return {
    abort_code: code_match ? Number(code_match[1] ?? code_match[2]) : null,
    abort_module: module_match?.[1] ?? null,
  }
}

/** Classify a THROWN (no-digest, pre-execution) error into a retry class. */
export function classify_throw(err) {
  const m = String(err?.message ?? err ?? '')
  if (/equivocat/i.test(m)) return 'equivocation'
  if (/version|conflict|not available for consumption|reserved for another|ObjectVersion/i.test(m))
    return 'version_conflict'
  if (/deadline|timeout|ECONN|ETIMEDOUT|fetch failed|socket hang up|502|503|429|try again|temporarily/i.test(m))
    return 'network'
  return 'preflight_error'
}
const is_retryable = (cls) => cls === 'version_conflict' || cls === 'equivocation' || cls === 'network'

/** Classify an EXECUTED result (a digest exists). */
export function classify_executed(res) {
  const st = res?.effects?.status
  if (st?.status === 'success') return { class: 'success' }
  const parsed = parse_move_abort(st?.error)
  if (parsed.abort_code != null) return { class: 'move_abort', ...parsed }
  return { class: 'executed_failure' }
}

/** Compose and dry-run a negative-path transaction. It never signs, submits, or produces a digest. */
export async function simulate({ client, tx, sender, budget = LOCALNET_GAS_BUDGET }) {
  if (sender) tx.setSender(sender)
  if (!tx.getData?.().gasData?.budget) tx.setGasBudget(budget)
  try {
    const transactionBlock = await tx.build({ client })
    const result = await client.dryRunTransactionBlock({ transactionBlock })
    const wrapped = wrap_result(result)
    const parsed = parse_move_abort(result?.effects?.status?.error)
    return { ...wrapped, digest: null, class: wrapped.ok ? 'success' : 'move_abort', ...parsed }
  } catch (error) {
    const parsed = parse_move_abort(error?.message ?? error)
    return {
      ok: false,
      status: 'preflight_failure',
      digest: null,
      class: parsed.abort_code == null ? classify_throw(error) : 'move_abort',
      error: String(error?.message ?? error),
      ...parsed,
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jitter = (attempt) => sleep(40 * 2 ** (attempt - 1) + Math.floor(Math.random() * 60))

/** Per-class outcome counters — surfaced in the run report so contention is visible without failing the suite. */
export class SubmitStats {
  constructor() {
    this.classes = {} // class -> count (final outcome per tx)
    this.retries = 0 // total retried attempts
    this.retried_classes = {} // which pre-exec class caused a retry
  }
  record(res) {
    const c = res?.class ?? 'success'
    this.classes[c] = (this.classes[c] ?? 0) + 1
    this.retries += Math.max(0, (res?.attempts ?? 1) - 1)
    for (const rc of res?.retried ?? []) this.retried_classes[rc] = (this.retried_classes[rc] ?? 0) + 1
    return res
  }
  get executed_failures() {
    return this.classes.executed_failure ?? 0
  }
}

/**
 * Build → sign → execute → wait → wrap, WITH contention classification + the money-law retry policy.
 * @param {object} args
 * @param {any} args.client        SuiJsonRpcClient (or a mock with the same surface)
 * @param {any} args.signer        Ed25519Keypair
 * @param {import('@mysten/sui/transactions').Transaction} args.tx  the built tx (attempt 1)
 * @param {() => import('@mysten/sui/transactions').Transaction} [args.rebuild]  rebuild w/ fresh refs for a retry
 * @param {number} [args.budget]
 * @param {string} [args.sender]
 * @param {number} [args.max_retries]  bounded pre-exec retries (default 3)
 * @returns {Promise<ReturnType<typeof wrap_result> & { class: string, abort_code?: number, attempts: number, retried: string[] }>}
 */
export async function submit({ client, signer, tx, rebuild, budget = LOCALNET_GAS_BUDGET, sender, max_retries = 3 }) {
  const retried = []
  for (let attempt = 1; ; attempt++) {
    const t = attempt > 1 && rebuild ? rebuild() : tx
    if (sender) t.setSender(sender)
    else if (signer?.toSuiAddress) t.setSenderIfNotSet(signer.toSuiAddress())
    if (!t.getData?.().gasData?.budget) t.setGasBudget(budget)
    let r
    try {
      r = await client.signAndExecuteTransaction({
        signer,
        transaction: t,
        options: { showEffects: true, showObjectChanges: true, showEvents: true },
      })
    } catch (e) {
      // THROWN before execution (no digest): safe to retry the retryable classes, bounded + jittered.
      const cls = classify_throw(e)
      if (is_retryable(cls) && attempt <= max_retries) {
        retried.push(cls)
        await jitter(attempt)
        continue
      }
      return {
        ok: false,
        status: 'preflight_failure',
        class: cls,
        digest: null,
        error: String(e?.message ?? e),
        attempts: attempt,
        retried,
        objectChanges: [],
        events: [],
        created: () => null,
        createdIncl: () => null,
        createdAll: () => [],
        event: () => null,
      }
    }
    // A digest means execution happened. Waiting only improves read visibility; if that wait races the fullnode,
    // return the executed outcome and let callers poll state. Retrying here could repeat a gas-burning abort.
    let wait_error = null
    if (r?.digest && client.waitForTransaction)
      try {
        await client.waitForTransaction({ digest: r.digest })
      } catch (error) {
        wait_error = String(error?.message ?? error)
      }
    const ex = classify_executed(r)
    return {
      ...wrap_result(r),
      class: ex.class,
      abort_code: ex.abort_code,
      abort_module: ex.abort_module,
      attempts: attempt,
      retried,
      wait_error,
    }
  }
}

// ── reads (state assertions) ───────────────────────────────────────────────────────────────────────────

/** A parsed object's Move struct fields (o.data.content.fields), or null. */
export async function get_fields(client, id) {
  const o = await client.getObject({ id, options: { showContent: true, showType: true, showOwner: true } })
  return o?.data?.content?.fields ?? null
}

/** The full parsed object (data + owner + type). */
export async function get_object(client, id) {
  const o = await client.getObject({ id, options: { showContent: true, showType: true, showOwner: true } })
  return o?.data ?? null
}

/** Owned objects of an exact StructType (e.g. `${PKG}::run::RunPass`). */
export async function owned_by_type(client, owner, structType) {
  const out = []
  let cursor = null
  do {
    const p = await client.getOwnedObjects({
      owner,
      filter: { StructType: structType },
      options: { showType: true, showContent: true },
      cursor,
    })
    out.push(...(p.data ?? []))
    cursor = p.hasNextPage ? p.nextCursor : null
  } while (cursor)
  return out
}

/** Dynamic fields under a parent (kiosk contents, etc.). */
export async function dynamic_fields(client, parentId) {
  const p = await client.getDynamicFields({ parentId })
  return p?.data ?? []
}

export async function sui_balance(client, owner) {
  const b = await client.getBalance({ owner })
  return BigInt(b?.totalBalance ?? 0)
}

/**
 * FREE read-only call of a pure `fun` via devInspect (no gas, no digest, no state change) — the right tool for
 * verifying a module-level formula (e.g. `commission::platform_cut_of` / `kolizeum::platform_cut_of`) against the
 * REAL published bytecode without needing a whole live money-flow to observe it. Returns the decoded return
 * values (BCS-decoded per `returnTypes`, e.g. ['u64']), or throws with the devInspect error on failure.
 * @param {any} client SuiJsonRpcClient
 * @param {import('@mysten/sui/transactions').Transaction} tx a moveCall-only tx (sender required, no gas payment needed)
 * @param {string} sender any valid address (devInspect never executes for real)
 */
export async function dev_inspect(client, tx, sender) {
  tx.setSenderIfNotSet(sender)
  const r = await client.devInspectTransactionBlock({ sender, transactionBlock: tx })
  if (r?.effects?.status?.status !== 'success')
    throw new Error(`[dev_inspect] simulation failed: ${JSON.stringify(r?.effects?.status)}`)
  return r
}

/** Decode devInspect's `results[i].returnValues` (array of `[bytes, type]`) as BigInt u64s via BCS. `bcs.u64()`
 *  parses to a STRING (precision-safe for u64), not a bigint or number — callers comparing against a computed
 *  bigint need the coercion done HERE, once, or every call site risks a silent `"100" === 100n` false-negative. */
export function dev_inspect_u64s(result, bcs) {
  const rv = result?.results?.[0]?.returnValues ?? []
  return rv.map(([bytes]) => BigInt(bcs.u64().parse(Uint8Array.from(bytes))))
}

/** Decode devInspect's FIRST return value as a bool via BCS. */
export function dev_inspect_bool(result, bcs) {
  const bytes = result?.results?.[0]?.returnValues?.[0]?.[0]
  return bytes ? bcs.bool().parse(Uint8Array.from(bytes)) : false
}
