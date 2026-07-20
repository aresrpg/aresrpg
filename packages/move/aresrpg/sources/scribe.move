/// SCRIBE CONFIG — the admin-set per-item-LEVEL MAX stat BAND table, and NOTHING else. The actual scribe
/// transaction (the player-initiated rune rewrite of an owned item's stats) lives in the SIBLING
/// `aresrpg_forgemagie` package (`scribe_rune`, the S-48 Retro forgemagie system; extracted 2026-07-12 —
/// package-size split); the old clamp-band `scribe_stats` door was deleted (see the note below `set_band`).
///
/// WHAT SURVIVES HERE: the shared `ScribeConfig` (a per-level `ItemStatistics` band, admin-authored while dark)
/// plus `set_band` + getters. It stays a public, upgrade-frozen admin surface even though the band data is now
/// INERT — `forgemagie` owns the write path and does its own clamping.
///
/// PLACEMENT-BY-RESPONSIBILITY: the stat BANDS are items' law (a shared `ScribeConfig` here, admin-set), kept in
/// their own home, separate from the forgemagie write path.
module aresrpg::scribe;

use aresrpg::{
  admin::AdminCap,
  item::{Self, Item, ItemTemplate},
  item_stats::{Self, ItemStatistics},
  version::Version
};
use sui::{event, table::{Self, Table}};

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The shared scribe config: per item-LEVEL MAX stat band (admin-set data). A scribe clamps each field to the
/// band for the item's level. Seeded EMPTY — a level with no band falls back to the hardcoded ceiling alone.
public struct ScribeConfig has key {
  id: UID,
  bands: Table<u16, ItemStatistics>,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct BandSet has copy, drop { level: u16 }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(ScribeConfig { id: object::new(ctx), bands: table::new(ctx) });
}

// ╔════════════════ [ Admin (AdminCap + version gated — bands authored while dark) ] ═ ]

/// Set (or update) the MAX stat band for item `level`. `create`/scribe clamp each field to `min(band, ceiling)`.
public fun set_band(
  cap: &AdminCap,
  config: &mut ScribeConfig,
  level: u16,
  band: ItemStatistics,
  version: &Version,
  ctx: &TxContext,
) {
  cap.verify(ctx);
  version.assert_latest();
  if (config.bands.contains(level)) *config.bands.borrow_mut(level) = band
  else config.bands.add(level, band);
  event::emit(BandSet { level });
}

// S-48 (upgrade #2): the clamp-band scribe (`scribe_stats`) is DELETED — superseded by the Retro
// forgemagie system (the sibling `aresrpg_forgemagie` package's `scribe_rune`, puits ledger). The ScribeConfig
// bands + `set_band` stay (public admin surface is upgrade-frozen; the band data is inert).

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun has_band(config: &ScribeConfig, level: u16): bool { config.bands.contains(level) }

public fun band(config: &ScribeConfig, level: u16): &ItemStatistics { config.bands.borrow(level) }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
