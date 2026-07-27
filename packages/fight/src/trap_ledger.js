// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/trap_ledger.js — pure, receipt-proven retirement of the local trap ledger.

import { K_PLACE_TRAP } from '@aresrpg/sim/spell_effect'
import { get_aoe_cells } from '@aresrpg/sim/spell_targeting'

import { armed_at, decoded_cell, encoded_cell, placements_by_anchor, reconstructed_path } from './fight_render_prims.js'
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

// A trap fires ON-CHAIN only when a fighter ENTERS its cell (spell_board::on_enter), so consume it from the
// COMMITTED transition log, not from the batch's final fighter positions. A pushed fighter may land on the trap
// and then take its mob turn away in the SAME receipt; final-position sampling loses that entry. Re-derive walks
// through the renderer's shared path machinery so "which cells did this walk enter" has ONE answer client-wide.
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
  const cell_at = new Map(Object.entries(base.fighters ?? {}).map(([key, fighter]) => [key, fighter.cell]))
  const committed_entries = []

  authoritative_tail.forEach((entry, at) => {
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

    for (const cell of entered.length > 0 ? entered : [to]) committed_entries.push({ cell, version, at })
    cell_at.set(key, to)
  })

  return committed_entries
}

const movement_fighter_key = (entry) => {
  if (!['Moved', 'MobMoved', 'Displaced'].includes(entry.kind)) return null
  if (entry.kind === 'Displaced')
    return fighter_key({
      is_mob: entry.target_is_mob,
      idx: entry.target_idx,
      resolve_seat: entry.resolve_seat,
    })
  return fighter_key({
    is_mob: entry.kind === 'MobMoved',
    idx: entry.idx,
    character: entry.character,
    resolve_seat: entry.resolve_seat,
  })
}

const after_placement = (entry, placed_at) =>
  Number(entry.version) > Number(placed_at.version) ||
  (Number(entry.version) === Number(placed_at.version) && Number(entry.event_idx) > Number(placed_at.event_idx))

/**
 * Placement occupants are exempt only while they have no later optimistic movement row. Deriving that fact from
 * the live log keeps it reversible: rolling a prediction back removes the row and restores the exemption.
 */
export const stationary_placement_occupants = (trap, entries) => {
  const occupants = trap?.placement_occupants ?? []
  if (!occupants.length || !trap?.placed_at) return occupants
  const moved = new Set(
    Object.values(entries ?? {})
      .filter((entry) => entry.source === 'intent' && after_placement(entry, trap.placed_at))
      .map(movement_fighter_key)
      .filter(Boolean)
  )
  return occupants.filter(({ key }) => !moved.has(String(key)))
}

const trap_anchor = (placements, trap) => {
  if (trap.anchor != null) return Number(trap.anchor)
  const anchor = (trap.cells ?? []).find((cell) => placements.has(Number(cell)))
  return anchor == null ? null : Number(anchor)
}

// The standing-position proof is deliberately anchor-only. The cast anchor must be empty when the trap is placed,
// so a later committed occupant proves entry. Other AoE cells may already contain the caster or another fighter at
// placement time; treating those cells as entry proof retires a newly placed AoE before it can ever be painted.
export const fold_trap_ledger = ({ authoritative_tail, base, chain_committed, traps, view }) => {
  const committed_entries = committed_entries_of({ authoritative_tail, base, view })
  const placements = placements_by_anchor(authoritative_tail, (entry) =>
    entry.kind === 'Cast' ? entry.target_cell : null
  )
  const occupied_cells = new Set(
    Object.values(chain_committed.fighters ?? {})
      .filter((fighter) => fighter.cell != null)
      .map((fighter) => fighter.cell)
  )

  return (traps ?? []).map((trap) => {
    if (trap.gone) return trap
    const anchor = trap_anchor(placements, trap)
    const occupied_anchor = anchor !== null && occupied_cells.has(anchor)
    const crossed = (trap.cells ?? []).some((cell) =>
      committed_entries.some(
        (entry) =>
          entry.cell === Number(cell) &&
          entry.version >= Number(trap.basis_version ?? entry.version) &&
          (anchor === null || armed_at(placements, anchor, entry.at))
      )
    )
    return occupied_anchor || crossed ? { ...trap, gone: true } : trap
  })
}
