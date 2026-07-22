// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TransferPolicy stores TypeName values with DEFINING package ids. Those tags are the source of truth for WHICH
// rules a purchase must satisfy, but an upgraded package's defining id is not necessarily a legal Move-call target:
// Sui binds one upgraded version per package lineage and aborts InvalidLinkage when a PTB calls another version.
// Marketplace callers therefore validate the complete live rule set from `policy.rules`, then route Move calls
// through the release-config linkage targets supplied below. The pin is derived from the fresh core package's
// linkage table and atomically written by packages/move/scripts/stamp_all.mjs after publish/upgrade.

const BASE_MARKETPLACE_RULES = [
  'royalty_rule',
  'kiosk_lock_rule',
  'personal_kiosk_rule',
]

/** @param {string} package_id */
function normalize_package_id(package_id) {
  const hex = String(package_id).toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{1,64}$/.test(hex))
    throw new Error(
      `[marketplace_rules] invalid Sui package id ${JSON.stringify(package_id)}`,
    )
  return `0x${hex.padStart(64, '0')}`
}

/**
 * Read the TypeName strings out of either the `@mysten/kiosk` TransferPolicy shape (`rules: string[]`) or the
 * flattened on-chain shape (`rules: { contents: ({ name } | string)[] }`).
 * @param {{ id?: string, rules?: string[] | { contents?: ({ name?: string } | string)[] } }} policy
 * @returns {string[]}
 */
function policy_rule_types(policy) {
  const rules = Array.isArray(policy?.rules)
    ? policy.rules
    : policy?.rules?.contents
  if (!Array.isArray(rules) || !rules.length)
    throw new Error(
      `[marketplace_rules] TransferPolicy ${policy?.id ?? '<unknown>'} has no readable rule type tags`,
    )

  return rules.map(rule => {
    const type = typeof rule === 'string' ? rule : rule?.name
    if (!type)
      throw new Error(
        `[marketplace_rules] TransferPolicy ${policy?.id ?? '<unknown>'} contains a malformed rule tag`,
      )
    return type
  })
}

/**
 * Return the defining package named by exactly one `${package}::${module_name}::Rule` tag on `policy`.
 * This proves rule presence/identity; do not use the return value as an upgraded Kiosk-lineage call target.
 * @param {{ id?: string, rules?: string[] | { contents?: ({ name?: string } | string)[] } }} policy
 * @param {string} module_name
 */
export function policy_rule_package(policy, module_name) {
  const matches = policy_rule_types(policy).flatMap(type => {
    const parts = String(type).split('::')
    return parts.length === 3 && parts[1] === module_name && parts[2] === 'Rule'
      ? [normalize_package_id(parts[0])]
      : []
  })

  if (matches.length !== 1)
    throw new Error(
      `[marketplace_rules] TransferPolicy ${policy?.id ?? '<unknown>'} must contain exactly one ${module_name}::Rule tag (found ${matches.length})`,
    )
  return matches[0]
}

/**
 * Resolve every Move-call target for a marketplace policy confirmation. Rule tags prove the live policy actually
 * requires the three base receipts plus its type-specific listing receipt. Calls use the fresh linkage/core pins:
 * defining ids in TypeName tags can be older package versions and are not safe call targets after an upgrade.
 * @param {{
 *   policy: { id?: string, rules?: string[] | { contents?: ({ name?: string } | string)[] } },
 *   kiosk_rule_package_id: string,
 *   listing_rule_module: 'item_listing_rule' | 'character_listing_rule',
 *   listing_rule_package_id: string,
 * }} args
 */
export function resolve_marketplace_rule_targets({
  policy,
  kiosk_rule_package_id,
  listing_rule_module,
  listing_rule_package_id,
}) {
  for (const module_name of BASE_MARKETPLACE_RULES)
    policy_rule_package(policy, module_name)
  policy_rule_package(policy, listing_rule_module)

  const kiosk_rules = normalize_package_id(kiosk_rule_package_id)
  return {
    royalty_rule: kiosk_rules,
    kiosk_lock_rule: kiosk_rules,
    personal_kiosk_rule: kiosk_rules,
    listing_rule: normalize_package_id(listing_rule_package_id),
  }
}
