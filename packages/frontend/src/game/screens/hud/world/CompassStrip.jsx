// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COMPASS STRIP — the "option 3A" top-strip compass design (zone mobs+resources render through the
// top-strip compass), translated from the
// mockup (mockups_design/world_discovery/3a_compass_top_strip.html) into the GOLD GOTHIC terminal per the
// same house design-system line (frosted-obsidian REJECTED — .gw-panel tokens only). Feature riders (07-09):
//   • MERGES the old top-center coords/fps DOM chip (D188(b)/D199 — deleted in embed_voxel.js): position
//     gold-left, fps cyan-right, fed by the %10-frame `player_pose` publish (pos + camera yaw + fps).
//   • ZONE STATE line: current zone via zone_of(pose) — undiscovered → UNSEARCHED; cooling down → "ZONE
//     REFRESH m:ss" + an explainer tooltip, off RpcZone.discovered_at_ms + the World's own zone_ttl_ms (chain
//     doc, §17.1 lazy TTL); TTL-expired (ready) → no label at all (a text state here read
//     as a fake button — the [F] SEARCH pill, still owned by the PromptStack/untouched, is the real affordance
//     once it's wired to re-arm on expiry, a declared gap — see the zone_state comment below); honest '—'
//     whenever a source is absent.
//   • PIPS: the zone's live mob groups (red) + resource nodes (cyan) by bearing relative to the CAMERA
//     heading, distance-faded (near/mid/far), sliding on the ±100° ruler with the cardinals. Spawn truth is
//     the /v1/zones single-zone read (rpc/client get_zone — the Zone DF state in ONE fetch) DERIVED into rows
//     by zone_rows.js (the seed-derivation home), polled on the zone cadence for discovered zones only. Every pip is
//     public chain data — the UI is your bot.
//     DENSITY (the density dial turned this into "pip soup"): cap_nearest_pips → cluster_pips
//     → thin_pip_labels (compass_math, pure + unit-tested, in that exact order) BEFORE any strip projection
//     — nearest ~5 of each kind survive, near-identical bearings (≤2°) merge into one ×N marker, only the
//     nearest ~3 of each kind keep a distance label (the rest are dot-only). Falloff stays pip_tier, unchanged.
//   • EDGE MARKERS (answers "how do I reach the next zone"): the nearest 1-2 boundaries of the
//     CURRENT zone cell (compass_math zone_edge_distances/nearest_zone_edges — pure geometry off the
//     player's world pos + zone_size), projected through the SAME bearing→x math as the cardinals/pips
//     above (one home). Tinted by the NEIGHBOR zone's discovered flag — a free `.find()` against the SAME
//     zones store zone_row already reads below, zero extra fetch: undiscovered = gold, discovered = muted.
// Self-gates on `player_pose` (null in spectate / before the walker's first frame → renders nothing).
// DEV seam: window.__ARES_COMPASS_SYNTH = { world_id?, zone?, zone_ttl_ms?, spawns?, zones? } overrides the
// network sources for harness/QA drives (spawns? are WORLD-space spawn_markers rows now — the store already
// ingests chain→world; zones? feeds the edge-marker neighbor-discovered lookup; mirrors __ARES_WORLD_READS;
// tree-shaken from prod).

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'

import { GATHER_RESOURCES } from '@aresrpg/sdk/jobs'

import './compass-strip.css'
import { DayNightBar } from './DayNightDial.jsx' // day-night cycle indicator — the subtle progress line on the strip's bottom edge
import { useGameState } from '../../../store.js'
import { play_sfx } from '../../../core/audio/sfx.js'
import { InteractionChip } from '../../../touch/InteractionChip.jsx'
import { use_zones_view, refetch_zones } from '../../../../rpc/zones_poll'
import { use_world_binding } from '../../../../world-shell/session_gate.js'
import { use_spawns } from '../../../../world-shell/spawns_adapter.js'
import { use_prompt_stack, visible_prompts } from '../../../../world-shell/prompt_stack.js'
import { zone_of, zone_of_world, world_offsets, DEFAULT_ZONE_SIZE } from '@aresrpg/sdk/coords'
import { zone_world_doc } from '../../../zone_rows.js'
import {
  CARDINALS,
  bearing_of,
  camera_heading,
  cap_nearest_pips,
  cluster_pips,
  format_mmss,
  nearest_zone_edges,
  neighbor_zone_key,
  pip_tier,
  relative_bearing,
  strip_x,
  thin_pip_labels,
  reconciled_zone_row,
} from './compass_math.js'
import { spawn_markers } from '@aresrpg/world/spawns_zones'
import { reroll_at, zone_row_of } from '@aresrpg/world/spawns_reconcile'

// A resource node's (job u8 0/1/2, tier 1-11) → its gatherable display NAME (the @aresrpg/sdk/jobs roster —
// the ONE home shared with the 3D node prop's resource_visual). Design ruling 2026-07-12: the pip label shows the real
// name, never the "(N left)" charge counter. Null (unmapped) falls back to the localized `compass.resource`.
const JOB_KEYS = ['farmer', 'herbalist', 'miner']
const resource_name = (job, tier) => {
  const roster = GATHER_RESOURCES[JOB_KEYS[Math.max(0, Math.min(2, Number(job) | 0))]] ?? []
  const t = Math.max(1, Math.min(11, Number(tier) | 0))
  return (roster.find((r) => r.tier === t) ?? roster[0])?.name
}

// The world doc (zone_size / zone_ttl_ms — config-grade) comes from its ONE home, `zone_rows.zone_world_doc`:
// one chain read per world per session, and a non-answer is never cached, so a later mount retries instead of
// freezing on a boot-time hiccup. This file used to keep a third Map over the identical read (#2054).

/**
 * @param {{ mobile?: boolean }} props
 * @returns {import('react').ReactElement | null}
 */
export function CompassStrip({ mobile = false } = {}) {
  const { t } = useTranslation()
  const pose = useGameState((s) => s.player_pose)
  const character_id = useGameState((s) => s.selected_character_id)
  // The selected character's world binding — session_gate is the ONE binding home (three writers heal it);
  // no extra character-doc poll here. undefined (unknown) and null (unbound) both read as "no world yet".
  const bound_char = use_world_binding((s) => s.character_id)
  const bound_world = use_world_binding((s) => s.world)
  const synth = import.meta.env.DEV ? /** @type {any} */ (window.__ARES_COMPASS_SYNTH ?? null) : null
  const world_id = synth?.world_id ?? (bound_char === character_id ? (bound_world ?? null) : null)

  // World doc (zone_size + zone_ttl_ms) — one chain read per world per session.
  const [world_doc, set_world_doc] = useState(null)
  const synth_on = !!synth
  useEffect(() => {
    if (!world_id || synth_on) return
    let dead = false
    zone_world_doc(world_id).then((doc) => {
      if (!dead) set_world_doc(doc)
    })
    return () => {
      dead = true
    }
  }, [world_id, synth_on])
  const zone_size = Number(world_doc?.zone_size ?? 0) || DEFAULT_ZONE_SIZE
  const zone_ttl_ms = synth?.zone_ttl_ms ?? (world_doc ? Number(world_doc.zone_ttl_ms ?? 0) || null : null)

  // World↔chain codec: the pose is SIGNED WORLD space (render origin-centred); the zone KEY is chain-space
  // (data lookups + spawn reads), so translate world→chain then floor. The origin's chain zone re-centres the
  // DISPLAY label so world (0,0) reads ZONE 0·0 (never fed to a tx).
  const off = world_offsets(world_doc)
  const cell = pose ? zone_of_world(pose.x, pose.z, zone_size, off.x, off.z) : null
  const origin_zone = zone_of(off.x, off.z, zone_size)

  // Discovered-zone set — the ONE shared /v1/zones poll (rpc/zones_poll.js — #242): CompassStrip,
  // DiscoveryPrompts, and world_spawns.js all derive from this SAME timer instead of each running their own.
  const zones_view = use_zones_view(!synth_on ? world_id : null)
  const rpc_zone_row = cell ? (zones_view.data?.zones?.find((z) => z.zx === cell.zx && z.zy === cell.zy) ?? null) : null
  // RECEIPT vs POLL (UX-latency fix — the compass used to stay on UNSEARCHED far too long after the search
  // was revealed): the search tx's OWN receipt already flipped this cell inside the shared spawns/zones core
  // the instant it certified (discovery_actions.js's zone_searched dispatch → spawns_zones.js's
  // fold_zone_searched) — read it back here (zone_row_of) so the strip never has to wait out ITS OWN poll
  // cadence for a fact the client already proved (pipeline law №1: predict off the receipt; the poll only
  // reconciles later and never regresses it — reconciled_zone_row, compass_math.js). Skipped in the DEV synth
  // harness (synth.zone below is the whole point of that override — no real receipt to react to).
  const spawns_zones = use_spawns((s) => s.zones)
  const store_zone_row = !synth_on && cell ? zone_row_of(spawns_zones, cell.zx, cell.zy) : null
  const zone_row = synth?.zone ?? reconciled_zone_row(store_zone_row, rpc_zone_row)
  const discovered = !!zone_row && zone_row.discovered !== false

  // Live spawns — the standing cell's slice of the ONE spawns store (spawn_markers), never a compass-owned
  // per-zone fetch. The store is fed by the shared 6s poll AND the search fast-path (world_spawns.js folds the
  // searched zone chain-direct the instant the tx certifies), so the strip repaints from the SAME truth the big
  // map + 3-D world read — no divergence, no bespoke reconcile-wait. Marker x/z are WORLD space (offset applied
  // at the door). An undiscovered cell has no store rows, so the pips vanish exactly as discovery flips.
  const templates = use_spawns((s) => s.templates)
  const pending = use_spawns((s) => s.pending)
  const cell_spawns = useMemo(
    () =>
      !synth_on && cell
        ? spawn_markers({ zones: spawns_zones, templates, pending }).filter((m) => m.zx === cell.zx && m.zy === cell.zy)
        : [],
    [synth_on, spawns_zones, templates, pending, cell?.zx, cell?.zy]
  )
  const spawns = synth?.spawns ?? cell_spawns

  // Reroll countdown — a 1 s local tick, armed only while a real deadline exists (reroll_at: the ONE home,
  // compass_math — shared with the DiscoveryPrompts [F] re-arm so the countdown and the affordance never drift).
  const reroll = reroll_at(zone_row, zone_ttl_ms)
  const [now, set_now] = useState(() => Date.now())
  useEffect(() => {
    if (!reroll) return
    set_now(Date.now())
    const timer = setInterval(() => set_now(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [reroll])

  // SEARCH-ZONE RELOCATE (moved from the bottom-center prompt stack to sit directly under the
  // strip): DiscoveryPrompts.jsx still OWNS the registration/gate (zone_searchable)/pending-optimism/F-keybind
  // (PromptStack.jsx's ONE listener still routes the key here) — this only renders THAT prompt's pill in the
  // new spot. PromptStack.jsx excludes id 'search' from its own stack so it never renders twice.
  const search_prompt =
    use_prompt_stack(useShallow((s) => visible_prompts(s).filter((p) => p.id === 'search')))[0] ?? null
  const trigger_search = () => {
    play_sfx('button') // S-71 §2.11 — the same press cue every world-prompt trigger fires (PromptStack.jsx's trigger)
    use_prompt_stack.getState().trigger_prompt('search')
  }
  // SEARCHABLE GLOW: search_prompt truthy IS "the zone is actionable" —
  // DiscoveryPrompts' `searchable` gate (zone_searchable: undiscovered OR TTL-elapsed), mirrored through the
  // prompt store. Reused verbatim rather than re-derived from discovered/reroll so the glow can never drift
  // off the pill's own real gate (one home per fact) — an earlier pass here glowed only on `!discovered`,
  // missing the TTL-elapsed re-search case where the pill is ALSO live. Drives both this pill's and the
  // strip's persistent gold pulse below.
  const searchable_now = !!search_prompt

  // Spectate / pre-first-frame: the walker never published a pose — no strip (PartyFrame's render-nothing idiom).
  if (!pose) return null

  // Zone-state line — honest '—' whenever a source is absent (never an invented state). RETENTION FIX:
  // the READY state ("reroll ready") read as a confusing dead label — a zone
  // whose TTL elapsed is re-searchable, so the [F] SEARCH ZONE prompt (DiscoveryPrompts arms it via the shared
  // `zone_searchable` — undiscovered OR TTL-elapsed) is the honest affordance for it, not compass text. This
  // strip renders NOTHING for that state (zone_state stays '') rather than a second, redundant label; while
  // COOLING DOWN it shows the "ZONE REFRESH" countdown + an explainer tooltip ("expired zones can be
  // re-searched, fresh spawns for everyone").
  let zone_state = '—'
  let zone_tooltip = null
  if (world_id && cell && (zones_view.data || synth || store_zone_row)) {
    if (!discovered) zone_state = t('compass.unsearched')
    else if (reroll == null) zone_state = t('compass.searched')
    else if (reroll - now > 0) {
      zone_state = t('compass.zone_refresh_in', { time: format_mmss(reroll - now) })
      zone_tooltip = t('compass.zone_refresh_tooltip')
    } else zone_state = ''
  }

  const heading = camera_heading(pose.yaw ?? 0)
  const marks = CARDINALS.map((c) => ({ ...c, x: strip_x(relative_bearing(c.bearing, heading)) })).filter(
    (m) => m.x != null
  )
  // Pip pipeline (the density dial turned the strip into "pip soup", ~40 overlapping dots):
  // build every candidate's raw bearing/dist, then cap → cluster → label-thin (pure, compass_math, one
  // home — unit-tested there) BEFORE ever projecting to a strip position, so a merged/dropped pip never
  // even reaches strip_x. Size/opacity falloff stays pip_tier's job, unchanged, applied to what survives.
  const pip_candidates = spawns.map((s) => {
    // Marker x/z are WORLD space already (the store ingests chain→world at the door); the pose is world space too.
    const dx = s.x - pose.x
    const dz = s.z - pose.z
    return {
      id: `${s.kind}:${s.spawn_id}`,
      kind: s.kind,
      bearing: bearing_of(dx, dz),
      dist: Math.round(Math.hypot(dx, dz)),
      title:
        s.kind === 'mob'
          ? t('compass.mob_group', { size: s.size ?? 0 })
          : resource_name(s.job, s.tier) || t('compass.resource'), // real name, no "(N left)" counter
    }
  })
  const pips = thin_pip_labels(cluster_pips(cap_nearest_pips(pip_candidates)))
    .map((p) => {
      const x = strip_x(relative_bearing(p.bearing, heading))
      if (x == null) return null
      return { ...p, x, tier: pip_tier(p.dist) }
    })
    .filter(Boolean)

  // Edge markers — the nearest 1-2 boundaries of the CURRENT zone cell, tinted by the neighbor zone's
  // discovered flag (free lookup against the same store zone_row already reads above; no new fetch).
  const zones_list = synth?.zones ?? zones_view.data?.zones
  const edge_markers = cell
    ? nearest_zone_edges(pose.x, pose.z, cell.zx, cell.zy, zone_size, off.x, off.z)
        .map((e) => {
          const x = strip_x(relative_bearing(e.bearing, heading))
          if (x == null) return null
          const nb = neighbor_zone_key(cell.zx, cell.zy, e.edge)
          const nb_row = zones_list?.find((z) => z.zx === nb.zx && z.zy === nb.zy)
          const nb_discovered = !!nb_row && nb_row.discovered !== false
          return { id: `edge:${e.edge}`, x, dist: Math.round(e.dist), discovered: nb_discovered }
        })
        .filter(Boolean)
    : []

  return (
    <div className="gw-compass-wrap">
      <div
        className={`gw-compass gw-panel${searchable_now ? ' gw-compass--searchable' : ''}`}
        aria-label={t('compass.label')}
      >
        <div className="gw-compass__band" aria-hidden="true">
          <div className="gw-compass__ruler" />
          {marks.map((m) => (
            <span
              key={m.label}
              className={`gw-compass__card${m.major ? ' gw-compass__card--major' : ''}`}
              style={{ left: `${m.x * 100}%` }}
            >
              {m.label}
            </span>
          ))}
          <div className="gw-compass__fwd">
            <span className="gw-compass__caret" />
            <span className="gw-compass__stem" />
          </div>
          {pips.map((p) => (
            <span
              key={p.id}
              title={p.count > 1 ? `${p.title} · ${t('compass.cluster_count', { extra: p.count - 1 })}` : p.title}
              className={`gw-compass__pip gw-compass__pip--${p.kind} gw-compass__pip--${p.tier}`}
              style={{ left: `${p.x * 100}%` }}
            >
              <span className="gw-compass__pip-dot-row">
                <span className="gw-compass__pip-dot" />
                {p.count > 1 && <span className="gw-compass__pip-count">×{p.count}</span>}
              </span>
              {p.show_label && <span className="gw-compass__pip-dist">{p.dist}m</span>}
            </span>
          ))}
          {edge_markers.map((m) => (
            <span
              key={m.id}
              title={t('compass.zone_edge', { dist: `${m.dist}m` })}
              className={`gw-compass__edge gw-compass__edge--${m.discovered ? 'discovered' : 'undiscovered'}`}
              style={{ left: `${m.x * 100}%` }}
            >
              <span className="gw-compass__edge-tick" />
              <span className="gw-compass__edge-label">{t('compass.zone_edge', { dist: `${m.dist}m` })}</span>
            </span>
          ))}
        </div>
        {mobile && (
          <span className="gw-compass__mobile-zone" title={zone_tooltip ?? undefined}>
            {cell && origin_zone
              ? `${t('compass.zone')} ${cell.zx - origin_zone.zx}·${cell.zy - origin_zone.zy}`
              : t('compass.out_of_bounds')}
          </span>
        )}
        {!mobile && (
          <div className="gw-compass__info">
            {/* coords as whole blocks (no decimals), one subtle chip per axis */}
            <span className="gw-compass__pos">
              <span className="gw-compass__pos-chip">{Math.round(pose.x)}</span>
              <span className="gw-compass__pos-chip">{Math.round(pose.y)}</span>
              <span className="gw-compass__pos-chip">{Math.round(pose.z)}</span>
            </span>
            <span className="gw-compass__zone" title={zone_tooltip ?? undefined}>
              {/* the zone under the avatar, ALWAYS. SIGNED display: the chain zone key re-centred on the world
                  origin (world (0,0) → ZONE 0·0, walking west → −1·0), so the label matches the signed coord
                  chips. Past the world's low edge (translated chain < 0) the cell is null → the honest
                  OUT-OF-BOUNDS label instead of a dead '—' (fixes a vanished-zone-info regression). */}
              {cell && origin_zone
                ? `${t('compass.zone')} ${cell.zx - origin_zone.zx}·${cell.zy - origin_zone.zy}${zone_state ? ` · ${zone_state}` : ''}`
                : t('compass.out_of_bounds')}
            </span>
            <span className="gw-compass__fps">{`${pose.fps} FPS`}</span>
          </div>
        )}
        {/* DAY-NIGHT indicator: the subtle time-of-day progress line hugging the strip's bottom
            edge — the old top-right dome dial folded into the compass. Pure reader of the cycle clock. */}
        <DayNightBar />
      </div>
      {/* SEARCH-ZONE (relocate + style-revert): the [F] search-zone prompt's pill, moved here
          from the bottom-center prompt stack — same gate/label/keybind (DiscoveryPrompts.jsx) — but the
          relocate moves POSITION ONLY: same .gw-npc-prompt pill markup/classes as every bottom-stack prompt
          (PromptStack.jsx), never a bespoke look (an earlier pass here swapped in the
          house .btn-outline CTA idiom). --searchable adds the persistent gold pulse (game-world-hud.css)
          while the zone is actionable — the exact gate that renders this button at all, so it's on
          whenever the pill exists (searchable_now above). */}
      {search_prompt && (
        <InteractionChip
          prompt={search_prompt}
          on_trigger={trigger_search}
          class_name={`gw-npc-prompt gw-npc-prompt--stacked gw-panel pointer-events-auto${searchable_now ? ' gw-npc-prompt--searchable' : ''}`}
        />
      )}
    </div>
  )
}
