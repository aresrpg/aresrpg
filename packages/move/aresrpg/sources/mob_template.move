// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// MOB TEMPLATE — the admin-minted mob CONTENT blueprint (stats, a ≤4-spell kit, a ≤16-entry loot table, xp).
/// S-46 final split: the ENGINE spawns from a plain `MobSpec` — this module owns the shared authoring object and
/// mirrors it into the spec at the core fight doors (`y69` — resistances stored CENTERED here are DECENTERED
/// into true magnitudes exactly where the old engine spawn decoded them).
module aresrpg::mob_template;

use aresrpg::{admin::AdminCap, version::Version};
use aresrpg_fight::mob::{Self, MobSpec, MobLootEntry};
use aresrpg_foundation::{spell::{Self, Stats}, spell_effect::SpellLevel};
use std::string::String;
use sui::event;

const MAX_SPELLS: u64 = 4; // §17.21 mob spell-list bound
const MAX_LOOT: u64 = 16; // §17.14 loot entries per mob template

const ETooManySpells: u64 = 101; // mint: spell kit exceeds MAX_SPELLS
const ETooManyLoot: u64 = 102; // mint: loot table exceeds MAX_LOOT

/// A shared authoring blueprint for a mob. `stats` stores resistances CENTERED at 32768 (the mob convention —
/// `y69` decodes them). `key` only — shared.
public struct MobTemplate has key {
  id: UID,
  name: String,
  min_level: u16,
  max_level: u16,
  base_hp: u64,
  ap: u64,
  mp: u64,
  element: u8,
  stats: Stats,
  spells: vector<SpellLevel>,
  loot: vector<MobLootEntry>,
  xp_reward: u64,
}

public struct MobTemplateCreated has copy, drop { template: ID, name: String }

/// Emitted when a mob template is burned (deleted on-chain). Live fights + zone mob-groups reference a template
/// by a plain `ID` copy (the cross-package seam law — never a typed ref), so a burn dangles nothing running: it
/// only retires the blueprint for FUTURE spawns. Mirrors `item::TemplateBurned`.
public struct MobTemplateBurned has copy, drop { template: ID, name: String }

/// Emitted when a live mob template's tunable STAT surface is retuned in place (`set_stats`). Carries the
/// scalar retune fields (the full `Stats` block is re-readable off the shared object, so it stays out of the
/// event — mirrors the lean `spell_template::SpellTuned` precedent). Lets an indexer project the new
/// hp/ap/mp/xp without a re-fetch.
public struct MobTemplateTuned has copy, drop { template: ID, base_hp: u64, ap: u64, mp: u64, xp_reward: u64 }

/// Emitted when a live mob template's LOOT TABLE is retuned in place (`set_loot`). The full loot vector is
/// re-readable off the shared object (mirrors the lean `MobTemplateTuned` precedent — the block stays out of the
/// event), so it carries only the new entry count; an indexer re-fetches the table on this signal.
public struct MobLootRetuned has copy, drop { template: ID, entries: u64 }

/// Emitted when a live mob template's SPELL KIT is retuned in place (`set_spells`). The full spell vector is
/// re-readable off the shared object (the same lean precedent `MobLootRetuned` set — the block stays out of the
/// event), so it carries only the new kit size; an indexer re-fetches the kit on this signal.
public struct MobSpellsRetuned has copy, drop { template: ID, spells: u64 }

/// Mint + SHARE a mob template (admin content). Cap + version gated; asserts the engine bounds. Returns the id.
public fun mint(
  cap: &AdminCap,
  version: &Version,
  name: String,
  min_level: u16,
  max_level: u16,
  base_hp: u64,
  ap: u64,
  mp: u64,
  element: u8,
  stats: Stats,
  spells: vector<SpellLevel>,
  loot: vector<MobLootEntry>,
  xp_reward: u64,
  ctx: &mut TxContext,
): ID {
  cap.verify(ctx);
  version.assert_latest();
  assert!(spells.length() <= MAX_SPELLS, ETooManySpells);
  assert!(loot.length() <= MAX_LOOT, ETooManyLoot);
  let tmpl = MobTemplate { id: object::new(ctx), name, min_level, max_level, base_hp, ap, mp, element, stats, spells, loot, xp_reward };
  let tid = object::id(&tmpl);
  event::emit(MobTemplateCreated { template: tid, name: tmpl.name });
  transfer::share_object(tmpl);
  tid
}

/// BURN a mob template: delete its shared object on-chain (any admin-authored object must always be deletable).
/// Cap + version gated, MIRRORING `mint` and the item precedent (`admin::burn_item_template`).
/// A `MobTemplate` carries NO dynamic fields and NO on-chain supply counter (the engine spawns from a mirrored
/// `MobSpec` value, never a decremented count), so the admin gate suffices — reference-safety is proven OFF-CHAIN
/// by the firing script (zero live fights/zone-groups reference this id) exactly as the item ghost burn did.
/// Unpacks the struct (every non-`id` field has `drop`) and `object::delete`s the UID (Sui permits deleting a
/// SHARED object passed BY VALUE). Emits `MobTemplateBurned`.
public fun burn(cap: &AdminCap, version: &Version, tmpl: MobTemplate, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  let MobTemplate {
    id, name, min_level: _, max_level: _, base_hp: _, ap: _, mp: _, element: _, stats: _, spells: _, loot: _, xp_reward: _,
  } = tmpl;
  event::emit(MobTemplateBurned { template: id.to_inner(), name });
  object::delete(id);
}

/// Additive admin-facing alias with the same argument order as `admin::burn_item_template`: authority, object,
/// version, context. The original `burn` ABI stays frozen for upgrade compatibility; both doors execute the exact
/// same AdminCap + latest-version checks and terminal UID deletion.
public fun burn_mob_template(cap: &AdminCap, tmpl: MobTemplate, version: &Version, ctx: &TxContext) {
  burn(cap, version, tmpl, ctx);
}

/// Retune a live mob template's TUNABLE STAT SURFACE in place — base_hp, ap, mp, the `stats` block (attributes
/// + CENTERED elemental resistances, the mob convention `y69` decodes) and xp_reward — in ONE atomic call
/// (one `set_stats` call takes everything for the mob — xp, hp, ap, mp, resistance). The
/// IDENTITY fields (name, min/max level, element) stay MINT-ONLY — an identity change is a re-author, not a
/// stat tune; the KIT fields have their own dedicated doors (`set_loot`, `set_spells`), never this one.
/// Cap + version gated exactly like `mint`/`burn` (the same-file sibling idiom:
/// authority, version, object, values, ctx), so the admin cap holder retunes while dark AND live. Preserves the template
/// object ID: every world mob-entry, live fight and zone-group `ID` copy that points at it stays valid, and the
/// engine reads the new values from the NEXT spawn (spawns snapshot a `MobSpec` value at create — a retune never
/// touches a running fight). Additive public fn on the upgraded package — legal under the COMPATIBLE policy (no
/// existing signature or type changed). Emits `MobTemplateTuned`.
public fun set_stats(
  cap: &AdminCap,
  version: &Version,
  tmpl: &mut MobTemplate,
  base_hp: u64,
  ap: u64,
  mp: u64,
  stats: Stats,
  xp_reward: u64,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  tmpl.base_hp = base_hp;
  tmpl.ap = ap;
  tmpl.mp = mp;
  tmpl.stats = stats;
  tmpl.xp_reward = xp_reward;
  event::emit(MobTemplateTuned { template: object::id(tmpl), base_hp, ap, mp, xp_reward });
}

/// Retune a live mob template's LOOT TABLE in place — replace the whole `≤16`-entry `vector<MobLootEntry>`
/// (ceremony-1's loot edits + the wool-floor balance fix never reached chain — `MobTemplate.loot`
/// still serves MINT-TIME rates; no setter existed). The loot table is a KIT field, mint-only until now; this
/// additive setter is the LOOT twin of `set_stats` — same cap + version gate, the SAME `MAX_LOOT` bound `mint`
/// asserts (mirrored, never weaker), same object-ID preservation (every world mob-entry, live fight and
/// zone-group `ID` copy stays valid; the engine reads the new table from the NEXT spawn — a snapshot never
/// touches a running fight). The caller builds the entries with `aresrpg_fight::mob::new_loot_entry` (the exact
/// same public constructor `mint` receives its loot through) and passes the vector — mint's input shape,
/// verbatim. Additive public fn on the upgraded package — legal under the COMPATIBLE policy (no existing
/// signature or type changed). Emits `MobLootRetuned`.
public fun set_loot(
  cap: &AdminCap,
  version: &Version,
  tmpl: &mut MobTemplate,
  loot: vector<MobLootEntry>,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(loot.length() <= MAX_LOOT, ETooManyLoot);
  tmpl.loot = loot;
  event::emit(MobLootRetuned { template: object::id(tmpl), entries: tmpl.loot.length() });
}

/// Retune a live mob template's SPELL KIT in place — replace the whole `≤4`-entry `vector<SpellLevel>`. The
/// correction door for the ratified effect encoding: the live kits were minted CENTERED while both runtimes
/// consume magnitude+flag, and `spells` was MINT-ONLY, so no correction could fire without a re-mint (which
/// would change the template ID every world mob-entry and zone-group points at). This additive setter is the
/// SPELL twin of `set_loot` — same cap + version gate, the SAME `MAX_SPELLS` bound `mint` asserts (mirrored,
/// never weaker: the setter can never bake a kit `mint` would have rejected), same object-ID preservation
/// (every live fight and zone-group `ID` copy stays valid; the engine reads the new kit from the NEXT spawn —
/// a spawn snapshots a `MobSpec` value at create, so a retune never touches a running fight). The caller
/// builds the levels with `aresrpg_foundation::spell_effect::new_spell_level` — the exact same public
/// constructor `mint` receives its kit through — and passes the vector WHOLESALE (a correction driver
/// re-pushes complete kits, never a per-effect patch). Additive public fn on the upgraded package — legal
/// under the COMPATIBLE policy (no existing signature or type changed). Emits `MobSpellsRetuned`.
public fun set_spells(
  cap: &AdminCap,
  version: &Version,
  tmpl: &mut MobTemplate,
  spells: vector<SpellLevel>,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(spells.length() <= MAX_SPELLS, ETooManySpells);
  tmpl.spells = spells;
  event::emit(MobSpellsRetuned { template: object::id(tmpl), spells: tmpl.spells.length() });
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// Mirror the template into the engine's plain `MobSpec` (resistances DECENTERED — true magnitudes, exactly
/// where the old engine spawn decoded them). Called by the core fight doors at create.
public(package) fun y69(self: &MobTemplate): MobSpec {
  mob::new_mob_spec(
    self.min_level, self.max_level, self.base_hp, self.ap, self.mp,
    spell::decenter_mob_resistances(&self.stats), self.spells, self.xp_reward, self.loot,
  )
}

public fun template_id(self: &MobTemplate): ID { object::id(self) }
public fun mob_loot(self: &MobTemplate): vector<MobLootEntry> { self.loot }
/// The stored spell kit. Free read (mirrors `mob_loot`/`mob_stats`) so the `set_spells` correction is
/// verifiable off-chain and on-chain without a spawn — the readback oracle's on-chain half.
public fun mob_spells(self: &MobTemplate): vector<SpellLevel> { self.spells }
public fun mob_xp_reward(self: &MobTemplate): u64 { self.xp_reward }
public fun mob_min_level(self: &MobTemplate): u16 { self.min_level }
public fun mob_max_level(self: &MobTemplate): u16 { self.max_level }
public fun mob_base_hp(self: &MobTemplate): u64 { self.base_hp }
public fun mob_ap(self: &MobTemplate): u64 { self.ap }
public fun mob_mp(self: &MobTemplate): u64 { self.mp }
/// The stored `Stats` block (resistances CENTERED at 32768 — the mob convention; `y69` decenters). Free
/// read so the `set_stats` retune is verifiable off-chain and on-chain without a spawn.
public fun mob_stats(self: &MobTemplate): Stats { self.stats }
