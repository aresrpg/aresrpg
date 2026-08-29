// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const empty_shared_pin = Object.freeze({ id: null, shared_version: null })

/** Republish retains only historical ledger namespaces and unrelated local facts. */
export const full_republish_pin_patch = Object.freeze({
  math_package: null,
  math_package_original: null,
  math_upgrade_cap: null,
  math_artifact_digest: null,
  control_package: null,
  control_package_original: null,
  control_upgrade_cap: null,
  control_artifact_digest: null,
  admin_cap: null,
  seed_package: null,
  seed_package_original: null,
  seed_upgrade_cap: null,
  seed_artifact_digest: null,
  content_root: empty_shared_pin,
  package: null,
  package_original: null,
  package_artifact_digest: null,
  kiosk_package: null,
  upgrade_cap: null,
  publisher: null,
  item_publisher: null,
  character_publisher: null,
  version: empty_shared_pin,
  loot_registry: empty_shared_pin,
  name_registry: empty_shared_pin,
  friend_registry: empty_shared_pin,
  template_registry: empty_shared_pin,
  item_policy: empty_shared_pin,
  character_policy: empty_shared_pin,
  item_protected_policy: empty_shared_pin,
  character_protected_policy: empty_shared_pin,
})
