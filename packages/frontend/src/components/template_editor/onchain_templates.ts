import { useState, useEffect } from 'react'
import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'

import { get_sdk } from '../../chain/sdk'
import { DEMO_NETWORK, T62_WORLDS } from '../../chain/deployment'
import { get_mob_templates, get_item_templates } from '../../chain/read_templates'
import { get_worlds } from '../../chain/read_worlds'
import { game_log } from '../../core/log.js'

// ─── On-chain templates (mob/item) ────────────────────────────────────────
// Chain-direct replacement for the dead backend `fetch_templates('mob'|'item')` WS call — replays
// MobTemplateCreated/ItemTemplateCreated events + batch-fetches the live shared objects (see
// chain/read_templates.js). A tiny module-level cache is shared across every consumer (the TEMPLATES
// admin tab AND the mob-editor loot picker both need the 'item' list at once) so opening the loot picker
// doesn't re-run a full event replay the tab just did.
type OnChainTemplateKind = 'mob' | 'item'
const onchain_cache: Record<OnChainTemplateKind, any[] | undefined> = { mob: undefined, item: undefined }
const onchain_inflight: Record<OnChainTemplateKind, Promise<any[]> | null> = { mob: null, item: null }
const onchain_listeners: Record<OnChainTemplateKind, Set<() => void>> = { mob: new Set(), item: new Set() }

function load_onchain_templates(kind: OnChainTemplateKind, force = false): Promise<any[]> {
  if (!force && onchain_inflight[kind]) return onchain_inflight[kind]!
  if (!force && onchain_cache[kind]) return Promise.resolve(onchain_cache[kind]!)
  const fetcher = kind === 'mob' ? get_mob_templates : get_item_templates
  const promise = (async () => {
    try {
      const { graphql_client } = await get_sdk()
      const rows = await fetcher(graphql_client, aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID'))
      onchain_cache[kind] = rows
      onchain_inflight[kind] = null
      onchain_listeners[kind].forEach((cb) => cb())
      return rows
    } catch (err) {
      onchain_inflight[kind] = null
      game_log('templates', `on-chain ${kind} template read failed:`, err)
      return onchain_cache[kind] ?? []
    }
  })()
  onchain_inflight[kind] = promise
  return promise
}

/** Live MobTemplate/ItemTemplate list for `kind`, chain-direct. `refresh()` forces a re-fetch (call it right
 * after a successful mint so the new template shows up without a full page reload).
 * `opts.orphans`: 'include' (DEFAULT — the ADMIN editor lists ALL on-chain templates, orphans badge-able) or
 * 'exclude' (the ENCYCLOPEDIA drops stale/legacy templates so players never see pre-v2 / bad-category junk).
 * The module cache always holds the FULL list; the filter is applied per-consumer at return. */
export function use_onchain_templates(
  kind: OnChainTemplateKind,
  opts?: { orphans?: 'include' | 'exclude' }
): { data: any[] | undefined; refresh: () => void } {
  const [, force_render] = useState(0)
  useEffect(() => {
    const cb = () => force_render((n) => n + 1)
    onchain_listeners[kind].add(cb)
    load_onchain_templates(kind)
    return () => {
      onchain_listeners[kind].delete(cb)
    }
  }, [kind])
  const rows = onchain_cache[kind]
  const data = opts?.orphans === 'exclude' && rows ? rows.filter((r) => !r?._orphan) : rows
  return {
    data,
    refresh: () => {
      load_onchain_templates(kind, true).then(() => force_render((n) => n + 1))
    },
  }
}

// ─── On-chain worlds ───────────────────────────────────────────────────────
// Chain-direct replacement for the dead backend WS 'world' template type — reads every world in the
// T62_WORLDS constant straight from chain (see chain/read_worlds.js). Same module-level cache +
// listener pattern as use_onchain_templates above, kept separate since worlds are a distinct kind with no
// event-replay discovery step (the constant already enumerates every seeded world id).
let worlds_cache: any[] | undefined
let worlds_inflight: Promise<any[]> | null = null
const worlds_listeners = new Set<() => void>()

function load_onchain_worlds(force = false): Promise<any[]> {
  if (!force && worlds_inflight) return worlds_inflight
  if (!force && worlds_cache) return Promise.resolve(worlds_cache)
  const promise = get_worlds(T62_WORLDS)
    .then((rows) => {
      worlds_cache = rows
      worlds_inflight = null
      worlds_listeners.forEach((cb) => cb())
      return rows
    })
    .catch((err) => {
      worlds_inflight = null
      game_log('worlds', 'on-chain world read failed:', err)
      return worlds_cache ?? []
    })
  worlds_inflight = promise
  return promise
}

/** Live World list (T62_WORLDS), chain-direct. `refresh()` forces a re-fetch (call after an admin world
 * write — e.g. set_enabled — so the tab reflects the new on-chain state). */
export function use_onchain_worlds(): { data: any[] | undefined; refresh: () => void } {
  const [, force_render] = useState(0)
  useEffect(() => {
    const cb = () => force_render((n) => n + 1)
    worlds_listeners.add(cb)
    load_onchain_worlds()
    return () => {
      worlds_listeners.delete(cb)
    }
  }, [])
  return {
    data: worlds_cache,
    refresh: () => {
      load_onchain_worlds(true).then(() => force_render((n) => n + 1))
    },
  }
}
