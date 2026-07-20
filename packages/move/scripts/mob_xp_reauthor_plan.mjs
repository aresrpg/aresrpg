// MOB-XP REAUTHOR — the SHARED diff/read truth. Owner re-aim 2026-07-20 (verbatim: "we probably need an admin
// stat setter?"): the PRIMARY xp chain path is now an additive `aresrpg::mob_template::set_xp_reward` setter +
// upgrade built in a PARALLEL lane (mirroring the 07-15 `set_level_targeting` precedent) — an IN-PLACE mutation,
// so template ids DON'T change and NO world-table repoint is needed. THIS lane is the FALLBACK; the burn+remint
// writer is intentionally unbuilt (the driver's `--strategy=remint` is a documented stub, never a silent no-op).
//
// Both paths — the setter apply script and any future remint — consume the ONE truth defined here: the live
// manifest's mob template ids → their on-chain `xp_reward` → the changed set (chain xp ≠ retuned seed xp). Pure
// (no client/fs import; `fetch_chain_xp` takes an injected client) so the diff is fixture-tested and either lane
// reuses it without side effects. The retuned xp lives in seed/mainnet/**/mobs.json (`xp` field); the chain
// carries the OLD xp until the ceremony fires — so `changed` is exactly the set the ceremony must reauthor.

const is_id = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? '')

/** u64 gRPC json arrives as a number (small) or a string (large); mobs.json `xp` is a number. Normalize both to
 * a non-negative safe integer, or throw (callers decide whether that is "invalid seed row" or "unreadable"). */
export function to_xp(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error(`xp ${JSON.stringify(value)} is not a non-negative integer`)
  return number
}

/** xp_reward off a mob-template gRPC json (fields sit at top level; `.fields` fallback for other read shapes).
 * Returns null on absent/malformed/negative — a read anomaly becomes a `read_failed` bucket row, never a crash. */
export function read_template_xp(template_json) {
  if (!template_json || typeof template_json !== 'object') return null
  const fields = template_json.fields ?? template_json
  if (fields.xp_reward == null) return null
  try {
    return to_xp(fields.xp_reward)
  } catch {
    return null
  }
}

/** seed mob key → retuned xp, mirroring seed_full_corpus `mob_xp_required` (xp>0 mandatory, NO linear fallback).
 * First-wins on duplicate keys (corpus-dedupe parity); a dup carrying a DIFFERENT xp is surfaced, never merged. */
export function seed_xp_by_key(mob_rows) {
  const xp = {}
  const invalid = []
  const duplicates = []
  for (const row of mob_rows ?? []) {
    const key = row?.key ?? null
    if (!key) {
      invalid.push({ key, why: 'row missing key' })
      continue
    }
    let value
    try {
      value = to_xp(row.xp)
    } catch {
      invalid.push({ key, why: `xp ${JSON.stringify(row?.xp)} not a non-negative integer` })
      continue
    }
    if (value <= 0) {
      invalid.push({ key, why: 'xp must be > 0 (no linear-20 fallback)' })
      continue
    }
    if (key in xp) {
      if (xp[key] !== value) duplicates.push({ key, kept: xp[key], ignored: value })
      continue
    }
    xp[key] = value
  }
  return { xp, invalid, duplicates }
}

/** The pure diff BOTH paths consume. `manifest_mobs` = seed_manifest.mobs (key → {id,…}); `seed_xp` = key→xp;
 * `chain_xp` = id → xp|null (null = unreadable). `limit` (canary) trims the SORTED key set deterministically —
 * the driver reads the SAME sorted slice so ids and diff stay aligned. Buckets:
 *   changed      chain xp ≠ seed xp   → {key,id,from,to}  (the ceremony work set)
 *   unchanged    chain xp == seed xp                      (post-run rerun ⇒ all here = idempotent)
 *   read_failed  id invalid / xp unreadable               (LIVE blocker: never touch what you couldn't read)
 *   missing_seed manifest key absent from the seed         (LIVE blocker: data inconsistency) */
export function diff_mob_xp({ manifest_mobs, seed_xp, chain_xp, limit = null }) {
  const all_keys = Object.keys(manifest_mobs ?? {}).sort()
  const keys = limit == null ? all_keys : all_keys.slice(0, Math.max(0, limit))
  const changed = []
  const unchanged = []
  const read_failed = []
  const missing_seed = []
  for (const key of keys) {
    const id = manifest_mobs[key]?.id
    if (!is_id(id)) {
      read_failed.push({ key, id: id ?? null, why: 'invalid manifest id' })
      continue
    }
    const chain = chain_xp?.[id]
    if (chain == null) {
      read_failed.push({ key, id, why: 'xp_reward unreadable on chain' })
      continue
    }
    if (!(key in seed_xp)) {
      missing_seed.push({ key, id, chain_xp: chain })
      continue
    }
    const seed = seed_xp[key]
    if (seed === chain) unchanged.push({ key, id, xp: chain })
    else changed.push({ key, id, from: chain, to: seed })
  }
  return { total: keys.length, changed, unchanged, read_failed, missing_seed }
}

/** Seed keys with no minted template (info only — no id to touch, so not reauthorable). */
export function unminted_seed_keys(manifest_mobs, seed_xp) {
  const minted = new Set(Object.keys(manifest_mobs ?? {}))
  return Object.keys(seed_xp ?? {})
    .filter((key) => !minted.has(key))
    .sort()
}

/** Batched gRPC read of xp_reward for a list of template ids (client INJECTED — no client.js import here, so the
 * module stays side-effect-free and the setter apply lane reuses it with its own client). id → xp|null. */
export async function fetch_chain_xp(client, ids, page_size = 50) {
  const xp = {}
  for (let index = 0; index < ids.length; index += page_size) {
    const page = ids.slice(index, index + page_size)
    const { objects } = await client.getObjects({
      objectIds: page,
      include: { json: true },
    })
    objects.forEach((object, page_index) => {
      xp[page[page_index]] =
        object instanceof Error ? null : read_template_xp(object?.json ?? null)
    })
  }
  return xp
}
