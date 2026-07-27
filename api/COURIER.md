# Stateless courier

The shared `api/server.mjs` process exposes two ephemeral, zkLogin-only ingress routes:

| Route                       | Required payload                                                    | Shared hard limit           | Effect                                                          |
| --------------------------- | ------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| `POST /v1/courier/position` | `{ world, character, x, z, heading, sender, challenge, signature }` | 2 requests/second/address   | Latest pose stored for 10 seconds and published to world SSE.   |
| `POST /v1/courier/chat`     | `{ world, character, text, sender, challenge, signature }`          | 1 request/2 seconds/address | Line published to world SSE; text is capped at 280 code points. |

`challenge` is `aresrpg-courier:<sender>:<epoch-ms>` and is verified by the same server module and issuer
allowlist as the sponsor challenge. The signature scheme must be zkLogin. Redis failures refuse both writes
with `503`; neither hard gate fails open.

## Presence wire

Both event types use the simpler existing wire:

`GET /v1/stream/presence/:world`

The stream service subscribes to `courier:presence:<world>`. On connection it reads
`courier:positions:<world>`, removes expired scores, and loads each live
`courier:position:<world>:<character>` JSON value. The initial SSE row is
`{ "type": "positions", "positions": [...] }`; live pub/sub rows are either `type: "position"` or
`type: "chat"`. Position values expire after approximately 10 seconds.

Chat moderation is deliberately out of scope for this pass. The abuse floor is zkLogin authentication, the
shared per-address rate gate, and the 280-code-point cap. Optional `channel`, `target`, and `party` fields retain
the current client routing vocabulary; party lines are receiver-filtered on the exact party id.
