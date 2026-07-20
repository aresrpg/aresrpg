import { bcs } from '@mysten/sui/bcs'
import { deriveObjectID, deriveDynamicFieldID } from '@mysten/sui/utils'

// The on-chain free-vs-paid character gate, read off-chain. The Move contract
// (`character::new_free`) claims a per-account derived object keyed on the account's ADDRESS
// (`FreeCharacterKey(address)`) the first time an account mints its FREE character. That claim writes a
// PERMANENT `Claimed` dynamic field on the shared `AresRoot` (the marker lives on the parent, so it
// survives even a later character delete — the derived object itself is deleted in `new_free`). A second
// free mint from the same account therefore aborts `EFreeCharacterClaimed` (109), FOR EVER.

/**
 * Reproduce `derived_object::exists(AresRoot, FreeCharacterKey(address))` off-chain: derive the
 * `FreeCharacterKey` object address (== `derived_object::derive_address`), then derive the permanent
 * `Claimed` dynamic-field id on `AresRoot` for that address. `getObject` of the returned id existing means
 * the account has ALREADY claimed its one free character.
 *
 * The server routes free-vs-paid on THIS (the actual on-chain claim), never on the live character count:
 * the count drops to 0 when a player deletes their only character, but the claim is permanent, so routing
 * by count would send a claimed-then-emptied account back to the FREE path -> abort 109 -> a permanent
 * create brick (free AND paid). Routing by the claim escapes that trap.
 *
 * Pure + deterministic (blake2b derivation, no I/O).
 *
 * @param {{ ares_root: string, package_id: string, owner: string }} params
 *   `package_id` is the TYPE-IDENTITY id of the `FreeCharacterKey` struct, i.e. the package version that
 *   INTRODUCED it (the #938 free-gate upgrade — currently `LATEST_PACKAGE_ID`, verified on-chain), NOT the
 *   original `PACKAGE_ID` that still identifies the older Character/Item types. A type identity is
 *   immutable, so this is the introducing version even after later upgrades, never whatever LATEST becomes.
 * @returns {string} the 0x object id of the account's free-claim `Claimed` marker on `AresRoot`
 */
export function free_character_claim_field_id({
  ares_root,
  package_id,
  owner,
}) {
  const derived_id = deriveObjectID(
    ares_root,
    `${package_id}::character::FreeCharacterKey`,
    bcs.Address.serialize(owner).toBytes(),
  )
  return deriveDynamicFieldID(
    ares_root,
    '0x2::derived_object::Claimed',
    bcs.Address.serialize(derived_id).toBytes(),
  )
}
