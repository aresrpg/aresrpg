// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// item_display_census.mjs — the ITEM DISPLAY-TRUTH census + root diagnosis (a live bug, 2026-07-20:
// the explorer shows a stale name and no icon for a cosmetic — "Lorito Cloak (Emerald)" on-chain vs
// "Lorito Cloak (Opal)" in-game, and a dead image_url). READS ONLY — never signs, never writes chain.
//
//   NETWORK=testnet node packages/move/scripts/item_display_census.mjs           # full census + report
//   NETWORK=testnet LIMIT=200 node packages/move/scripts/item_display_census.mjs # cap template reads
//
// WHAT IT PROVES (the two divergence axes reported in the field):
//   A. NAME  — a minted `Item` object snapshots `name` AT MINT (item.move: "immutable provenance"; the
//      ONLY name mutator is `set_name_description(&mut ItemTemplate)` — TEMPLATE-scoped, never the object).
//      Every object minted BEFORE its template's last rename keeps the OLD name; its own template (and the
//      /v1 projection the client renders) already carries the CORRECTED name. So the OBJECT lies, the
//      template tells the truth — and there is NO on-chain function to fix a minted object's name.
//   B. ICON  — Display<Item>.image_url is `/assets/items/{item_type}.png`. `item_type` for a whole class
//      (all cosmetics: hat/cloak/title; some relics/pets) is the GENERIC SLOT WORD, not a per-variant slug,
//      so the string resolves to a non-existent, HOST-RELATIVE path — dead on every external explorer.
//      Sui Display substitutes object fields only ({name}/{item_type}/{description}); it cannot reach the
//      per-variant `icon` slug (never an on-chain field), so no display::edit can fix a slot-word class.
//
// This tool DIAGNOSES; it does not (and cannot) apply. The remediation needs a manual decision (see the printed
// WALLS block). Leg B for the UNIQUE-item_type classes is the EXISTING walrus_display_step.mjs (already
// built, DRY, fail-closed on the display-url law) — this census never rebuilds it.
import { readFileSync as read_file, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import release from '../../sdk/src/deployment/release.json' with { type: 'json' }

const script_dir = dirname(file_url_to_path(import.meta.url))
const repo_dir = resolve(script_dir, '..', '..', '..')
const read_json = (file_path) => JSON.parse(read_file(file_path, 'utf8'))
const is_id = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? '')

// The historical (delisted) cosmetic renames apply_shop_payload.mjs drives at the TEMPLATE level — the
// authored truth for the element family that is no longer in shop.json but still worn on-chain. Kept here
// as the seed-convergence oracle for those four slugs (single-homed in apply_shop_payload; mirrored, not
// imported, to avoid a cross-script live-path import — same rationale as apply_xp's superset note).
export const HISTORICAL_COSMETIC_NAMES = {
  cape_lorito_air: 'Lorito Cloak (Opal)',
  cape_lorito_water: 'Lorito Cloak (Aquamarine)',
  cape_lorito_fire: 'Lorito Cloak (Garnet)',
  cape_lorito_earth: 'Lorito Cloak (Jade)',
}

// ── pure helpers (exported, side-effect-free — fixture-tested) ────────────────────────────────────

/** Apply Sui Display `{field}` substitution to a Display field-map given an object's flat json. Unknown
 * fields are LEFT as the literal `{field}` token (exactly how Display renders an absent field), so the
 * caller can see a template that references a field the object lacks. Returns { key: resolved }. */
export function interpolate_display(display_fields, object_json) {
  const out = {}
  for (const [key, template] of Object.entries(display_fields ?? {}))
    out[key] = String(template).replace(/\{(\w+)\}/g, (whole, field) =>
      object_json?.[field] != null ? String(object_json[field]) : whole,
    )
  return out
}

/** Classify a resolved image_url the way an EXTERNAL explorer (no app host, no cosmetic_icons map) sees
 * it. `relative` (leading '/') ⇒ dead on any explorer (no origin to resolve against). `unresolved` ⇒ the
 * template still holds a `{field}` token (the object lacked that field). `host` is the origin for an
 * absolute url. This is the icon-state verdict rendered as the Sui droplet placeholder. */
export function classify_image_url(url) {
  const value = String(url ?? '')
  const unresolved = /\{\w+\}/.test(value)
  if (value.startsWith('/'))
    return { url: value, kind: 'relative', explorer_ok: false, unresolved, host: null }
  try {
    const host = new URL(value).host
    return { url: value, kind: 'absolute', explorer_ok: !unresolved, unresolved, host }
  } catch {
    return { url: value, kind: 'malformed', explorer_ok: false, unresolved, host: null }
  }
}

/** id -> field value (default `name`), first-wins; skips rows with no id/value. */
export function index_by_id(objects, field = 'name') {
  const out = {}
  for (const object of objects ?? []) {
    const id = object?.id
    if (is_id(id) && object?.[field] != null && !(id in out)) out[id] = object[field]
  }
  return out
}

/** THE ROOT DIAGNOSIS (leg A). Bucket every minted object by whether its snapshotted `name` still equals
 * its OWN template's CURRENT name:
 *   stale       object.name !== template.name  (the root bug — the object froze an old name)
 *   consistent  object.name === template.name  (minted after the template's last rename)
 *   orphan      the object's template id was not read (deleted/unresolved template)
 * A naive census that only checks templates-vs-seed reports all-good and MISSES this class entirely —
 * that miss is exactly what a template-only sweep did before this diff existed. */
export function diff_object_vs_template(objects, template_name_by_id) {
  const stale = []
  const consistent = []
  const orphan = []
  for (const object of objects ?? []) {
    const template_name = template_name_by_id?.[object?.template]
    const row = {
      id: object?.id,
      template: object?.template,
      item_type: object?.item_type,
      object_name: object?.name,
      template_name,
    }
    if (template_name == null) orphan.push(row)
    else if (object?.name === template_name) consistent.push(row)
    else stale.push(row)
  }
  return { stale, consistent, orphan }
}

/** Group templates by on-chain `item_type`; a value shared by >1 template is a SLOT-WORD class whose
 * per-variant icon Display can NEVER resolve (the discriminating slug is off-chain). Unique values are
 * the Display-fixable classes (walrus_display_step's `{item_type}.png` quilt-patch route). */
export function item_type_collisions(templates) {
  const by_type = {}
  for (const t of templates ?? []) {
    const it = t?.item_type
    if (it == null) continue
    ;(by_type[it] ??= []).push(t.id)
  }
  const shared = {}
  const unique = []
  for (const [it, ids] of Object.entries(by_type))
    if (ids.length > 1) shared[it] = ids
    else unique.push({ item_type: it, id: ids[0] })
  const shared_templates = Object.values(shared).reduce((n, ids) => n + ids.length, 0)
  return { shared, unique, shared_types: Object.keys(shared).length, shared_templates, unique_count: unique.length }
}

/** Seed-convergence oracle: for the authored-name sample (slug -> expected name), is the on-chain template
 * name equal to the authored truth? A non-empty `diverged` means a TEMPLATE (not just an object) still
 * lies — the ceremony rename never landed. Proves the "template == authored == client-correct" claim. */
export function template_seed_convergence({ expected_name_by_slug, manifest_items, template_name_by_id }) {
  const converged = []
  const diverged = []
  const missing = []
  for (const [slug, expected] of Object.entries(expected_name_by_slug ?? {})) {
    const id = manifest_items?.[slug]
    if (!is_id(id)) { missing.push({ slug, why: 'no manifest id' }); continue }
    const actual = template_name_by_id?.[id]
    if (actual == null) { missing.push({ slug, id, why: 'template unreadable' }); continue }
    if (actual === expected) converged.push({ slug, id, name: actual })
    else diverged.push({ slug, id, expected, actual })
  }
  return { converged, diverged, missing }
}

// ── impure edges ──────────────────────────────────────────────────────────────────────────────────

const GQL = (network) =>
  network === 'mainnet' ? 'https://sui-mainnet.mystenlabs.com/graphql' : 'https://graphql.testnet.sui.io/graphql'

async function gql(endpoint, query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.json()
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors).slice(0, 300)}`)
  return body.data
}

/** Batched read of a flat {id,name,item_type,category,template} per object id (multiGetObjects, ≤45/call). */
async function read_objects(endpoint, ids) {
  const out = {}
  for (let i = 0; i < ids.length; i += 45) {
    const keys = ids.slice(i, i + 45).map((a) => `{address:"${a}"}`).join(',')
    const data = await gql(endpoint, `query{ multiGetObjects(keys:[${keys}]){ address asMoveObject{ contents{ json } } } }`)
    for (const node of data?.multiGetObjects ?? [])
      if (node?.asMoveObject?.contents?.json) out[node.address] = node.asMoveObject.contents.json
  }
  return out
}

/** Paginate every ROOT-VISIBLE object of a Move type. NOTE: kiosk-LOCKED items are dynamic-object-fields
 * of their Kiosk and are NOT returned here — the live object census is a lower bound (caveat printed). */
async function enumerate_type(endpoint, type) {
  const nodes = []
  let cursor = null
  do {
    const data = await gql(
      endpoint,
      `query($t:String!,$c:String){ objects(first:50,after:$c,filter:{type:$t}){ pageInfo{ hasNextPage endCursor } nodes{ asMoveObject{ contents{ json } } } } }`,
      { t: type, c: cursor },
    )
    const page = data?.objects
    if (!page) break
    for (const n of page.nodes) if (n?.asMoveObject?.contents?.json) nodes.push(n.asMoveObject.contents.json)
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor)
  return nodes
}

/** A Display<T> object's field-map { key: templateString }. */
async function read_display_fields(endpoint, display_id) {
  const data = await gql(
    endpoint,
    `query($a:SuiAddress!){ object(address:$a){ version asMoveObject{ contents{ json } } } }`,
    { a: display_id },
  )
  const object = data?.object
  const out = {}
  for (const kv of object?.asMoveObject?.contents?.json?.fields?.contents ?? []) out[kv.key] = kv.value
  return { version: object?.version, fields: out }
}

// ── the cosmetic expected-name oracle: shop.json cosmetics (live) + the historical delisted family ──
function cosmetic_expected_names(repo) {
  const shop = read_json(join(repo, 'seed', 'mainnet', 'shop.json'))
  const expected = { ...HISTORICAL_COSMETIC_NAMES }
  for (const row of shop.cosmetics ?? []) if (row?.slug && row?.name) expected[row.slug] = row.name
  return expected
}

function deployment(network) {
  const ares = release.networks?.[network]?.packages?.aresrpg
  const displays = ares?.displays ?? {}
  const origin = ares?.origin
  if (!is_id(origin)) throw new Error(`release.json has no aresrpg.origin for ${network}`)
  return { origin, item_type: `${origin}::item::Item`, display_item: displays.Item, display_template: displays.ItemTemplate }
}

async function main() {
  const network = process.env.NETWORK ?? 'testnet'
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : null
  const endpoint = GQL(network)
  const dep = deployment(network)
  const manifest = read_json(join(script_dir, 'out', 'seed_manifest.json'))
  const manifest_items = manifest.items ?? {}

  const all_template_ids = Object.values(manifest_items).filter(is_id)
  const template_ids = limit == null ? all_template_ids : all_template_ids.slice(0, limit)
  const template_json = await read_objects(endpoint, template_ids)
  const templates = Object.values(template_json)
  const template_name_by_id = index_by_id(templates, 'name')

  const objects = await enumerate_type(endpoint, dep.item_type)
  const names = diff_object_vs_template(objects, template_name_by_id)

  const collisions = item_type_collisions(templates)
  const convergence = template_seed_convergence({
    expected_name_by_slug: cosmetic_expected_names(repo_dir),
    manifest_items,
    template_name_by_id,
  })

  const display_item = dep.display_item ? await read_display_fields(endpoint, dep.display_item) : null
  const display_template = dep.display_template ? await read_display_fields(endpoint, dep.display_template) : null
  // Resolve the Display over one stale object + one unique-item_type object to SHOW the icon verdict.
  const stale_sample = names.stale[0]
  const stale_obj = objects.find((o) => o?.id === stale_sample?.id)
  const image_state = display_item?.fields?.image_url
    ? classify_image_url(interpolate_display(display_item.fields, stale_obj ?? objects[0] ?? {}).image_url)
    : null

  console.log(`=== ITEM DISPLAY-TRUTH CENSUS | READ-ONLY | network=${network} ===`)
  console.log(`origin=${dep.origin}`)
  console.log(
    `templates read: ${templates.length}/${all_template_ids.length}${limit ? ` (LIMIT ${limit})` : ''} · ` +
      `root-visible Item objects: ${objects.length} (kiosk-locked items are DOFs — not counted; lower bound)`,
  )
  console.log(
    `\nA. NAME divergence (object.name vs its template's CURRENT name):\n` +
      `   stale=${names.stale.length} · consistent=${names.consistent.length} · orphan=${names.orphan.length}`,
  )
  for (const row of names.stale.slice(0, 5))
    console.log(`     ${row.id.slice(0, 12)} [${row.item_type}] obj="${row.object_name}"  tmpl="${row.template_name}"`)
  console.log(
    `\n   template-side convergence (cosmetic authored names): ` +
      `converged=${convergence.converged.length} diverged=${convergence.diverged.length} missing=${convergence.missing.length}`,
  )
  for (const row of convergence.diverged.slice(0, 5))
    console.log(`     DIVERGED ${row.slug} ${row.id.slice(0, 10)} chain="${row.actual}" seed="${row.expected}"`)

  console.log(
    `\nB. ICON / image_url:\n` +
      `   Display<Item> v${display_item?.version} image_url template: ${display_item?.fields?.image_url}\n` +
      `   Display<ItemTemplate> v${display_template?.version} image_url template: ${display_template?.fields?.image_url}`,
  )
  if (image_state)
    console.log(
      `   resolved sample → ${image_state.url}  [${image_state.kind}; explorer_ok=${image_state.explorer_ok}]`,
    )
  console.log(
    `   SLOT-WORD classes (item_type shared by >1 template → Display can NEVER emit a per-variant icon): ` +
      `${collisions.shared_types} types cover ${collisions.shared_templates} templates`,
  )
  console.log(
    `     ${Object.entries(collisions.shared).map(([it, ids]) => `${it}×${ids.length}`).slice(0, 12).join('  ')}`,
  )
  console.log(`   UNIQUE-item_type templates (Display-fixable via walrus_display_step.mjs): ${collisions.unique_count}`)

  console.log(
    `\n=== WALLS (why the tooling cannot APPLY either leg — a manual decision is required) ===\n` +
      `  A. Minted-object names are IMMUTABLE on-chain: item.move exposes no Item-name setter (only\n` +
      `     set_name_description(&mut ItemTemplate)). The templates are already correct (convergence above);\n` +
      `     the objects froze old names. Fixing them needs a NEW admin::set_item_name_description(&mut Item)\n` +
      `     — a Move upgrade that BREAKS the "immutable provenance" law — then a sweep. Not buildable today.\n` +
      `  B. On-chain item_type is the CATEGORY word for ${collisions.shared_templates}/${templates.length} templates, so Display's\n` +
      `     {item_type}.png yields ONE generic icon per category — the per-item art slug is NEVER on-chain and\n` +
      `     Display cannot reach it. walrus_display_step.mjs's {item_type}.png quilt-patch route only resolves\n` +
      `     the ${collisions.unique_count} UNIQUE-item_type templates (and only if art is staged under those exact names);\n` +
      `     it is structurally incapable for the category classes. A real fix = a per-item on-chain icon slug\n` +
      `     (struct change, impossible post-publish) or a re-mint with item_type=slug — both owner-gated.\n` +
      `=== CENSUS COMPLETE (nothing written, nothing signed) ===`,
  )

  // Machine-readable diagnosis for the seat / any future LIVE remediation (READ-ONLY artifact — the census
  // never signs). Carries the full stale set (leg-A candidates), the Display-addressable unique templates
  // (leg-B set), and the convergence proof.
  const report = {
    network,
    generated_at: new Date().toISOString(),
    origin: dep.origin,
    templates_read: templates.length,
    root_visible_objects: objects.length,
    kiosk_locked_caveat: 'kiosk-locked items are dynamic-object-fields, not returned by a root type filter — the object census is a lower bound',
    name_divergence: names,
    template_convergence: convergence,
    image_url: {
      display_item: display_item?.fields?.image_url,
      display_item_version: display_item?.version,
      display_template: display_template?.fields?.image_url,
      resolved_sample: image_state,
      slot_word_types: collisions.shared,
      slot_word_template_count: collisions.shared_templates,
      unique_item_type_templates: collisions.unique,
    },
  }
  const report_path = join(script_dir, 'out', 'item_display_census.json')
  writeFileSync(report_path, JSON.stringify(report, null, 2))
  console.log(`report: ${report_path}`)
}

const is_main = process.argv[1] && resolve(process.argv[1]) === file_url_to_path(import.meta.url)
if (is_main) main().catch((error) => { console.error(`\nCENSUS STOPPED: ${error.message}`); process.exitCode = 1 })
