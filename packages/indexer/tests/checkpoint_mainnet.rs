// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Mainnet checkpoint 330185168, captured 2026-10-04 from
// https://checkpoints.mainnet.sui.io/330185168.binpb.zst.
// The deployed Sui decoder stalls here with transaction.bcs enum variant 3.
use object_store::local::LocalFileSystem;
use std::sync::Arc;
use sui_indexer_alt_framework::ingestion::store_client::StoreIngestionClient;

#[tokio::test]
async fn captured_mainnet_checkpoint_decodes_through_ingestion() {
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let store = Arc::new(LocalFileSystem::new_with_prefix(fixtures).unwrap());
    let client = StoreIngestionClient::new(store, None);
    let checkpoint = client.checkpoint(330185168).await.unwrap();
    assert_eq!(checkpoint.summary.sequence_number, 330185168);
    assert!(!checkpoint.transactions.is_empty());
    println!("decoded {} transactions", checkpoint.transactions.len());
}
