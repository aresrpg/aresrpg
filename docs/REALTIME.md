# Realtime architecture — the two lanes

One page, one truth. Everything realtime in AresRPG rides exactly one of two lanes. A feature
that needs both is two features. There are no fallback layers: each lane has one write door and
one read stream, and an outage surfaces honestly instead of degrading into a second system.

## Lane 1 — chain truth (durable, replayable)

```
Sui chain → rust indexer → /v1 reads + SSE streams
```

- **What rides it:** everything that is or derives from chain state — fight journals, world
  objects, items, characters, balances.
- **Read side:** `GET /v1/stream/fight/{fight_id}` (packages/rpc/indexer/src/stream.rs) replays
  the decoded per-fight journal from any cursor and stays live; plain `/v1` endpoints serve
  snapshots. `lastEventId` resume means a dropped connection loses nothing.
- **Write side:** there is none. Chain truth is written by transactions, never by this lane.
- **Why SSE exists:** it replaced client polling of `/v1`. That is the whole story — an
  efficiency transport for chain events, not a message bus.
- **Properties:** stateless by construction (every byte re-derivable from chain), one decoder,
  one cursor scheme. The indexer mirror is a full member of the deterministic-twin contract
  (Move struct · client decode · mirror — field layout AND lifecycle).

## Lane 2 — ephemeral social (seconds-lived, never on chain)

```
client → POST /v1/courier/{position,chat} → redis (TTL) → GET /v1/stream/presence/{world_id}
```

- **What rides it:** things with no chain home and no persistence need — position heartbeats,
  who-is-online presence, chat delivery.
- **Write door:** the courier (api/courier.mjs, one process with the sponsor). Two routes:
  `position` and `chat`. Every reject carries a machine-readable reason — a bare 400 is a bug.
- **Read stream:** `GET /v1/stream/presence/{world_id}` (same stream.rs) fans the registry out.
  Fast travel, friend presence, and the social panel all read THIS stream — never a private
  cache, never a second source.
- **State discipline:** the redis rows are TTL heartbeats — seconds-lived by design. Nothing in
  this lane is durable, authoritative, or restorable; wiping it costs at most a heartbeat
  interval. That is the sense in which the architecture stays "stateless": no durable server
  state, not no memory at all.

## What died, on purpose

- **trystero / browser p2p:** fully removed (zero references in the tree). It was unreliable
  over public relays, and the courier+SSE bus replaced it with fewer moving parts — no NAT
  traversal, no signaling relay to host, same latency class for our scale. Reintroducing p2p is
  a deliberate future decision with its own doc, not a fallback and not a remnant.
- **The "p2p idle" widget:** a leftover from that era. It must read the presence SSE connection
  state and say what is true ("presence connected / reconnecting / down: <reason>"), or die.

## The laws

1. **One write door, one read stream, per lane.** No client-side presence caches that outlive
   the stream; no chat paths outside the courier; no chain reads outside /v1.
2. **No fallback layers.** If the courier is down, presence is DOWN and says so — it does not
   silently degrade into polling, guessing, or a resurrected p2p. Outages are loud and honest.
3. **No cross-lane leakage.** Chain truth never rides the courier; ephemeral heartbeats never
   touch the chain or the indexer's chain tables.
4. **Errors carry reasons end-to-end.** Courier rejects, stream disconnects, and zkp/sponsor
   failures surface their machine-readable cause to console and, when player-relevant, to a
   toast in plain language.
