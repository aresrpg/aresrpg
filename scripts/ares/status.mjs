// `ares status` — the testnet liveness/drift board: release pins vs chain objects, /v1 read-API
// health, Walrus quilt registry shape, the deployed prod bundle's package pins, and the sponsor
// station. Pure summary helpers are exported for scripts/ares.test.mjs (via the ares.mjs re-export).
import fs from 'node:fs'
import path from 'node:path'

import { aresrpg_id, release_network } from '../../packages/sdk/src/deployment/aresrpg.js'
import { getClient as get_sui_client } from '../../packages/move/scripts/ceremony_lib.mjs'

import { repo_root, one_line, error_reason } from './lib.mjs'

const fetch_timeout_ms = 10_000
const object_page_size = 50
const max_indexer_lag_seconds = 5
const frontend_rpc_default = 'http://localhost:3000'
const prod_origin = 'https://testnet.aresrpg.world'
const sponsor_url = 'https://sponsor.aresrpg.world/api/sponsor'
const walrus_classes =
  'mob_glb_quilt character_glb_quilt cosmetic_glb_quilt cosmetic_icon_quilt music_quilt spell_icon_quilt mob_icon_quilt item_icon_quilt shop_render_quilt'.split(
    ' '
  )
const registry_fields = ['SOCIAL_FRIEND_REGISTRY', 'FIGHT_REGISTRY', 'POOL_REGISTRY', 'LOOT_REGISTRY']
// SDK field, semantic release package, origin/latest selector, stale-hint flag, client-bundle flag.
const package_pin_fields = [
  ['PACKAGE_ID', 'aresrpg', 'origin'],
  ['LATEST_PACKAGE_ID', 'aresrpg', 'latest', true, true],
  ['FOUNDATION_PACKAGE_ID', 'foundation', 'latest', false, true],
  ['ENGINE_PACKAGE_ID', 'engine', 'origin'],
  ['ENGINE_LATEST_PACKAGE_ID', 'engine', 'latest', true, true],
  ['SPELLS_PACKAGE_ID', 'spells', 'origin', false, true],
  ['SOCIAL_PACKAGE_ID', 'social', 'origin'],
  ['SOCIAL_LATEST_PACKAGE_ID', 'social', 'latest', true, true],
  ['KOLIZEUM_PACKAGE_ID', 'kolizeum', 'latest', false, true],
  ['FORGEMAGIE_PACKAGE_ID', 'forgemagie', 'latest', false, true],
  ['GIFTING_PACKAGE_ID', 'gifting', 'latest', false, true],
  ['DUNGEON_PACKAGE_ID', 'dungeon', 'latest', false, true],
  ['KIOSK_ROYALTY_RULE_PACKAGE_ID', null, 'rules_package', false, true],
].map(([field, package_name, release_field, stale_hint = false, client = false]) => ({
  field,
  package_name,
  release_field,
  stale_hint,
  client,
}))
const client_package_fields = package_pin_fields.filter(({ client }) => client).map(({ field }) => field)
const status_row = (state, label, evidence) => ({ state, label, evidence: one_line(evidence) })
function failed_probe_row(label, probe, detail = '') {
  if (!probe.reached) return status_row('DOWN', label, `reason=${probe.reason}${detail ? ` ${detail}` : ''}`)
  const state = probe.http_status >= 500 ? 'DOWN' : 'DRIFT'
  const reason = probe.json_error ? ` reason=${probe.json_error}` : ''
  return status_row(state, label, `http=${probe.http_status}${reason}${detail ? ` ${detail}` : ''}`)
}
async function fetch_text(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(fetch_timeout_ms),
    })
    return {
      reached: true,
      http_status: response.status,
      text: await response.text(),
    }
  } catch (error) {
    return { reached: false, reason: error_reason(error) }
  }
}
async function fetch_json(url) {
  const probe = await fetch_text(url, {
    headers: { accept: 'application/json' },
  })
  if (!probe.reached) return probe
  try {
    return { ...probe, data: JSON.parse(probe.text) }
  } catch {
    return { ...probe, json_error: 'invalid JSON' }
  }
}
const is_success = (probe) => probe.reached && probe.http_status >= 200 && probe.http_status < 300
const is_sui_id = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? '')
const normalized_id = (value) => (is_sui_id(value) ? value.toLowerCase() : '')
const field_list = (fields) => (fields.length ? fields.join(',') : 'none')
function read_package_pin_records() {
  const release = release_network('testnet')
  if (!release) throw new Error('release.json has no testnet config')
  return package_pin_fields.map((pin) => {
    const package_record = release.packages?.[pin.package_name]
    const expected = pin.package_name ? package_record?.[pin.release_field] : release[pin.release_field]
    return {
      ...pin,
      value: aresrpg_id('testnet', pin.field),
      expected,
      original_id: package_record?.origin,
      version: package_record?.latest !== package_record?.origin ? 2 : 1,
    }
  })
}
export function package_pin_summary(records, present_ids) {
  const present = new Set(present_ids.map(normalized_id).filter(Boolean))
  const invalid_fields = records.filter(({ value }) => !is_sui_id(value)).map(({ field }) => field)
  const recorded_fields = records
    .filter(({ value, expected }) => normalized_id(value) !== normalized_id(expected))
    .map(({ field }) => field)
  const missing_fields = records
    .filter(({ value }) => is_sui_id(value) && !present.has(normalized_id(value)))
    .map(({ field }) => field)
  const stale_fields = records
    .filter(
      ({ value, original_id, version, stale_hint }) =>
        stale_hint && version > 1 && normalized_id(value) === normalized_id(original_id)
    )
    .map(({ field }) => field)
  return {
    ok: invalid_fields.length === 0 && recorded_fields.length === 0 && missing_fields.length === 0,
    total: records.length,
    present: records.length - invalid_fields.length - missing_fields.length,
    invalid_fields,
    recorded_fields,
    missing_fields,
    stale_fields,
  }
}
export async function probe_object_ids(ids, get_objects) {
  const unique_ids = [...new Set(ids.map(normalized_id).filter(Boolean))]
  const present_ids = new Set()
  try {
    for (let index = 0; index < unique_ids.length; index += object_page_size) {
      const page = unique_ids.slice(index, index + object_page_size)
      const response = await get_objects(page)
      if (!Array.isArray(response?.objects)) throw new Error('invalid getObjects response')
      for (const object of response.objects) {
        if (object instanceof Error) continue
        const object_id = normalized_id(object?.objectId)
        if (object_id) present_ids.add(object_id)
      }
    }
    return { reached: true, present_ids: [...present_ids] }
  } catch (error) {
    return { reached: false, reason: error_reason(error), present_ids: [] }
  }
}
function live_object_probe() {
  const client = get_sui_client('testnet')
  return (ids) => probe_object_ids(ids, (object_ids) => client.core.getObjects({ objectIds: object_ids }))
}
function package_row(records, probe) {
  const summary = package_pin_summary(records, probe.present_ids ?? [])
  const evidence = `pins=${summary.total} chain=${probe.reached ? `${summary.present}/${summary.total}` : `?/${summary.total}`} invalid=${field_list(summary.invalid_fields)} recorded=${field_list(summary.recorded_fields)} missing=${field_list(summary.missing_fields)} stale_hint=${field_list(summary.stale_fields)}`
  if (!probe.reached) return status_row('DOWN', 'pins.package', `reason=${probe.reason} ${evidence}`)
  return status_row(summary.ok ? 'OK' : 'DRIFT', 'pins.package', evidence)
}
function registry_row(registries, probe) {
  const invalid_fields = registry_fields.filter((field) => !is_sui_id(registries[field]))
  const present = new Set((probe.present_ids ?? []).map(normalized_id))
  const missing_fields = registry_fields.filter(
    (field) => is_sui_id(registries[field]) && !present.has(normalized_id(registries[field]))
  )
  const chain_count = registry_fields.length - invalid_fields.length - missing_fields.length
  const evidence = `pins=${registry_fields.length} chain=${probe.reached ? `${chain_count}/${registry_fields.length}` : `?/${registry_fields.length}`} invalid=${field_list(invalid_fields)} missing=${field_list(missing_fields)}`
  if (!probe.reached) return status_row('DOWN', 'pins.registries', `reason=${probe.reason} ${evidence}`)
  const ok = invalid_fields.length === 0 && missing_fields.length === 0
  return status_row(ok ? 'OK' : 'DRIFT', 'pins.registries', evidence)
}
async function pinned_rows(probe_ids) {
  const registries = Object.fromEntries(registry_fields.map((field) => [field, aresrpg_id('testnet', field)]))
  const package_ids = package_pin_fields.map(({ field }) => aresrpg_id('testnet', field))
  let probe
  try {
    probe = await probe_ids([...package_ids, ...Object.values(registries)])
  } catch (error) {
    probe = { reached: false, reason: error_reason(error), present_ids: [] }
  }
  let package_result
  try {
    package_result = package_row(read_package_pin_records(), probe)
  } catch (error) {
    package_result = status_row('DOWN', 'pins.package', `reason=${error_reason(error)} chain=not-evaluated`)
  }
  return [package_result, registry_row(registries, probe)]
}
export function registry_class_diff(registry_classes) {
  const expected = new Set(walrus_classes)
  const registered = new Set(registry_classes)
  return {
    missing: registry_classes.filter((asset_class) => !expected.has(asset_class)),
    extra: walrus_classes.filter((asset_class) => !registered.has(asset_class)),
  }
}
function walrus_rows() {
  const registry_path = path.join(repo_root, 'scripts/walrus/registry.json')
  let registry
  try {
    registry = JSON.parse(fs.readFileSync(registry_path, 'utf8'))
  } catch (error) {
    return walrus_classes.map((asset_class) =>
      status_row('DOWN', `walrus.${asset_class.replace(/_quilt$/, '')}`, `reason=${error_reason(error)}`)
    )
  }
  const registry_classes = Object.keys(registry.blobs ?? {})
  const { missing } = registry_class_diff(registry_classes)
  return [...walrus_classes, ...missing].map((asset_class) => {
    const entry = registry.blobs?.[asset_class]
    const entries = Array.isArray(entry) ? entry : entry ? [entry] : []
    const quilt_ids = entries.map((item) => item?.blob_id).filter(Boolean)
    const expected_count = asset_class === 'item_icon_quilt' ? 4 : 1
    const shape_ok = asset_class === 'item_icon_quilt' ? Array.isArray(entry) : !!entry && !Array.isArray(entry)
    const ok =
      registry.network === 'testnet' &&
      shape_ok &&
      entries.length === expected_count &&
      quilt_ids.length === expected_count
    const count_label =
      asset_class === 'item_icon_quilt' ? `item_shards=${entries.length} expected=4` : `quilts=${entries.length}`
    return status_row(
      ok ? 'OK' : 'DRIFT',
      `walrus.${asset_class.replace(/_quilt$/, '')}`,
      `network=${registry.network ?? '(missing)'} ${count_label} ids=${quilt_ids.join(',') || '(missing)'}`
    )
  })
}
function api_status_row(probe) {
  if (!is_success(probe)) return failed_probe_row('rpc.status', probe)
  if (probe.json_error) return failed_probe_row('rpc.status', probe)
  const data = probe.data ?? {}
  const lag_seconds = Number(data.lag_seconds)
  const healthy =
    data.status === 'ok' &&
    data.redis === 'up' &&
    data.indexed === true &&
    Number.isFinite(lag_seconds) &&
    lag_seconds < max_indexer_lag_seconds
  return status_row(
    healthy ? 'OK' : 'DRIFT',
    'rpc.status',
    `http=${probe.http_status} status=${data.status ?? '(missing)'} redis=${data.redis ?? '(missing)'} indexed=${data.indexed ?? '(missing)'} lag_seconds=${Number.isFinite(lag_seconds) ? lag_seconds : '(missing)'} checkpoint=${data.latest_checkpoint ?? '(missing)'} watermark=${data.committer_watermark ?? '(missing)'}`
  )
}
function api_config_row(probe) {
  if (!is_success(probe)) return failed_probe_row('rpc.config', probe)
  if (probe.json_error) return failed_probe_row('rpc.config', probe)
  return status_row(
    probe.data?.enabled === true ? 'OK' : 'DRIFT',
    'rpc.config',
    `http=${probe.http_status} enabled=${probe.data?.enabled ?? '(missing)'}`
  )
}
function api_shop_row(probe) {
  if (!is_success(probe)) return failed_probe_row('rpc.shop', probe)
  if (probe.json_error) return failed_probe_row('rpc.shop', probe)
  const sales = probe.data?.sales
  return status_row(
    Array.isArray(sales) ? 'OK' : 'DRIFT',
    'rpc.shop',
    `http=${probe.http_status} sales=${Array.isArray(sales) ? sales.length : '(missing)'}`
  )
}
export function spell_manifest_ids(manifest) {
  if (!manifest?.spells || typeof manifest.spells !== 'object' || Array.isArray(manifest.spells))
    throw new Error('missing spells map in seed manifest')
  return Object.values(manifest.spells).map((spell) => spell?.id)
}
export function spell_presence_summary(expected_ids, probe) {
  if (!Array.isArray(expected_ids))
    return { state: 'DOWN', evidence: `spells=?/? reason=${probe.reason ?? 'seed manifest unavailable'}` }
  const valid_ids = expected_ids.map(normalized_id).filter(Boolean)
  const unique_ids = [...new Set(valid_ids)]
  const invalid = expected_ids.length - valid_ids.length
  const duplicates = valid_ids.length - unique_ids.length
  if (!probe.reached) return { state: 'DOWN', evidence: `spells=?/${expected_ids.length} reason=${probe.reason}` }
  const present = new Set((probe.present_ids ?? []).map(normalized_id))
  const present_count = unique_ids.filter((id) => present.has(id)).length
  const ok = invalid === 0 && duplicates === 0 && present_count === expected_ids.length
  const detail = `${invalid ? ` invalid=${invalid}` : ''}${duplicates ? ` duplicates=${duplicates}` : ''}`
  return {
    state: ok ? 'OK' : 'DRIFT',
    evidence: `spells=${present_count}/${expected_ids.length}${detail}`,
  }
}
async function spell_probe(probe_ids) {
  let expected_ids
  try {
    const manifest_path = path.join(repo_root, 'packages/move/scripts/out/seed_manifest.json')
    expected_ids = spell_manifest_ids(JSON.parse(fs.readFileSync(manifest_path, 'utf8')))
  } catch (error) {
    return { expected_ids: null, probe: { reached: false, reason: error_reason(error), present_ids: [] } }
  }
  try {
    return { expected_ids, probe: await probe_ids(expected_ids) }
  } catch (error) {
    return { expected_ids, probe: { reached: false, reason: error_reason(error), present_ids: [] } }
  }
}
function worst_state(...states) {
  const rank = { OK: 0, DRIFT: 1, DOWN: 2 }
  return states.reduce((worst, state) => (rank[state] > rank[worst] ? state : worst), 'OK')
}
function api_content_row(probe, spells) {
  const spell_summary = spell_presence_summary(spells.expected_ids, spells.probe)
  if (!is_success(probe) || probe.json_error) {
    const failed = failed_probe_row('rpc.content', probe, spell_summary.evidence)
    return status_row(worst_state(failed.state, spell_summary.state), failed.label, failed.evidence)
  }
  const mobs = probe.data?.mobs
  const mobs_state = Array.isArray(mobs) ? 'OK' : 'DRIFT'
  return status_row(
    worst_state(mobs_state, spell_summary.state),
    'rpc.content',
    `http=${probe.http_status} mobs=${Array.isArray(mobs) ? mobs.length : '(missing)'} ${spell_summary.evidence}`
  )
}
async function api_zones_row(rpc_base, worlds_probe, fetch_json_fn) {
  if (!is_success(worlds_probe)) return failed_probe_row('rpc.zones', worlds_probe, 'smoke=not-run worlds-probe-failed')
  if (worlds_probe.json_error) return failed_probe_row('rpc.zones', worlds_probe, 'smoke=not-run worlds-probe-failed')
  const worlds = worlds_probe.data?.worlds
  if (!Array.isArray(worlds))
    return status_row('DRIFT', 'rpc.zones', `http=${worlds_probe.http_status} smoke=not-run worlds=(missing)`)
  const [world_id] = worlds
    .map((world) => world?.world_id)
    .filter(Boolean)
    .sort()
  if (!world_id) return status_row('DRIFT', 'rpc.zones', `http=${worlds_probe.http_status} smoke=not-run worlds=0`)
  const zones_probe = await fetch_json_fn(`${rpc_base}/v1/zones?world=${encodeURIComponent(world_id)}`)
  if (!is_success(zones_probe)) return failed_probe_row('rpc.zones', zones_probe, `world=${world_id}`)
  if (zones_probe.json_error) return failed_probe_row('rpc.zones', zones_probe, `world=${world_id}`)
  const zones = zones_probe.data?.zones
  return status_row(
    Array.isArray(zones) ? 'OK' : 'DRIFT',
    'rpc.zones',
    `http=${zones_probe.http_status} world=${world_id} zones=${Array.isArray(zones) ? zones.length : '(missing)'}`
  )
}
async function api_rows(probe_ids, fetch_json_fn = fetch_json) {
  const rpc_base = (process.env.VITE_RPC_URL || frontend_rpc_default).replace(/\/+$/, '')
  const spells_promise = spell_probe(probe_ids)
  try {
    const parsed = new URL(rpc_base)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported URL protocol')
  } catch {
    const spells = await spells_promise
    const spell_evidence = spell_presence_summary(spells.expected_ids, spells.probe).evidence
    return ['status', 'config', 'shop', 'zones', 'content'].map((label) =>
      status_row(
        'DOWN',
        `rpc.${label}`,
        `reason=invalid VITE_RPC_URL${label === 'content' ? ` ${spell_evidence}` : ''}`
      )
    )
  }
  const [status_probe, config_probe, shop_probe, mobs_probe, worlds_probe, spells] = await Promise.all([
    fetch_json_fn(`${rpc_base}/v1/status`),
    fetch_json_fn(`${rpc_base}/v1/config`),
    fetch_json_fn(`${rpc_base}/v1/shop`),
    fetch_json_fn(`${rpc_base}/v1/encyclopedia?kind=mobs`),
    fetch_json_fn(`${rpc_base}/v1/encyclopedia?kind=worlds`),
    spells_promise,
  ])
  const zones_row = await api_zones_row(rpc_base, worlds_probe, fetch_json_fn)
  return [
    api_status_row(status_probe),
    api_config_row(config_probe),
    api_shop_row(shop_probe),
    zones_row,
    api_content_row(mobs_probe, spells),
  ]
}
const prod_failed_row = (probe, stage, detail = '') =>
  failed_probe_row('prod.bundle', probe, `stage=${stage}${detail ? ` ${detail}` : ''}`)
export function bundle_pin_summary(bundle_text, pins) {
  const invalid_fields = pins.filter(({ value }) => !is_sui_id(value)).map(({ field }) => field)
  const missing_fields = pins
    .filter(({ value }) => is_sui_id(value) && !bundle_text.toLowerCase().includes(value.toLowerCase()))
    .map(({ field }) => field)
  return {
    ok: invalid_fields.length === 0 && missing_fields.length === 0,
    found: pins.length - invalid_fields.length - missing_fields.length,
    total: pins.length,
    invalid_fields,
    missing_fields,
  }
}
async function prod_row(fetch_text_fn = fetch_text) {
  // Content ids come from /v1 + seed receipts; the deployed bundle only carries release package pins.
  const pins = client_package_fields.map((field) => ({
    field,
    value: aresrpg_id('testnet', field),
  }))
  const local = bundle_pin_summary('', pins)
  if (local.invalid_fields.length)
    return status_row(
      'DRIFT',
      'prod.bundle',
      `stage=local-sdk-pin pins=?/${local.total} invalid=${field_list(local.invalid_fields)}`
    )
  const index_page = await fetch_text_fn(prod_origin, {
    headers: { accept: 'text/html' },
  })
  if (!is_success(index_page)) return prod_failed_row(index_page, 'index-html')
  const index_match = index_page.text.match(
    /(?:src|href)=["']([^"']*\/assets\/index-([A-Za-z0-9_-]+)\.js(?:\?[^"']*)?)["']/
  )
  if (!index_match)
    return status_row('DRIFT', 'prod.bundle', `http=${index_page.http_status} stage=index-html index_hash=(missing)`)
  const index_url = new URL(index_match[1], prod_origin).href
  const index_bundle = await fetch_text_fn(index_url, {
    headers: { accept: 'text/javascript' },
  })
  if (!is_success(index_bundle)) return prod_failed_row(index_bundle, 'index-bundle', `index_hash=${index_match[2]}`)
  const sdk_match = `${index_page.text}\n${index_bundle.text}`.match(/(?:\/assets\/|\.\/)(sdk-[A-Za-z0-9_-]+\.js)/)
  if (!sdk_match)
    return status_row('DRIFT', 'prod.bundle', `index_hash=${index_match[2]} sdk=(missing) pins=?/${pins.length}`)
  const sdk_url = new URL(`/assets/${sdk_match[1]}`, prod_origin).href
  const sdk_bundle = await fetch_text_fn(sdk_url, {
    headers: { accept: 'text/javascript' },
  })
  if (!is_success(sdk_bundle))
    return prod_failed_row(sdk_bundle, 'sdk-bundle', `index_hash=${index_match[2]} sdk=${sdk_match[1]}`)
  const summary = bundle_pin_summary(sdk_bundle.text, pins)
  return status_row(
    summary.ok ? 'OK' : 'DRIFT',
    'prod.bundle',
    `index_hash=${index_match[2]} sdk=${sdk_match[1]} pins=${summary.found}/${summary.total} missing=${field_list(summary.missing_fields)}`
  )
}
async function sponsor_row(fetch_text_fn = fetch_text) {
  // The station two-call contract: /reserve is the live entry (an empty probe gets its 400
  // validation error back = handler alive); the legacy base path answers 410 by design.
  const probe = await fetch_text_fn(`${sponsor_url}/reserve`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: '{}',
  })
  if (!probe.reached) return failed_probe_row('sponsor', probe)
  let error = ''
  try {
    error = JSON.parse(probe.text)?.error ?? ''
  } catch {
    error = probe.text
  }
  error = one_line(error).slice(0, 160)
  const alive = probe.http_status === 400 && error.includes('txKindBytes')
  const state = alive ? 'OK' : probe.http_status >= 500 ? 'DOWN' : 'DRIFT'
  return status_row(state, 'sponsor', `http=${probe.http_status} error=${error || '(missing)'}`)
}
function print_status(rows) {
  const label_width = Math.max(22, ...rows.map((row) => row.label.length))
  console.log('ARES STATUS · testnet')
  for (const row of rows) console.log(`${row.state.padEnd(5)} ${row.label.padEnd(label_width)} ${row.evidence}`)
  const counts = Object.fromEntries(
    ['OK', 'DRIFT', 'DOWN'].map((state) => [state, rows.filter((row) => row.state === state).length])
  )
  const summary_state = counts.DOWN > 0 ? 'DOWN' : counts.DRIFT > 0 ? 'DRIFT' : 'OK'
  console.log(
    `${summary_state.padEnd(5)} ${'summary'.padEnd(label_width)} OK=${counts.OK} DRIFT=${counts.DRIFT} DOWN=${counts.DOWN}`
  )
  return summary_state === 'OK' ? 0 : 1
}
export async function run_status({
  probe_ids = live_object_probe(),
  fetch_json_fn = fetch_json,
  fetch_text_fn = fetch_text,
} = {}) {
  const [pins, rpc_rows, prod, sponsor] = await Promise.all([
    pinned_rows(probe_ids),
    api_rows(probe_ids, fetch_json_fn),
    prod_row(fetch_text_fn),
    sponsor_row(fetch_text_fn),
  ])
  return print_status([...pins, ...rpc_rows, ...walrus_rows(), prod, sponsor])
}
