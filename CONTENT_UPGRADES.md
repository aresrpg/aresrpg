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
- Mastery offer: statless item type.

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
- Mastery offers: point cost and enabled state. Removing an authored offer disables its existing
  chain object; redemption mints the referenced statless item. Loot boxes keep using their current
  seeded table after redemption.

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
7. If Move changed, prepare its compatible upgrades or testnet republish and push the resulting
   hardcoded pins to `edge` before versioning.
8. From clean, current `edge`, run `bun pm version patch` (or the intended semver level). Wait for
   tag CI to publish changed backend images to public GHCR and stage the production Vercel build.
9. Confirm the retained preparation manifest names that exact SHA, package lineages, image
   versions/digests, and staged Vercel URL.
10. Pause gameplay when content or package work requires it.
11. Apply content batches in deterministic order.
12. Record every successful transaction digest.
13. Never retry a transaction that executed and returned a digest.
14. If a batch stops, inspect chain state and resume only the missing rows.
15. When Move, server, or indexer changed, run the prepared Kubernetes repository's Helmfile diff
    and sync. A pure app tag skips this step. The composite game+seed projection identity decides
    whether this retains the store or replaces it for a repin.
16. Trigger the manual production-activation workflow; it promotes the staged Vercel deployment
    without rebuilding, verifies production, publishes the draft release, and announces it.
17. Exercise one affected action against chain truth.
18. Resume gameplay.

## Partial failures

A failed simulation or wallet rejection spends no gas and may be corrected normally.

An executed failure has a digest and may have spent gas. Do not automatically retry it. Read the
receipt and current chain objects, then compose only work still missing.

Board synchronization reads the chain catalog length. It replaces shared indexes, appends missing
indexes, and removes the tail. `pins.json` records every derived address and authored fingerprint
under its Registry root; the chain catalog length still decides board shape.

## Printing giftcards

Giftcard QR images are bearer secrets. Generate them only after the authored vouchers are published
and owned by the signer address authored as their `custody`. A `pins.publisher` value is a Sui
Publisher capability object ID, never a wallet address. Run `aresrpg-operator`, choose
`Create Sui Crate giftcards`, review its three-phase plan, type `CREATE 100 CARDS`, and confirm the
single Slush transaction in the web signer.

The operator prepares a private recovery manifest and one 85×55 mm 300-DPI PNG per voucher before
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
    math + control + combat + seed → core

Upgrade only a package whose desired artifact changed. Reuse unchanged published dependencies.

Republish abandons every active package lineage, publishes fresh math, control, combat, seed, and
core packages in dependency order, and creates a fresh empty Registry. Historical content ledgers remain
namespaced by their old Registry roots for audit and recovery, but no active package or content
object is reused. Compatibility belongs only to Upgrade; Republish never attempts selective reuse.

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
