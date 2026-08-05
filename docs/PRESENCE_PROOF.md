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

Connection health and remote population are separate facts. `link_status` derives from the transport:
an OPEN RTC data channel remains usable if signaling drops, while an established MQTT relay session can
discover the first or next peer. Zero remote peers is a valid empty room, not proof of failure; treating it
as failure stranded every refreshed client on `degraded` even after MQTT connected. Only zero usable peer
channels _and_ zero relay sessions spends the reconnect budget and can ultimately report `failed`.

- Home: `packages/frontend/src/p2p/lobby-room.js`, `_health_check`.
- Pinned by `packages/frontend/test/p2p/lobby-room.test.js`: "reload with a healthy broker clears connecting
  when the MQTT connect resolves", "a late MQTT CONNACK clears the failure state on the next health
  observation", and "does not mistake the last peer leaving for relay failure".

Contract items 1–3 are pinned headlessly against the real transport module — peer appearance, position
delivery, and the `PEER_EXPIRY_MS` lapse driven through the core's own `tick` — in
`packages/frontend/test/p2p/lobby-room.test.js` and `packages/frontend/test/p2p/presence_bridge_chain.test.js`.
Recorded on lane `lane/a3-courier`, parent `c4982fbda`.

**Still owed, and deliberately not claimed here:** the forced-relay drive above, the moment a TURN
credential exists. Until then no page in this repo may claim that two players behind hostile NATs have
been shown to reach each other — only that a client which cannot reach anyone now says so.
