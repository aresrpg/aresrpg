# Realtime architecture — the two lanes

One page, one truth. Everything realtime in AresRPG rides exactly one of two lanes. A feature
that needs both is two features. No fallback layers: each lane has one transport, and an outage
surfaces honestly instead of degrading into a second system.

## Lane 1 — chain truth (durable, replayable)

```
Sui chain → rust indexer → redis → stateless /v1 reads + SSE streams
```

- **What rides it:** everything that is or derives from chain state — fight journals, world
  objects, items, characters, balances.
- **Why SSE exists:** it replaced the 4s client poll that made a coop peer's turn arrive as a
  bare state jump (#216). SSE streams the ordered per-fight journal from any cursor
  (`lastEventId` resume — a dropped connection loses nothing). It is an efficiency transport
  for chain events, not a message bus.
- **Write side: none.** Chain truth is written by transactions. The ONLY writer of redis is the
  indexer; any number of redis+indexer pairs can exist, and /v1 is fully stateless — hostable
  in any region, in any count.
- The indexer mirror is a full member of the deterministic-twin contract (Move struct · client
  decode · mirror).

## Lane 2 — ephemeral social (seconds-lived, peer-to-peer, MANDATORY)

```
browser ⇄ browser (WebRTC via trystero) — signaling: wss://relay.aresrpg.world (ours)
```

- **What rides it:** position, chat, who-is-here presence, cosmetic state (pet ownership) —
  anything whose loss costs at most a blink. Presence IS room membership: joining the p2p room
  announces the peer; there is no server-side presence registry.
- **Infrastructure:** one self-hosted stateless signaling relay (message-passer, persistence
  off, multi-region) + coturn for NAT traversal. Neither is authoritative; neither stores
  anything; the server NEVER receives a client state write.
- **History, so it never re-litigates:** public third-party relays rate-limited us and stalled
  fights (2026-07-27). The cure was self-hosted relays and getting fights OFF p2p — not
  removing p2p. A client→server courier existed for one day (07-28) and was retired as a
  violation of the no-client-writes law.

## The fight-turn overlay (the one sanctioned p2p touch near fights)

Observers watching another player's ACTIVE turn get truth from the fight journal — correct, but
paced at commit granularity. The liveness between commits (walking previews, aim telegraphs,
the feel of watching someone play) streams peer-to-peer as a PRESENTATION OVERLAY with a hard
fence: peer intents never fold into the fight core, never gate any input, and never reach a
transaction — they paint on top of the folded truth and are discarded on commit. A dropped feed
degrades to journal-paced rendering, never to wrongness. "Fights never ride p2p" stays exact:
fight TRUTH never rides p2p; this overlay carries no truth.

## The laws

1. **Only the indexer writes redis.** /v1 and SSE are read-only projections; rpc is stateless
   and replicable anywhere.
2. **Zero client→server writes.** A browser writes the chain (transactions) or speaks to
   browsers (p2p). Nothing else, ever.
3. **Fight-critical never rides p2p.** Fights are chain→indexer→SSE. p2p carries only what can
   be lost silently.
4. **No fallback layers, no cross-lane leakage.** Relay down = presence says DOWN, loudly.
   Chain truth never rides p2p; heartbeats never touch the chain or the indexer's tables.
