// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// @aresrpg/engine3/vfx — the public barrel for the flagship fight-VFX preset system. The frontend fight
// renderer (fight_cast_vfx.js) imports `create_vfx_preset` + `PRESETS` here to play a 3D GPU-particle burst
// at an impact instead of a sprite sheet; the runtime + data live one module deeper (vfx_preset_engine.js /
// vfx_presets_data.js). One import surface, nothing new to wire in engine.js.

export { create_vfx_preset, tint_emitter, particle_state, seed_emitter, preset_peak_luma } from './vfx_preset_engine.js'
export { PRESETS, get_preset, list_presets } from './vfx_presets_data.js'
export { follow_entity } from './vfx_anchor.js'
// World/ambience props (class d_world): the FlameFX bonfire/candle LOOP fixtures + the shared mount-group lifecycle
// the dungeon (cave_scene) + overworld (world_props) consumers use to spawn/animate/tear-down world light-props.
export { create_world_fixture_group, world_fixture_preset, FLAME_TINTS, WORLD_PRESETS } from './vfx_presets_world.js'
// On-model status glow (a worn cosmetic → a body-silhouette aura): attach_status_overlay mounts the
// create_status_overlay shell on the avatar's own skinned mesh; STATUS_OVERLAY carries the per-aura pack colour.
export { attach_status_overlay, create_status_overlay, STATUS_OVERLAY } from './vfx_model_overlay.js'
// Melee + impact preset lanes (BattleFX claw/swing/slash_elem bursts · shield-ward · dark vortex · air impact) —
// the frontend feel lane consumes these builders + preset maps through @aresrpg/engine3/vfx.
export { melee_burst_preset, MELEE_PRESETS } from './vfx_presets_melee.js'
export { shield_ward_preset, DARK_VORTEX_PRESETS, AIR_IMPACT_PRESETS, IMPACT_PRESETS } from './vfx_presets_impact.js'
