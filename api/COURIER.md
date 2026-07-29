# Stateless courier

The shared `api/server.mjs` process exposes two ephemeral, zkLogin-only ingress routes:

| Route                       | Required payload                                                    | Shared hard limit           | Effect                                                          |
| --------------------------- | ------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| `POST /v1/courier/position` | `{ world, character, x, z, heading, sender, challenge, signature }` | 2 requests/second/address   | Latest pose stored for 10 seconds and published to world SSE.   |
| `POST /v1/courier/chat`     | `{ world, character, text, sender, challenge, signature }`          | 1 request/2 seconds/address | Line published to world SSE; text is capped at 280 code points. |

`challenge` is `aresrpg-courier:<sender>:<epoch-ms>` and is verified by the same server module and issuer
allowlist as the sponsor challenge. The signature scheme must be zkLogin. Redis failures refuse both writes
with `503`; neither hard gate fails open.

The optional `channel` must be a `CHAT_*` name — an unknown one is refused, never silently rewritten to
general. `CHAT_FIGHT` is the machine courtesy channel (a serialized drafted turn, never rendered as chat) and
carries its own larger cap, `COURIER_FIGHT_MAX_LENGTH` (2000 code points): the human 280 cap 400'd every
courtesy batch (#1641). Both caps stay under the same per-address rate gate.

## Every refusal names itself

No bare 400s (#1641). Each refusal answers `{ error, code }` — `error` is the human sentence, `code` is the
machine-readable reason, and its ONE home is the `CourierApiError` raised at the site of the rule that broke.
Field rules derive theirs from the field (`invalid_world`, `invalid_character`, `invalid_sender`,
`invalid_party`, `invalid_x`…), policy rules name themselves (`empty_text`, `text_too_long`,
`invalid_channel`, `invalid_json`, `rate_limited`, `authentication_failed`, `store_down`). The browser edge
reads the code it was handed and branches only on the HTTP status — `401` means re-sign (the cached courier
signature is dropped so the next heartbeat re-authenticates), `429`/`503` mean retry later, and a `400` is a
client bug, reported loudly.

## Presence wire

Delivery is not this process. It is the RPC read layer's presence route — `stream.rs` in
`packages/rpc/indexer`, served by the `aresrpg-rpc-indexer` binary — which reads what the routes above wrote:

`GET /v1/stream/presence/:world?address=…&character=…`

The route refuses a link that names neither identity: the query is how a connection registers itself in the
world's presence registry. One connection carries both vocabularies. The read layer's own frames are named
`current-set`, `join` and `leave`; the courier's three are:

| Frame       | When                | Body                                                  |
| ----------- | ------------------- | ----------------------------------------------------- |
| `positions` | once, on connection | `{ type, world, positions: [...] }` — every live pose |
| `position`  | per accepted POST   | the stored pose row, forwarded verbatim               |
| `chat`      | per accepted POST   | the published chat row, forwarded verbatim            |

The stream subscribes to `courier:presence:<world>` before it assembles the join frames, so a row published
mid-join waits in the channel instead of falling into the gap. The snapshot prunes `courier:positions:<world>`
by expiry score and loads each live `courier:position:<world>:<character>` value in one local step; those
values expire after approximately 10 seconds. Courier frames deliberately carry no SSE id — they are
ephemeral, so a reconnect gets the live snapshot and never a replay, and the fight stream's Last-Event-ID law
is untouched by this half.

The browser edge is `packages/frontend/src/courier/world.js`: it opens that one link through
`world-shell/presence_sse_adapter.js` and folds every frame — courier and read-layer alike — through the
single presence door. A sender's own accepted line returns down this same wire, and that round trip IS the
local echo: there is no optimistic second path that could disagree with what the world actually received.

Chat moderation is deliberately out of scope for this pass. The abuse floor is zkLogin authentication, the
shared per-address rate gate, and the 280-code-point cap. Optional `channel`, `target`, and `party` fields retain
the current client routing vocabulary; party lines are receiver-filtered on the exact party id.
