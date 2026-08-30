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
- sale: item type and finite/infinite supply policy.

Retiring a row removes every live reference to it. A derived object is not deleted and recreated
under the same identity.

Every player spell always has exactly six levels.

## Mutable content

- Items: name, level, pet foods, stats, damages, and stackable behavior.
- Recipes: ingredient item types, quantities, and derived/fallback job. Removing an authored
  recipe disables its existing chain object; re-adding the same output reactivates it.
- Spells: all six level payloads. The class ladder slot stays fixed.
- Mobs: full authored payload.
- Worlds: entry level, mobs, resources, biome map, and dungeon rooms.
- Boards: add, replace, reorder, and remove.
- Sales: price and enabled state. Finite supply is never replenished. Removing an authored sale
  disables its existing chain object.

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
15. Run the prepared Kubernetes repository's Helmfile diff and sync. The composite game+seed
    projection identity decides whether this retains the store or replaces it for a repin.
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

    math → control → seed → core

Upgrade only a package whose desired artifact changed. Reuse unchanged published dependencies.

Republish abandons every active package lineage, publishes fresh math, control, seed, and core
packages in dependency order, and creates a fresh empty Registry. Historical content ledgers remain
namespaced by their old Registry roots for audit and recovery, but no active package or content
object is reused. Compatibility belongs only to Upgrade; Republish never attempts selective reuse.

Refresh the local read stack with the ceremony that matches the chain change:

- after a fresh package publication, run `bun run repin:local`; it replaces the disposable local
  FalkorDB projection because the original package lineage may have changed;
- after a compatible package upgrade, run `bun run reload:local`; it preserves FalkorDB and its
  watermark, refuses a changed original package id, rebuilds both reader images, and restarts the
  indexer and server immediately. The client blocks play while the cached index lag is unknown or
  above 300 checkpoints and shows catch-up progress instead of hiding the server.

## Permanent freeze

Permanent freeze is a separate cold-key ceremony, not a normal content upgrade.

Before requesting approval:

1. Confirm every authored row is published.
2. Confirm the admin page discovers the Registry as unfrozen.
3. Confirm the exact active math, control, seed, and core UpgradeCaps.
4. Run all repository gates.
5. Record the intended package IDs and content state for human review.

After explicit owner approval, one PTB freezes the Registry and calls
Sui package::make_immutable for all four AresRPG UpgradeCaps. No content or package upgrade is
possible afterward.
