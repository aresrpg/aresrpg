<!-- SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available -->

# Room presence driven proof

This is the half-contract boarding gate. The server-side presence path could be retired only once the
replacement path was shown to carry the load by itself and — just as importantly — to say so honestly
when it does not.

## Contract

Two clients in one world, over the room path alone:

1. Client A sees client B appear.
2. Client A sees client B move.
3. Client A sees client B lapse after B leaves or stops announcing past the freshness bound.

## Why a same-host two-context drive does NOT discharge this

Two browser contexts on one machine form a direct WebRTC data channel over host candidates every time.
Such a run proves the fold and the wire format and nothing about the transport in the field: it cannot
fail the way a real pair of players fails (symmetric NAT, no TURN credential, a relay that introduces
peers and then carries nothing). A green same-host run is evidence about the code path, never about
reachability — treating it as the gate would be exactly the vacuity this section exists to name. Any
same-host run recorded here is a smoke check, explicitly not the discharge.

The honest alternative is a forced-relay drive: an `iceTransportPolicy: 'relay'` pair against real TURN
credentials, with the selected candidate pair logged as `relay`/`relay`. **That drive is not available
today — no TURN credential has been minted** (`env.ts` ships `TURN_URL` empty, and the transport
announces `ICE is STUN-only` at join). It remains the right proof for the day TURN exists.

## Evidence — the discharge basis

Because reachability could not be demonstrated, the gate is discharged the other way: by removing the
failure mode it was guarding against. The risk it protected against was a client that _believes_ it is
connected while carrying nothing — a green chip over an empty world, silently covered for by the
server-side path underneath. That path is now gone, so the transport is made to report itself honestly
instead:

**THE HONEST-DEGRADED GUARANTEE.** `link_status` never reads `connected` over zero open peer channels.
`getPeers()` exposes only OPEN RTC data channels; a relay socket by itself introduces peers and carries
no position, no chat and no presence. So the health check derives `connected` from peer channels alone,
and once the fresh-room grace has passed, a link with none of them reads `degraded` — whatever the
reason (alone in the world, a symmetric NAT with no TURN to relay through, a channel that froze). The
chip renders the atom, so an unreachable client now reads as unreachable rather than as an empty world.

- Home: `packages/frontend/src/p2p/lobby-room.js`, `_health_check`.
- Pinned by `packages/frontend/test/p2p/lobby-room.test.js`: "never claims connected over zero peer
  channels", "holds its judgement inside the fresh-room grace", "recovers to connected the moment a
  channel opens, and degrades again when it closes".
- Red-first: forcing the derivation back to a constant `connected` reddens exactly those assertions and
  nothing else; reverting restores 29/29 green.
- The same change deletes `unreachable_peers`, the heuristic that previously tried to tell "alone" from
  "unreachable" in order to justify a green chip. Under the guarantee above that distinction no longer
  changes what is shown, so the concept is gone rather than kept as decoration.

Contract items 1–3 are pinned headlessly against the real transport module — peer appearance, position
delivery, and the `PEER_EXPIRY_MS` lapse driven through the core's own `tick` — in
`packages/frontend/test/p2p/lobby-room.test.js` and `packages/frontend/test/p2p/presence_bridge_chain.test.js`.
Recorded on lane `lane/a3-courier`, parent `c4982fbda`.

**Still owed, and deliberately not claimed here:** the forced-relay drive above, the moment a TURN
credential exists. Until then no page in this repo may claim that two players behind hostile NATs have
been shown to reach each other — only that a client which cannot reach anyone now says so.
