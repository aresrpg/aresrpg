// One-time post-publish setup: create the standard TransferPolicy + the AresRPG protected policy
// for Character and Item, and attach (1) the Mysten royalty rule that enforces the trading fee and
// (2) the Mysten personal_kiosk_rule that enforces personal-kiosk-only ownership for our NFTs.
//   PRIVATE_KEY=<sponsor> ARESRPG_PACKAGE_ID=<pkg> PUBLISHER=<pub> VERSION=<ver> bun run scripts/setup_policies.js
//
// The bare TransferPolicy alone captures nothing. We attach to BOTH policies:
//   • `kiosk::royalty_rule` (Config { amount_bp, min_amount }) — every real player-to-player trade pays the
//     fee into the policy balance.
//   • `kiosk::personal_kiosk_rule` (by design) — the item can ONLY be locked in a PERSONAL kiosk, so
//     ownership is fixed (soulbound-via-personal-kiosk). This GUARANTEES the recall_character/start_fight
//     PersonalKioskCap assumption universally: no regular-kiosk edge case can hold our NFT after a trade.
// The buyer routes through @mysten/kiosk `KioskTransaction.purchaseAndResolve()`, which auto-resolves BOTH
// rules (resolveRoyaltyRule + resolvePersonalKioskRule). The game's own extraction stays fee-/rule-free by
// design via the separate `protected_policy` (its TransferPolicy is empty → confirm_request passes trivially).
// The TransferPolicyCap is kept by the runner so the accrued balance can later be withdrawn.
import { KioskClient } from '@mysten/kiosk'
import { Transaction } from '@mysten/sui/transactions'

import { NETWORK, keypair, sui_client } from './client.js'

const { ARESRPG_PACKAGE_ID: PKG, PUBLISHER, VERSION } = process.env
if (!PKG || !PUBLISHER || !VERSION)
  throw new Error('need ARESRPG_PACKAGE_ID, PUBLISHER, VERSION')

// BARE mode (BARE=1): create the base TransferPolicy + AresRPG protected policy WITHOUT attaching the
// royalty / personal_kiosk rules. Attaching those rules to a freshly published package's own type
// currently aborts InvalidLinkage (T93/T98) — so every release since T62 ships BARE. Personal-kiosk
// enforcement is upheld by the entry-fns' &PersonalKioskCap (recall/fight/dungeon/equip), NOT the
// policy rule; the royalty fee is deferred until the linkage issue is resolved (mainnet milestone).
const BARE = process.env.BARE === '1' || process.env.BARE_POLICIES === '1'

// Trading fee: 10% royalty (1000 basis points), spec'd in docs/MVP-PLAN.md. FLAT floor `min_amount` = 0.01 SUI
// (10_000_000 MIST): royalty_rule charges max(price × bp/10000, min_amount), so a 0-default let a price-0/dust
// listing dodge royalty entirely (advisor HIGH, 2026-07-11 — fixed identically in ceremony_lib.mjs, the LIVE path).
// The floor only binds below a 0.1-SUI sale; real gear/character trades pay the 10% rate. Both overridable via env.
const FEE_BP = Number(process.env.ROYALTY_FEE_BP ?? 1000)
const MIN_FEE = BigInt(process.env.ROYALTY_MIN_FEE ?? 10_000_000)
if (!Number.isInteger(FEE_BP) || FEE_BP < 0 || FEE_BP > 10_000)
  throw new Error(
    'ROYALTY_FEE_BP must be an integer basis-point value in [0, 10000]'
  )

// The kiosk-rules packages live in Mysten's published apps, which differ per network. Resolve them via
// KioskClient (seamless testnet↔mainnet); allow explicit overrides. NOTE: @mysten/kiosk 1.3.3 DROPPED the
// `Network` enum export — KioskClient now takes a plain string network ('testnet' | 'mainnet').
const kiosk_client = new KioskClient({
  client: sui_client,
  network: NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
})
const KIOSK_PKG =
  process.env.KIOSK_PKG ?? kiosk_client.getRulePackageId('royaltyRulePackageId')
// personal_kiosk_rule lives in the SAME Mysten kiosk-apps package as personal_kiosk.
const PERSONAL_KIOSK_PKG =
  process.env.PERSONAL_KIOSK_PKG ??
  kiosk_client.getRulePackageId('personalKioskRulePackageId')

const me = keypair.getPublicKey().toSuiAddress()
const tx = new Transaction()

for (const T of ['character::Character', 'item::Item']) {
  const type = `${PKG}::${T}`
  const [policy, cap] = tx.moveCall({
    target: '0x2::transfer_policy::new',
    typeArguments: [type],
    arguments: [tx.object(PUBLISHER)],
  })
  // Attach the rules BEFORE sharing — once shared we no longer have a mutable reference.
  // After this, a bare `kiosk.purchase` aborts (missing receipts); buyers must pay the fee AND lock into a
  // personal kiosk. Both receipts are auto-resolved by @mysten/kiosk `purchaseAndResolve()`.
  // SKIPPED in BARE mode (the current-known-good path — see the BARE note above).
  if (!BARE) {
    tx.moveCall({
      target: `${KIOSK_PKG}::royalty_rule::add`,
      typeArguments: [type],
      arguments: [policy, cap, tx.pure.u16(FEE_BP), tx.pure.u64(MIN_FEE)],
    })
    // personal_kiosk_rule (by design): the NFT can ONLY ever be locked in a PERSONAL kiosk → ownership is
    // fixed. No config args. Enforced at confirm_request (purchase); lock/mint/extract are unaffected.
    tx.moveCall({
      target: `${PERSONAL_KIOSK_PKG}::personal_kiosk_rule::add`,
      typeArguments: [type],
      arguments: [policy, cap],
    })
    // AresRPG per-type listing gate (2026-07-11): character → character_listing_rule (§17.30 level gate); item →
    // item_listing_rule (blocks amount-0 ghost-stack listings). Type-specific non-generic fns (no typeArguments).
    // Matches the LIVE ceremony.mjs policyPTB. NOTE: this standalone ships BARE by default (T93/T98 InvalidLinkage
    // on a fresh publish — see the BARE note); ceremony.mjs is the real publish path.
    tx.moveCall({
      target: `${PKG}::${T.split('::')[0]}_listing_rule::add`,
      arguments: [policy, cap],
    })
  }
  tx.moveCall({
    target: '0x2::transfer::public_share_object',
    typeArguments: [`0x2::transfer_policy::TransferPolicy<${type}>`],
    arguments: [policy],
  })
  // Keep the cap: it owns the right to withdraw accrued fees from the policy balance.
  tx.transferObjects([cap], me)
  tx.moveCall({
    target: `${PKG}::protected_policy::mint_and_share_aresrpg_policy`,
    typeArguments: [type],
    arguments: [tx.object(PUBLISHER), tx.object(VERSION)],
  })
}

const result = await sui_client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showObjectChanges: true, showEffects: true },
})
await sui_client.waitForTransaction({ digest: result.digest })
console.log(
  'digest:',
  result.digest,
  '| status:',
  result.effects?.status?.status
)
if (BARE) {
  console.log(
    'mode: BARE (no royalty / personal_kiosk rules attached — T93/T98 InvalidLinkage path)'
  )
} else {
  console.log(
    'royalty rule:',
    `${KIOSK_PKG}::royalty_rule`,
    '| fee_bp:',
    FEE_BP,
    '| min_fee:',
    MIN_FEE.toString()
  )
  console.log(
    'personal_kiosk_rule:',
    `${PERSONAL_KIOSK_PKG}::personal_kiosk_rule (enforce personal-kiosk-only)`
  )
}

// Categorised policy-id map for the deployment.ts manifest (base TransferPolicy vs AresRPG protected,
// per NFT type). Explicit labels avoid a mislabel (the RING-vs-ring class of bug).
const created = (result.objectChanges || []).filter((c) => c.type === 'created')
const findPolicy = (kind, T) =>
  created.find(
    (c) =>
      c.objectType.startsWith(`${kind}<`) &&
      c.objectType.includes(`::${T}::`) &&
      c.objectType.endsWith('>')
  )?.objectId
const manifest = {
  CHARACTER_POLICY: findPolicy(
    '0x2::transfer_policy::TransferPolicy',
    'character'
  ),
  CHARACTER_PROTECTED_POLICY: findPolicy(
    `${PKG}::protected_policy::AresRPG_TransferPolicy`,
    'character'
  ),
  ITEM_POLICY: findPolicy('0x2::transfer_policy::TransferPolicy', 'item'),
  ITEM_PROTECTED_POLICY: findPolicy(
    `${PKG}::protected_policy::AresRPG_TransferPolicy`,
    'item'
  ),
}
console.log('POLICY MANIFEST:', JSON.stringify(manifest, null, 2))
console.log('all created objects:')
for (const c of created)
  console.log(' ', c.objectId, c.objectType.replaceAll(PKG, '<PKG>'))
