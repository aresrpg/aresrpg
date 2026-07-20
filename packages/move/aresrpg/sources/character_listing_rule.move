/// CHARACTER_LISTING_RULE — the anti-name-squat LEVEL GATE on character resale (§17.30 / DECISIONS 2026-07-08:
/// "LISTING a character requires level ≥ 30 — squatting now costs playing"). A kiosk TRANSFER-POLICY rule on the
/// `TransferPolicy<Character>`, mirroring the Mysten `royalty_rule` / `kiosk_lock_rule` receipt pattern exactly:
/// the creator ADDs it ONCE at ceremony, and every secondary PURCHASE must satisfy its receipt or the framework's
/// `confirm_request` aborts. This is the SINGLE consumer of the `config::listing_level_gate` dial (until now the
/// dial was built + tested but wired to nothing — the audit's MISSING-enforcement row).
///
/// HONEST LIMIT — ENFORCED AT PURCHASE, NOT AT LIST. The Sui framework exposes NO list-time hook that can read
/// game state: native `kiosk::list` is generic (it cannot see a character's level), and a transfer policy fires
/// ONLY at `confirm_request` (purchase). So LISTING a below-gate character is not itself blocked — but NO SALE CAN
/// COMPLETE below the gate, which is ECONOMICALLY EQUIVALENT: a squatter may list a level-1 character, yet nobody
/// can ever buy it, so the name stays bound to a worthless object with no exit. This is the ONLY enforceable home
/// for the gate; there is no cleaner list-time mechanism to build instead (verified against the kiosk framework +
/// the three linked Mysten rules — none gate `list`).
///
/// LIVE DIAL — the gate reads `GameConfig.listing_level_gate` at prove time (NOT baked into the rule `Config`), so
/// the admin retunes the threshold with no policy re-attach (single home of the number stays on GameConfig). The
/// character's level is the same progression view the world gate + combat snapshot read (`character_link::level`):
/// the STORED progression level once a fight has granted xp, else the base-experience curve — a fresh, never-played
/// character is level 1. So a name-squatter must actually PLAY the character to the gate before any buyer can
/// complete a purchase.
///
/// EVASION GUARD — `prove_level` asserts the proven `&Character` IS the one being transferred
/// (`object::id(character) == transfer_policy::item(request)`), so a buyer purchasing a low-level squatted
/// character cannot satisfy the receipt by passing a DIFFERENT high-level character they happen to own (the
/// royalty-evasion / wrong-object class, closed by construction like the extract seam's pledge-id check).
///
/// CEREMONY — the `TransferPolicyCap<Character>` holder adds this rule to the Character policy at the coordinated
/// publish, alongside the three Mysten rules (royalty / kiosk_lock / personal_kiosk), while the package is DARK:
///
///     character_listing_rule::add(&mut character_policy, &character_policy_cap);
///
/// It folds into `docs/MAINNET_CEREMONY_RUNBOOK.md §3` as the 4th Character-policy rule (an OPEN doc item for the
/// lead — this module cannot edit the runbook). A secondary buy PTB then satisfies FOUR receipts:
/// `royalty_rule::pay`, `kiosk_lock_rule::prove`, `personal_kiosk_rule::prove`, and this `prove_level` — all four
/// before `confirm_request`. The shop's initial mint-lock bypasses `confirm_request`, so the gate never blocks a
/// first sale (only resale) — spec-correct, a freshly-minted character is the creator's own to lock.
module aresrpg::character_listing_rule;

use aresrpg::{character_link, config::GameConfig, fight_marker};
use aresrpg::character::Character;
use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};

// ╔════════════════ [ Errors (teach, don't reject) ] ═════════════════════════ ]

const ELevelTooLow: u64 = 101; // prove_level: the character's level is below the live GameConfig listing gate
const EWrongCharacter: u64 = 102; // prove_level: the proven character is not the one being purchased (evasion guard)
const EUnfinishedBusiness: u64 = 103; // prove_level: the character carries an unresolved PvM fight (fight_marker) — the holder must OPEN the result before any sale completes (the cross-party-brick closure)

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The rule witness that authorises this policy rule (Mysten `royalty_rule::Rule` shape). `drop` only — it names
/// the rule to the framework's `add_rule` / `add_receipt`; it is never stored or transferred.
public struct Rule has drop {}

/// The rule's on-policy config — EMPTY on purpose: the gate reads the LIVE dial off `GameConfig` at prove time,
/// so nothing is baked in here and a dial change needs no re-attach. `store + drop` as the framework requires.
public struct Config has store, drop {}

// ╔════════════════ [ Creator action — ADD the rule (cap-gated; ceremony, while dark) ] ═ ]

/// Attach the level gate to the Character `policy`. Authority IS the `TransferPolicyCap<Character>` — the framework
/// `add_rule` asserts the cap matches the policy and that the rule is not already present. Mirrors
/// `royalty_rule::add` / `kiosk_lock_rule::add`: one line, cap-gated, no runtime config.
public fun add(policy: &mut TransferPolicy<Character>, cap: &TransferPolicyCap<Character>) {
  transfer_policy::add_rule(Rule {}, policy, cap, Config {});
}

// ╔════════════════ [ Buyer action — PROVE the level to unblock confirm_request ] ═ ]

/// Prove `character` meets the live `GameConfig.listing_level_gate` and add the receipt that unblocks
/// `confirm_request`. Aborts `EWrongCharacter` if the proven character is not the one being transferred (the
/// evasion guard — a buyer cannot substitute a different high-level character they own) and `ELevelTooLow` if the
/// character's level is under the current gate. Called by the secondary-purchase PTB after `kiosk::purchase` hands
/// over the character by value; the buyer already holds `&Character`, so no extra fetch is needed.
public fun prove_level(character: &Character, config: &GameConfig, request: &mut TransferRequest<Character>) {
  assert!(object::id(character) == transfer_policy::item(request), EWrongCharacter);
  assert!(character_link::level(character) >= config.listing_level_gate(), ELevelTooLow);
  // UNFINISHED BUSINESS: a marked character (unopened PvM result / live seat) cannot complete
  // a SALE — only the seller can open its result, so letting the sale through would brick the buyer forever.
  assert!(fight_marker::is_unmarked(character), EUnfinishedBusiness);
  transfer_policy::add_receipt(Rule {}, request);
}
