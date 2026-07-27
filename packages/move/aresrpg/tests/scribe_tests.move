// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Scribe-module tests, post S-48: `scribe_stats` (the clamp-band rewrite) is DELETED — superseded by the
/// Retro forgemagie system (`aresrpg::forgemagie`, its own suite). What remains here is the upgrade-frozen
/// public admin surface: `set_band` + the band reads must stay callable (the band data is inert but the
/// signatures are law).
#[test_only]
module aresrpg::scribe_tests;

use aresrpg::{admin::{Self, AdminCap, Catalog}, item, item_stats::{Self, ItemStatistics}, scribe::{Self, ScribeConfig}, version::{Self, Version}};
use sui::test_scenario::{Self as ts};

const OWNER: address = @0xA;
const LEVEL: u16 = 10;
const BAND: u16 = 33_000;

fun band_block(): ItemStatistics {
  item_stats::new(
    BAND, BAND, BAND, BAND, BAND, BAND, BAND, BAND, BAND, BAND, BAND, BAND, BAND, BAND, BAND, BAND, BAND,
  )
}

#[test]
/// The frozen admin surface: `set_band` writes a per-level band and stays callable after the S-48 body-kill
/// of its consumer (deleting the door would break the upgrade-compatibility law).
fun set_band_still_writes() {
  let mut sc = ts::begin(OWNER);
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  item::test_init(sc.ctx());
  admin::test_init_catalog(sc.ctx());
  scribe::test_init(sc.ctx());

  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut ver = sc.take_shared<Version>();
  admin::admin_set_enabled(&cap, &mut ver, true, sc.ctx());
  let mut config = sc.take_shared<ScribeConfig>();
  assert!(!scribe::has_band(&config, LEVEL)); // seeded empty
  scribe::set_band(&cap, &mut config, LEVEL, band_block(), &ver, sc.ctx());
  assert!(scribe::has_band(&config, LEVEL)); // now present
  assert!(!scribe::has_band(&config, 999)); // an unset level stays absent
  assert!(item_stats::vitality(scribe::band(&config, LEVEL)) == BAND); // the band reads back
  ts::return_shared(config);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  sc.end();
}
