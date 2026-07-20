// ceremony_lib.mjs — helpers for the 5-package PUBLISH CEREMONY orchestrator (S-46 merge). SCRIPT ONLY.
//
// Split out of ceremony.mjs (the 600-LoC file cap): pure, side-effect-light helpers — constants, the
// dependency topology + topological publish order, the lazy signer/client (dry-run needs NO key), the
// no-retry SUCCESS runner + dryRun-derived gas budgets (the tx-retry-burn law), Published.toml stamping
// (the automated-address-management publish-state file these packages actually use — NOT a manual Move.toml
// `published-at`), and the manifest classifier. The orchestration (publish loop, wiring/enable PTBs,
// assertions, dry-run plan) lives in ceremony.mjs and imports everything here.
//
// SIGNER/NETWORK env mirror the house `client.js` (PRIVATE_KEY / NETWORK / SUI_GRPC_URL) but are loaded LAZILY
// so `--dry-run` never throws for a missing key (proof-bar requirement). TRANSPORT: the gRPC Core API — testnet
// JSON-RPC is dead (fullnode.testnet.sui.io JSON-RPC = 404); every read/dryRun/execute rides `SuiGrpcClient`
// (mirrors packages/sdk/src/sui.js). Receipt shapes are re-projected to the jsonRpc-ish form consumers parse
// (normalizeReceipt) so `classify`/`resolveBatch`/`createdId` stay byte-identical across the cutover.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

const __dir = path.dirname(fileURLToPath(import.meta.url))
export const MOVE_DIR = path.resolve(__dir, '..') // packages/move
export const OUT = path.join(__dir, 'out')
export const MANIFEST_PATH = path.join(OUT, 'ceremony_manifest.json')

// S-46: the ExtensionCap namespace machinery is DELETED from the merged package — no cap-deposit map exists.

export const ROYALTY_BP = 1000 // 10% royalty floor rate
// FLAT royalty FLOOR per sale, in MIST — the Mysten royalty_rule charges max(price × bp/10000, min_amount). At 0 a
// price-0 (or dust) listing dodged royalty entirely (advisor HIGH, 2026-07-11). 10_000_000 MIST = 0.01 SUI: it only
// BINDS below a 0.1-SUI sale (where the 10% rate is under the floor), so it taxes zero/dust listings without touching
// real gear/character trades (a 1-SUI sale pays 0.1 SUI via the rate, far above the floor). Cheap stackables trade via
// the pool curve, not kiosk listings, so the floor never hits legitimate micro-sales. DECLARED for owner sign-off.
export const ROYALTY_MIN = 10_000_000

// Chain-ids declared in every package's Move.toml [environments] — stamped into Published.toml so a downstream
// sibling build resolves the freshly-published dependency address for the target network.
export const CHAIN_IDS = { testnet: '4c78adac', mainnet: '35834a8a' }

// Framework / system package ids to EXCLUDE when deriving RULES_PKG from aresrpg's publish dependencies: once the
// framework (0x1/0x2/…) and the four sibling packages are removed, the single remaining dep IS the exact kiosk
// lineage version aresrpg linked against == the id its linkageTable binds == the ONLY id the royalty/kiosk_lock/
// personal_kiosk rule `add`s may target. getRulePackageId instead returns the Kiosk ORIGINAL published id; a rule
// `add` against that ORIGINAL aborts InvalidLinkage — the policy's type resolves through aresrpg's linkageTable,
// which binds the LINKED (compiled-against) dep id, not the original — so the linked dep id is the truth.
const FRAMEWORK_IDS = new Set(
  ['0x1', '0x2', '0x3', '0x5', '0xb', '0xdee9'].map(norm)
)

// ── The 7-package dependency graph (S-46 final split + the 2026-07-11/12 size splits: foundation = math libs;
//    spells/social standalone; engine (aresrpg_fight) = the generic branded combat engine; aresrpg = THE core
//    game; kolizeum (aresrpg_kolizeum) = the PvP wager arena; forgemagie (aresrpg_forgemagie) = the Retro
//    rune forge — both extracted when core hit the 102,400 B publish cap (07-11 kolizeum, 07-12 forgemagie)) ──
export const PKG_DEPS = {
  foundation: [],
  spells: ['foundation'],
  social: [],
  engine: ['foundation', 'spells'],
  aresrpg: ['foundation', 'spells', 'social', 'engine'],
  kolizeum: ['aresrpg', 'engine', 'social'],
  forgemagie: ['aresrpg', 'foundation'],
  gifting: ['aresrpg'],
  dungeon: ['aresrpg', 'engine'],
}
export const TICKET_ORDER = [
  'foundation',
  'spells',
  'social',
  'engine',
  'aresrpg',
  'kolizeum',
  'forgemagie',
  'gifting',
  'dungeon',
]

// The old per-package manifest keys retained for seed-script compatibility.
// S-46: they all resolve to the ONE aresrpg entry — written as ALIASES into the manifest so downstream scripts
// keep working verbatim ("all six SDK homes get the SAME PACKAGE_ID + the one VERSION" — the spec's ripple).
// 'kolizeum' LEFT the alias set 2026-07-11: it is a REAL package again (the size split) — its manifest entry is
// written by its own publish; aliasing it to core would stamp the SDK's kolizeum targets at the WRONG package.
// 'dungeon' LEFT the alias set 2026-07-13 for the same reason (the gifting/dungeon size split) — it is now the
// REAL aresrpg_dungeon package; aliasing it to core would stamp the SDK's dungeon targets at the WRONG package.
export const LEGACY_ALIASES = ['items', 'game', 'pools'] // → aresrpg (core); fight → engine

/** Kahn topological sort over PKG_DEPS, TICKET_ORDER as tie-break. Returns { order, corrections }. */
export function publishOrder() {
  const indeg = {},
    adj = {}
  for (const p of TICKET_ORDER) {
    indeg[p] = 0
    adj[p] = []
  }
  for (const [p, deps] of Object.entries(PKG_DEPS))
    for (const d of deps) {
      adj[d].push(p)
      indeg[p]++
    }
  const order = []
  const ready = () =>
    TICKET_ORDER.filter((p) => indeg[p] === 0 && !order.includes(p))
  while (order.length < TICKET_ORDER.length) {
    const [next] = ready() // TICKET_ORDER preference among all currently-unblocked packages
    if (!next) throw new Error('publishOrder: dependency cycle among packages')
    order.push(next)
    for (const p of adj[next]) indeg[p]--
  }
  // Report every package the topo sort moved earlier than the ticket listed it (the social<kolizeum fix).
  const corrections = []
  for (const p of order) {
    const deps = PKG_DEPS[p]
    for (const d of deps)
      if (TICKET_ORDER.indexOf(d) > TICKET_ORDER.indexOf(p))
        corrections.push(
          `${d} moved before ${p} (${p} depends on ${d}; ticket listed ${d} later)`
        )
  }
  return { order, corrections: [...new Set(corrections)] }
}

// ── Lazy signer / client (dry-run never calls these, so a missing PRIVATE_KEY never throws in dry-run) ──
export function getNetwork() {
  const n = process.env.NETWORK || 'testnet'
  if (!CHAIN_IDS[n])
    throw new Error(`unsupported NETWORK '${n}' (testnet|mainnet)`)
  return n
}
export function getClient(network = getNetwork()) {
  const baseUrl =
    process.env.SUI_GRPC_URL ||
    (network === 'mainnet'
      ? 'https://fullnode.mainnet.sui.io:443'
      : 'https://fullnode.testnet.sui.io:443')
  return new SuiGrpcClient({ network, baseUrl })
}
// Keyless by default (never export the raw key) — logic mirrors client.js's
// `load_signer()` exactly (not imported: client.js calls it EAGERLY at module top-level, which
// would defeat this file's "dry-run never throws for a missing key" invariant the instant
// ceremony_lib.mjs imported client.js at all). PRIVATE_KEY stays an explicit override; when
// absent, load the ACTIVE address's Ed25519 key straight from the Sui CLI keystore. The secret is
// never printed, logged, written, or `sui keytool export`ed — only public addresses are derived
// to find the right entry.
export function getSigner() {
  if (process.env.PRIVATE_KEY)
    return Ed25519Keypair.fromSecretKey(
      decodeSuiPrivateKey(process.env.PRIVATE_KEY).secretKey
    )

  const config_dir =
    process.env.SUI_CONFIG_DIR || `${homedir()}/.sui/sui_config`

  const active_address = fs
    .readFileSync(`${config_dir}/client.yaml`, 'utf8')
    .match(/^active_address:\s*"?(0x[0-9a-fA-F]+)"?/m)?.[1]
    ?.toLowerCase()
  if (!active_address)
    throw new Error(
      `No active_address in ${config_dir}/client.yaml — run \`sui client\` or set PRIVATE_KEY`
    )

  // sui.keystore = JSON array of base64 blobs; each is [flag byte][32-byte secret]. flag 0x00 = Ed25519.
  const keystore = JSON.parse(
    fs.readFileSync(`${config_dir}/sui.keystore`, 'utf8')
  )
  for (const entry of keystore) {
    const blob = Buffer.from(entry, 'base64')
    if (blob.length !== 33 || blob[0] !== 0x00) continue // Ed25519 only
    const candidate = Ed25519Keypair.fromSecretKey(
      Uint8Array.from(blob.subarray(1))
    )
    if (candidate.getPublicKey().toSuiAddress() === active_address)
      return candidate
  }

  throw new Error(
    `No Ed25519 key in ${config_dir}/sui.keystore matches active address ${active_address}. ` +
      `Only Ed25519 (flag 0x00) is supported — if this address uses secp256k1/r1, ` +
      `\`sui client switch\` to an Ed25519 address or set PRIVATE_KEY.`
  )
}

export const netGas = (g) =>
  Number(g.computationCost) + Number(g.storageCost) - Number(g.storageRebate)

// gRPC renders type-string addresses ADDRESS-PADDED (`0x0000…0002::package::UpgradeCap`); jsonRpc rendered them
// SHORT (`0x2::…`). Every address-sensitive consumer literal (classify's UpgradeCap `===` / Publisher / Display
// startsWith, ceremony capturePolicy's `0x2::transfer_policy::TransferPolicy<` includes) compares the SHORT form —
// an unnormalized padded type MISSES them all (upgradeCap=null → Published.toml stamps "null" → every downstream
// `sui move build` dies AccountAddressParseError). Canonicalize every 0x-address inside a type string, struct
// type args included. Suffix matchers (`endsWith('::item::ItemTemplate')`) are form-agnostic either way.
const shortType = (t) =>
  t ? String(t).replace(/0x0*([0-9a-fA-F]+)/g, '0x$1') : t

// Map a gRPC Core ObjectOwner ({ $kind:'Shared', Shared:{ initialSharedVersion } } / { AddressOwner } / …) to the
// jsonRpc-ish owner shape classify() reads (`isShared(o) => 'Shared' in o`, `o.Shared.initial_shared_version`).
function mapOwner(o) {
  if (!o) return null
  if (o.$kind === 'Shared' || o.Shared)
    return {
      Shared: {
        initial_shared_version:
          o.Shared?.initialSharedVersion ?? o.Shared?.initial_shared_version,
      },
    }
  if (o.$kind === 'AddressOwner' || typeof o.AddressOwner === 'string')
    return { AddressOwner: o.AddressOwner }
  return o
}

/**
 * Re-project a gRPC Core transaction result ({ $kind, Transaction|FailedTransaction }) into the jsonRpc-ish
 * receipt every seeder/ceremony consumer already parses: `digest` · `effects.status.status` ('success'|'failure')
 * · `effects.gasUsed` {computation,storage,rebate} · `objectChanges[{type,packageId,objectType,objectId,version,
 * owner}]` (created + published + mutated) · `events[{type,parsedJson}]`. SSOT port of the frontend's proven
 * receipt.ts `normalize_receipt` into the script layer — richer only in that it also carries `published` +
 * `owner` (the ceremony's classify() reads them; the app's consumers didn't). Modules are NOT in gRPC effects,
 * but classify's `e.modules` capture is write-only (never read downstream), so it is intentionally omitted.
 */
export function normalizeReceipt(result) {
  const success = !!result?.Transaction
  const tx = result?.Transaction ?? result?.FailedTransaction ?? {}
  const objectTypes = tx.objectTypes ?? {}
  const objectChanges = []
  for (const o of tx.effects?.changedObjects ?? []) {
    if (o?.outputState === 'PackageWrite') {
      objectChanges.push({ type: 'published', packageId: o.objectId })
      continue
    }
    if (o?.idOperation === 'Created')
      objectChanges.push({
        type: 'created',
        objectId: o.objectId,
        objectType: shortType(objectTypes[o.objectId] ?? ''),
        version: o.outputVersion ?? null,
        owner: mapOwner(o.outputOwner),
      })
    else if (o?.outputState === 'ObjectWrite')
      objectChanges.push({
        type: 'mutated',
        objectId: o.objectId,
        objectType: shortType(objectTypes[o.objectId] ?? ''),
        version: o.outputVersion ?? null,
        owner: mapOwner(o.outputOwner),
      })
  }
  const events = (tx.events ?? []).map((e) => ({
    type: shortType(e.eventType),
    parsedJson: e.json,
  }))
  const g = tx.effects?.gasUsed ?? {}
  return {
    digest: tx.digest,
    effects: {
      status: {
        status: success ? 'success' : 'failure',
        error: tx.effects?.status?.error ?? null,
      },
      gasUsed: {
        computationCost: String(g.computationCost ?? 0),
        storageCost: String(g.storageCost ?? 0),
        storageRebate: String(g.storageRebate ?? 0),
      },
    },
    objectChanges,
    events,
  }
}

/** Re-fetch an executed tx by digest → the same normalized receipt (the crash-safe pendingDigests BACKFILL path). */
export async function getReceipt(client, digest) {
  const raw = await client.getTransaction({
    digest,
    include: { effects: true, events: true, objectTypes: true },
  })
  return normalizeReceipt(raw)
}

/**
 * dryRun the tx and return a gas budget = net × 1.5 (the measure-don't-guess law). REFUSES loudly if the
 * dryRun fails or the derived budget exceeds `ceilingSui` — a hardcoded-too-low budget fails ON-CHAIN and
 * burns the whole budget, so we derive with headroom and a ceiling.
 */
export async function deriveBudget(client, signer, tx, label, ceilingSui = 5) {
  tx.setSenderIfNotSet(signer.getPublicKey().toSuiAddress())
  // gRPC Core: simulateTransaction IS the dryRun (gas is resolved natively from the signer's consensus
  // address-balance — no discrete Coin object needed). `$kind === 'Transaction'` is the success discriminant.
  const sim = await client.simulateTransaction({
    transaction: tx,
    include: { effects: true },
  })
  if (sim.$kind !== 'Transaction')
    throw new Error(
      `${label}: dryRun FAILED — refusing to guess a budget: ${JSON.stringify(sim.FailedTransaction?.effects?.status ?? sim.$kind)}`
    )
  const budget = Math.ceil(netGas(sim.Transaction.effects.gasUsed) * 1.5)
  const ceiling = Math.floor(ceilingSui * 1e9)
  if (budget > ceiling)
    throw new Error(
      `${label}: derived budget ${budget} MIST (${budget / 1e9} SUI) exceeds ceiling ${ceilingSui} SUI — refusing`
    )
  return Math.max(budget, 5_000_000)
}

/**
 * SUCCESS runner — signs, executes, waits, THROWS on any executed failure (a digest = gas burned = NEVER
 * auto-retry; the tx-retry-burn law). `derive` (default) sets a dryRun-derived, ceiling-guarded budget for the
 * money-path wiring/enable PTBs; `derive:false` lets the SDK auto-estimate (mirrors publish.js — a publish
 * dryRun can hit the JSON-RPC command limits, so the proven publish path never sets an explicit budget).
 */
export async function run(
  client,
  signer,
  label,
  tx,
  { derive = true, ceilingSui = 5 } = {}
) {
  if (derive)
    tx.setGasBudget(await deriveBudget(client, signer, tx, label, ceilingSui))
  // gRPC Core: `include` selects the receipt fields; normalizeReceipt re-projects to the jsonRpc-ish shape every
  // consumer (classify / createdId / resolveBatch) parses. Gas payment is resolved natively (address-balance).
  const raw = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    include: { effects: true, objectTypes: true, events: true },
  })
  const r = normalizeReceipt(raw)
  await client.waitForTransaction({ digest: r.digest })
  const s = r.effects.status.status
  console.log(
    `  [${label}] ${s} digest=${r.digest} gasNET=${netGas(r.effects.gasUsed)}`
  )
  if (s !== 'success')
    throw new Error(
      `${label} FAILED (executed) — NOT retrying (gas already burned): ${JSON.stringify(r.effects.status)}`
    )
  return r
}

/**
 * Probe the largest N (rows per PTB) that clears a REAL simulation with margin, starting at `start`, capped
 * at `cap`, stepping by `step` (the seed-batching money law: "probe upward via dryRun… pick the largest
 * size whose dryRun clears with margin" — a critical-path seeder optimization).
 *
 * Sui's actual bind varies by row shape: gas/tx-bytes for simple rows, but the 1024-command PTB cap for
 * command-dense rows — a single seed row can expand into 7-30+ COMMANDS via nested moveCalls (statsBlock/
 * dmgLine/effectFx/lootEntry/spellLevel are each their own PTB command, not free locals). Measured against
 * the live corpus: item rows ~7 cmd/row (cap=100 clears easily, gas ~38% of ceiling), mob rows ~15 cmd/row
 * (breaches 1024 at n=70 — the cap bites, not gas), spell rows ~31 cmd/row (breaches at n=40 — needs a
 * floor far below `start`). So this steps UP from `start` while it clears (the common case), and if
 * `start` itself is too dense, steps DOWN to find a safe floor instead of assuming 50 always works.
 *
 * Uses gRPC Core `simulateTransaction` (the dryRun): gas is NOT charged but usage IS computed, so the probe
 * reads gas cost without spending. It resolves gas from the `sender`'s consensus address-balance (the funded
 * ops address it is always called with), so no discrete gas coin is required — read-only against a live node.
 *
 * `buildBatch(rows)` must return a FRESH Transaction populated with exactly one command-group per row.
 * Returns the winning `{ size, gasNet, budgetMist, ceilingMist, probed }`, or THROWS if nothing at all
 * clears (refuses to guess a size — same law as `deriveBudget`).
 */
export async function probeBatchSize(
  client,
  sender,
  rows,
  buildBatch,
  opts = {}
) {
  const { start = 50, cap = 100, step = 10, ceilingSuiPerItem = 0.03 } = opts
  const tryN = async (n) => {
    const tx = buildBatch(rows.slice(0, n))
    tx.setSenderIfNotSet(sender)
    let sim
    try {
      sim = await client.simulateTransaction({
        transaction: tx,
        include: { effects: true },
      })
    } catch (probe_error) {
      if (process.env.PROBE_DEBUG) console.error('[probe-debug] build/sim threw:', probe_error?.message ?? probe_error)
      return null
    } // build-time reject (e.g. "maximum commands in a programmable transaction is 1024")
    if (
      sim.$kind !== 'Transaction' ||
      sim.Transaction.effects.status.success === false
    ) {
      if (process.env.PROBE_DEBUG)
        console.error('[probe-debug] sim status:', JSON.stringify(sim?.Transaction?.effects?.status ?? sim?.$kind).slice(0, 400))
      return null
    }
    const gasNet = netGas(sim.Transaction.effects.gasUsed)
    const budgetMist = Math.ceil(gasNet * 1.5)
    const ceilingMist = Math.floor(n * ceilingSuiPerItem * 1e9)
    if (budgetMist > ceilingMist) return null
    return { size: n, gasNet, budgetMist, ceilingMist }
  }
  if (rows.length <= start) {
    const r = await tryN(rows.length)
    if (!r)
      throw new Error(
        `probeBatchSize: the full ${rows.length}-row phase fails to clear simulate — refusing to guess a size`
      )
    return { ...r, probed: true }
  }
  let best = await tryN(start)
  if (best) {
    for (let n = start + step; n <= Math.min(cap, rows.length); n += step) {
      const r = await tryN(n)
      if (!r) break // monotonic assumption (more rows never gets cheaper) — stop at the first failure
      best = r
    }
    return { ...best, probed: true }
  }
  for (let n = start - step; n >= 1; n -= step) {
    const r = await tryN(n)
    if (r) return { ...r, probed: true }
  }
  const floor = await tryN(1) // guarantee the true floor is tested, not just multiples of `step`
  if (floor) return { ...floor, probed: true }
  throw new Error(
    'probeBatchSize: even a single row fails to clear simulate — refusing to guess a size'
  )
}

// Page every id-array read (50/page, order preserved) — belt-and-braces against per-request node caps. gRPC Core
// `getObjects` returns { objects:[obj|Error] }; re-projected to the jsonRpc-ish { data:{ objectId, content:{ fields }}}
// shape consumers read (o.data.objectId, o.data.content.fields.*). `options.showContent` → the core `json` include.
export const RPC_ID_PAGE = 50
export async function multiGetObjectsChunked(client, ids, options) {
  const include = options?.showContent ? { json: true } : {}
  const out = []
  for (let i = 0; i < ids.length; i += RPC_ID_PAGE) {
    const { objects } = await client.getObjects({
      objectIds: ids.slice(i, i + RPC_ID_PAGE),
      include,
    })
    for (const o of objects)
      out.push(
        o instanceof Error
          ? { data: null, error: o.message }
          : { data: { objectId: o.objectId, content: { fields: o.json } } }
      )
  }
  return out
}

/**
 * BACKFILL resolver (train #3): every CREATED id must claim exactly one unclaimed row by key — but unlike
 * resolveBatch, `rows` may be a SUPERSET of the executed batch (all still-unresolved corpus rows), so
 * leftover rows are fine (still pending); an unmatched created id THROWS — never guesses, never drops an
 * on-chain object. Duplicate keys consume first-available (identical key = interchangeable object).
 */
export function claimCreated(rows, keyOfRow, created) {
  const buckets = new Map()
  for (const row of rows) {
    const k = keyOfRow(row)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(row)
  }
  return created.map((c) => {
    const q = buckets.get(c.key)
    if (!q?.length)
      throw new Error(
        `claimCreated: created id ${c.id} (key ${c.key}) matches no unclaimed row — refusing to guess`
      )
    return { row: q.shift(), id: c.id }
  })
}

/**
 * Split a wanted fixed-key set against the keys ALREADY on-chain (pre-flight read) — the idempotence
 * guard for `Table<String,bool>.add` targets (Catalog categories, Creation classes), where a duplicate add
 * aborts `0x2::dynamic_field::add` code 0 (EFieldAlreadyExists). Live incident 2026-07-12: crush_go_live's
 * registry run had already seeded the `rune` category into the fresh lineage's Catalog, and the corpus
 * seeder's blind re-add of ALL categories aborted PHASE 1. Read first, add ONLY the missing.
 */
export function planFixedKeyAdds(wanted, existing) {
  const missing = wanted.filter((k) => !existing.has(k))
  return {
    missing,
    existingCount: wanted.length - missing.length,
    skip: missing.length === 0,
  }
}

/**
 * Pre-flight read of a `Table<String, bool>` whitelist hanging off a shared object (Catalog.categories /
 * Creation.classes) → the Set of existing string keys. Table entries are dynamic fields of the TABLE's own
 * UID — not the parent object's — so resolve the table id from content first, then walk its DF pages.
 * Read-only (sanctioned pre-flight); throws rather than returning an empty set on an unresolvable table —
 * an empty set would green-light the exact blind re-add this guards against.
 */
export async function existingTableKeys(client, sharedId, field) {
  // gRPC Core json flattens a Table field to { id:'0x..', size } (jsonRpc nested it as { id:{ id } }) — accept both.
  const { object } = await client.getObject({
    objectId: sharedId,
    include: { json: true },
  })
  const t = object?.json?.[field]
  const tableId = typeof t?.id === 'string' ? t.id : t?.id?.id
  if (!tableId)
    throw new Error(
      `existingTableKeys: cannot resolve Table '${field}' on ${sharedId} — refusing a blind add`
    )
  const keys = new Set()
  let cursor = null
  do {
    const page = await client.listDynamicFields({ parentId: tableId, cursor })
    // gRPC DF name = { type, bcs } (bcs = the BCS-encoded key); a Table<String,bool> key is a bare String.
    for (const d of page.dynamicFields || [])
      keys.add(bcs.string().parse(d.name.bcs))
    cursor = page.hasNextPage ? page.cursor : null
  } while (cursor)
  return keys
}

/**
 * Resolve a batch's created objects back to their originating seed rows by a composite KEY — never an
 * order assumption (objectChanges/event ordering vs PTB command ordering is not a documented guarantee,
 * and a key match makes it irrelevant either way). `rows` = the batch's seed rows in original order;
 * `keyOfRow(row)` derives the SAME composite key `created` entries carry (`created` = [{key,id}] read
 * off-chain — event parsedJson fields when the event alone is uniquely-keyed, else multiGetObjects content
 * fields). Duplicate keys are treated as INTERCHANGEABLE (first-available consumption) — safe because an
 * identical key means an identical object in every field we can observe, so any assignment among the
 * duplicates is correct. HARD ASSERT: every row claims exactly one id; any row with zero candidates, or any
 * leftover unclaimed created id (a count mismatch), THROWS — never guesses a mapping.
 */
export function resolveBatch(rows, keyOfRow, created) {
  const buckets = new Map()
  for (const c of created) {
    if (!buckets.has(c.key)) buckets.set(c.key, [])
    buckets.get(c.key).push(c.id)
  }
  const resolved = rows.map((row) => {
    const k = keyOfRow(row)
    const bucket = buckets.get(k)
    if (!bucket || !bucket.length)
      throw new Error(
        `resolveBatch: no created id matches row key ${JSON.stringify(k)}`
      )
    return { row, id: bucket.shift() }
  })
  const leftover = [...buckets.values()].reduce((sum, b) => sum + b.length, 0)
  if (leftover)
    throw new Error(
      `resolveBatch: ${leftover} created id(s) unclaimed after matching — batch/row count mismatch, refusing to guess`
    )
  return resolved
}

// ── Build one package → { modules, dependencies, digest } (mirrors publish.js / ceremony_upgrade.mjs) ──
export function buildPackage(pkgName) {
  const out = execSync(
    `sui move build --dump-bytecode-as-base64 --path ${path.join(MOVE_DIR, pkgName)}`,
    { encoding: 'utf-8' }
  )
  const line = out.split('\n').find((l) => l.trimStart().startsWith('{'))
  if (!line)
    throw new Error(`buildPackage(${pkgName}): no JSON in build output`)
  return JSON.parse(line)
}

// ── Published.toml stamping (the publish-state file automated address management reads). SDK `tx.publish()`
//    does NOT write it (only `sui client publish` does), so the ceremony stamps it AT RUNTIME between
//    publishes so the next dependent build resolves the fresh sibling address. Working-tree edits only. ──
const pubPath = (pkgName) => path.join(MOVE_DIR, pkgName, 'Published.toml')
const PUB_HEADER = `# Generated by Move (ceremony.mjs — S-44)\n# This file contains metadata about published versions of this package in different environments.\n# This file SHOULD be committed to source control.\n`

/** Remove the `[published.<net>]` block for one network (pre-fresh-publish: a stale id blocks the build). */
export function clearPublished(pkgName, net) {
  const f = pubPath(pkgName)
  if (!fs.existsSync(f)) return
  const kept = stripSection(fs.readFileSync(f, 'utf8'), `[published.${net}]`)
  fs.writeFileSync(f, kept)
}

/** Write the fresh `[published.<net>]` block after an SDK publish (create file if absent). */
export function writePublished(
  pkgName,
  net,
  { publishedAt, originalId, upgradeCap }
) {
  const f = pubPath(pkgName)
  const base = fs.existsSync(f)
    ? stripSection(fs.readFileSync(f, 'utf8'), `[published.${net}]`)
    : PUB_HEADER
  const block =
    `\n[published.${net}]\n` +
    `chain-id = "${CHAIN_IDS[net]}"\n` +
    `published-at = "${publishedAt}"\n` +
    `original-id = "${originalId}"\n` +
    `version = 1\n` +
    `toolchain-version = "1.74.1"\n` +
    `build-config = { flavor = "sui", edition = "2024" }\n` +
    `upgrade-capability = "${upgradeCap}"\n`
  fs.writeFileSync(f, base.replace(/\s*$/, '\n') + block)
}

/** Remove a top-level TOML section (header line + body up to the next top-level `[` or EOF). */
function stripSection(content, header) {
  const lines = content.split('\n')
  const out = []
  let skipping = false
  for (const l of lines) {
    if (l.trim() === header) {
      skipping = true
      continue
    }
    if (skipping && /^\s*\[/.test(l)) skipping = false
    if (!skipping) out.push(l)
  }
  return out.join('\n')
}

// ── Post-UPGRADE lineage bookkeeping (2026-07-13 wave-2a incident): tx.upgrade's `package` field is the
//    CURRENT on-chain package id (UpgradeCap.package / Published.toml published-at) — NOT the type-origin id.
//    Passing the origin on a 2nd+ upgrade authorizes a ticket for `cap.package` that can never match the
//    Upgrade command → PackageIDDoesNotMatch aborts ON-CHAIN (gas burned). These helpers derive the target
//    from ground truth and refuse loudly PRE-FLIGHT when a caller-passed id disagrees. Pure — tested in
//    ceremony_lib.test.mjs. ──

const norm_id = (id) => {
  const s = String(id).trim().toLowerCase()
  return s.startsWith('0x') ? s : `0x${s}`
}

/** The `[published.<net>]` section of a Published.toml source string, or null when absent. */
function publishedSection(content, net) {
  const lines = content.split('\n')
  const header = `[published.${net}]`
  const start = lines.findIndex((l) => l.trim() === header)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++)
    if (/^\s*\[/.test(lines[i])) {
      end = i
      break
    }
  return { lines, start, end, body: lines.slice(start + 1, end).join('\n') }
}

/** Parse the `[published.<net>]` block of a Published.toml source string.
 * @returns {{ publishedAt?: string, originalId?: string, version?: number, upgradeCap?: string } | null}
 *   null when the network section is absent (fresh package). */
export function parsePublishedToml(content, net) {
  const section = publishedSection(content, net)
  if (!section) return null
  const field = (key) =>
    section.body.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1]
  const version = section.body.match(/^version\s*=\s*(\d+)/m)?.[1]
  return {
    publishedAt: field('published-at'),
    originalId: field('original-id'),
    version: version ? Number(version) : undefined,
    upgradeCap: field('upgrade-capability'),
  }
}

/** Published.toml source with `[published.<net>]`'s published-at swapped to `newPublishedAt` and its
 * `version` incremented — EXACTLY what `sui client upgrade` records; the SDK path (ceremony_upgrade.mjs)
 * must do it itself or the next dependent build links the STALE lineage (and the next upgrade re-hits the
 * origin-id bug this section exists to kill). Throws (writes nothing) when the section/fields are missing. */
export function bumpPublishedToml(content, net, newPublishedAt) {
  const section = publishedSection(content, net)
  if (!section)
    throw new Error(`bumpPublishedToml: no [published.${net}] section`)
  const { lines, start, end } = section
  let sawAt = false
  let sawVersion = false
  for (let i = start + 1; i < end; i++) {
    if (/^published-at\s*=/.test(lines[i])) {
      lines[i] = `published-at = "${norm_id(newPublishedAt)}"`
      sawAt = true
    } else if (/^version\s*=\s*\d+/.test(lines[i])) {
      lines[i] = `version = ${Number(lines[i].match(/(\d+)/)[1]) + 1}`
      sawVersion = true
    }
  }
  if (!sawAt || !sawVersion)
    throw new Error(
      `bumpPublishedToml: [published.${net}] lacks published-at/version fields`
    )
  return lines.join('\n')
}

/** The id `tx.upgrade({ package })` must target, derived from ground truth — on-chain `UpgradeCap.package`
 * first (chain wins), local Published.toml `published-at` as fallback. THROWS pre-flight when a caller
 * explicitly passed a package id that disagrees (the exact wave-2a bug: a type-origin id where the current
 * package id is required — that mismatch must never reach the chain, where it aborts post-execution).
 * @param {{ capPackage?: string, publishedAt?: string, envPackageId?: string }} sources
 * @returns {{ target: string, source: 'upgrade-cap' | 'published-toml', stalePublishedToml: boolean }} */
export function resolveUpgradeTarget({ capPackage, publishedAt, envPackageId }) {
  const cap = capPackage ? norm_id(capPackage) : undefined
  const toml = publishedAt ? norm_id(publishedAt) : undefined
  const target = cap ?? toml
  if (!target)
    throw new Error(
      'resolveUpgradeTarget: neither UpgradeCap.package nor Published.toml published-at is available — refusing to guess an upgrade target'
    )
  if (envPackageId && norm_id(envPackageId) !== target)
    throw new Error(
      `resolveUpgradeTarget: PACKAGE_ID env (${norm_id(envPackageId)}) disagrees with the CURRENT package id ` +
        `(${target}, from ${cap ? 'UpgradeCap.package' : 'Published.toml published-at'}). tx.upgrade targets the ` +
        `LATEST package id — a type-origin id here aborts ON-CHAIN (PackageIDDoesNotMatch) and burns gas. ` +
        `Fix the caller (or drop PACKAGE_ID entirely — it is derived now).`
    )
  return {
    target,
    source: cap ? 'upgrade-cap' : 'published-toml',
    stalePublishedToml: Boolean(cap && toml && cap !== toml),
  }
}

// ── Manifest classification: fold one package's publish result into M[pkgName]. ──
export function blankPkg() {
  return {
    pkg: null,
    upgradeCap: null,
    admin: null,
    version: null,
    shared: {},
    shared_versions: {},
    caps: {},
    publishers: {},
    displays: {},
    _extCapIds: [],
    _pubIds: [],
    dependencies: [],
  }
}
export function classify(pkgName, result, M) {
  const e = (M[pkgName] ||= blankPkg())
  for (const c of result.objectChanges || []) {
    if (c.type === 'published') {
      e.pkg = c.packageId
      e.modules = c.modules
      continue
    }
    if (c.type !== 'created') continue
    const t = c.objectType,
      id = c.objectId
    // S-51a: capture initial_shared_version for EVERY created shared object — including ones whose ID a
    // special-cased branch below claims (Version rides every tx; the hottest static-ref candidates). Sui
    // freezes this at share-time, so it's the exact value a static SharedObjectRef needs forever after
    // (skips the per-tx client.getObject resolve). Owned objects (caps/publishers/displays) never enter.
    // String() because JSON-RPC shapes waver between number and string — the stamped file always holds strings.
    if (isShared(c.owner))
      e.shared_versions[simpleStruct(t)] = String(
        c.owner.Shared.initial_shared_version
      )
    if (t.endsWith('::version::Version')) e.version = id
    else if (t.endsWith('::admin::AdminCap'))
      e.admin = id // the one super AdminCap minted at init
    else if (t === '0x2::package::UpgradeCap') e.upgradeCap = id
    else if (t.endsWith('::extension::ExtensionCap')) e._extCapIds.push(id)
    else if (t.startsWith('0x2::package::Publisher')) e._pubIds.push(id)
    else if (t.startsWith('0x2::display::Display<'))
      e.displays[
        t
          .slice(t.indexOf('<') + 1, t.lastIndexOf('>'))
          .split('::')
          .pop()
      ] = id
    else if (isShared(c.owner)) e.shared[simpleStruct(t)] = id
  }
  return e
}
const isShared = (o) => o && typeof o === 'object' && 'Shared' in o
const simpleStruct = (t) => t.replace(/<.*$/, '').split('::').pop()

/** Resolve the item vs character Publisher by its `module_name` field (mirrors 02_policies.mjs). */
export async function resolvePublishers(client, M) {
  for (const pid of M.aresrpg._pubIds) {
    const { object } = await client.getObject({
      objectId: pid,
      include: { json: true },
    })
    M.aresrpg.publishers[object.json.module_name] = pid
  }
  for (const mod of ['item', 'character'])
    if (!M.aresrpg.publishers[mod]) throw new Error(`missing ${mod} Publisher`)
}

/** RULES_PKG = the single non-framework, non-sibling id in aresrpg's publish dependencies (the linked
 *  kiosk lineage version — the ONLY id the royalty/kiosk_lock/personal_kiosk rule `add`s may target). */
export function resolveRulesPkg(M) {
  const excluded = new Set([
    ...FRAMEWORK_IDS,
    norm(M.foundation.pkg),
    norm(M.spells.pkg),
    norm(M.social.pkg),
    norm(M.engine.pkg),
  ])
  const cands = (M.aresrpg.dependencies || []).filter(
    (d) => !excluded.has(norm(d))
  )
  if (cands.length !== 1)
    throw new Error(
      `resolveRulesPkg: expected exactly 1 non-framework/non-foundation aresrpg dep (the kiosk lineage), found ${cands.length}: ${JSON.stringify(cands)}`
    )
  return cands[0]
}

// ── Synthetic manifest for the dry-run plan: readable package LABELS for `.pkg` (so recorded moveCall targets
//    render as `game::character_link::…`) + valid 0x-hex fake ids for every object reference (tx.object needs
//    real-shaped ids). Zero chain calls. ──
export function fakeId(n) {
  return '0x' + String(n).padStart(64, '0')
}
export function syntheticManifest() {
  let n = 1
  const fresh = () => fakeId(n++)
  const M = {
    _signer: fakeId(9999),
    _rules: '0xKIOSK_RULES_PKG',
    _network: getNetwork(),
    _station: fakeId(8888),
  }
  for (const p of TICKET_ORDER) {
    M[p] = blankPkg()
    M[p].pkg = p // label, not a real id → readable targets
    M[p].admin = fresh()
    M[p].version = fresh()
    M[p].upgradeCap = fresh()
  }
  M.aresrpg.publishers = { item: fresh(), character: fresh() }
  M.gifting.shared.Creation = fresh()
  M.aresrpg.shared.GameConfig = fresh()
  M.gifting.shared.PoolRegistry = fresh()
  M.engine.shared.FightRegistry = fresh()
  for (const a of LEGACY_ALIASES) M[a] = M.aresrpg // alias keys → the core (downstream scripts)
  M.fight = M.engine // the fight home now points at the ENGINE package
  M._rules = '0xKIOSK_RULES_PKG'
  return M
}

// Normalize a Sui address/id for comparison (strip 0x, lowercase, left-pad to 64, re-prefix).
export function norm(id) {
  const h = String(id).toLowerCase().replace(/^0x/, '')
  return '0x' + h.padStart(64, '0')
}

/** Option field truthiness for assertion reads: None renders as null / {vec:[]}, Some as an object/{vec:[x]}. */
export function isSome(field) {
  if (field == null) return false
  if (typeof field === 'object' && Array.isArray(field.vec))
    return field.vec.length > 0
  return true
}
