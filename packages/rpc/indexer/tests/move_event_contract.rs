// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Checked Move ↔ indexer ↔ client event registry.
//!
//! A missing consumer is legal only when this registry names the event and records
//! the product contract that makes the leg unnecessary. The tests parse every
//! scoped Move `event::emit` and the indexer's structural-mirror registry afresh,
//! so a new event or a removed mirror cannot inherit an accidental waiver.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy)]
struct SourceContract {
    move_source: &'static str,
    indexer_mirrors: &'static [&'static str],
    indexer_waived: &'static [&'static str],
    indexer_waiver_reason: Option<&'static str>,
    client_consumers: &'static [&'static str],
    client_waived: &'static [&'static str],
    client_waiver_reason: Option<&'static str>,
}

macro_rules! contract {
    (
        $source:literal,
        indexer [$($indexer:literal),* $(,)?],
        indexer_waived [$($indexer_waived:literal),* $(,)?] => $indexer_reason:expr,
        client [$($client:literal),* $(,)?],
        client_waived [$($client_waived:literal),* $(,)?] => $client_reason:expr $(,)?
    ) => {
        SourceContract {
            move_source: $source,
            indexer_mirrors: &[$($indexer),*],
            indexer_waived: &[$($indexer_waived),*],
            indexer_waiver_reason: $indexer_reason,
            client_consumers: &[$($client),*],
            client_waived: &[$($client_waived),*],
            client_waiver_reason: $client_reason,
        }
    };
}

#[rustfmt::skip]
const CONTRACTS: &[SourceContract] = &[
    contract!(
        "aresrpg/admin.move",
        indexer [],
        indexer_waived ["CategoryAdded", "CategoryRemoved"] => Some("Administrative taxonomy audit only; the product has no category-event read model."),
        client [],
        client_waived ["CategoryAdded", "CategoryRemoved"] => Some("Clients consume the authored category catalog, not administrative receipts."),
    ),
    contract!(
        "aresrpg/character.move",
        indexer ["CharacterMinted", "PositionAnchored"],
        indexer_waived ["CharacterPolicyCreated"] => Some("Transfer-policy creation is deployment ceremony metadata, not a durable product view."),
        client ["CharacterMinted"],
        client_waived ["PositionAnchored", "CharacterPolicyCreated"] => Some("Position is read from the character checkpoint and policy creation is ceremony-only."),
    ),
    contract!(
        "aresrpg/character_extract.move",
        indexer [],
        indexer_waived ["CharacterExtractPolicyCreated", "CharacterDeleted"] => Some("Policy creation and destructive audit receipts have no retained RPC document."),
        client [],
        client_waived ["CharacterExtractPolicyCreated", "CharacterDeleted"] => Some("Clients reconcile authoritative owned objects after deletion; policy creation is ceremony-only."),
    ),
    contract!(
        "aresrpg/character_link.move",
        indexer ["StatRaised"],
        indexer_waived [] => None,
        client ["StatRaised"],
        client_waived [] => None,
    ),
    contract!(
        "aresrpg/commission.move",
        indexer ["CraftRequested", "CraftAccepted", "CraftExecuted", "CraftCancelled"],
        indexer_waived ["CraftXpRedeemed"] => Some("Voucher redemption is receipt-only; the character progression snapshot owns the resulting XP."),
        client ["CraftExecuted"],
        client_waived ["CraftRequested", "CraftAccepted", "CraftXpRedeemed", "CraftCancelled"] => Some("Commission lifecycle is consumed through RPC request state; voucher XP comes from progression."),
    ),
    contract!(
        "aresrpg/config.move",
        indexer ["ConfigEnabledSet", "DialChanged", "ClassRowSet"],
        indexer_waived ["DomainSet"] => Some("The domain bitmask is read from the authoritative GameConfig object, not event projection."),
        client ["ConfigEnabledSet", "DialChanged", "ClassRowSet"],
        client_waived ["DomainSet"] => Some("Clients consume the authoritative domain mask exposed by the config view."),
    ),
    contract!(
        "aresrpg/crafting.move",
        indexer [],
        indexer_waived [
            "RecipeCreated",
            "RecipeInputsSet",
            "RecipeCraftXpSet",
            "RecipeRetired",
            "Crafted",
        ] => Some("Recipe definitions are chain-direct shared objects and craft outcomes are transaction receipts."),
        client ["Crafted"],
        client_waived [
            "RecipeCreated",
            "RecipeInputsSet",
            "RecipeCraftXpSet",
            "RecipeRetired",
        ] => Some("Clients read live Recipe objects; recipe definition changes carry no client read model."),
    ),
    contract!(
        "aresrpg/extract.move",
        indexer ["ItemEquipped", "ItemUnequipped", "ItemBurned"],
        indexer_waived ["ExtractPolicyCreated", "StacksMerged"] => Some("Policy creation is ceremony-only and stack merge is an atomic receipt delta."),
        client ["ItemEquipped", "ItemUnequipped", "StacksMerged"],
        client_waived ["ExtractPolicyCreated", "ItemBurned"] => Some("Policy creation is ceremony-only; clients reconcile burned ownership from the receipt/object set."),
    ),
    contract!(
        "aresrpg/gathering.move",
        indexer ["ProtectorTriggered"],
        indexer_waived ["ResourceGathered", "RareGathered"] => Some("Gather results are receipt deltas; durable node depletion comes from the Zone snapshot."),
        client ["ResourceGathered"],
        client_waived ["ProtectorTriggered", "RareGathered"] => Some("The client consumes the gather result and authoritative world/fight state, not auxiliary receipts."),
    ),
    contract!(
        "aresrpg/item.move",
        indexer ["TemplateCreated", "TemplateBurned", "TemplateRenamed", "ItemMinted"],
        indexer_waived ["ItemMerged", "ItemSplit", "ItemPolicyCreated"] => Some("Merge/split are receipt-local inventory deltas and policy creation is deployment ceremony metadata."),
        client ["TemplateCreated", "ItemMinted", "ItemMerged"],
        client_waived ["TemplateBurned", "TemplateRenamed", "ItemSplit", "ItemPolicyCreated"] => Some("Catalog changes arrive through live template reads; split receipts reconcile created objects directly."),
    ),
    contract!(
        "aresrpg/mob_template.move",
        indexer [],
        indexer_waived [
            "MobTemplateCreated",
            "MobTemplateBurned",
            "MobTemplateTuned",
            "MobLootRetuned",
            "MobSpellsRetuned",
        ] => Some("Mob templates are shared objects served chain-direct; no event-sourced mirror is authoritative."),
        client [],
        client_waived [
            "MobTemplateCreated",
            "MobTemplateBurned",
            "MobTemplateTuned",
            "MobLootRetuned",
            "MobSpellsRetuned",
        ] => Some("Clients decode the live MobTemplate object rather than tuning/administrative events."),
    ),
    contract!(
        "aresrpg/pet.move",
        indexer ["FoodPowerSet", "PetPowerAdvanced"],
        indexer_waived ["PetFed"] => Some("PetFed is an action receipt; PetPowerAdvanced owns the durable projected power."),
        client [],
        client_waived ["FoodPowerSet", "PetFed", "PetPowerAdvanced"] => Some("Clients read pet power and feed configuration from projected/object state, not raw events."),
    ),
    contract!(
        "aresrpg/results.move",
        indexer ["ResultOpened", "ResultBurned"],
        indexer_waived ["LootMinted"] => Some("LootMinted is an atomic receipt correlation; ItemMinted rows own durable item identity."),
        client ["ResultOpened", "LootMinted", "ResultBurned"],
        client_waived [] => None,
    ),
    contract!(
        "aresrpg/scribe.move",
        indexer [],
        indexer_waived ["BandSet"] => Some("The scribe band is authoritative shared configuration read chain-direct."),
        client [],
        client_waived ["BandSet"] => Some("Clients read the scribe configuration object and do not consume its administrative receipt."),
    ),
    contract!(
        "aresrpg/shop.move",
        indexer [
            "SaleCreated",
            "PriceChanged",
            "WindowChanged",
            "SalePaused",
            "SaleBurned",
            "SaleBought",
        ],
        indexer_waived [] => None,
        client ["SaleCreated", "SalePaused", "SaleBought"],
        client_waived ["PriceChanged", "WindowChanged", "SaleBurned"] => Some("Clients consume the normalized sale projection; they do not replay administrative sale events."),
    ),
    contract!(
        "aresrpg/version.move",
        indexer [],
        indexer_waived ["VersionBumped", "EnabledSet"] => Some("Core package liveness is read from the shared Version object in the package registry."),
        client [],
        client_waived ["VersionBumped", "EnabledSet"] => Some("Clients consume the package-registry liveness view rather than raw version events."),
    ),
    contract!(
        "aresrpg/world.move",
        indexer ["WorldCreated", "RareLinkSet", "RareLinkCleared"],
        indexer_waived ["WorldLinksDrained", "WorldBurned", "WorldUpdated"] => Some("World mutation/destruction is reconciled from authoritative object snapshots, not audit receipts."),
        client ["WorldCreated"],
        client_waived [
            "RareLinkSet",
            "RareLinkCleared",
            "WorldLinksDrained",
            "WorldBurned",
            "WorldUpdated",
        ] => Some("Clients consume the normalized live World view and do not replay world-administration events."),
    ),
    contract!(
        "aresrpg/zones.move",
        indexer ["WorldJoined", "ZoneSearched", "MobGroupClaimed"],
        indexer_waived ["MobGroupReleased", "ZonesDrained"] => Some("Release/drain are reflected by the authoritative Zone object snapshot and index reconciliation."),
        client ["WorldJoined", "ZoneSearched", "MobGroupClaimed"],
        client_waived ["MobGroupReleased", "ZonesDrained"] => Some("Clients consume current zone/fight projections, not maintenance receipts."),
    ),
    contract!(
        "dungeon/dungeon_events.move",
        indexer ["RunActivated", "PassEnteredFight", "RunAdvanced", "RunEnded"],
        indexer_waived [] => None,
        client [],
        client_waived ["RunActivated", "PassEnteredFight", "RunAdvanced", "RunEnded"] => Some("Dungeon lifecycle is indexer-only; clients consume rpc:run state plus authoritative fight receipts."),
    ),
    contract!(
        "forgemagie/forgemagie.move",
        indexer ["BoardCreated", "Crushed", "RecipelessSet"],
        indexer_waived ["RuneRegistered", "RuneScribed"] => Some("Rune registry is read from the CrushBoard table and scribing reconciles minted items from its receipt."),
        client ["Crushed"],
        client_waived ["BoardCreated", "RuneRegistered", "RecipelessSet", "RuneScribed"] => Some("Clients use the indexed taux view, chain-direct rune registry, and minted-item receipt deltas."),
    ),
    contract!(
        "gifting/airdrop.move",
        indexer [],
        indexer_waived [
            "AirdropCreated",
            "AirdropAddressesAdded",
            "AirdropAddressesRemoved",
            "AirdropClosed",
            "AirdropClaimed",
        ] => Some("Airdrop state is an operator-owned object/receipt workflow with no product read model."),
        client [],
        client_waived [
            "AirdropCreated",
            "AirdropAddressesAdded",
            "AirdropAddressesRemoved",
            "AirdropClosed",
            "AirdropClaimed",
        ] => Some("The SDK reconciles airdrop transactions from effects and live objects, not event replay."),
    ),
    contract!(
        "gifting/consume.move",
        indexer [],
        indexer_waived ["ConsumableUsed"] => Some("ConsumableUsed is a signed action receipt; character/item snapshots own durable state."),
        client [],
        client_waived ["ConsumableUsed"] => Some("Clients reconcile the consumed item and character state from the transaction/object result."),
    ),
    contract!(
        "gifting/creation.move",
        indexer [
            "CharacterCreated",
            "PriceChanged",
            "PausedSet",
            "SponsorSet",
            "FreeEnabledSet",
            "ClassAdded",
            "ClassRemoved",
        ],
        indexer_waived [] => None,
        client ["CharacterCreated"],
        client_waived [
            "PriceChanged",
            "PausedSet",
            "SponsorSet",
            "FreeEnabledSet",
            "ClassAdded",
            "ClassRemoved",
        ] => Some("Clients consume the normalized creation-config projection, not its administrative events."),
    ),
    contract!(
        "gifting/gift.move",
        indexer [],
        indexer_waived ["GiftSent", "GiftClaimed", "GiftRecalled"] => Some("Gift escrow is resolved from the live Gift object and signed transaction effects."),
        client [],
        client_waived ["GiftSent", "GiftClaimed", "GiftRecalled"] => Some("Clients use owned/shared object state and receipt effects rather than replaying gift events."),
    ),
    contract!(
        "gifting/loot_box.move",
        indexer [],
        indexer_waived ["LootTableSet", "LootBoxOpened", "PetClaimed"] => Some("Loot tables are shared objects and box outcomes are private transaction-receipt facts."),
        client ["LootBoxOpened"],
        client_waived ["LootTableSet", "PetClaimed"] => Some("The client decodes the reveal receipt; configuration and claim completion come from live objects/effects."),
    ),
    contract!(
        "gifting/pool.move",
        indexer ["PoolBuy", "PoolSell"],
        indexer_waived [] => None,
        client [],
        client_waived ["PoolBuy", "PoolSell"] => Some("The pool production doors are retired; retained mirrors are indexer-only compatibility surface."),
    ),
    contract!(
        "kolizeum/kolizeum_events.move",
        indexer [
            "KolizeumCreated",
            "KolizeumCancelled",
            "KolizeumStarted",
            "KolizeumSettled",
            "KolizeumDrawn",
            "KolizeumSwept",
        ],
        indexer_waived ["KolizeumJoined", "KolizeumExited", "KolizeumOutcomeOpened"] => Some("Live roster changes come from the Kolizeum object; outcome opening is receipt-local."),
        client ["KolizeumCreated"],
        client_waived [
            "KolizeumJoined",
            "KolizeumExited",
            "KolizeumCancelled",
            "KolizeumStarted",
            "KolizeumSettled",
            "KolizeumDrawn",
            "KolizeumSwept",
            "KolizeumOutcomeOpened",
        ] => Some("Clients consume the authoritative normalized PvP lifecycle view and signed outcome receipt."),
    ),
    contract!(
        "social/friends.move",
        indexer [],
        indexer_waived ["FriendListCreated", "FriendAdded", "FriendRemoved"] => Some("Friend relationships are served chain-direct from the owner-keyed FriendList object."),
        client [],
        client_waived ["FriendListCreated", "FriendAdded", "FriendRemoved"] => Some("Clients read the live FriendList and reconcile their own signed transaction result."),
    ),
    contract!(
        "social/party.move",
        indexer ["PartyCreated", "PartyJoined", "PartyLeft"],
        indexer_waived [] => None,
        client [],
        client_waived ["PartyCreated", "PartyJoined", "PartyLeft"] => Some("Party lifecycle is indexer-only; clients consume normalized party snapshots and p2p UX nudges."),
    ),
    contract!(
        "social/version.move",
        indexer [],
        indexer_waived ["VersionBumped", "EnabledSet"] => Some("Social package liveness is read from its shared Version object, not event projection."),
        client [],
        client_waived ["VersionBumped", "EnabledSet"] => Some("Clients use the package liveness/object contract and do not consume raw version events."),
    ),
    contract!(
        "spells/spell_template.move",
        indexer [],
        indexer_waived ["SpellMinted", "SpellTuned"] => Some("Spell templates are authoritative shared objects populated by deployment ceremony."),
        client [],
        client_waived ["SpellMinted", "SpellTuned"] => Some("Runtime clients read the spell-template corpus; mint/tune events are ceremony-only."),
    ),
    contract!(
        "spells/version.move",
        indexer [],
        indexer_waived ["VersionBumped", "EnabledSet"] => Some("Spell package liveness is read from its shared Version object, not event projection."),
        client [],
        client_waived ["VersionBumped", "EnabledSet"] => Some("Clients use the package liveness/object contract and do not consume raw version events."),
    ),
];

fn manifest_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}

fn without_line_comments(source: &str) -> String {
    source
        .lines()
        .map(|line| line.split_once("//").map_or(line, |(code, _)| code))
        .collect::<Vec<_>>()
        .join("\n")
}

fn emitted_events(source: &str) -> BTreeSet<String> {
    let source = without_line_comments(source);
    let mut events = BTreeSet::new();
    let mut rest = source.as_str();
    while let Some(offset) = rest.find("event::emit") {
        rest = &rest[offset + "event::emit".len()..];
        let Some(open) = rest.find('(') else { break };
        rest = rest[open + 1..].trim_start();
        let name = rest
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
            .collect::<String>();
        if name
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_uppercase())
        {
            events.insert(name);
        }
    }
    events
}

fn names(values: &[&str]) -> BTreeSet<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn assert_partition(
    move_source: &str,
    emitted: &BTreeSet<String>,
    covered: &[&str],
    waived: &[&str],
    waiver_reason: Option<&str>,
    leg: &str,
) {
    let covered = names(covered);
    let waived = names(waived);
    assert!(
        covered.is_disjoint(&waived),
        "{move_source}: {leg} event is both consumed and waived"
    );
    let registered = covered.union(&waived).cloned().collect::<BTreeSet<_>>();
    assert_eq!(
        &registered, emitted,
        "{move_source}: {leg} registry does not exactly cover emitted events"
    );
    if waived.is_empty() {
        assert!(
            waiver_reason.is_none(),
            "{move_source}: {leg} carries a reason without a waiver"
        );
    } else {
        assert!(
            waiver_reason.is_some_and(|reason| reason.trim().len() >= 24),
            "{move_source}: {leg} waiver requires a concrete product-contract reason"
        );
    }
}

fn mirror_blocks(source: &str) -> Vec<&str> {
    let mut starts = source
        .match_indices("mirrors!(")
        .map(|(offset, _)| offset)
        .chain(source.match_indices("&[Mirror {").map(|(offset, _)| offset))
        .collect::<Vec<_>>();
    starts.sort_unstable();
    starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            let end = starts.get(index + 1).copied().unwrap_or(source.len());
            &source[*start..end]
        })
        .collect()
}

fn mirror_registered(parity_source: &str, move_source: &str, event: &str) -> bool {
    let (package, file) = move_source.split_once('/').unwrap();
    let source_literal = format!("\"../../move/{package}/sources/{file}\"");
    let macro_event = format!("(\"{event}\",");
    let singleton_event = format!("move_struct: \"{event}\"");
    mirror_blocks(parity_source).iter().any(|block| {
        block.contains(&source_literal)
            && (block.contains(&macro_event) || block.contains(&singleton_event))
    })
}

#[test]
fn every_scoped_move_event_has_an_explicit_triplet_contract() {
    let parity_source = fs::read_to_string(manifest_path("tests/move_mirror_parity.rs")).unwrap();
    let mut registered_sources = BTreeSet::new();
    let mut registered_event_count = 0_usize;

    for contract in CONTRACTS {
        assert!(
            registered_sources.insert(contract.move_source),
            "duplicate source contract: {}",
            contract.move_source
        );
        let move_source = fs::read_to_string(manifest_path(&format!(
            "../../move/{}/sources/{}",
            contract.move_source.split_once('/').unwrap().0,
            contract.move_source.split_once('/').unwrap().1,
        )))
        .unwrap();
        let emitted = emitted_events(&move_source);
        registered_event_count += emitted.len();

        assert_partition(
            contract.move_source,
            &emitted,
            contract.indexer_mirrors,
            contract.indexer_waived,
            contract.indexer_waiver_reason,
            "indexer",
        );
        assert_partition(
            contract.move_source,
            &emitted,
            contract.client_consumers,
            contract.client_waived,
            contract.client_waiver_reason,
            "client",
        );
        for event in contract.indexer_mirrors {
            assert!(
                mirror_registered(&parity_source, contract.move_source, event),
                "{}::{event}: declared indexer mirror is absent from move_mirror_parity.rs",
                contract.move_source
            );
        }
    }

    assert_eq!(
        registered_event_count, 119,
        "review the triplet contract when the scoped event count changes"
    );
}

#[test]
fn every_event_emitting_source_in_scoped_packages_is_registered() {
    let registered = CONTRACTS
        .iter()
        .map(|contract| contract.move_source.to_owned())
        .collect::<BTreeSet<_>>();
    let packages = CONTRACTS
        .iter()
        .map(|contract| contract.move_source.split_once('/').unwrap().0)
        .collect::<BTreeSet<_>>();
    let mut emitting_sources = BTreeSet::new();

    for package in packages {
        let directory = manifest_path(&format!("../../move/{package}/sources"));
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("move") {
                continue;
            }
            let source = fs::read_to_string(&path).unwrap();
            if !emitted_events(&source).is_empty() {
                emitting_sources.insert(format!(
                    "{package}/{}",
                    path.file_name().unwrap().to_string_lossy()
                ));
            }
        }
    }

    assert_eq!(
        registered, emitting_sources,
        "an event-emitting Move source was added or removed without updating the triplet registry"
    );
}
