// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/trap_ledger.js — pure canonical retirement + presentation of the local trap ledger.

import { K_PLACE_TRAP } from '@aresrpg/sim/spell_effect'
import { get_aoe_cells } from '@aresrpg/sim/spell_targeting'

import {
  armed_at,
  blocks_a_walk,
  decoded_cell,
  encoded_cell,
  placements_by_anchor,
  reconstructed_path,
} from './fight_render_prims.js'
import { fighter_key, seat_resolver } from './inputs.js'
import { GRID_W, decode, encode } from './los.js'

const fields_of = (value) => value?.fields ?? value ?? {}

/**
 * Read the live traps from the public Fight.fx board. The chain entry owns anchor/team/zone truth; this decoder
 * only expands its direction-independent placed zone into the encoded cells the render projection consumes.
 * @param {any} json
 * @returns {{ anchor:number, owner_team:number, cells:number[] }[]}
 */
export function read_fight_traps(json) {
  const rows = fields_of(json?.fx).cell_entries
  if (!Array.isArray(rows)) return []
  return rows.flatMap((raw) => {
    const row = fields_of(raw)
    const anchor = Number(row.cell)
    const owner_team = Number(row.owner_team)
    if (Number(row.kind) !== K_PLACE_TRAP || !Number.isFinite(anchor) || !Number.isFinite(owner_team)) return []
    const cells = get_aoe_cells(
      { area_shape: Number(row.zone_shape) || 0, area_size: Number(row.zone_size) || 0 },
      decode(anchor)
    ).map((cell) => encode(cell.x, cell.y))
    return [{ anchor, owner_team, cells }]
  })
}

/** The chain version a ledger row was consumed at, from the `version:at:step` key `fold_trap_ledger` stamps.
 *  A row that is `gone` without one is retired by an unknown clock — treat it as consumed forever, never a
 *  candidate for re-adoption (erring toward "it stays dead" is the safe half: a resurrected marker is a lie). */
const consumed_version = (trap) => {
  const version = Number(String(trap.triggered_at ?? '').split(':')[0])
  return Number.isFinite(version) ? version : Infinity
}

const covers_anchor = (trap, anchor) =>
  Number(trap.anchor) === anchor || (trap.cells ?? []).some((cell) => Number(cell) === anchor)

/** Does this ledger row make `anchor` a duplicate of what a read at `version` reports? A LIVE row always does;
 *  a consumed one only while the read is not NEWER than the consumption (a newer read naming it is a re-arm). */
const already_held = (trap, anchor, version) =>
  covers_anchor(trap, anchor) && (!trap.gone || consumed_version(trap) >= version)

/**
 * ADOPT the public Fight.fx board into the ONE trap ledger (#1858 · #2033). `read_fight_traps` decodes the
 * authoritative entries; this folds them into the SAME durable ledger a local trap-cast writes, so render,
 * prediction, cast-legality and the beat producer all read one list.
 *
 * Before the fold there were two homes with different lifecycles, and join history decided which one a client
 * rode: a trap the local ledger never saw — an ally's, or your own after a rejoin — rendered off the raw chain
 * list, which no boom ever consumed (removal WAS the next object read) and which prediction never looked at at
 * all. That second home is both the ghost marker and the twin divergence where the chain detonated a trap the
 * client's sim door did not know existed.
 *
 * `version` is the read the rows came from. A row is adopted only when the ledger holds no live row covering
 * its anchor and no row consumed at/after that read — so the very read that detonated a trap can still name it
 * without resurrecting it, while a genuine RE-ARM (a NEWER read naming an anchor consumed earlier) is adopted.
 * Adopted rows carry no payload: the public entry's effects are not decoded here, so they predict a trigger
 * with no damage — a missing number, never a missing trigger.
 * @param {any[]} traps the durable ledger
 * @param {{ anchor:number, owner_team:number, cells:number[] }[]} chain_traps `read_fight_traps` output
 * @param {number} version the chain version those rows were read at
 */
export const adopt_chain_traps = (traps, chain_traps, version) => {
  const rows = traps ?? []
  if (!Array.isArray(chain_traps) || chain_traps.length === 0) return rows
  const adopted = chain_traps
    .map((row) => ({ row, anchor: Number(row?.anchor) }))
    .filter(({ anchor }) => Number.isFinite(anchor) && !rows.some((trap) => already_held(trap, anchor, version)))
  if (adopted.length === 0) return rows
  return [
    ...rows,
    ...adopted.map(({ row, anchor }) => ({
      // `chain: true` is the ownership fact, not a lifecycle one: an adopted row names no LOCAL owner, so the
      // renderer attributes its hit through the neutral fallback instead of borrowing this client's entity.
      chain: true,
      draft_id: null,
      basis_version: version,
      anchor,
      cells: (row.cells ?? []).map(Number).filter(Number.isFinite),
      owner_team: Number(row.owner_team),
      payload: [],
      gone: false,
    })),
  ]
}

// A trap fires ON-CHAIN only when a fighter ENTERS its cell. Reconstruct every entered cell in canonical row
// order, including intermediate walk cells; `step` keeps two triggers in one collapsed move individually keyed.
const committed_entries_of = ({ authoritative_tail, base, view }) => {
  const board_facts = {
    obstacles: view?.obstacles,
    holes: view?.holes,
    shape_mask: view?.shape_mask,
    board_width: view?.width,
    board_height: view?.grid_height,
    width: GRID_W,
  }
  const resolve_seat_key = seat_resolver(view)
  // Only LIVING bodies mask a rebuilt route (`blocks_a_walk` — the chain's `add_living_bodies` rule, one home).
  const cell_at = new Map(
    Object.entries(base.fighters ?? {})
      .filter(([, fighter]) => blocks_a_walk(fighter))
      .map(([key, fighter]) => [key, fighter.cell])
  )
  const committed_entries = []

  authoritative_tail.forEach((entry, at) => {
    // A body killed EARLIER in this same tail frees its cell for a LATER mover: the chain rebuilds its wall mask
    // per mover (`move_blocked_cells` at each `walk` call), so a mid-receipt corpse blocks nothing after it falls.
    if (entry.kind === 'Hit' && Number(entry.remaining_hp) <= 0) {
      cell_at.delete(`${entry.victim_is_mob ? 'm' : 'p'}${Number(entry.victim_idx)}`)
      return
    }
    if (!['Moved', 'MobMoved', 'Displaced'].includes(entry.kind) || entry.to_cell == null) return
    const resolve_seat = entry.resolve_seat ?? resolve_seat_key
    const key =
      entry.kind === 'Displaced'
        ? fighter_key({ is_mob: entry.target_is_mob, idx: entry.target_idx, resolve_seat })
        : fighter_key({ is_mob: entry.kind === 'MobMoved', idx: entry.idx, character: entry.character, resolve_seat })
    const to = Number(entry.to_cell)
    const from = cell_at.get(key)
    const version = Number(entry.version)
    const occupied_cells = [...cell_at.entries()]
      .filter(([other, cell]) => other !== key && cell != null)
      .map(([, cell]) => decoded_cell(cell, GRID_W))
    const entered =
      entry.kind === 'Displaced' || from == null
        ? [to]
        : reconstructed_path(decoded_cell(from, GRID_W), decoded_cell(to, GRID_W), {
            ...board_facts,
            occupied_cells,
          }).map((cell) => encoded_cell(cell, GRID_W))

    for (const [step, cell] of (entered.length > 0 ? entered : [to]).entries())
      committed_entries.push({ cell, version, at, step })
    cell_at.set(key, to)
  })

  return committed_entries
}

const trap_anchor = (placements, trap) => {
  if (trap.anchor != null) return Number(trap.anchor)
  const anchor = (trap.cells ?? []).find((cell) => placements.has(Number(cell)))
  return anchor == null ? null : Number(anchor)
}

/**
 * Canonically consume one first-live trap per ordered entered cell. This is the sole `gone` writer: no final
 * position, turn edge, or renderer state participates. A collapsed walk crossing N traps produces N sequential
 * rows here, matching sim `check_traps` and its one `fight_trap_triggered` event per entered trap.
 */
export const fold_trap_ledger = ({ authoritative_tail, base, traps, view }) => {
  const placements = placements_by_anchor(authoritative_tail, (entry) =>
    entry.kind === 'Cast' ? entry.target_cell : null
  )
  const committed_entries = committed_entries_of({ authoritative_tail, base, view })

  return committed_entries.reduce(
    (next_traps, entry) => {
      const trap_index = next_traps.findIndex((trap) => {
        if (trap.gone || entry.version < Number(trap.basis_version ?? entry.version)) return false
        const anchor = trap_anchor(placements, trap)
        return (
          (trap.cells ?? []).some((cell) => Number(cell) === entry.cell) &&
          (anchor === null || armed_at(placements, anchor, entry.at))
        )
      })
      if (trap_index === -1) return next_traps
      return next_traps.with(trap_index, {
        ...next_traps[trap_index],
        gone: true,
        triggered_at: `${entry.version}:${entry.at}:${entry.step}`,
      })
    },
    [...(traps ?? [])]
  )
}

/**
 * Present exactly one already-canonical trigger. This never writes lifecycle (`gone`); it advances only the
 * overlay's event cursor so the ordered boom removes its own marker. Trigger ids make replay/ack idempotent.
 */
export const present_trap = (traps, { anchor = null, cell = null, trigger_id = null }) => {
  const next_traps = [...(traps ?? [])]
  if (trigger_id != null && next_traps.some((trap) => trap.presented_trigger_id === trigger_id)) return next_traps
  const trap_index = next_traps.findIndex(
    (trap) =>
      trap.gone &&
      !trap.presented &&
      (anchor != null
        ? Number(trap.anchor) === Number(anchor)
        : (trap.cells ?? []).some((candidate) => Number(candidate) === Number(cell)))
  )
  if (trap_index !== -1)
    next_traps[trap_index] = {
      ...next_traps[trap_index],
      presented: true,
      ...(trigger_id != null ? { presented_trigger_id: trigger_id } : {}),
    }
  return next_traps
}
