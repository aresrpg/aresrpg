// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GATHER action seam (UI map #9 rewire) — the [G] prompt's real on-chain submit, the twin of the [F]
// search seam. `gathering::gather` is a terminal `&Random` entry (its own tx, Random-PTB rule); the SDK
// builder carries the ITEM_POLICY / GameConfig / Version refs, nothing here guesses gas.
//
// THE node_index seam (search-cost rework): `node_index` is now the DERIVATION-STREAM index — stable for the
// zone's whole seed lifetime (nothing swap-removes; consumption is a bitmap bit). We still re-read the zone
// RIGHT BEFORE the tx (chain-direct) so a concurrent gather that already consumed the cell surfaces as the
// honest missing-row refusal here instead of an on-chain ENodeEmpty abort (burned gas). Row `spawn_id`s are
// derived 64-bit DECIMAL STRINGS — compare as strings, never Number (2^53 corruption).

import { gather_ptb } from '@aresrpg/sdk/game'
import { JOBS, JOB_CATEGORY } from '@aresrpg/sdk/jobs'

import i18n from '../i18n'
import { DEMO_NETWORK } from '../chain/deployment'
import { get_config } from '../rpc/client'
import { zone_rows_chain } from '../game/zone_rows.js'
import { play_gather_sfx } from '../game/core/audio/sfx.js'
import { play_local_beat } from '../game/core/local_beat.js'
import { note_gather } from '../game/screens/hud/world/quest_ladder_store.js' // ONBOARDING quest-ladder GATHER seam
import { push_progress_toast, update_progress_toast, resolve_progress_toast } from '../game/core/toast.js'

import { run_tx } from './tx.js'
import { spawns_store, spawns_input } from './spawns_adapter.js'

// The 3 GATHERING jobs in on-chain enum order (world.move: a resource node's `job` u8 is 0 FARMER /
// 1 HERBALIST / 2 MINER) — the same SDK-sourced derivation gather_gate.js uses. Uppercased ids match the
// seed's `gatherProtectorJson.jobType` verbatim (farmer → FARMER …), which keys `protector_templates`.
const GATHER_JOBS = JOBS.filter((j) => j.category === JOB_CATEGORY.GATHERING)

/**
 * GATHER the resource node identified by `spawn_id` in zone `(zx, zy)`: sticky progress toast → resolve the
 * live `node_index` → sign `gathering::gather` → the yield mints into the caller's personal kiosk. Returns
 * the run_tx promise (failures already toasted).
 * @param {{ world_id:string, zx:number, zy:number, spawn_id:number|string, template_id:string,
 *           character_id:string, kiosk_id:string, personal_kiosk_cap_id:string }} args
 */
export function gather({ world_id, zx, zy, spawn_id, template_id, character_id, kiosk_id, personal_kiosk_cap_id }) {
  const toast_id = push_progress_toast({ title: i18n.t('discovery.gathering') })
  const started = Date.now()
  const sweep = setInterval(() => update_progress_toast(toast_id, Math.min(0.9, (Date.now() - started) / 2000)), 120)
  // THE DOOR SEES THE PRESS (D770a W2): when this node is the core's armed [G] target (it set the prompt),
  // gather_intent latches its pending row — pending-until-settle as data; the receipt/failure below always
  // settles it. A stale press (target moved between arm and press) skips the latch — the receipt still lands.
  const core_key = `${zx}:${zy}:resource:${spawn_id}`
  if (spawns_store.getState().gather_target_key === core_key) spawns_input({ type: 'gather_intent' })

  return Promise.resolve()
    .then(async () => {
      // Resolve the node_index from the stable spawn_id (see the header seam note), and pull
      // /v1/config in the same breath (env-fed + ~static, so no added latency; a failed read degrades to the
      // honest missing-key refusal below, never a crash before it).
      const [rows, config] = await Promise.all([
        // PRE-FLIGHT EXEMPTION: the other zone-spawn readers (world_spawns.js/CompassStrip.jsx/
        // embed_voxel_dev.js) read /v1; this read feeds a tx pre-flight — it needs the FRESHEST on-chain
        // consumption state (see the header note above), not a short-poll RPC view, so it derives off the
        // chain-direct Zone DF read (zone_rows_chain).
        zone_rows_chain(world_id, zx, zy),
        get_config().catch(() => null),
      ])
      const resources = (rows ?? []).filter((r) => r.kind === 'resource')
      // rows are LIVE-only (consumed bits filtered) and carry their DERIVATION index — the chain's node_index.
      const node = resources.find((r) => String(r.spawn_id) === String(spawn_id))
      if (!node) throw new Error(i18n.t('discovery.gather_failed'))
      const node_index = node.index

      // §17.22 PROTECTOR AMBUSH — gather_ptb REQUIRES the (job,tier)-matched protector `&MobTemplate` id (a
      // `protector_bp` roll spawns a SOLO PvM fight INTRA-call; no inert default exists). The chain carries no
      // protector→resource link, so the resolver is /v1/config `protector_templates` — the CEREMONY SEED map
      // (env-fed, rpc views.js) keyed `${jobType}_${tier}` off the seed's gatherProtectorJson, e.g. "FARMER_9".
      // The node's identity comes from its OWN on-chain (job u8, tier) on the zone row just re-read — the exact
      // pair gathering.move matches the protector against; no extra template fetch. A missing key (or an
      // unreachable config) REFUSES rather than composing a wrong-id PTB (an on-chain abort = burned gas).
      const job = GATHER_JOBS[Number(node.job) || 0]
      const protector_key = `${job ? job.id.toUpperCase() : 'UNKNOWN'}_${Number(node.tier) || 0}`
      const protector_template_id = config?.protector_templates?.[protector_key]
      if (!protector_template_id) {
        console.warn(
          `[gather] refused — no protector MobTemplate for "${protector_key}" in /v1/config protector_templates (§17.22); the ceremony seed map must serve that key.`
        )
        // Localized "gather failed" title (via the shared catch) + this honest subline; never a silently-wrong PTB.
        throw new Error('Gathering temporarily unavailable')
      }
      return gather_ptb({ network: DEMO_NETWORK })({
        world_id,
        kiosk_id,
        personal_kiosk_cap_id,
        character_id,
        zx,
        zy,
        node_index,
        template_id,
        protector_template_id,
      })
    })
    .then((tx) => run_tx('gather', tx))
    .then((res) => {
      // Design ruling 2026-07-12: the toast shows WHAT YOU GOT — the yield scales with job level on-chain
      // (gathering.move gather_yield = 1 + (job_level−required)/5), so surface the authoritative `quantity`
      // off the ResourceGathered event rather than a flat "done". Defaults to 1 if the event is unreadable.
      const ev = (res?.result?.events ?? []).find((e) =>
        String(e?.type ?? '').endsWith('::gathering::ResourceGathered')
      )
      const count = Number(ev?.parsedJson?.quantity) || 1
      // THE GATHER RECEIPT through the door: one charge consumed on-chain — the core decrements `remaining`
      // (receipt-shielded against the lagging poll; the last charge removes + tombstones the node).
      spawns_input({ type: 'gather_receipt', key: core_key })
      resolve_progress_toast(toast_id, { state: 'success', title: i18n.t('discovery.gather_done', { count }) })
      play_gather_sfx() // S-71 §2.3 — the harvest pop; fully built in sfx.js, this was its zero-callers gap
      play_local_beat('ATTACK') // 2026-07-10: a real gather swings the avatar's ATTACK clip once
      // ONBOARDING: a gather tx landed → advance the quest ladder's GATHER step (no-op once past it). Guarded
      // so a tutorial hiccup can never break the gather flow.
      try {
        note_gather()
      } catch {
        /* quest ladder is best-effort */
      }
      return res
    })
    .catch((e) => {
      spawns_input({ type: 'gather_failed', key: core_key }) // settle the pending row (honest re-arm)
      resolve_progress_toast(toast_id, {
        state: 'error',
        title: i18n.t('discovery.gather_failed'),
        message: String(e?.message ?? e).slice(0, 80),
      })
      throw e
    })
    .finally(() => clearInterval(sweep))
}
