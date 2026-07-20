// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Pipeline handlers.
//!
//! Each handler turns checkpoint content into records written to Redis, and is
//! registered as its own pipeline in `main.rs`. Two pipelines run today:
//! [`CheckpointHandler`], the checkpoint-liveness recorder that proves ingestion
//! end-to-end, and [`AresHandler`], the game read-model (SPEC §14) — characters,
//! kiosk listings, pools, shop, per-world zones, encyclopedia, config, kolizeum,
//! dungeon runs, and the `aresrpg_fight` fight/result lifecycle (`project.rs`
//! projects FightCreated/FightJoined/…/FightResult).
//!
//! ## Adding a handler
//!
//! 1. Add `mod my_handler;` here and `pub use` its type.
//! 2. Implement `Processor` (checkpoint -> Vec<Value>) and either
//!    `pipeline::sequential::Handler` (ordered, in-place updates) or
//!    `pipeline::concurrent::Handler` (throughput; append-only) with
//!    `type Store = RedisStore`.
//! 3. Register it in `main.rs` via `indexer.sequential_pipeline(..)` /
//!    `indexer.concurrent_pipeline(..)`. Each pipeline gets its own watermark
//!    keyed by `Processor::NAME`, so they resume independently.

mod ares;
mod checkpoint;

pub use ares::{AresHandler, AresSnapshotHandler};
pub use checkpoint::CheckpointHandler;
