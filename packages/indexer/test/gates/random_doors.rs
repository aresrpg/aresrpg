// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
use move_binary_format::file_format::{
    CompiledModule, Signature, SignatureIndex, SignatureToken as Sig, Visibility,
};
use sui_indexer_alt_framework::types::SUI_FRAMEWORK_ADDRESS;

use std::collections::BTreeMap;
use std::process::Command;

use super::{load_modules, repo_root};

fn contains_framework_type(module: &CompiledModule, token: &Sig, name: &str) -> bool {
    match token {
        Sig::Reference(inner) | Sig::MutableReference(inner) | Sig::Vector(inner) => {
            contains_framework_type(module, inner, name)
        }
        Sig::Datatype(index) => {
            let datatype = module.datatype_handle_at(*index);
            let owner = module.module_handle_at(datatype.module);
            *module.address_identifier_at(owner.address) == SUI_FRAMEWORK_ADDRESS
                && module.identifier_at(owner.name).as_str() == "random"
                && module.identifier_at(datatype.name).as_str() == name
        }
        Sig::DatatypeInstantiation(instance) => {
            contains_framework_type(module, &Sig::Datatype(instance.0), name)
                || instance
                    .1
                    .iter()
                    .any(|token| contains_framework_type(module, token, name))
        }
        _ => false,
    }
}

fn assert_random_boundary(module: &CompiledModule) -> usize {
    let mut checked = 0;
    for definition in module.function_defs() {
        if !definition.is_entry && definition.visibility != Visibility::Public {
            continue;
        }
        let function = module.function_handle_at(definition.function);
        let parameters = &module.signature_at(function.parameters).0;
        let name = module.identifier_at(function.name);
        assert!(
            !parameters.iter().any(|token| contains_framework_type(
                module,
                token,
                "RandomGenerator"
            )),
            "{name}: callers must not supply an entropy generator"
        );
        if !parameters
            .iter()
            .any(|token| contains_framework_type(module, token, "Random"))
        {
            continue;
        }
        checked += 1;
        assert!(
            definition.is_entry && definition.visibility == Visibility::Private,
            "{name}: Random doors must be private entry functions"
        );
        assert!(
            module.signature_at(function.return_).0.is_empty(),
            "{name}: Random doors must retain outcomes, not return inspectable values"
        );
    }
    checked
}

// Reuse the package-size gate's isolated production build. Unit-test compilation promotes
// private entry visibility, so ABI checks must never inspect its cached bytecode.
fn assert_production_random_boundaries(modules: &BTreeMap<String, CompiledModule>) {
    let checked: usize = modules.values().map(assert_random_boundary).sum();
    assert!(checked > 0, "No Random entrypoints were checked");
    let original = &modules["api"];
    let index = original
        .function_defs()
        .iter()
        .position(|definition| {
            let function = original.function_handle_at(definition.function);
            definition.is_entry
                && original
                    .signature_at(function.parameters)
                    .0
                    .iter()
                    .any(|token| contains_framework_type(original, token, "Random"))
        })
        .expect("api has Random entrypoints");
    let mut exposed = original.clone();
    exposed.function_defs[index].visibility = Visibility::Public;
    assert!(std::panic::catch_unwind(|| assert_random_boundary(&exposed)).is_err());
    let mut returning = original.clone();
    let signature = SignatureIndex(returning.signatures.len().try_into().unwrap());
    returning.signatures.push(Signature(vec![Sig::U64]));
    let handle = returning.function_defs[index].function.0 as usize;
    returning.function_handles[handle].return_ = signature;
    assert!(std::panic::catch_unwind(|| assert_random_boundary(&returning)).is_err());
}

#[test]
fn production_packages_keep_size_and_random_boundaries() {
    // The 2026-08-30 transaction rejected 97,048 raw bytes as a 102,559-byte package
    // object. The shared 96,000-byte ceiling preserves roughly 1 KB below Sui's 102,400-byte
    // object limit after the observed linkage/type-origin metadata.
    let max_bytecode_bytes =
        serde_json::from_str::<serde_json::Value>(include_str!("../../../../move-packages.json"))
            .expect("parsing the shared package-size limit")["max_bytecode_bytes"]
            .as_u64()
            .expect("package-size limit is a u64");

    let root = repo_root();
    let packages = [
        ("math", "packages/move-math", "aresrpg_math"),
        ("control", "packages/control", "aresrpg_control"),
        ("combat", "packages/move-combat", "aresrpg_combat"),
        ("seed", "packages/seed", "aresrpg_seed"),
        ("rewards", "packages/rewards", "aresrpg_rewards"),
        ("game", "packages/move", "aresrpg"),
    ];
    for (slot, package_path, package_name) in packages {
        let install_dir =
            std::env::temp_dir().join(format!("aresrpg-size-gate-{}-{slot}", std::process::id()));
        if install_dir.exists() {
            std::fs::remove_dir_all(&install_dir).expect("removing stale package-size build");
        }
        let output = Command::new("sui")
            .args([
                "move",
                "build",
                "--path",
                package_path,
                "--build-env",
                "testnet",
                "--warnings-are-errors",
                "--install-dir",
            ])
            .arg(&install_dir)
            .current_dir(&root)
            .output()
            .expect("running a production package-size build");
        assert!(
            output.status.success(),
            "{slot} production package-size build failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let build_dir = install_dir.join(format!("build/{package_name}/bytecode_modules"));
        let bytes = std::fs::read_dir(&build_dir)
            .unwrap_or_else(|error| panic!("listing {slot} bytecode modules: {error}"))
            .map(|entry| entry.expect("bytecode module entry").path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "mv"))
            .map(|path| {
                std::fs::metadata(&path)
                    .expect("reading bytecode module metadata")
                    .len()
            })
            .sum::<u64>();
        if slot == "game" {
            assert_production_random_boundaries(&load_modules(&build_dir));
        }
        std::fs::remove_dir_all(&install_dir).expect("removing package-size build");
        assert!(
            bytes <= max_bytecode_bytes,
            "{slot} bytecode is {bytes} bytes; the shared {max_bytecode_bytes}-byte limit \
             leaves room for Sui package metadata under the 102,400-byte object limit"
        );
    }
}
