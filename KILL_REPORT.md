# Trystero kill report

Status: **BLOCKED — stopped after two identical `bun install` tempdir failures, as required by the attempt budget.**

The working tree contains an unverified, uncommitted partial migration. `packages/frontend/package.json` no
longer declares `trystero`, but `bun.lock` has not been regenerated, so the dependency removal is not complete
and the tree must not be treated as gate-ready.

## Per-consumer disposition

- World position send: the movement call site already used `src/courier/world.js::broadcast_position`; no
  duplicate courier wiring was needed. Lobby session joins were removed in the partial working tree.
- World chat send: already used `src/courier/world.js::broadcast_chat`; no legacy send survived outside the
  deleted lobby file in the partial working tree.
- Party chat (`CHANNEL.group`): **not blocked by ingress validation**. `api/courier.mjs` accepts and validates
  `body.party`, the SDK posts it, and `courier_inputs` filters `CHAT_GROUP` delivery by the active party id.
- Party membership scope: partially rewired so `party_store` publishes only the courier party-chat scope and
  keeps its `/v1` projection polling.
- Party invite and dungeon-share nudges: removed with the lobby transport in the partial working tree. Their
  signed/on-chain sources remain, but no replacement courier vocabulary was added.
- Cosmetics fast path: local `set_local_cosmetic` sends and remote reads of `mounted`, `mount_glb`, and
  `veteran` were removed in the partial working tree. Remote worn cosmetics and pets continue to repaint from
  the existing `/v1/characters` cache. This has not been verified by gates.
- Peer identity/address consumers: partially repinned to server-observed SSE presence rows, signed courier chat
  addresses, accepted party member owners, or chain-resolved presence entries.
- Fight courtesy channel: a live consumer was found (`init_fight_stream` folds placement ghosts and drafted
  batches), so it was retained and partially moved to a hidden `CHAT_FIGHT` courier-chat row instead of being
  deleted. This migration is unverified.
- Commission live-session nudge/inbox: removed with the lobby-only convenience path in the partial working tree;
  the existing commission read/stub remains.
- Scene teardown and wallet reset: partially changed to close/reset the courier stream without loading the
  lobby chunk.

## Files deleted in the partial working tree

- `packages/frontend/src/p2p/lobby-room.js`
- `packages/frontend/src/p2p/lobby-room.anticheat.test.js`
- `packages/frontend/src/p2p/lobby-room.d237.test.js`
- `packages/frontend/src/p2p/lobby-room.mount.test.js`
- `packages/frontend/src/p2p/relay-signaling.js`
- `packages/frontend/src/p2p/relays.js`
- `packages/frontend/src/test_helpers/trystero_mock.js`
- `packages/frontend/test/p2p/lobby-room.test.js`
- `packages/frontend/test/p2p/relay-signaling.test.js`
- `packages/frontend/e2e/mp_rig.mjs`
- `packages/frontend/src/world-shell/commission_inbox.js`
- `packages/frontend/src/world-shell/commission_inbox.test.js`

`packages/frontend/src/p2p/presence_bridge_chain.test.js` was partially repinned to courier delivery and moved
to `packages/frontend/src/courier/presence_bridge_chain.test.js`.

## Tests pinning Trystero behavior

- Lobby-room transport, relay signaling, anticheat-at-transport, mount/cosmetic propagation, and dedicated
  multiplayer relay-rig tests were deleted with the feature.
- The full presence bridge test was repinned to `courier_inputs`.
- Fight-stream tests were partially repinned to the courier courtesy subscription.
- Boot-smoke relay-weather exemptions were partially removed because the client no longer dials those relays.

## Gate tails

Not run after edits because the mandatory dependency/lockfile update blocked first.

Initial required setup succeeded:

```text
$ git rev-parse --show-toplevel
/private/tmp/codex-lanes/trystero-kill

$ bun install --frozen-lockfile
1589 packages installed
```

Lockfile regeneration attempt 1:

```text
$ bun install
bun install v1.3.5 (1e86cebd)
error: bun is unable to write files to tempdir: PermissionDenied
```

Lockfile regeneration attempt 2:

```text
$ TMPDIR=/private/tmp bun install
bun install v1.3.5 (1e86cebd)
error: bun is unable to write files to tempdir: PermissionDenied
```

The following required gates were therefore **not run**:

- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `cd packages/frontend && bun test src`

No commits were created because the lockfile is stale and the partial migration has not reached a testable
state.

## BLOCKED

### Bun dependency/lockfile update

- **Symptom:** Bun immediately exits with `error: bun is unable to write files to tempdir: PermissionDenied`.
- **Repro:** from `/tmp/codex-lanes/trystero-kill`, remove the frontend `trystero` manifest entry and run
  `bun install`.
- **Tried:** (1) normal `bun install`; (2) `TMPDIR=/private/tmp bun install`.
- **Hypothesis:** the sandbox permits the clone and `/private/tmp`, but Bun 1.3.5 is selecting or probing a
  different internal install/cache temp path that remains outside the writable roots. The frozen install did
  not need to regenerate the lockfile and therefore did not hit this write path.
- **Smallest question:** may the attempt budget be extended by one so the install can be retried with Bun's
  install cache explicitly rooted under `/private/tmp` (for example `BUN_INSTALL_CACHE_DIR`), or can the Bun
  temp/cache path be made writable?

