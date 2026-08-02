// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { get_object_json } from './_object.js'

// status: 0 ACTIVE, 1 RETURNING, 2 DEAD (aresrpg::expedition)
const STATUS_LABELS = ['active', 'returning', 'dead']

/**
 * Read an OWNED Expedition object straight from chain — the full run state the dApp renders
 * with no backend. `character` is the ESCROWED Character (a wrapped struct): `getObject` can't
 * fetch it directly, but `showContent` surfaces its nested fields, so we expose BOTH its object
 * id (`character_id`, unchanged) AND its appearance (`character`: the FOLLOW-view avatar
 * descriptor — classe + colors + sex/male + name + experience) so a RUNNING character can be
 * followed physically, not just identified. `region` is the deploy-time config snapshot;
 * `world_id` is the World it deployed to. Returns null when the object is GONE (e.g. already withdrawn →
 * deleted) — which, before #2054, it never actually did: the transport throws on a missing id, so the whole
 * "gone → null" contract only became true once absence was told apart from failure at the read seam.
 * @param {import("../../../types.js").Context} context
 * @throws when the read fails (transport / unclassified ledger error) — never on absence. */
export function get_expedition({ grpc_client }) {
  return async ({ expedition_id }) => {
    // #23 gRPC: core.getObject({include:{json:true}}) flattens the struct (nested `.fields` gone; UID `id.id`→`id`),
    // so the escrowed Character is `fields.character` (not `.character.fields`) and every UID is a bare string.
    const fields = /** @type {any} */ (
      await get_object_json(grpc_client, expedition_id)
    )
    if (!fields) return null // ABSENT expedition — withdrawn and deleted

    const { region } = fields
    const status = Number(fields.status)
    // The ESCROWED Character struct (wrapped, not directly fetchable) lives under `fields.character`.
    // Field names mirror normalize_character (frontend read_character.js) so `expedition.character` drops
    // straight into the SAME mount_scene avatar path the idle roster uses → real class GLB + colors.
    const char = fields.character
    const char_sex = String(char.sex ?? 'male')

    return {
      id: fields.id,
      owner: fields.owner,
      character_id: char.id,
      character: {
        name: String(char.name ?? ''),
        classe: String(char.classe ?? ''),
        sex: char_sex,
        male: char_sex === 'male',
        color_1: Number(char.color_1 ?? 0),
        color_2: Number(char.color_2 ?? 0),
        color_3: Number(char.color_3 ?? 0),
        experience: Number(char.experience ?? 0),
      },
      char_level: Number(fields.char_level),
      player_stats: fields.player_stats.map(Number),
      max_hp: Number(fields.max_hp),
      carried_hp: Number(fields.carried_hp),
      encounter_chance: Number(fields.encounter_chance),
      gather: Number(fields.gather),
      equipped_tool: Number(fields.equipped_tool),
      consumables: Number(fields.consumables),
      consumable_heal: Number(fields.consumable_heal),
      region: {
        density: Number(region.density),
        fight_pct: Number(region.fight_pct),
        difficulty: Number(region.difficulty),
        lvl_min: Number(region.lvl_min),
        lvl_max: Number(region.lvl_max),
        richness: Number(region.richness),
        accrual_half_life_ms: Number(region.accrual_half_life_ms),
      },
      world_id: fields.world_id,
      deploy_ms: Number(fields.deploy_ms),
      journey_len: Number(fields.journey_len),
      opened: Number(fields.opened),
      // run loot is bounded by journey_len (hard-capped at 200 encounters) → Number is safe
      run_resources: Number(fields.run_resources),
      run_xp: Number(fields.run_xp),
      status,
      status_label: STATUS_LABELS[status] ?? 'unknown',
    }
  }
}
