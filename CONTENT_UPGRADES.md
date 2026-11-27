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
  Either earned points or 1,000 burned KARES per point mint the same statless item. Loot boxes retain their current table.

Stackable consumables and loot boxes use their template's current behavior. Unstackable equipment
keeps the stats and damages rolled when it was minted. Running fights keep their mob and board
snapshots.

## Upgrade checklist

1. Edit the canonical files under seed/.
2. Run seed validation.
3. Reject accidental immutable-identity changes.
4. Open `/world/demo#boards` and inspect every generated board.
5. Run the relevant package tests, Move builds/tests, indexer parity, lint, and type checks.
6. Confirm no wagered fight would be unfairly changed by the planned spell or mob update.
7. Before starting source-bound publication, build every package for the selected network with
   the pinned Sui compiler and review its `Move.lock` resolution. First-mainnet builds add mainnet
   lock entries; those changes must be settled before capturing the publication source identity.
   If Move changed, prepare its compatible upgrades or fresh publication first; the version commit
   carries the resulting hardcoded pins.
8. From clean, current `edge`, the release operator commits the root version at the intended semver
   level (with the live `pins.json` and the generated `version.move`), tags it and pushes `edge` and
   the tag atomically. Dispatch preparation CI on that exact tag. It certifies on the first green gate
   of the tag commit or of its parent, whose tree differs only in the version line. Its staged build
   reads the production token from the GitHub `Production` environment; the release operator approves that request for the run
   it dispatched. Wait for changed backend images and the staged
   production Vercel build. CI gives the frontend build and prebuilt output one custom deployment ID;
   `scripts/pin_vercel_deployment.ts` must run after `vercel build` and before upload. This keeps
   retained deployments accessible to their already-open pages.
9. Confirm the retained preparation manifest names that exact SHA, package lineages, image
   versions/digests, and staged Vercel URL. Unchanged images retain the previous certified digest;
   deployment configuration consumes those digests, never mutable semver aliases.
   New schema-two manifests include server, indexer, Discord and hosted bot images. A legacy
   manifest without the hosted bot image cannot certify its first rollout; preparation builds it.
   Image publication alone does not satisfy application configuration or security prerequisites.
   Verify those privately before separately authorized activation.
10. Pause gameplay when content or package work requires it.
11. Apply content batches in deterministic order.
12. Record every successful transaction digest.
13. Never retry a transaction that executed and returned a digest.
14. If a batch stops, inspect chain state and resume only the missing rows.
15. Before backend changes, review the exact prepared inputs privately. Changed or unknown inputs
    stop recovery. Preserve projection state only when its game+seed lineage remains compatible.
    Infrastructure procedures and configuration remain outside public documentation.
16. Release tooling automatically dispatches the production-activation workflow with the retained
    tag, version, preparation run and request ID. The network is always mainnet. It promotes the
    staged Vercel deployment without rebuilding, verifies production, and publishes the draft release.
    The release operator approves the activation's `Production` request in the same way.
    Wait for that exact successful activation and published release before continuing. Persist
    dispatch intent first; a lost response must never cause an automatic duplicate dispatch.
17. Exercise one affected action against chain truth.
18. Resume gameplay.

## Partial failures

A failed simulation or wallet rejection spends no gas and may be corrected normally.

An executed failure has a digest and may have spent gas. Do not automatically retry it. Read the
receipt and current chain objects, then compose only work still missing.

Board synchronization reads the chain catalog length. It replaces shared indexes, appends missing
indexes, and removes the tail. `pins.json` records every derived address and authored fingerprint
in the current deployment; the chain catalog length still decides board shape.

## Direct giftcard distribution

Author each entitlement once in `seed/content/airdrop.json` under `giftcards`.
Every giftcard and recipient batch names its `campaign`. Campaigns own their display name, visibility,
reward types, and eligibility copy identity. Scoped issuance sends the complete reviewed campaign;
campaign metadata is excluded from immutable voucher fingerprints. Operator-only test campaigns
never enter the public catalogue.
Use `giftcard_batches` for one item/amount sent to a recipient list; the SDK derives one voucher identity per address.
Use `custody` for the initial recipient or distribution wallet. Publication already batches creation and transfer.
Set `network` to `mainnet` or `testnet` when an allocation belongs to only one network; omitted means both.
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

## Historical player rewards

Historical Hytale awards use an isolated restored database, never the active game projection.
Export only the ranking inputs and the recorded shop-spending counter:

```bash
bun scripts/export_hytale_players.mjs <isolated-container> <graph-name> <backup.rdb> <backup-timestamp-ms> <private-export.json>
bun scripts/prepare_hytale_gifts.mjs <private-export.json> <private-ranking-report.json>
```

The catalogue's Hytale tiers own the reward quantities. Ranking aggregates each wallet's characters,
bank and inventory. Equal-weight percentile scores measure unique item types, playtime, character XP,
and earned profession levels; admin/builder accounts and snapshot-active bans are excluded. Quantity
duplicates do not create additional collection variety. Ties resolve by character XP, then address.
The separate supporter award uses recorded shop spending strictly greater than 100 SUI, independent
of ranking. The historical counter is in hundredths of SUI, not USD or MIST. Generated allocations
are mainnet-only and reject changes to already-prepared batch identities. Preparation sends nothing.
Keep the export and named ranking report private; only the necessary recipient allocations enter seed.

## Printing giftcards

Giftcard QR images are bearer secrets. Generate them only after the authored vouchers are published
and owned by the signer address authored as their `custody`. A `pins.publisher` value is a Sui
Publisher capability object ID, never a wallet address. The SDK administrative signing adapter
creates links only for canonical vouchers held directly by the connected signer.

Prepare and retain bearer keys before submitting the link transaction. Record the certified digest
alongside those keys. Recovery must reuse prepared links, verify completed transactions, and reject
mixed or unknown custody instead of generating replacement secrets.
Each QR opens AresRPG `/gift`; the zkSend key stays in the URL fragment, survives Google login in
session storage, and is never sent to the application server.
Keep bearer files outside the repository with owner-only access. Never upload them before
the cards are intentionally distributed. If execution returns a digest and fails, inspect that digest
and current object custody; never retry automatically.

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
    retired kares + independent rewards
    math + control + combat + seed + kares + rewards → core

Upgrade only a package whose desired artifact changed. Reuse unchanged published dependencies.

Republish abandons every active package lineage, publishes fresh math, control, combat, seed, and
core packages in dependency order, and creates a fresh empty Registry. The previous game pins and
content ledger are discarded; no active package or content object is reused. Compatibility belongs only to Upgrade; Republish never attempts selective reuse.

Currency and rewards are outside that five-package game lifecycle. Preserve their identities and
objects across compatible upgrades. The rewards package binds the original game victory
witness, so a fresh game lineage cannot inherit combat payouts. Production migration uses Upgrade.

## KARES reward operations

The project issues the currency and locks its market in one launch. The administrative SDK builds
the three launch transactions; the operator's Launch token action runs them. Mainnet publication,
launch, upgrades and permanent freeze require explicit owner approval.

Before the launch:

1. Publish `packages/rewards` from the treasury wallet. Record the shared Economy, unique Setup and
   genuine unrestricted UpgradeCap. Publication creates no token and funds no pool.
   Compatible upgrades may precede funding. Keep Setup and UpgradeCap; funding verifies their original rewards lineage.
2. Compile and deploy the game with both the compatibility ABI and active rewards dependency.
   Record the unfunded Economy pin. Boss settlement pays zero KARES while that Economy is unfunded.
3. Fund the treasury wallet with the SUI seed plus gas. The seed is the only SUI the pool starts with
   and can never be withdrawn. State the seed in `.operator/networks/<network>/launch.json`.
4. Compare `AFTERMATH_MAINNET` in `packages/sdk/src/kares_launch.ts` with Aftermath's live
   `/api/addresses`. Aftermath upgrades its packages; a stale id fails the simulation, never silently.

The launch, signed by the treasury, one transaction at a time:

6. **Publish.** One transaction publishes `packages/currency` and `packages/currency-lp` and makes both
   immutable. The treasury receives the non-transferable Genesis (the whole supply), the metadata
   authority and Aftermath's pool-creation cap. Nothing is tradable yet.
7. **Register.** One transaction promotes the currency to its shared registry object.
8. **Launch.** One atomic transaction: open Genesis into 540M liquidity, 410M reserves and 50M team;
   create the Aftermath pool (80% KARES, 20% SUI, 0.3% pool fee) with the liquidity share and the SUI
   seed; wrap it in the 2% DAO fee paid to the treasury; send every liquidity token to `0x0`; fund
   the Economy with the reserve share; send the team share and the fee authority to the treasury.
   Before the wallet opens, the SDK simulates the launch and refuses it unsigned unless the pool is
   shared, every liquidity token is at `0x0`, the fee authority and exactly the 50M team share are in
   the treasury, and only the seed plus gas is spent. Still read the signer page line by line: the
   weights and fees are checked by the builder's tests and, after certification, by the operator.
9. Record the coin type, Currency, three reward pools and market pool from certified effects. Recover
   uncertain digests; never retry them. Funding immediately enables boss rewards on-chain; there is
   no separate payout activation. Release the frontend with these pins in the same session.
10. Exercise Mastery (1 point = 1,000 KARES), staking, boss payouts, trade and one small market buy.

After the launch:

- The pool's weights and its 0.3% fee are permanent. Only the DAO fee rate and recipient can change,
  through the treasury-held fee authority. Announce any change first; never raise it silently.
- SUI returned to the pool is a deposit that mints new liquidity tokens. Send them to `0x0` in the
  same transaction, or that liquidity is not locked.
- The metadata authority can change the name, description and icon. Supply can only fall, by burns.

Rewards upgrades retain their own treasury-held UpgradeCap. A future migration must preserve
staking principal and accrued rewards; no withdrawal or witness-rotation door is currently exposed.
A fresh game lineage cannot silently replace the authorized witness. Game republishing therefore
requires an explicit rewards migration when reserves are already funded.

Community vesting lasts 1,825 wall-clock days from setup. Staking emissions advance for 1,825 active
days, only while principal is nonzero. Supplemental deposits begin at the next active-day boundary,
stream for 30 active days, and cannot be withdrawn. Marketplace claims fund staking with 20% of
actual withdrawn SUI royalties. The market's 2% DAO fee is treasury income outside these contracts.

Local read stacks must replace their derived projection when the branch's game or seed original changes and
may preserve it only across compatible upgrades of the same original. The client blocks play while
cached index lag is unknown or above 300 checkpoints and shows catch-up progress instead of hiding
the server.

## Permanent freeze

Permanent freeze is a separate cold-key ceremony, not a normal content upgrade.

Before requesting approval:

1. Confirm every authored row is published.
2. Confirm release inspection discovers the Registry as unfrozen.
3. Confirm the exact active math, control, combat, seed, rewards, and core UpgradeCaps.
4. Run all repository gates.
5. Require funded reward reserves and one cold wallet owning every active UpgradeCap and the AdminCap.
6. Record the intended package IDs and content state for human review.

After explicit owner approval, one PTB freezes the Registry and calls
Sui package::make_immutable for all six active AresRPG UpgradeCaps, including the rewards cap. No content or package upgrade is
possible afterward.
