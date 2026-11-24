// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The Move↔indexer parity gates, read from the compiled bytecode and the Move sources:
//!
//! * **Event census** — every `event::emit` is decoded by `events.rs` or deferred with a reason.
//! * **Event mirrors** — each decoded event's field order and widths match the bytecode.
//! * **Pinned constants** — the zone size and the character price match their Move owners.
//! * **Layout snapshot** (`layout.rs`), **package size and Random ABI** (`random_doors.rs`),
//!   **XP authority** (`authority.rs`), **purchase-cap leaks** and the TypeScript vocabularies.
//!
//! A missing build directory is an ERROR with the command to run — never a skip.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use move_binary_format::binary_config::BinaryConfig;
use move_binary_format::file_format::{
    Bytecode, CompiledModule, SignatureToken, SignatureToken as Sig, StructFieldInformation,
};

#[path = "gates/authority.rs"]
mod authority;
#[path = "gates/layout.rs"]
mod layout;
#[path = "gates/random_doors.rs"]
mod random_doors;

/// Events the projection DELIBERATELY does not route — each entry needs a
/// reason. `world::WorldCreated` fires once per world at seeding time, before
/// any player can be watching, and the World object's own projection carries
/// everything the event would have said.
const DEFERRED_EVENTS: &[(&str, &str)] = &[
    // SDK receipts use exact amounts; the live wire already projects Item object writes.
    ("item", "AmountChanged"),
    ("world", "WorldCreated"),
    // A content birth receipt: content is the seed corpus, read at boot.
    ("dungeon_content", "DungeonContentCreated"),
    // Owner-only writes fold this full row from their certified receipt; reconnect reads
    // the projected Mastery object, so no realtime event channel has a consumer.
    ("mastery", "MasteryUpdated"),
    // The SDK consumes the deterministic vector from its own receipt to avoid composing
    // zero-owed rune calls. The CrushClaim object remains reconnect authority.
    ("forgemagie", "CrushRevealed"),
    // Independent wallet finance is read through the SDK. This receipt certifies the
    // royalty split but has no game-state projection or realtime consumer.
    ("staking", "RoyaltyFunded"),
    // Treasury vesting is independent wallet finance. Its certified receipt and the
    // canonical offering balance own this claim; it has no game projection consumer.
    ("offering", "CommunityClaimed"),
    // Independent rewards are read directly through the wallet-finance SDK.
    ("community", "CommunityClaimed"),
    ("economy", "Funded"),
    // The FightProjected write in the same transaction carries `closable`.
    ("fight", "FightClosable"),
    // The Kolizeum object write publishes the directory invalidation.
    ("kolizeum", "KolizeumCreated"),
    // The SDK, the bot and the client read these from their own receipts; object writes
    // stream every resulting Item, Giftcard and claim.
    ("distribution", "GiftcardMinted"),
    ("distribution", "GiftcardRedeemed"),
    ("forgemagie", "RuneScribed"),
    ("loot_box", "LootBoxesOpened"),
    // Content is the seed corpus, read at boot; no live consumer exists.
    ("item_rows", "TemplateCreated"),
    ("mob_rows", "MobTemplateCreated"),
    ("spell_rows", "SpellCreated"),
    ("recipe_rows", "RecipeCreated"),
    ("registry", "ContentWritten"),
    ("loot_box", "LootTableSet"),
];

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("packages/indexer sits two levels under the repo root")
        .to_path_buf()
}

fn load_modules(build_dir: &Path) -> BTreeMap<String, CompiledModule> {
    assert!(
        build_dir.is_dir(),
        "no compiled Move build at {} — run `sui move build --path <pkg>` first \
         (the gate never skips: SKIP ≠ PASS)",
        build_dir.display()
    );
    let mut modules = BTreeMap::new();
    for entry in std::fs::read_dir(build_dir).expect("listing bytecode_modules") {
        let path = entry.expect("dir entry").path();
        if path.extension().is_some_and(|e| e == "mv") {
            let bytes = std::fs::read(&path).expect("reading .mv");
            // local builds are UNPUBLISHABLE-flavored (their header differs
            // from published bytecode) — the config must allow them.
            let module =
                CompiledModule::deserialize_with_config(&bytes, &BinaryConfig::new_unpublishable())
                    .unwrap_or_else(|e| panic!("deserializing {}: {e:?}", path.display()));
            let name = module.identifier_at(module.self_handle().name).to_string();
            modules.insert(name, module);
        }
    }
    assert!(
        !modules.is_empty(),
        "empty build at {}",
        build_dir.display()
    );
    modules
}

/// Render a type compactly: primitives lowercase, datatypes as
/// `module::Name` (address-free — publish-independent), generics recursive.
fn render(module: &CompiledModule, token: &SignatureToken) -> String {
    match token {
        SignatureToken::Bool => "bool".into(),
        SignatureToken::U8 => "u8".into(),
        SignatureToken::U16 => "u16".into(),
        SignatureToken::U32 => "u32".into(),
        SignatureToken::U64 => "u64".into(),
        SignatureToken::U128 => "u128".into(),
        SignatureToken::U256 => "u256".into(),
        SignatureToken::Address => "address".into(),
        SignatureToken::Signer => "signer".into(),
        SignatureToken::Vector(inner) => format!("vector<{}>", render(module, inner)),
        SignatureToken::Datatype(handle) => datatype_name(module, *handle),
        SignatureToken::DatatypeInstantiation(instantiation) => {
            let (handle, params) = instantiation.as_ref();
            let inner = params
                .iter()
                .map(|p| render(module, p))
                .collect::<Vec<_>>()
                .join(", ");
            format!("{}<{inner}>", datatype_name(module, *handle))
        }
        SignatureToken::Reference(inner) => format!("&{}", render(module, inner)),
        SignatureToken::MutableReference(inner) => format!("&mut {}", render(module, inner)),
        SignatureToken::TypeParameter(i) => format!("T{i}"),
    }
}

fn datatype_name(
    module: &CompiledModule,
    handle: move_binary_format::file_format::DatatypeHandleIndex,
) -> String {
    let handle = module.datatype_handle_at(handle);
    let owner = module.module_handle_at(handle.module);
    format!(
        "{}::{}",
        module.identifier_at(owner.name),
        module.identifier_at(handle.name)
    )
}

/// `events.rs` routes a fight to `evt:zone:{world}:{x/ZONE_SIZE}:{z/ZONE_SIZE}` from a Rust
/// const that cannot import the Move one, so it is pinned against the compiled accessor.
#[test]
fn the_indexer_zone_size_is_the_compiled_one() {
    let root = repo_root();
    let math = load_modules(&root.join("packages/move-math/build/aresrpg_math/bytecode_modules"));
    let module = math
        .get("zone_math")
        .expect("zone_math is part of the math build");

    let accessor = module
        .function_defs()
        .iter()
        .find(|def| {
            let handle = module.function_handle_at(def.function);
            module.identifier_at(handle.name).as_str() == "zone_size"
        })
        .expect("zone_math::zone_size is the constant's only public witness");
    let code = &accessor.code.as_ref().expect("zone_size has a body").code;

    // the accessor is `LdConst(ZONE_SIZE); Ret` — any other shape means the constant
    // moved and this gate can no longer speak for it
    let [Bytecode::LdConst(index), Bytecode::Ret] = code[..] else {
        panic!("zone_math::zone_size is no longer a plain constant load: {code:?}")
    };
    let constant = module.constant_at(index);
    assert_eq!(constant.type_, Sig::U32, "zone_size returns a u32");
    let bytes: [u8; 4] = constant
        .data
        .as_slice()
        .try_into()
        .expect("a u32 constant is four bytes");

    assert_eq!(
        u32::from_le_bytes(bytes),
        crate::events::ZONE_SIZE,
        "events.rs ZONE_SIZE drifted from zone_math::ZONE_SIZE — resync it, \
         every evt:zone channel is derived from it"
    );
}

#[test]
fn character_creation_revenue_is_the_authored_price() {
    let root = repo_root();
    let source = std::fs::read_to_string(root.join("packages/move/sources/character.move"))
        .expect("character.move is readable");
    let declaration = source
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix("const PRICE: u64 = "))
        .and_then(|value| value.split_once(';').map(|(literal, _)| literal))
        .expect("character::PRICE keeps its canonical declaration");
    let price = declaration
        .replace('_', "")
        .parse::<u64>()
        .expect("character::PRICE is a u64 literal");
    assert_eq!(
        price,
        crate::analytics::CHARACTER_CREATION_MIST,
        "admin character revenue drifted from character::PRICE"
    );
}

#[test]
fn every_emitted_move_event_is_routed_or_deferred() {
    let mut emitted: Vec<(String, String)> = vec![];
    for sources in [
        repo_root().join("packages/move-math/sources"),
        repo_root().join("packages/move-combat/sources"),
        repo_root().join("packages/move/sources"),
        repo_root().join("packages/seed/sources"),
        repo_root().join("packages/kares/sources"),
        repo_root().join("packages/rewards/sources"),
    ] {
        for entry in std::fs::read_dir(&sources).expect("listing move sources") {
            let path = entry.expect("dir entry").path();
            if path.extension().is_none_or(|e| e != "move") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("reading move source");
            let module = text
                .lines()
                .find_map(|line| {
                    line.trim()
                        .strip_prefix("module aresrpg_math::")
                        .or_else(|| line.trim().strip_prefix("module aresrpg_combat::"))
                        .or_else(|| line.trim().strip_prefix("module aresrpg::"))
                        .or_else(|| line.trim().strip_prefix("module aresrpg_seed::"))
                        .or_else(|| line.trim().strip_prefix("module aresrpg_kares::"))
                        .or_else(|| line.trim().strip_prefix("module aresrpg_rewards::"))
                        .map(|rest| rest.trim_end_matches(';').to_string())
                })
                .unwrap_or_else(|| panic!("no module decl in {}", path.display()));
            let mut rest = text.as_str();
            while let Some(at) = rest.find("event::emit(") {
                rest = &rest[at + "event::emit(".len()..];
                let name: String = rest
                    .trim_start()
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect();
                assert!(
                    !name.is_empty(),
                    "unparseable event::emit in {}",
                    path.display()
                );
                emitted.push((module.clone(), name));
            }
        }
    }
    assert!(!emitted.is_empty(), "no events found — wrong sources path?");

    for (module, name) in &emitted {
        let routed = crate::events::ROUTED
            .iter()
            .any(|(m, n)| m == module && n == name);
        let deferred = DEFERRED_EVENTS
            .iter()
            .any(|(m, n)| m == module && n == name);
        assert!(
            routed || deferred,
            "`{module}::{name}` is emitted on-chain but neither routed (events.rs) nor on \
             the deferred list (gates.rs) — a new event nobody wired is a silent gap"
        );
    }
    // the reverse direction: a routed event that no longer exists is dead code
    for (module, name) in crate::events::ROUTED {
        assert!(
            emitted.iter().any(|(m, n)| m == module && n == name),
            "`{module}::{name}` is routed but no Move source emits it — dead route?"
        );
    }
}

/// One mirror field's Rust type, spelled the way `layout_line` renders the Move one — the
/// two vocabularies meet here, once, instead of in every reader's head.
fn rust_as_move(ty: &str, module: &str) -> String {
    let ty = ty.replace(' ', "");
    match ty.as_str() {
        "Id" => "object::ID".to_string(),
        "Addr" => "address".to_string(),
        "String" => "string::String".to_string(),
        "bool" | "u8" | "u16" | "u32" | "u64" | "u128" => ty,
        _ => {
            if let Some(inner) = ty.strip_prefix("Vec<").and_then(|t| t.strip_suffix('>')) {
                format!("vector<{}>", rust_as_move(inner, module))
            } else if let Some(inner) = ty.strip_prefix("Option<").and_then(|t| t.strip_suffix('>'))
            {
                format!("option::Option<{}>", rust_as_move(inner, module))
            } else if ty == "RolledDrop" {
                "combat::RolledDrop".to_string()
            } else {
                // a value type of the event's own module
                format!("{module}::{ty}")
            }
        }
    }
}

/// The fields one struct declares in the compiled bytecode, IN ORDER: `name: type`.
fn declared_fields(
    modules: &BTreeMap<String, CompiledModule>,
    module_name: &str,
    datatype: &str,
) -> Vec<String> {
    let module = modules
        .get(module_name)
        .unwrap_or_else(|| panic!("module `{module_name}` is not in the compiled package"));
    for def in &module.struct_defs {
        let handle = module.datatype_handle_at(def.struct_handle);
        if module.identifier_at(handle.name).as_str() != datatype {
            continue;
        }
        let StructFieldInformation::Declared(fields) = &def.field_information else {
            panic!("{module_name}::{datatype} is native?");
        };
        return fields
            .iter()
            .map(|f| {
                format!(
                    "{}: {}",
                    module.identifier_at(f.name),
                    render(module, &f.signature.0)
                )
            })
            .collect();
    }
    panic!("{module_name}::{datatype} is not a struct in the compiled package");
}

/// BCS is positional and the event decoder is a hand-written mirror: a mirror missing a field
/// reads the next field's bytes and stops the whole pipeline. This compares each mirror with
/// the bytecode; the snapshot gate only compares Move with Move.
#[test]
fn every_event_mirror_matches_the_compiled_field_order() {
    let game = load_modules(&repo_root().join("packages/move/build/aresrpg/bytecode_modules"));
    for (module, name, mirrored) in crate::events::ROUTED_FIELDS {
        let declared = declared_fields(&game, module, name);
        let mirror = mirrored
            .iter()
            .map(|(field, ty)| format!("{field}: {}", rust_as_move(ty, module)))
            .collect::<Vec<_>>();
        assert_eq!(
            declared, mirror,
            "EVENT MIRROR DRIFT — `events.rs` decodes `{module}::{name}` as {mirror:?} \
             while the compiled event declares {declared:?}. BCS is positional AND \
             width-sensitive: this mirror poisons every checkpoint carrying the event. \
             Resync the mirror."
        );
    }
}

/// A `PurchaseCap` handed to an arbitrary caller can be burned, permanently locking the listed
/// asset. Only the two withdraw doors may return one: they hand the caller their own cap back.
#[test]
fn only_the_own_cap_withdraw_doors_return_a_purchase_cap() {
    const ALLOWED: &[&str] = &["trade_take_item", "trade_recover_item"];
    let sources = repo_root().join("packages/move/sources");
    let mut leaks = vec![];
    for entry in std::fs::read_dir(&sources).expect("listing move sources") {
        let path = entry.expect("dir entry").path();
        if path.extension().is_none_or(|e| e != "move") {
            continue;
        }
        let text = std::fs::read_to_string(&path).expect("reading move source");
        // Split on public/entry declarations; `public(package)` is internal and exempt.
        let mut rest = text.as_str();
        while let Some(at) = rest
            .find("public fun ")
            .map(|i| (i, 11))
            .or_else(|| rest.find("entry fun ").map(|i| (i, 10)))
        {
            let (index, keyword_len) = at;
            rest = &rest[index + keyword_len..];
            let name: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            // the signature ends at the body brace; returns sit between `)` and `{`
            let Some(body) = rest.find('{') else { break };
            let signature = &rest[..body];
            if signature.contains("PurchaseCap")
                && signature
                    .rsplit(')')
                    .next()
                    .is_some_and(|ret| ret.contains("PurchaseCap"))
                && !ALLOWED.contains(&name.as_str())
            {
                leaks.push(format!("{}::{name}", path.display()));
            }
        }
    }
    assert!(
        leaks.is_empty(),
        "PURCHASE-CAP LEAK — these public doors return a PurchaseCap an attacker can burn \
         to permanently lock the listed asset: {leaks:?}. Consume the cap inside the door \
         (purchase_with_cap) and return the asset + TransferRequest instead."
    );
}

#[test]
fn typescript_vocabularies_match_the_indexer() {
    use crate::leaderboards::Metric;
    let protocol = include_str!("../../protocol/src/leaderboards.ts");
    let vocabulary = include_str!("../../immutable/src/leaderboards.ts");
    assert!(
        protocol.contains("export { LEADERBOARD_METRICS } from '@aresrpg/immutable/leaderboards'")
    );
    for metric in [
        Metric::Xp,
        Metric::Kills,
        Metric::Dungeons,
        Metric::Jobs,
        Metric::Marketplace,
        Metric::Kolizeum,
        Metric::Zones,
        Metric::Feeding,
        Metric::Gathering,
    ] {
        assert!(vocabulary.contains(&format!("'{}'", metric.key())));
    }
    let prices = include_str!("../../protocol/src/market_prices.ts");
    assert!(prices.contains(&format!(
        "MARKET_PRICE_RETENTION_DAYS = {}",
        crate::market_prices::RETENTION_DAYS
    )));
}
