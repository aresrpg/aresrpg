# Content upgrades

Content is authored only in seed/. Published content is mutable until the one permanent freeze.

A content write changes chain truth immediately and emits `ContentWritten` as an audit trail.
There is no server-staleness protocol: gameplay is paused for the whole window, and the server and
frontend are deployed from the same edited repository. Restarting an old image is not a content
deployment.

## Immutable identities

These values never change after first publication:

- item: item_type and category;
- recipe: output_type;
- spell: name and class;
- mob: mob_type;
- world: world name;
- city: city slug;
- dungeon: dungeon slug;
- Mastery offer: statless item type and redemption cost.

Retiring a row removes every live reference to it. A derived object is not deleted and recreated
under the same identity.

Every player spell always has exactly six levels.

## Mutable content

- Items: name, level, pet foods, stats, damages, and stackable behavior.
- Recipes: ingredient item types, quantities, and derived/fallback job. Removing an authored
  recipe disables its existing chain object; re-adding the same output reactivates it.
- Spells: all six level payloads. The class ladder slot stays fixed.
- Mobs: full authored payload.
- Worlds: entry level, mobs, resources, biome map, cities, city anchors, structures, and dungeon references.
- Dungeons: key and ordered room compositions. Do not reorder or shrink rooms while any character
  has an active run in that dungeon; a live run keeps its room number and committed seed, not a
  room snapshot.
- Boards: add, replace, reorder, and remove.
- Mastery offers: enabled state. Existing costs cannot change; reconciliation checks the authored
  cost against the immutable chain value. Removing an offer disables it without rewriting its price.
  Either earned points or burned KARES mint the same statless item. Loot boxes retain their current table.

Stackable consumables and loot boxes use their template's current behavior. Unstackable equipment
keeps the stats and damages rolled when it was minted. Running fights keep their mob and board
snapshots.

## Upgrade checklist

1. Edit the canonical files under seed/.
2. Run seed validation.
3. Reject accidental immutable-identity changes.
4. Open /demo#boards and inspect every generated board.
5. Run the relevant package tests, Move builds/tests, indexer parity, lint, and type checks.
6. Confirm no wagered fight would be unfairly changed by the planned spell or mob update.
7. Before starting source-bound publication, build every package for the selected network with
   the pinned Sui compiler and review its `Move.lock` resolution. First-mainnet builds add mainnet
   lock entries; those changes must be settled before the operator captures its source identity.
   If Move changed, prepare its compatible upgrades or fresh publication and push the resulting
   hardcoded pins to `edge` before versioning.
8. From clean, current `edge`, run `bun pm version patch` (or the intended semver level). Resume the
   operator to dispatch preparation CI on that exact tag. Wait for changed backend images and the
   staged production Vercel build.
9. Confirm the retained preparation manifest names that exact SHA, package lineages, image
   versions/digests, and staged Vercel URL. Unchanged images retain the previous certified digest;
   the operator and Helm consume those digests, never mutable semver aliases.
10. Pause gameplay when content or package work requires it.
11. Apply content batches in deterministic order.
12. Record every successful transaction digest.
13. Never retry a transaction that executed and returned a digest.
14. If a batch stops, inspect chain state and resume only the missing rows.
15. At the operator's APPLY boundary, review the retained Helm diff and generated Kubernetes values.
    Publish those exact values before continuing. The operator checks the published inputs against
    its retained archive and applies from a private snapshot. Changed inputs or diffs stop recovery.
    A certified app-only release skips Kubernetes; an unknown baseline requires review. The composite
    game+seed projection identity decides whether the store is retained or replaced for a repin.
16. At ACTIVATE, manually run the production-activation workflow with the displayed tag, version,
    network, preparation run, and request ID. It promotes the staged Vercel deployment without rebuilding,
    verifies production, and publishes the draft release. The operator observes that exact successful
    activation before continuing.
17. Exercise one affected action against chain truth.
18. Resume gameplay.

## Partial failures

A failed simulation or wallet rejection spends no gas and may be corrected normally.

An executed failure has a digest and may have spent gas. Do not automatically retry it. Read the
receipt and current chain objects, then compose only work still missing.

Board synchronization reads the chain catalog length. It replaces shared indexes, appends missing
indexes, and removes the tail. `pins.json` records every derived address and authored fingerprint
under its Registry root; the chain catalog length still decides board shape.

## Direct giftcard distribution

Author each entitlement once in `seed/content/airdrop.json` under `giftcards`.
Use `giftcard_batches` for one item/amount sent to a recipient list; the SDK derives one voucher identity per address.
Use `custody` for the initial recipient or operator wallet. Publication already batches creation and transfer.
Set `network` to `mainnet` or `testnet` when an allocation belongs to only one network; omitted means both.
In the operator, **Prepare holder gifts** reads `seed/content/snapshots/collections.json`, saves each
collection at one mainnet checkpoint, and appends its recipient batches to `airdrop.json`. It performs no
chain writes. Existing snapshot files are reused, and an existing gift identity cannot change its
recipient. Review the prepared rows, then use normal operator content sync to mint and send them.
An optional collection `limit` selects that many verified holders by SHA-256 of `batch_id:address`,
independently of input order. Both Suifren collections are capped at 500. Unresolved custody is recorded
in the snapshot; it blocks uncapped distributions and is excluded from capped selection.
Prime Machin object destinations are mainnet-only; testnet does not contain those NFTs.
For later delivery, prepare a JSON manifest of `{ "id": "0xGiftcard", "recipient": "0xWalletOrNFT" }` rows.
The object ID is the destination when sending to a Prime Machin; do not resolve it to the current holder.
Only send to object types whose receiving interface has been verified. Prime Machin receiving uses
Studio Mirai's interface and its current KOTO fee; `/claim` imports the resulting wallet-held voucher.

```bash
bun scripts/snapshot_sui_holders.mjs --type <collection-type> --recipient object --output /tmp/recipients.json
bun scripts/send_giftcards.mjs --network testnet --manifest /tmp/gifts.json
bun scripts/send_giftcards.mjs --network testnet --manifest /tmp/gifts.json --execute --receipts /tmp/gift-receipts.jsonl
```

The snapshot returns a recipient list; pair it with the intended already-issued giftcards in the manifest.
The sender defaults to simulation using the configured Sui CLI environment and signer. It validates
canonical type and signer custody before sending any batch. Production execution still requires
explicit owner approval. Execution creates a new private journal and records intent before each
submission, then the returned receipt. A lost response leaves `submitting`; inspect chain custody and
transaction history before preparing a manifest containing only verified unsent objects. Never reuse
the original manifest blindly or automatically retry an executed failure.

## Printing giftcards

Giftcard QR images are bearer secrets. Generate them only after the authored vouchers are published
and owned by the signer address authored as their `custody`. A `pins.publisher` value is a Sui
Publisher capability object ID, never a wallet address. Run `aresrpg-operator`, choose
**Print Sui Crate giftcards**, review the action, press Enter, and confirm the single Slush
transaction in the web signer.

The operator prepares a private recovery manifest and one printable PNG per voucher before
touching chain state, then marks the manifest live with the certified digest. It resumes the same
prepared links when every voucher remains in custody, recovers a completed common transaction, and
refuses mixed or unknown custody instead of generating replacement secrets.
Each QR opens AresRPG `/gift`; the zkSend key stays in the URL fragment, survives Google login in
session storage, and is never sent to the application server.
The output lives under the operator's ignored, owner-only `.operator/branches/<branch>/giftcards/`
directory. Never upload it before the cards are intentionally distributed. If execution returns a
digest and fails, inspect that digest and current object custody; never retry automatically.

## Adding and editing worlds

The ordered rows in `seed/content/worlds.json` are the world roster. Add a row there to add a world;
content synchronization creates its deterministic `WorldContent` and gameplay `World` together.
Edit an existing row to update that world's living content. Its `world` slug is permanent, so a
rename is a new world identity. Removed rows are retired from the authored roster; synchronization
does not delete existing shared objects.

## Rollback

There is no chain rollback. Restore the previous Git content and publish it as another content
upgrade using the same checklist.

Already minted unstackable items and already created fights remain unchanged by design.

## Package upgrades and republishing

Package deployment follows the dependency graph:

    math → combat
    math + control → seed
    independent kares
    math + control + combat + seed + kares → core

Upgrade only a package whose desired artifact changed. Reuse unchanged published dependencies.

Republish abandons every active package lineage, publishes fresh math, control, combat, seed, and
core packages in dependency order, and creates a fresh empty Registry. Historical content ledgers remain
namespaced by their old Registry roots for audit and recovery, but no active package or content
object is reused. Compatibility belongs only to Upgrade; Republish never attempts selective reuse.

KARES is outside that five-package game lifecycle. A game republish must retain its currency,
offering, combat pot and staking originals, objects and balances. Publish KARES independently through the
operator before preparing a game package that imports it.

## KARES offering operations

The operator owns publication, atomic offering configuration and sealing, one-time start, settlement, treasury vesting
claims, combat funding and authorization, and metadata updates. Open **KARES launch** in the operator
for its live process memo. Its named signer actions use the same receipt recovery as game operations.
No mainnet operation follows automatically from testnet rehearsal or from this runbook.

1. Publish KARES through the named operator action. Record its receipt-derived lineage and Genesis.
2. Review the intended name, description and icon asset before a public offering.
3. Keep the original, never-upgraded UpgradeCap with the publisher until setup. Never freeze it
   separately: setup must consume that exact capability, and premature destruction strands Genesis.
4. Use **Review sale terms** to save the immutable sale duration and recipient addresses. The sale lasts
   15 minutes on testnet and seven days on mainnet, measured from its separate native start.
   Mainnet accepts 50,000–200,000 SUI. The testnet rehearsal requires 5–20 SUI.
5. Use **Configure and seal the offering** once. It registers native Currency, destroys its genuine UpgradeCap,
   allocates Genesis and fixes the offering terms. Recovery must prove the canonical cap's deletion
   in that same successful setup receipt; an absent-cap read alone is insufficient. The offering stays
   inactive until its configured treasury runs **Start the offering once**.
6. Record the canonical combat-pot ID and initial shared version from the setup receipt. Before
   enabling combat on mainnet, the immutable treasury runs **Move the combat reserve** once to move
   the reserved 100,000 KARES directly into that pot. Confirm its balance from certified effects.
7. After publishing the game, the treasury runs **Authorize game victories**. Its witness is
   `<original_game_package>::fight_rewards::BossVictory`, using the original type ID, not an upgrade target.
   Read the pot back and verify that exact type before enabling gameplay. Repeat authorization after
   a game republish; preserve the existing pot and counters. Zero payouts before activation are final.
8. When ready, the treasury runs **Start the offering once**. Use **Open the launch page** to contribute
   manually. Closing below the minimum permits full refunds; otherwise claims return tokens plus
   excess SUI and distribute proceeds once when needed. Claims never expire. No early close, restart,
   or extension exists.

After a successful sale, **Distribute sale proceeds (optional)** can move proceeds before the first
participant claim. Use the delivered liquidity allocation to create the market manually.
**Claim vested community tokens** remains available as tokens unlock to the treasury over 1,825
wall-clock days from successful settlement. Claim frequency does not change total entitlement.
Unlocked tokens may be distributed or burned; failed offerings never start this release.

Treasury controls which witness proves eligibility. Authorizing a publicly constructible type would
allow its holders to claim the daily allowance directly; the immutable monetary ceiling still applies.
Keep the treasury signer trusted and verify the game witness type. There is no automatic deployment
or funding action merely because these SDK methods exist.

The community cold wallet receives native metadata authority independently of mint authority and
the package UpgradeCap. The operator's metadata action verifies its actual holder and accepts only
name, description and HTTPS image URL. It cannot change ticker, decimals or supply.
The image is served by the independent launchpad deployment; publishing contracts does not publish that site.

Local read stacks must replace their derived projection when the branch's game or seed original changes and
may preserve it only across compatible upgrades of the same original. The client blocks play while
cached index lag is unknown or above 300 checkpoints and shows catch-up progress instead of hiding
the server.

## Permanent freeze

Permanent freeze is a separate cold-key ceremony, not a normal content upgrade.

Before requesting approval:

1. Confirm every authored row is published.
2. Confirm release inspection discovers the Registry as unfrozen.
3. Confirm the exact active math, control, combat, seed, and core UpgradeCaps.
4. Run all repository gates.
5. Record the intended package IDs and content state for human review.

After explicit owner approval, one PTB freezes the Registry and calls
Sui package::make_immutable for all five AresRPG UpgradeCaps. No content or package upgrade is
possible afterward.
