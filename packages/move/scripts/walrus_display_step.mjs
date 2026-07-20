// packages/move/scripts/walrus_display_step.mjs — S-20 tail: the STANDALONE Display-swap ceremony step.
//
// Swaps the three on-chain Display image_url templates (Item / ItemTemplate / Character — the only
// Displays the 5-package train mints, all in the aresrpg package) from the retiring
// assets.aresrpg.world CDN to Walrus aggregator URLs, and PROVES every string it would set per the
// display-url law: curl the EXACT resolved URL → HTTP 200 + content-type image/* — never
// pattern-matched. DRY-RUN BY DEFAULT: prints the plan + the URL-proof table, executes nothing.
//
// URL SHAPE (the load-bearing decision): Sui Display does `{field}` substitution ONLY — it cannot
// derive a per-asset blob_id from an object field. The one aggregator route that composes with
// substitution is the QUILT-PATCH read: a constant quilt id + a per-object identifier
// (`{agg}/v1/blobs/by-quilt-id/<quilt_id>/{item_type}.png`). So item/template art ships as ONE
// quilt whose patch identifiers are the item_type slugs, character art as one quilt keyed
// `{class}_{male}`. The quilt ids come from the walrus registry (scripts/walrus/registry.json,
// written by the upload lane) — NEVER hardcoded.
//
// SEQUENCING (ceremony integration): runs AFTER ceremony.mjs publish+wiring (Displays exist in
// ceremony_manifest.json) and AFTER the art quilts are uploaded (registry has the quilt keys),
// BEFORE --enable — art must resolve before any public mint renders it.
//
//   node packages/move/scripts/walrus_display_step.mjs                      # dry-run: plan + URL-proof table
//   node packages/move/scripts/walrus_display_step.mjs --set-character '…'  # explicit template override
//   PRIVATE_KEY=… node packages/move/scripts/walrus_display_step.mjs --execute   # THE supervised swap
//
// --execute is FAIL-CLOSED: it refuses unless every Display string it would set just proved
// 200 + image/* on this very run. Signer/budget/no-retry discipline comes from ceremony_lib
// (dryRun-derived budget ×1.5, ceiling-guarded, executed failures NEVER retried).
//
// Env: NETWORK (testnet|mainnet), SUI_RPC (defaults to the publicnode testnet RPC — the default
// fullnode.testnet.sui.io is dead), WALRUS_AGGREGATOR_BASE (optional), PRIVATE_KEY (--execute only,
// read lazily by ceremony_lib.getSigner — never printed).

import { join } from 'node:path'

import { Transaction } from '@mysten/sui/transactions'

import {
  REPO_ROOT,
  read_json,
  write_json,
  file_exists,
  parse_args,
  aggregator_base,
  quilt_patch_url,
} from '../../../scripts/walrus/lib.mjs'

import {
  getClient,
  getSigner,
  run,
  MANIFEST_PATH,
  multiGetObjectsChunked,
} from './ceremony_lib.mjs'

const args = parse_args(process.argv.slice(2))
const EXECUTE = !!args.execute
const MANIFEST = args.manifest || MANIFEST_PATH
const REGISTRY_PATH =
  args.registry || join(REPO_ROOT, 'scripts/walrus/registry.json')
const SEED_MANIFEST =
  args['seed-manifest'] ||
  join(REPO_ROOT, 'packages/move/scripts/out/seed_manifest.json')
const REPORT_PATH =
  args.report || join(REPO_ROOT, 'scripts/walrus/out/display_swap_report.json')

if (!file_exists(MANIFEST)) {
  console.error(
    `error: ceremony manifest not found: ${MANIFEST} — run ceremony.mjs first (Displays must exist)`
  )
  process.exit(2)
}
const M = read_json(MANIFEST)
const NETWORK = args.network || process.env.NETWORK || M._network || 'testnet'
process.env.NETWORK = NETWORK
// Transport is the gRPC Core API (getClient) — SUI_GRPC_URL overrides the official fullnode gRPC per-env.

const registry = file_exists(REGISTRY_PATH) ? read_json(REGISTRY_PATH) : null
if (registry?.network && registry.network !== NETWORK) {
  const msg = `registry network is "${registry.network}" but running on "${NETWORK}"`
  if (EXECUTE) {
    console.error(`error: ${msg} — refusing to execute`)
    process.exit(2)
  }
  console.warn(`warning: ${msg}`)
}
const AGG = aggregator_base(NETWORK)

// ── The three swaps (the complete Display surface of the train). `registry_key` is the quilt the
// upload lane stages; `identifier` is the default patch-identifier pattern (a registry record's own
// `identifier_pattern` wins — the upload lane owns the naming it actually stored under).
const SWAPS = [
  {
    display: 'Item',
    type: (p) => `${p}::item::Item`,
    registry_key: 'item_art_quilt',
    identifier: '{item_type}.png',
    probe_fields: ['item_type'],
  },
  {
    display: 'ItemTemplate',
    type: (p) => `${p}::item::ItemTemplate`,
    registry_key: 'item_art_quilt',
    identifier: '{item_type}.png',
    probe_fields: ['item_type'],
  },
  {
    display: 'Character',
    type: (p) => `${p}::character::Character`,
    registry_key: 'character_art_quilt',
    identifier: '{class}_{male}.png',
    probe_fields: ['class', 'male'],
  },
]
const OVERRIDE_FLAG = {
  Item: 'set-item',
  ItemTemplate: 'set-item-template',
  Character: 'set-character',
}

// Resolve each swap's NEW image_url template: CLI override > registry quilt > UNRESOLVED (honest).
function resolve_swaps() {
  return SWAPS.map((s) => {
    const display_id = M.items?.displays?.[s.display]
    const override = args[OVERRIDE_FLAG[s.display]]
    if (typeof override === 'string' && override.length)
      return { ...s, display_id, template: override, source: 'cli override' }
    const rec = registry?.blobs?.[s.registry_key]
    if (rec?.blob_id)
      return {
        ...s,
        display_id,
        template: quilt_patch_url(
          AGG,
          rec.blob_id,
          rec.identifier_pattern || s.identifier
        ),
        source: `registry:${s.registry_key}`,
        patches: rec.patches,
      }
    return {
      ...s,
      display_id,
      template: null,
      source: null,
      why: `no staged quilt under registry key "${s.registry_key}"${registry ? '' : ' (no registry.json — nothing uploaded yet)'}`,
    }
  })
}

// ── RPC reads (read-only; degrade honestly when the RPC is unreachable) ──

// gRPC Core json flattens the Display<T> struct: `object.json.fields` is the VecMap<String,String> template,
// rendered as { contents: [{ key, value }] } (one wrapper level shallower than the jsonRpc content shape).
function display_fields(object) {
  const out = {}
  for (const kv of object?.json?.fields?.contents ?? []) out[kv.key] = kv.value
  return out
}

async function read_current(client, swaps) {
  for (const s of swaps) {
    if (!s.display_id) {
      s.current = null
      continue
    }
    try {
      const { object } = await client.getObject({
        objectId: s.display_id,
        include: { json: true },
      })
      s.current = display_fields(object)
      s.owner = object.owner?.AddressOwner || null
    } catch (e) {
      s.current = null
      s.read_error = e.message
    }
  }
}

// Probe values: item_type slugs read from the LIVE seeded ItemTemplate objects (strongest oracle;
// seed_manifest.json holds their ids), class from the seed manifest (--classes overrides, comma-sep).
async function probe_values(client) {
  const out = { item_type: [], character: [], provenance: {} }
  const seeds = file_exists(SEED_MANIFEST) ? read_json(SEED_MANIFEST) : null
  const ids = Object.values(seeds?.items || {})
  if (ids.length) {
    try {
      const objs = await multiGetObjectsChunked(client, ids, {
        showContent: true,
      })
      out.item_type = [
        ...new Set(
          objs.map((o) => o.data?.content?.fields?.item_type).filter(Boolean)
        ),
      ]
      out.provenance.item_type = `on-chain item_type of ${out.item_type.length} seeded templates (${SEED_MANIFEST})`
    } catch (e) {
      out.item_type = Object.keys(seeds.items)
      out.provenance.item_type = `seed manifest keys (RPC read failed: ${e.message})`
    }
  }
  const classes = (
    args.classes ? String(args.classes).split(',') : [seeds?.class]
  ).filter(Boolean)
  out.character = classes.flatMap((c) => [
    { class: c, male: 'true' },
    { class: c, male: 'false' },
  ])
  out.provenance.character = args.classes
    ? '--classes flag'
    : `seed manifest class × male∈{true,false}`
  return out
}

// ── The verifier (the display-url law): GET the EXACT string → 200 + content-type image/*. Also
// sniffs magic bytes so an aggregator serving image bytes as application/octet-stream is reported
// as exactly that (a real wallet-rendering risk), not hidden behind a bare FAIL.
function sniff(buf) {
  const b = new Uint8Array(buf.slice(0, 16))
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57
  )
    return 'webp'
  const head = new TextDecoder().decode(buf.slice(0, 256)).trimStart()
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'svg'
  return null
}

async function verify_url(url) {
  try {
    const r = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(20_000),
    })
    const content_type = r.headers.get('content-type') || ''
    let magic = null
    const len = Number(r.headers.get('content-length') || 0)
    if (r.ok && len < 8_000_000) magic = sniff(await r.arrayBuffer())
    const pass = r.status === 200 && content_type.startsWith('image/')
    return {
      status: r.status,
      content_type,
      magic,
      pass,
      note:
        !pass && r.status === 200 && magic
          ? `bytes are ${magic} but content-type is not image/*`
          : undefined,
    }
  } catch (e) {
    return {
      status: `ERR ${e.message}`,
      content_type: null,
      magic: null,
      pass: false,
    }
  }
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, f) =>
    values[f] != null ? values[f] : m
  )
}

async function build_proof_table(swaps, probes) {
  const rows = []
  const seen = new Map() // identical resolved URL verified ONCE, attributed to every display using it
  const probe_set = (s) =>
    s.display === 'Character'
      ? probes.character
      : probes.item_type.map((v) => ({ item_type: v }))
  for (const s of swaps) {
    // Baseline row (current on-chain string, first probe only): proves the verifier machinery and
    // documents the pre-swap reality. Not a gate.
    const [first] = probe_set(s)
    if (s.current?.image_url && first) {
      const url = fill(s.current.image_url, first)
      if (!seen.has(url)) seen.set(url, await verify_url(url))
      rows.push({ kind: 'baseline', display: s.display, url, ...seen.get(url) })
    }
    if (!s.template) {
      rows.push({
        kind: 'would-set',
        display: s.display,
        url: null,
        status: 'UNRESOLVED',
        pass: false,
        note: s.why,
      })
      continue
    }
    const set = probe_set(s)
    if (!set.length) {
      rows.push({
        kind: 'would-set',
        display: s.display,
        url: s.template,
        status: 'NO-PROBES',
        pass: false,
        note: 'no field values to substitute — cannot prove the string',
      })
      continue
    }
    for (const values of set) {
      const url = fill(s.template, values)
      if (!seen.has(url)) seen.set(url, await verify_url(url))
      const r = seen.get(url)
      let { note } = r
      if (s.patches && !s.patches.some((p) => url.endsWith(`/${p.identifier}`)))
        note = `identifier not in the staged quilt's patch list${note ? ' · ' + note : ''}`
      rows.push({ kind: 'would-set', display: s.display, url, ...r, note })
    }
  }
  return rows
}

// ── The PTB: 0x2::display::edit(image_url) + update_version per Display, ONE atomic tx ──
export function build_display_swap_tx(items_pkg, swaps) {
  const tx = new Transaction()
  for (const s of swaps) {
    if (!s.template) continue
    const t = [s.type(items_pkg)]
    tx.moveCall({
      target: '0x2::display::edit',
      typeArguments: t,
      arguments: [
        tx.object(s.display_id),
        tx.pure.string('image_url'),
        tx.pure.string(s.template),
      ],
    })
    tx.moveCall({
      target: '0x2::display::update_version',
      typeArguments: t,
      arguments: [tx.object(s.display_id)],
    })
  }
  return tx
}

// ── main ──
async function main() {
  console.log(
    `\nWALRUS DISPLAY SWAP  network=${NETWORK}  mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`
  )
  console.log(
    `manifest: ${MANIFEST}\nregistry: ${file_exists(REGISTRY_PATH) ? REGISTRY_PATH : `${REGISTRY_PATH} (ABSENT — no blobs staged)`}\naggregator: ${AGG}`
  )

  const swaps = resolve_swaps()
  const missing = swaps.filter((s) => !s.display_id)
  if (missing.length) {
    console.error(
      `error: manifest has no Display id for: ${missing.map((s) => s.display).join(', ')} — ceremony incomplete`
    )
    process.exit(2)
  }

  const client = getClient(NETWORK)
  await read_current(client, swaps)
  const probes = await probe_values(client)

  console.log('\n── PLAN (current → new image_url) ──')
  for (const s of swaps) {
    console.log(
      `\n  Display<${s.display}>  ${s.display_id}${s.owner ? `  owner=${s.owner === M._signer ? 'ceremony signer ✓' : s.owner + ' ⚠ NOT the ceremony signer'}` : ''}`
    )
    console.log(
      `    current: ${s.current?.image_url ?? `(unreadable${s.read_error ? ': ' + s.read_error : ''})`}`
    )
    console.log(
      `    new:     ${s.template ?? `UNRESOLVED — ${s.why}`}${s.source ? `  [${s.source}]` : ''}`
    )
  }

  const resolved = swaps.filter((s) => s.template)
  console.log(
    '\n── PTB (0x2::display::edit + update_version, one atomic tx) ──'
  )
  if (resolved.length) {
    for (const s of resolved) {
      console.log(
        `  → edit<${s.type(M.items.pkg)}>(${s.display_id}, "image_url", "${s.template}")`
      )
      console.log(`  → update_version<…${s.display}>(${s.display_id})`)
    }
  } else {
    console.log(
      '  (empty — nothing resolved; stage the art quilts or pass --set-* overrides)'
    )
  }

  console.log(
    `\n── URL PROOF (the display-url law: exact string → 200 + image/*) ──`
  )
  console.log(
    `probes: item_type ← ${probes.provenance.item_type || 'none'} · character ← ${probes.provenance.character}`
  )
  const rows = await build_proof_table(swaps, probes)
  console.log(
    '\nkind      display       status  content-type              bytes  verdict  url'
  )
  for (const r of rows) {
    const verdict = r.pass
      ? 'PASS'
      : String(r.status).match(/^\d+$/) ||
          r.status === 'UNRESOLVED' ||
          r.status === 'NO-PROBES'
        ? 'FAIL'
        : 'ERROR'
    console.log(
      `${r.kind.padEnd(9)} ${r.display.padEnd(13)} ${String(r.status).padEnd(7)} ${String(
        r.content_type ?? '-'
      )
        .slice(0, 25)
        .padEnd(
          25
        )} ${String(r.magic ?? '-').padEnd(6)} ${verdict.padEnd(8)} ${r.url ?? '-'}${r.note ? `\n${' '.repeat(10)}note: ${r.note}` : ''}`
    )
  }

  const would_set = rows.filter((r) => r.kind === 'would-set')
  const passed = would_set.filter((r) => r.pass)
  const all_proven =
    resolved.length === swaps.length &&
    would_set.length > 0 &&
    passed.length === would_set.length
  console.log(
    `\n${passed.length}/${would_set.length} would-set URLs proven · ${resolved.length}/${swaps.length} displays resolved`
  )

  write_json(REPORT_PATH, {
    network: NETWORK,
    aggregator: AGG,
    generated_at: new Date().toISOString(),
    mode: EXECUTE ? 'execute' : 'dry-run',
    swaps: swaps.map(({ type: _type, ...s }) => s),
    probes,
    proof: rows,
    all_proven,
  })
  console.log(`report: ${REPORT_PATH}`)

  if (!EXECUTE) {
    console.log(
      all_proven
        ? '\nDRY-RUN ok — every string proven; re-run with --execute (supervised) to swap.'
        : '\nDRY-RUN — NOT ready to execute (see UNRESOLVED/FAIL rows above).'
    )
    return
  }

  // ── EXECUTE (supervised): fail-closed on the law ──
  if (!all_proven) {
    console.error(
      '\nREFUSING --execute: not every Display string proved 200 + image/* on this run (the display-url law is the gate).'
    )
    process.exit(1)
  }
  const signer = getSigner()
  const me = signer.getPublicKey().toSuiAddress()
  const foreign = swaps.filter((s) => s.owner && s.owner !== me)
  if (foreign.length) {
    console.error(
      `\nREFUSING --execute: signer ${me} does not own Display(s): ${foreign.map((s) => s.display).join(', ')}`
    )
    process.exit(1)
  }
  const r = await run(
    client,
    signer,
    'display-swap',
    build_display_swap_tx(M.items.pkg, swaps)
  )
  await read_current(client, swaps)
  console.log('\n── POST-SWAP on-chain state ──')
  for (const s of swaps)
    console.log(`  Display<${s.display}> image_url = ${s.current?.image_url}`)
  const drift = swaps.filter((s) => s.current?.image_url !== s.template)
  if (drift.length)
    throw new Error(
      `post-swap read-back mismatch on: ${drift.map((s) => s.display).join(', ')}`
    )
  console.log(`\nSWAP COMPLETE  digest=${r.digest}`)
}

const invoked_directly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (invoked_directly) {
  main().catch((e) => {
    console.error('\nDISPLAY SWAP ERROR:', e.message)
    process.exit(1)
  })
}
