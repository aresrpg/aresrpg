// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The fight-board catalog — the door-contract's reference instance (registry.move carries
/// the contract). Boards are authored content: the off-chain validator proves connectivity,
/// `combat_grid::grid_spec` holds the cheap sanity floor, and this module owns the ONE
/// invariant a board store adds — DENSE indexes 0..len-1, holes impossible by construction
/// (add appends at `len`, replace overwrites in place, remove does not exist: a hole under
/// `seed % len` would be a fight-creation DoS). Core picks with `pick(catalog, seed)`.
module aresrpg_seed::board_catalog;

use aresrpg_math::combat_grid::GridSpec;
use aresrpg_control::admin::AdminCap;
use aresrpg_seed::registry::{Self, Registry};
use std::string::String;
use sui::{derived_object, dynamic_field as dfield};

const ENoSuchBoard: u64 = 4201;
const EEmptyCatalog: u64 = 4202;

const DOMAIN: vector<u8> = b"fight_boards";

/// Claim key under the registry root — the catalog's derived address.
public struct BoardCatalogKey() has copy, drop, store;

/// `len` boards live as dynamic fields `0..len-1` on this object.
public struct BoardCatalog has key {
  id: UID,
  len: u64,
}

/// Once per seeding: the catalog is born empty and shared; the first `add` makes it pickable.
public fun create_catalog(cap: &AdminCap, root: &mut Registry, ctx: &TxContext) {
  let catalog = BoardCatalog {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), BoardCatalogKey()),
    len: 0,
  };
  registry::bump(cap, root, DOMAIN.to_string(), b"create".to_string(), ctx);
  transfer::share_object(catalog);
}

/// Append one authored board at index `len` — built by `combat_grid::grid_spec` in the same
/// PTB (the one constructor; its asserts are the validation step of the door contract).
public fun add_board(cap: &AdminCap, root: &mut Registry, catalog: &mut BoardCatalog, board: GridSpec, ctx: &TxContext) {
  dfield::add(&mut catalog.id, catalog.len, board);
  catalog.len = catalog.len + 1;
  registry::bump(cap, root, DOMAIN.to_string(), index_key(catalog.len - 1), ctx);
}

/// Overwrite one board in place — live fights are untouched (they copied at creation).
public fun replace_board(cap: &AdminCap, root: &mut Registry, catalog: &mut BoardCatalog, index: u64, board: GridSpec, ctx: &TxContext) {
  assert!(index < catalog.len, ENoSuchBoard);
  *dfield::borrow_mut(&mut catalog.id, index) = board;
  registry::bump(cap, root, DOMAIN.to_string(), index_key(index), ctx);
}

/// Remove the current tail. The off-chain reconciler rewrites shifted indexes first, so this
/// one primitive supports arbitrary collection removal without holes or stable board IDs.
public fun remove_last_board(cap: &AdminCap, root: &mut Registry, catalog: &mut BoardCatalog, ctx: &TxContext) {
  assert!(catalog.len > 0, ENoSuchBoard);
  let index = catalog.len - 1;
  let _: GridSpec = dfield::remove(&mut catalog.id, index);
  catalog.len = index;
  registry::bump(cap, root, DOMAIN.to_string(), index_key(index), ctx);
}

/// The game's read: one board by entropy — only the picked child's bytes load.
public fun pick(catalog: &BoardCatalog, seed: u64): GridSpec {
  assert!(catalog.len > 0, EEmptyCatalog);
  *dfield::borrow(&catalog.id, seed % catalog.len)
}

public fun len(catalog: &BoardCatalog): u64 { catalog.len }

#[test_only]
public fun catalog_for_testing(ctx: &mut TxContext): BoardCatalog {
  BoardCatalog { id: object::new(ctx), len: 0 }
}

#[test_only]
public fun share_for_testing(catalog: BoardCatalog) { transfer::share_object(catalog); }

// key_string — the event key for one board index
fun index_key(index: u64): String {
  index.to_string()
}
