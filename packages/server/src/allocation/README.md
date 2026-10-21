# Allocation campaign operations

The public entry is `/allocation`. The same-origin endpoint is `/api/allocation`.
It uses the existing Google and Wallet Standard authentication. It does not publish
contracts, submit sale transactions, or write the game index.

## Configuration

Configure these private variables on the **game server**, never Vercel or `VITE_*`:

- `ALLOCATION_REDIS_URL`: the private persistent campaign Redis.
- `ALLOCATION_ORIGIN`: the exact frontend origin, normally `https://aresrpg.world`.
- `ALLOCATION_X_CLIENT_ID`, `ALLOCATION_X_CLIENT_SECRET`, `ALLOCATION_X_BEARER`: X linking and read credentials.
- `ALLOCATION_LEADERBOARD_REDIS_URL`: operator-only access to the active indexer's Redis.

The server Helm chart's `allocation.enabled` switch mounts `aresrpg-allocation-secrets`,
reads the password from `allocation-redis-credentials`, and gives the server pods the
`aresrpg.world/allocation-client: "true"` label required by Redis NetworkPolicy.
The encrypted source remains `domains/aresrpg/secrets.yaml` in the Kubernetes repository.
Redis has no public endpoint. It uses its own retained 1 GiB PVC, synchronous AOF and no eviction.
The game server connects lazily; a campaign database outage does not prevent game boot.

Google sign-in creates the ordinary Enoki wallet. The existing WebSocket challenge
admits that wallet through the same game connection. Private campaign requests use
`packet/allocation_request`; the server takes the owner from that connection, never
from supplied JSON. The existing global request budget applies, with one in-flight
campaign operation per connection. Google logout disposes that connection.

X is an optional linked identity, not a second login session. An authenticated
connection issues a five-minute, one-use linking ticket. The public redirect consumes
it and binds PKCE/state to that owner and the browser's HTTP-only state cookie.
The callback verifies both and returns a short-lived result token. Only the original
game account can consume that token over its authenticated connection to finish linking.
This prevents a shared linking URL from binding a visitor’s X identity to its sender. X accounts and game addresses bind uniquely
in both directions. Relinking cannot replace an existing identity. Access tokens are
discarded after identity verification; no X session cookie exists.
Register `https://aresrpg.world/api/allocation?action=callback` in the X app.
The app requests only `tweet.read users.read`; it cannot publish posts for users.

An admitted game wallet establishes the first portfolio card. Additional wallets sign a
five-minute one-use challenge binding their address, campaign and the admitted owner.
The server stores at most ten distinct verified wallets per account, including the game
wallet. Card reads never accept caller-selected unverified addresses. Removal affects the
portfolio, not an existing X entry or an already shared public summary.

Post submissions require the linked X author and a verified receiving wallet. The first
entry locks that recipient. Edits replace posts and reset submission time. Redis checks
its own clock inside the atomic write; a stale browser cannot submit past the deadline.

Public HTTP supports only ticketed X linking and opaque share-token previews/images.
There is no public address lookup. Share links expose tier, pending state and allocation,
never addresses, linked wallets, X identity or audit evidence. Public and private responses
are uncached. Vercel proxies `/api/allocation` to the existing HTTPS server and holds no
campaign credentials. Request/response packet logging excludes the campaign.

For local development, run the game server with the private variables and set
`ALLOCATION_ORIGIN=http://localhost:5173`. Vite proxies `/api/allocation` to
`http://localhost:9800`; `ALLOCATION_API_ORIGIN` overrides that development target.
Set `VITE_SERVER_WS_URL` to the same server. Register the exact local callback in X.
Production uses the canonical frontend origin; edge linking returns there.

## Before opening registration

Initialize once. An existing campaign is never reset:

```sh
bun scripts/allocation_campaign.ts init
```

Prepare a private JSON array of reserved addresses. Each row has `address`, `tier`,
`source`, and `evidence`. Allowed reserved sources are `existing`, `community`, and
`manual`. Example shape only:

```json
[
  {
    "address": "0x…",
    "tier": "veteran",
    "source": "community",
    "evidence": "Chinese community nomination"
  }
]
```

Import replaces the complete reserved list during registration. It rejects duplicate
addresses and per-source quota overflow:

```sh
bun scripts/allocation_campaign.ts import /private/path/reserved.json
```

Rules and quotas come from `seed/content/allocation_campaign.json`. Keep private
addresses and operational exports out of seed and Git. `submissions_close_at` is
2026-10-24 at 15:00 UTC: Saturday at 23:00 in Bali (WITA, UTC+8). The UI countdown
must use this exact instant. Redis checks its own clock inside the atomic submission
write, so a challenge signed before the deadline cannot be submitted afterward.
The API also reports whether submissions are open. Sunday's opening hour remains unset.

## Saturday snapshot and CSV

Run only when the owner requests the snapshot. This closes submissions before
reading any inputs. A failed capture remains closed for an explicit retry.

```sh
bun scripts/allocation_campaign.ts snapshot /private/path/snapshot.json
bun scripts/allocation_campaign.ts rank /private/path/snapshot.json /private/path/results.json
```

The leaderboard reader requires the same committed metadata before and after all
nine reads, with no pending indexer batch. It refuses a checkpoint over five minutes
old. Category order follows `LEADERBOARD_METRICS`. Selection rotates across boards,
skips prior winners, and walks below duplicates, within each board's top 100.
Reserved addresses win first, then leaderboard Veterans, leaderboard Members,
social Veterans, and social Members. Empty leaderboard places pass to social
selection at the same tier. Unfilled manual/community reservations do not silently
become social places.

The script reads X metrics in batches of 100. Each batch records its actual observation
time; it does not claim historical metrics at an earlier cutoff. Rank uses the
average weighted score across submitted posts. The tie-break is submission time,
then lexicographic X user ID. Missing posts or foreign authors stop ranking.

Review `results.json` and its `.scores.json` companion. To exclude reviewed accounts,
provide a private JSON array of X user ID strings and rank into a **new** result file:

```sh
bun scripts/allocation_campaign.ts rank /private/path/snapshot.json /private/path/reviewed.json /private/path/excluded-user-ids.json
```

After reviewing, finalize. This recomputes awards from the retained snapshot,
checks its SHA-256, writes the CSV, and publishes the same results to the checker:

```sh
bun scripts/allocation_campaign.ts finalize /private/path/results.json /private/path/snapshot.json /private/path/blast.csv
```

CSV columns are `address,cap_sui,cap_mist`. Addresses are normalized and sorted.
Amounts use integer MIST. Veteran caps are 125 SUI; Member caps are 70 SUI.
Confirm Blast's preferred column names and import the CSV there. Page finalization
does **not** mean Blast has imported it or that an on-chain allowlist matches it.

Retain the snapshot, exclusions, result, and CSV. Back up Redis until handoff is
verified. Campaign records have no automatic expiry; only OAuth/ticket/challenge
keys expire. Retire the temporary database explicitly after the campaign. The checker
needs its final awards until it is replaced by a static archive or removed.

## Verification

```sh
bun test packages/immutable/test/allocation.test.ts
bun test ./packages/server/test/allocation/api.integration.ts
```

The integration test starts its own temporary Redis Unix socket and requires
`redis-server`. It is an explicit integration check, separate from the native unit
suite. Share PNGs render on the server through the existing workspace Canvas library.

## Purchase integration boundary

Wallet sessions expose `blast.simulate` and `blast.purchase` through the existing SDK
executor. No purchase UI is enabled by this campaign yet. The actual KARES currency
and presale do not exist at the time of preparation. Before enabling purchases,
verify the sale's published terms and its complete `blast_presale` pin: `id`,
`package_original`, `package` (reviewed call target), `package_version` (shared
version guard), and Blast `url`, plus the root `kares_coin_type`.

The prepared builder targets the versioned Blast ABI. An older deployment without
`PackageVersion` is not silently accepted. Allowlisted purchases also need the
exact leaf index, cap in MIST and hexadecimal sibling hashes for Blast's published
root. A CSV row alone is not a Merkle proof; confirm Blast's proof delivery or
tree construction before wiring this UI. Chain simulation remains the authority
on eligibility, caps, available SUI and lifecycle.

Unsigned rehearsal against an **existing, already migrated Blast test sale**:

```sh
bun scripts/simulate_blast_purchase.ts --fixture
```

This is expected to refuse with `EInvalidLifecycle`, proving the deployed call
surface without accepting a purchase. It is not a successful KARES rehearsal.
The script has no signer, execute call, publication or deployment path. A reviewed
public JSON input can later supply the real `config`, `sender`, and `purchase`
(`method`, atomic `amount`, and allowlist `proof` when needed). Run a successful
simulation on the actual configured sale before enabling its confirmation UI.
