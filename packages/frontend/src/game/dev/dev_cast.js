// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEV-ONLY cast hook — lets HEADLESS qa land a REAL spell cast when arm→target board clicks won't register
// (Playwright can't drive the 3D raycast). It drives the IDENTICAL path a spell-card-drop + End-Turn produces:
// draft the cast on the target cell (use_dungeon_turn.set_cast_target — the same gold-ring readback the board
// draws), then fire the SAME single commit_turn on_end_turn builds for a cast-only turn:
//   dungeon_store.commit_turn([{ kind: 1 /* cast */, target: <encoded cell>, spell_template_id: '0x…' }])
// staging the spell's on-chain SpellTemplate object id exactly like the real UI (the store routes it to act_cast).
// → the CHAIN resolves it: real damage on the mob + AP spend + (once the turn advances) the mob replay, all off
// the real poll sync — NOT a painted VFX. (__ARES_DEV_PLAY_VFX only paints a float with no state change, which
// is why it can't gate D16/D19/the live float — this can.) Returns a small result object so qa can assert.
//
// import.meta.env.DEV-gated by the caller (GameWorldHud) — this whole module tree-shakes out of prod.

import { encode } from '@aresrpg/fight'
import { context } from '../store.js'
import { use_dungeon } from '../../world-shell/dungeon_store.js'
import { fight_view } from '@aresrpg/fight'
import { spell_object_id, resolve_class_spells } from '../screens/hud/fight-spells.js'
import { use_dungeon_turn } from '../screens/dungeon-turn.js'

const CAST_KIND = 1 // dungeon_turn.move apply_cast (0 = move, 1 = cast) — the on-chain action tag
const STATUS_ACTIVE = 1

/**
 * window.__ARES_DEV_CAST(spell_idx, target_cell) — draft + commit a REAL cast at {x,y} on the active turn.
 * @param {number} spell_idx hand-card index — the cast stages THAT card's on-chain SpellTemplate object id
 *   (falls back to the class primary when the index misses), and arms it so the VFX/hand match a real click.
 * @param {{ x: number, y: number }} target_cell the LIVING target mob's arena cell (fight-los grid coords).
 * @returns {Promise<{
 *   ok: boolean, error?: string,
 *   ap_before?: number, ap_after?: number,
 *   target_hp_before?: number, target_hp_after?: number, target_killed?: boolean,
 * }>}
 */
async function dev_cast(spell_idx, target_cell) {
  const store = use_dungeon.getState()
  const { dungeon, busy } = store
  const fight = fight_view()
  if (!dungeon || !fight) return { ok: false, error: 'no active dungeon fight' }
  if (busy) return { ok: false, error: 'store busy (a tx/poll is in flight) — retry' }
  if (dungeon.status !== STATUS_ACTIVE) return { ok: false, error: `dungeon not ACTIVE (status=${dungeon.status})` }

  const me = fight.my_entity_id
  if (!me) return { ok: false, error: 'no local participant (my_entity_id null)' }
  if (fight.active_entity_id !== me) return { ok: false, error: `not my turn (active=${fight.active_entity_id})` }

  const x = target_cell?.x
  const y = target_cell?.y
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { ok: false, error: 'target_cell must be { x:int, y:int }' }
  const cell = encode(x, y)

  const mob_idx = dungeon.mobs.findIndex((m) => m.cell === cell && m.alive)
  if (mob_idx === -1) {
    const living = dungeon.mobs.filter((m) => m.alive).map((m) => m.cell)
    return { ok: false, error: `no living mob at cell ${x},${y} (living mob cells: ${living.join(',')})` }
  }
  const target_hp_before = dungeon.mobs[mob_idx].hp
  // The AP the active player actually has to spend = the refilled per-turn budget the HUD/board draft against
  // (build_fighters refills the active player to the max; the raw escrow ap is the pre-refill leftover — see
  // dungeon_store #14). Reading the fight slice here matches what a real spell-click would spend from.
  const ap_before = fight.fighters.get(me)?.ap ?? null

  // Arm the hand card at spell_idx (parity with a real card-grab).
  const hand_id = (fight.hand ?? [])[spell_idx]
  if (hand_id) context.dispatch('action/fight/arm', { spell_id: hand_id })
  // Stage the SAME on-chain SpellTemplate object id the real UI stages (DungeonBoard flush_commit): the ARMED
  // card's id when spell_idx named one, else the caster's class primary (first on-chain spell — level-blind
  // here, the chain enforces min_char_level). The store routes {kind:1, spell_template_id} → act_cast; no
  // object id = no seeded spell = honest refusal.
  const my_classe =
    fight.fighters.get(me)?.class_id ??
    fight.fighters.get(me)?.classe ??
    dungeon.escrow?.find((p) => (p.character ?? p.character_id) === me)?.classe
  const spell_template_id =
    spell_object_id(hand_id) ?? resolve_class_spells(my_classe, Number.MAX_SAFE_INTEGER)[0]?.object_id ?? null
  if (!spell_template_id) return { ok: false, error: `no seeded on-chain spell for classe=${my_classe} — cannot cast` }

  // DRAFT + COMMIT the identical path on_end_turn runs for a cast: set the cast pick (gold-ring readback on the
  // 3D board), then commit the single action. commit_turn awaits its own refresh(), so the settled on-chain
  // state is readable straight after.
  use_dungeon_turn.getState().set_cast_target(cell)
  await store.commit_turn([{ kind: CAST_KIND, target: cell, spell_template_id }])
  use_dungeon_turn.getState().clear_picks()

  const err = use_dungeon.getState().error
  if (err) return { ok: false, error: String(err) }

  const after = use_dungeon.getState().dungeon
  const mob_after = after?.mobs?.[mob_idx]
  const me_after = after?.escrow?.find((p) => (p.character ?? p.character_id) === me)
  return {
    ok: true,
    ap_before,
    // raw on-chain leftover after the cast (the contract refills lazily inside the NEXT commit, so this is
    // budget − spend; ap_before − ap_after === the cast's AP cost proves the spend landed).
    ap_after: me_after?.ap ?? null,
    target_hp_before,
    target_hp_after: mob_after?.hp ?? null,
    target_killed: mob_after ? !mob_after.alive : true,
  }
}

/**
 * Register the DEV-only window hook. Called once at app boot (dev builds only). Idempotent. No-op in prod —
 * the caller gates on import.meta.env.DEV so this whole module tree-shakes out of the production bundle.
 */
export function register_dev_cast() {
  if (typeof window === 'undefined') return
  ;/** @type {any} */ (window).__ARES_DEV_CAST = dev_cast
}
