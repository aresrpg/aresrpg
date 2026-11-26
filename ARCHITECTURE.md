# AresRPG architecture law

This file describes the current system in present tense. Read it before changing architecture. It holds no history
and no checklist. `DECISIONS.md` holds the rulings and their motives; this file states what the system is.

> Move owns game truth; the indexer projects it; the server pushes it; reducers retain it; the SDK writes it; the
> engine presents it; `seed/` authors content.

## The one law

Every fact has one owner. Every other appearance is a derivation, a transport, a cache or a presentation. A derived
copy is disposable and never becomes a second write authority.

When an owner or a public contract changes, every projection and consumer changes in the same work, and the old path
is deleted. Packages of this monorepo keep no compatibility twins between them.

## System flow

```text
AUTHORED CONTENT
seed/*.json ──release tooling + SDK──▶ Sui content objects

LIVE WRITES
UI intent ──reducer──▶ observer ──SDK PTB──▶ Sui Move
                                             │
                                             └──certified receipt──▶ reducer

LIVE READS
Sui checkpoints ──▶ indexer ──▶ FalkorDB graph + evt:* pub/sub (graph Redis)
                                      │                 │
                                      └──────▶ server ◀─┘
                                                  │
                                    one WebSocket, protocol packets
                                                  │
                          site · game · mobile · hosted bot (reducers)
                                                  │
                                      React UI + Three.js engine

EPHEMERAL REALTIME
presence, chat, fight drafts ◀──server mesh Redis──▶ other seats
```

The chain is authoritative. A receipt and a server packet can describe the same transaction at different times, so
reducers are monotonic and idempotent. Arrival order is never authority.

## Package ownership

| Home                   | Owns                                                                                      | Must not own                                         |
| ---------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `packages/move-math`   | Pure on-chain values, validation, curves, grids, brackets and deterministic transforms    | Objects, capabilities, clocks, entropy, state writes |
| `packages/control`     | The deployment's AdminCap and freeze authority                                            | Gameplay, content values, player state               |
| `packages/kares`       | The retired currency's type layouts, kept only for compatible game upgrades               | Issuance, sale, staking or payout code               |
| `packages/rewards`     | Currency binding, staking, boss emissions and community vesting                           | Currency issuance, game state                        |
| `packages/currency`    | The currency's one issuance and its fixed three-share split                               | Sale, staking, payout or market logic                |
| `packages/currency-lp` | The market pool's liquidity token and the Aftermath interface it compiles against         | Pool rules, fees, liquidity custody                  |
| `packages/move-combat` | The authority-free deterministic fight state machine over plain values                    | UID, keys, custody, transfers, events, clock, Random |
| `packages/seed`        | Registry-rooted living content objects and AdminCap-gated content writes                  | Player state, gameplay custody                       |
| `packages/move`        | Players, world, custody, events, randomness, clocks and the fight wrapper                 | Combat rules, authored content                       |
| `packages/fight`       | The TypeScript fight twin and its presentation inputs                                     | Chain access, React, rendering                       |
| `packages/immutable`   | Shared vocabularies and tested mirrors of stable game math                                | Live state, network access                           |
| `packages/sdk`         | Every client-side transaction, PTB composition, the object-ref cache and receipt decoding | General player-facing reads, app state               |
| `packages/indexer`     | Checkpoint decoding and the only writes to FalkorDB and the graph Redis                   | Game authority, authored content                     |
| `packages/server`      | The one WebSocket: snapshots, graph reads, subscriptions, presence, chat and fight relay  | Durable game truth, chain writes                     |
| `packages/protocol`    | Packet types and parsing, shared wire projections and the one request limiter             | Independent gameplay state                           |
| `packages/bot`         | The hosted bot: OAuth/MCP door, custody records, grants, authored trees and wallet actors | Game truth, inference, arbitrary signing             |
| `packages/discord`     | Forwarding live notification events to Discord as PNG cards                               | Game authority, graph writes, sockets                |
| `packages/frontend`    | The site and the game: reducers, observers, UI, local prediction and reconciliation       | `@mysten/*` access, authoritative game state         |
| `packages/ui`          | Shared visual tokens, accessible React controls and windows                               | Stores, SDK calls, gameplay math, content            |
| `packages/engine`      | Terrain, models, cameras, audio, effects, rendering and collision presentation            | Network, wallet, gameplay authority                  |
| `packages/journal`     | The static editorial site at `journal.aresrpg.world`                                      | Game runtime, chain writes                           |
| `seed/`                | Authored items, mobs, spells, recipes, worlds, dungeons, boards, offers, gifts and assets | Live player state, website artwork                   |
| `pins.json`            | The current mainnet deployment: package lineages, shared objects, the content ledger      | Authored gameplay values                             |

Dependencies point toward smaller owners. The frontend composes engine, fight, immutable, protocol, SDK and UI. The
server composes engine data, fight and protocol. Protocol composes fight and immutable. Engine, fight and immutable
depend on no application package. `move-packages.json` is the public Move deployment graph and pins the Sui CLI.

`pins.json` describes one mainnet deployment and nothing older. Its optional `seed_ledger` holds only the current
Registry's reconciliation metadata. Browser builds for testnet read an ignored local pins file under `.dev/`;
`ARES_PINS_FILE` overrides the choice. A missing local file never falls back to mainnet. `scripts/browser_pins.ts`
gives the frontend and the SDK the same selected file and leaves `seed_ledger` out of browser output.

## State and effects

The frontend, the server and the hosted bot use one loop:

```text
input ──▶ pure reducer ──▶ new state ──▶ observer ──▶ effect
                                      effect result ──▶ new input
```

- One reducer owns each stateful domain.
- Callbacks, promises, timers, sockets and render loops never write a store. Their results re-enter as inputs.
- A long-lived mutable map lives inside an observer or reducer boundary and is never game truth.
- Selected UI state derives from per-identity state; it is never a synchronized second copy.
- Presentation fires from observed state deltas. An event can enrich a delta; it never triggers one.
- A character receipt (a raise, a heal, craft experience, an equipment change, a pet meal) folds only onto the row its
  transaction started from. A roster or item row that already shows the result, or anything newer, is the truth.

### Two documents, one store

The frontend builds two documents (`packages/frontend/vite.config.ts`). `index.html` is the site. `world.html` is the
game, served for every address under `/world` (`packages/frontend/vercel.json`). The site never loads the game's code;
`Play` opens `/world` in a new tab.

`packages/frontend/src/store.ts` is the store engine: the input queue, the event bus, the Zustand store and its hooks.
It imports no module. A module is `{ name, initial, reduce, observe }`. `start_app(modules, { seat })` builds the state
from the modules' `initial` slices, folds every input through exactly their reducers in list order, and starts their
observers. Each surface owns its list beside its entry:

- `src/site_modules.ts` (`SITE_MODULES`) for the site;
- `src/game/game_modules.ts` (`WORLD_MODULES`, and `GAME_MODULES`, which runs every observer except the lab's);
- `src/practice/modules.ts` and `src/demo/modules.ts`, which keep the game's slices and reducers and run only their own
  observers (`observing`).

A site module (`SiteModule`) reads only the site's slices (`SiteState`) and returns every other slice unchanged, so the
game composes it as is. Site code selects with `useSiteStore`; game code with `useAppStore`.
`test/site_boundary.test.ts` walks the site's static imports and fails on the engine, the mobile package, game code,
Three.js, the SDK's auth module or a game-only module.

A module sends a packet through one door, the `server/send` input, which the session observer forwards to the live
link. A live observation is a `(state, previous) => packet | null` subscription registered with
`observe_subscriptions` (`src/modules/session.ts`). A view on screen is one nullable observation of its domain
(`market/observed`, `leaderboards/observed`, `distribution/viewed`): it is kept across a sign-in and a reconnect, sent
again when a new link is accepted, and null once the view leaves. Request ids come from one counter per start
(`next_request_id`), so a reply to an earlier view is never taken for the current one.

### The site

`src/site/entry.tsx` starts the site: it requests the current page's code, starts the store with `SITE_MODULES` and
`seat: false`, and renders `src/site/SiteShell.tsx` once. The shell owns the bar (the helmet and name, pages, Play,
language, the wallet or the one sign-in), the status card, the footer, toasts, the sale line and the account dialogs
(`src/site/AccountDialogs.tsx`: the funding window and the wallet import window). A bar link swaps the page inside the
shell; the connection and the sign-in survive every swap. The status card sits in a sticky dock above the footer: it
stays at the window's bottom left while the footer is off screen and lands in the footer's first column, by CSS alone.
Under 1080px the bar's navigation, with the status card at its foot, is a sheet that a burger opens
(`src/site/SiteMenu.tsx`), and the dock is hidden; whether the sheet is open is the shell's own view state, and a page
change closes it.

`src/site/routes.ts` owns the site's addresses: the pages in bar order (`/market`, `/agent`, `/staking`,
`/leaderboards`, `/portfolio`), the game (`/world`), the docs, the agent guides and the outside links. An address the
site does not know is corrected to `/market` with its query kept. `src/modules/location.ts` is the one owner of the
address bar: views read `state.location` and ask for a change with `location/open`. Only `/allocation`, `/docs` and the
gift links (`/gift`, `/claim` with a bearer fragment) boot their own standalone entries. `/enoki` is the OAuth
callback; nothing runs there.

A site page names itself and builds no header. Content that waits on the chain holds its final shape with
`aui-skeleton` blocks. `src/site/SignIn.tsx` owns the one sign-in control and where it stands: signed out, a view
about the account (`is_account_view` in `routes.ts`: the portfolio, the AI page and the staking sections that sign)
holds it centred in the page (`SignInStage`), and the bar shows none; `useSignInStage` is the one reader both use. A failed sign-in or transaction is a toast, never a line beside a button.

### The game

`src/game/start.tsx` starts the game document with `GAME_MODULES` and `seat: true`. `/world/practice` and
`/world/demo` start the practice and the lab instead, with `seat: false`. On a compact or touch viewport the world,
Characters and Settings mount the phone surface `src/mobile/` (`src/player_layout.ts`); other game windows keep their
own responsive layout. Both share one full-viewport canvas and HUD. The game's navigation reducer
(`src/modules/navigation.ts`) owns its pages (world, characters, mastery, kolizeum, settings, admin) and asks
`location` for `/world/<page>` addresses. Market, rankings, docs, staking, the Mastery shop and airdrops are site
pages; the game links to them in a new tab.

### Shared UI, copy and content

`@aresrpg/ui` owns the visual tokens (`packages/ui/src/base.css`), the browser modal lifecycle and the controls. Its
components take presentation props and emit callbacks; they import no store or service. It also owns the page's ground,
`Ground`: a fixed layer that the site shell and the docs each mount once per document. A still poster paints with the
page; after load, one low-resolution WebGL pass draws the dithered cloud and fades in over it. The game document has no
ground. `/world/demo#ui` renders its
catalogue (`@aresrpg/ui/workshop`). A ui stylesheet styles only markup ui renders.

Every player-facing string lives in the eleven YAML locales under `packages/frontend/src/i18n/locales/`. A locale loads
alone; no fallback fills a missing key.

The frontend reads content from one compiled catalogue under `src/content/`, derived from `seed/content/` and generated
constants. A site page imports only the tables it reads. An icon's address derives from its identity
(`src/content/assets.ts`); the build serves `seed/icons`, so a page loads only the icons it shows.

### Telemetry

Production builds start Vercel Analytics, Speed Insights, PostHog and an errors-only Sentry reporter
(`src/telemetry.ts`). The site's `analytics` module measures sign-ins, certified transactions and identity; the game's
`gameplay_analytics` module measures play. PostHog runs without autocapture and without session replay, through the
same-origin `/ingest` proxy. Accounts are sent as a network-scoped SHA-256 pseudonym, never a raw address. Telemetry
strips URL queries and fragments. Analytics failures never block play.

## Chain write law

The frontend never imports `@mysten/*`. It asks the SDK to compose a transaction from resolved objects. The SDK
simulates the exact unsigned bytes once through the Sui Core resolver, signs once, submits once and folds the
certified receipt. The resolver chooses gas; the SDK never names a gas coin. `GAS_BUDGET_MIST` is 0.05 SUI
(`packages/sdk/src/gas_budget.ts`).

The SDK runs one execution lane per network and account (`packages/sdk/src/transaction_execution.ts`). Each pass
(record check, gas and object resolution, signing, submission, recovery, receipt) runs inside one exclusive lock named
by the lane's storage key: Web Locks across the browser's tabs, else an in-memory FIFO. The SDK derives the digest from
the signed bytes before submitting. A lost reply recovers that exact receipt through the Core transaction reader. A
missing or incomplete receipt is uncertain, blocks every later write and is never resubmitted. Each tab keeps its
uncertain digests in its own `sessionStorage`; browser storage never holds signatures or transaction bytes. An
executed failure has a digest and is never retried.

Move exposes the smallest custody-safe primitives. The SDK owns batching, optional stack preparation, Display setup
and non-random action-plus-close composition. Branches over current shared state, sealed randomness and inseparable
authority checks stay on-chain. No client hint becomes authority.

The generated door table (`packages/sdk/src/doors.gen.ts`) is data: one line per Move door, bound by
`packages/sdk/src/client.ts`. Types use the defining package ID; Move calls use the latest package ID.

The SDK reads the chain for transaction inputs. Its other reads are named one-shot exceptions that never become a
gameplay fallback: a Party run-to checkpoint snapshot, a linked item tooltip (one session-bounded LRU), wallet finance
(Economy, reserves, positions, balances, clock), the Blast sale reader, gift status and custody preflight before a
handover or an import. Everything else a player sees comes from the indexer through the server.

## Projection law

The indexer is a layout twin of Move and the only FalkorDB writer. Transactions keep checkpoint order. Each removes
consumed pre-state before it applies surviving outputs; a surviving same-ID output wins. Objects are the graph's
writers; events feed pub/sub, sales, rankings and analytics. Writes complete before their pub/sub notification, so the
server may re-read the graph on any notification. Reads are latest-request-wins per identity.

- The indexer counts only what our packages did. A call counts only when it targets a certified game version
  (`pipeline::game_target`). Royalty revenue is the balance our own `TransferPolicy` collected in the transaction.
- A kiosk enters the graph only when a transaction makes it hold or list a game Item or Character.
- Personal-kiosk ownership comes from certified personal caps and owner markers, never the Kiosk's owner label.
- Item deltas are bidirectional: the current custodian receives the full row, the previous one a removal.

Each indexer owns one private, disposable FalkorDB and replays from the original package publication. Nothing
coordinates or migrates databases between indexers. A projection's identity is the game original, the seed original
and a recovery epoch; changing either original needs a fresh store. Ingestion reads history over HTTP and live
checkpoints through a fullnode gRPC subscription.

The same sequential pass owns three other projections, each replay-safe through absolute, checkpoint-marked records:

- Numeric analytics: transactions, signed net gas and five revenue channels per time bucket. Fine buckets keep two and
  eight days; daily, weekly and monthly buckets keep 400 days (`packages/indexer/src/analytics.rs`).
- Leaderboards: the current UTC calendar month only. Earned XP stays with the earning address.
- Market history: daily volume buckets for 32 days (`market_volume.rs`) and daily per-item price records with OHLC for
  365 days (`market_prices.rs`).

Confirmed sales, rare gathering, dungeon victories and fight loot are published on
`evt:notifications:<game-original>` for `packages/discord`, which forwards only what it receives live and stores
nothing.

`packages/indexer/test/gates.rs` pins decoded layouts and routed event fields against the compiled Move bytecode, and
lists every event the indexer deliberately does not route (`DEFERRED_EVENTS`). A Move layout or event change is
incomplete until the decoders, routes and consumers pass that gate.

## Realtime server law

One WebSocket endpoint and one packet protocol serve every first-party client. The upgrade URL fixes the connection's
stage for its lifetime. One `Claim` type (`packages/protocol/src/packets.ts`) is the upgrade result, the
`packet/connection_accepted` payload and the only stage argument of `create_connection` and `create_player`:

- `open` (no `address`) proves nothing and mounts the public reads: server info, the market, the leaderboards,
  profile inspection and character owners.
- `signed` (`address`, then a signature over the server's challenge) adds the account's own streams and reads.
- `seated` (`address` and `seat=1`, then the signature) is the game seat and mounts everything.

The seat is always asked for explicitly; a client that drops the flag gets the signed stage. One stage table in
`packages/server/src/player.ts` decides the mounted modules. `open` and `signed` mount no module that takes gameplay
input or publishes presence, so such a packet changes nothing there. Public modules receive `viewer`, the proven
address or null.

An address holds one seat. A new seat replaces the old one; the replaced client stays down until the player reconnects.
Only seats count online and meet `MAX_PLAYERS`. Every other socket is a view and is never evicted. Limits:

| Limit                          | Value                                             | Owner                                      |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------ |
| Seats per pod                  | `MAX_PLAYERS`, 1,000 by default                   | `packages/server/src/env.ts`               |
| Views per pod                  | `MAX_VIEWERS`, 5,000 by default                   | `packages/server/src/env.ts`               |
| Live views per visitor address | 64                                                | `packages/server/src/admission.ts`         |
| Pending logins per visitor     | 4                                                 | `packages/server/src/admission.ts`         |
| Graph reads per socket         | 60 a minute                                       | `packages/protocol/src/request_limiter.ts` |
| Realtime packets per socket    | 20 per tracked actor (at least six) + 30 a second | `packages/server/src/player.ts`            |
| HTTP door of every service     | 600 requests a minute per caller                  | `packages/protocol/src/request_limiter.ts` |

One limiter serves every door. It is taken only at a public door, keyed by the socket, the visitor address the
Cloudflare edge reports (`CF-Connecting-IP`), or the verified identity. A request without that header comes from inside
the cluster and is never limited. Counts are per process and in memory: a flood guard, not a quota.

### Account and world

The account a socket proved is one table of domains (`packages/server/src/modules/account_streams.ts`). Subscriptions
precede baseline reads. `packet/characters` is the ready barrier and is sent only after every snapshot domain read
once; a failed snapshot read drops the socket for a normal reconnect. One single-flight reader per domain coalesces
overlapping invalidations. A seat tracks each character from its roster row; the address-scoped roster read is the
ownership proof.

The server follows the push model. A client updates itself from its own receipts; the server never echoes them. It
pushes one snapshot, then streams what the client's own transactions did not cause. The server decides every watch
from the roster and tracked positions; a client never subscribes to a zone. A seat tracks every owned character
without a count cap; the frontend projects at most six of them.

The tracking unit is the 512-block zone (`packages/protocol/src/zone.ts`). Each tracked character mounts a spiral of
radius one around its checkpoint. Public equipment and zone projections share one subscription and one in-flight read
per watched identity in the process. Movement packets name their character and its exact chain checkpoint. A new
checkpoint resets that character's movement allowance before its roster is sent. Speed is priced from the last proven
anchor, never per sample. Outgoing positions coalesce into 50 ms batches (`packages/protocol/src/position.ts`).

The graph Redis carries the indexer's `evt:*` channels. The mesh Redis carries only presence, chat, heartbeats and
fight-draft relays. Every five seconds each pod writes one key, `pod:<id>`, with a 20-second TTL, holding its seated
addresses, tracked character IDs and hosted-bot addresses (`packages/server/src/pubsub_bus.ts`). The online figures are
unions across live pods. Online history is the one off-chain fact the indexer cannot replay.

The server pushes its cached checkpoint lag with server info. The client blocks interaction while the lag is unknown or
above 300 checkpoints (`PLAYABLE_INDEXING_LAG`) and unlocks inside that window.

### Market and rankings

One pod-wide read of every publicly listed type, with its category and quote, runs at most every five seconds and only
while a socket observes the market (`packages/server/src/public_market.ts`). A socket pushes the list only when it
changed. A quote carries the cheapest public price of each paid lot, the listed units and the last full UTC day's
average price against the day before. Selecting a type reads 20 groups with three cheapest public offers each
(`packages/protocol/src/marketplace.ts`); a signed viewer's own offers are excluded before ranking.

The leaderboard samples one window per metric and one row per metric and address at most every five seconds, and
pushes the top 100 (`packages/protocol/src/leaderboards.ts`) plus the viewer's own rank. Optional SuiNS names come from
one 2,000-entry LRU per process, with a 250 ms presentation deadline (`packages/server/src/suins.ts`). A failed lookup
leaves the address and never changes a score.

## Authentication

Google through Enoki (zkLogin) is the only sign-in and the only gameplay signer. The site bar holds the one sign-in
control; the game restores the same remembered session and has no sign-in of its own: signed out, it returns to the
site. The OAuth callback `/enoki` is passive: the opener consumes its result.

The client signs the server's challenge as a personal message. The server verifies it and checks the address with the
Sui SDK's `verifyAddress`, which accepts both zkLogin address derivations. Until `packet/connection_accepted`, the
socket carries no application packet. Login reads no game state from the chain; the client becomes ready after the
server's indexed snapshot.

The SDK checks Enoki's network-scoped session before signing. An expired authorization returns the player to sign-in;
a background challenge never opens a popup. Another Sui wallet enters the game account only through the one import
window, which moves its characters and items through the bot handover path.

## Hosted bot

`packages/bot` is the hosted bot: the OAuth/MCP door for external AI clients and the actor that plays a hosted wallet
on its own game seat. The HTTP door and the actors share one trust boundary; a backend compromise is full authority
over hosted wallets. The operator README is `packages/bot/README.md`.

Custody. Each hosted wallet is a one-of-two multisig of an Ed25519 member and the owner's Google member. Either member
spends alone. The backend encrypts the Ed25519 seed with a separate keyring and keeps the plaintext only in process
memory. One verified Google identity reserves one wallet; provisioning reconciles the same request and never replaces
a committed identity. The owner can recover through the Google member without this service.

Store. Redis holds encrypted seeds, public descriptors, verified owner mappings, consent and grants, authored trees
and stop, pause and lease decisions. Every key is `<namespace>:<collection>[:<id>]`, built only by `keys` in
`packages/bot/src/store.ts`. Commands, signed envelopes, receipts and tree progress live only in the process that
executes them. A restart starts each active tree again from its root on fresh observations, so a non-idempotent leaf
can repeat; there is no exactly-once guarantee.

Processes. A durable lease per wallet keeps one owner process and fences the others. Owner reads and controls reach
that process through Redis pub/sub, never a stored queue. A process holding a submitted envelope keeps renewing its
lease; a lost lease reports the command uncertain. A server close of the bot's socket is a fact: the next pass that
needs it reconnects under the same lease.

OAuth uses S256 PKCE, exact registered redirects and the exact MCP resource. Consent binds the bot's address,
descriptor and generation, the owner, client, scopes and policy revision. Only token hashes persist; refresh rotation
detects reuse. Every SDK prepare, sign and submit rechecks the live grant, policy and lease fence. Wallet funding is
the only spending limit. `/mcp` authenticates first and takes the verified owner's allowance; every other route takes
the visitor's; `/health` is never refused.

Play. The external AI authors a JSON behavior tree per hero; the bot ships no tree catalogue and calls no AI provider.
One tree acts for one hero, and a hero has one run keyed by bot and character. A wallet hosts at most 30 runs
(`MAX_WALLET_RUNS`, `packages/bot/src/run_ref.ts`). The wallet lane is the signing queue and holds heroes, not
prebuilt transactions: a hero whose contested fight turn expires first signs first, then the others in a ring, one
signature at a time. A direct command (`bot_<action>`) is a one-shot entry of the same queue; a wallet holds one at a
time. Failure handling:

- A domain refusal fails its leaf, so a selector may take another branch.
- A failed or cancelled command selects again only when a fact it was judged on has moved. A refusal before
  submission is also retried after `BOT_REFUSAL_RETRY_MS` (30 s, `packages/bot/src/config.ts`).
- An uncertain command waits for receipt recovery and is never signed again.

Team play emerges from per-hero trees; there is no team controller. The dungeon key rule (`raid_entrants`) lives in
`packages/bot/src/behavior_team.ts`; area rules (`area_contains`) live in `packages/bot/src/target_constraints.ts`.
The bot collects its own kiosk proceeds once they reach 0.1 SUI (`packages/bot/src/market_collection.ts`).

The MCP surface is one tool table (`TOOLS`, `packages/bot/src/mcp.ts`). `bot_observe` is a short status; detail comes
from named views of the same read path (`bot_inventory`, `bot_item_stacks`: 20 by default, 200 at most, `bot_zones`,
`bot_market`: the public market, which borrows the wallet's one market view, `bot_arenas`: the Kolizeum lobbies and tournaments the
account stream pushes, without any name a player chose).
The bot pushes its status on its own game socket (`packet/agent_status`); the server relays it inside the owner's
account stream without storing it. No first-party client reads the bot over HTTP on a clock.

The site's `/agent` page sets up an agent; an assistant's consent link is `/agent?authorization_id=…`, and a request
waits for the player's click. The portfolio moves heroes and items between the game wallet and the bot wallet through
the SDK handover (zero-price exclusive offers, then claims).

## Domain contracts

### Funding

One address-first checkout (`src/funding/`, opened by `funding/open`) tops up a wallet. A Sui source sends SUI through
the SDK. EVM and Solana sources request a NEAR Intents 1Click exact-output quote to the game wallet, with 1% input
slippage and a ten-minute payment deadline (`src/funding/near.ts`). Solana reads go through the same-origin
`/api/solana` relay, which accepts reads only. Privy connects existing EVM and Solana wallets; it never logs in. The
suggested amount covers the shortfall plus a 0.2 SUI cushion; the cushion is not a gameplay gate. Progress lives in
the modal only; a closed modal ends it, and the player retries the game action by hand.

### Characters and equipment

A character costs 10 SUI, paid exactly at creation (`packages/move/sources/character.move`). Its ID derives from the
name registry and its lowercase name. Every character and item is born locked in a personal kiosk. Characters change
owners only through the marketplace and only bare of equipment. The frontend projects at most six characters.

Equipping sends the item to the character's own address; the slot record snapshots the item. Hats and cloaks have
statless cosmetic twins in the same equipment map. Total stats are a cache written only by equip and unequip. HP
regenerates lazily from the last checkpoint write. Stat and spell points are stored as available balances.

Model identity derives from item and mob identity through one shared parser (`basename__variant`); seed carries no
appearance fields.

### World actions

Travel, gathering and zone search are SDK actions proved by Move against the character's checkpoint. Each discovered
zone is a shared object under its world; only first discovery writes the World. Zone populations are derived by the
server (`packages/server/src/zone_spawns.ts`, the twin of `packages/move-math/sources/zone_math.move`); the client
never rerolls them. Gathering consumes one node, banks job XP and may fire a protector verdict that roots the character
until it fights it. Automatic travel (run-to, gathering travel, party follow) uses one navigator and the shared locomotion controller.

### Fights

Core Move owns the Fight object, custody, entropy, events and settlement; `packages/move-combat` owns the
deterministic transition; `packages/fight` is its TypeScript twin, checked against generated Move constants
(`packages/fight/src/move_contract.gen.ts`). A turn is one PTB: the drafted moves, casts and strikes, then one terminal
end-turn door that advances the turn or seals loot entropy. Drafts relay through the mesh for presentation and never
authorize spending. Entropy is pipelined one boundary ahead, so a retry repeats the same result. Force start becomes
legal 60 s after placement opens; a turn lasts at least 3 s, and anyone may pass it after 45 s
(`packages/move-combat/sources/combat.move`). Fight timers offer actions; they never take them. Settlement returns
characters, grants XP and
mints drops from entropy sealed when combat ended, in one PTB per personal kiosk.

Duels, PvM, dungeon rooms, Kolizeum and tournaments use the same fight machine. Kolizeum takes a 10% cut at start
(`packages/move/sources/kolizeum.move`). A seat's access rule, never its population, decides who may join. The server
relays fight drafts only from the connection's own seat.

Placement, turns and cranks are shared by every mode. Ready, start, forfeit, settle and close belong to what manages
the fight; `fight_mode` and `fight_doors` (`packages/sdk/src/fight_doors.ts`) map a fight row to those doors for the
game client and the hosted bot alike.

### Tournaments

Core owns rosters, deadlines, linked fights and prizes; `move-math` owns the single-elimination bracket of at most 64
teams (`packages/move-math/sources/tournament_bracket.move`). Nobody can start before the scheduled time; after it,
anyone may crank the start. A match admits players during the fight placement window after it becomes available, and
anyone may end an unfinished match after 30 minutes (`packages/move/sources/tournament.move`). An optional SUI fee per
character goes half to the treasury and half to the prize pool.

The rules a wallet plays by (who may register or enter, and its one next action) are pure functions of the projected
row in `packages/protocol/src/tournament_rules.ts`; `run_tournament_action` (`packages/sdk/src/tournament_play.ts`) sends the
chosen action. The game client and the hosted bot (`tournament_step`) both use them.

### Dungeons and Mastery

A dungeon run is a Character dynamic field: dungeon slug, room and committed seed
(`packages/move/sources/dungeon.move`). Entering proves travel to the city anchor and burns the dungeon's key. Rooms are ordinary fights. Recall and City
consumables are refused for the whole run.

Mastery is one soulbound object per address. Once per epoch a free character draws one city dungeon of a chosen
world; a final-room win in that world after the draw earns the snapshotted points. Mastery offers sell statless items
for earned points or for 1,000 burned KARES per point (`packages/rewards/sources/amounts.move`). The shop is a section
of `/staking`; the daily quest is played in the game.

### Giftcards and gifts

A seed-authored Giftcard is the only distribution entitlement: a portable object whose possession allows one
burn-on-redemption mint into a personal kiosk. Issuance is AdminCap-gated and stops at the permanent freeze. Holder
allocations are recipient batches in `seed/content/airdrop.json`, expanded by the SDK into per-recipient vouchers. The
staking page's airdrop section imports wallet-held vouchers and redeems them while it is on screen, at most 100 per
transaction (`packages/sdk/src/giftcard_batch.ts`). A printed card's link (`/gift#$<key>`, or `/claim#$<key>` on QR
cards) keeps its zkSend key in the URL fragment and is claimed on the gift page alone (`src/airdrop/gift_runtime.ts`).
The page keeps the link in the tab's session storage through the Google sign-in and a reload, and forgets it once the
chain shows the card claimed or spent; the app store never reads or claims a link. The player's wallet pays every step
and must hold 0.1 SUI first (`packages/sdk/src/gift_contract.ts`). Loot boxes open
and redeem up to 50 at once (`packages/sdk/src/loot_boxes.ts`).

### Marketplace

Sui Kiosk objects own listings and custody. Paid lots are 1, 10, 100 or 1,000 units with a 10% royalty
(`packages/immutable/src/marketplace.ts`); Move rejects other paid sizes. A zero-price exclusive listing is private
escrow. The indexer projects current listings and sales history; the server serves them as described under
[Market and rankings](#market-and-rankings).

`/market` browses and buys; an item's page is `/market?item=<type>`. Selling and the sales history live on the
portfolio. One marketplace reducer reconciles packets and certified receipts by version and never treats an unseen row
as deleted. Up to ten recent offer pages give an immediate display; only a fresh observation can buy.

Peer trade is one shared Trade object between two addresses for items, SUI and KARES, with revision-pinned offers.

### KARES and reward reserves

The currency and the rewards have separate identities. The game accepts one nine-decimal burn-only currency through
the `packages/rewards` Economy. Publication creates an unfunded Economy: boss settlement then records a zero payout.
One setup binds the currency and funds 200 million staking, 100 million combat and 110 million community tokens
(`packages/rewards/sources/amounts.move`).

The project issues the currency itself. `packages/currency` mints one billion tokens once, makes the supply
burn-only and holds it in a non-transferable Genesis object that opens only into three fixed shares: 540 million
liquidity, 410 million reserves and 50 million team. The launch is three treasury transactions (`kares_launch.ts`):
publish the currency and the pool's liquidity token as immutable packages, register the currency, then one atomic
transaction that creates the market and funds the Economy. The market is one Aftermath pool, 80% KARES and 20% SUI,
with a 0.3% pool fee that stays in the pool, behind Aftermath's DAO-fee wrapper that pays 2% of every swap, deposit
and withdrawal to the treasury. Every liquidity token goes to address `0x0`, so the pool can never be withdrawn. The
treasury keeps the team share, the fee authority and the metadata authority. No contract of ours holds market logic:
weights and the pool fee are permanent Aftermath facts, and only the treasury fee rate can change.

Community tokens vest over 1,825 days to the treasury. Boss emissions pay at most the daily combat quota to the
winning seats. Staking keeps principal separate from KARES and SUI rewards; its clock pauses while principal is zero.
Marketplace royalty claims fund staking with 20% of the withdrawn SUI. The permanent freeze destroys all six active
UpgradeCaps with the content freeze in one cold-wallet transaction.

`/staking` is the token's one page, with four sections behind its hash (`#staking`, `#tokenomics`, `#mastery`,
`#airdrop`). Its finance reads are the SDK's wallet-finance exception. The game's token features stay off until the
launch pins `kares_coin_type` and `kares_currency`. The failed Blast sale keeps its own pinned `coin_type`, a different
coin: `/allocation` and the sale card remain only so its buyers can take their refund, and are removed once every
commitment is claimed.

### Wallet card and portfolio

`src/components/WalletCard.tsx` is the one wallet card on every signed-in surface: the game wallet, plus the bot wallet
as a second tab once the owner's hosted signer is verified. Add funds opens the one funding window. Transfer moves
coins between the owner's two wallets; the bot wallet has no Send. Its card opens under its trigger through a named CSS
anchor, in the site bar and in the game alike (`src/components/app_layout.css`). `/portfolio` shows the account's
heroes, bag and listings. Its bag is the game inventory's rule (`src/portfolio/bag.ts`): one cell per stackable type,
whose listing and transfer take every stack. Hero power (`hero_power`, `packages/immutable/src/item_power.ts`) is
cosmetic and decides nothing.

### Beginner journey and portraits

The beginner journey is client-only: `seed/content/journey.json` authors its objectives, IndexedDB stores completed
IDs per network, package and account, and observations never write the chain.

Portraits render from `seed/icons/characters` masters and `seed/portraits` masks through one read-only endpoint,
`packages/frontend/api/portrait.ts`. The portrait URL carries class, sex, colors and art revision. With `card=poster`
it also carries a hero's name, level, power and worn items, and draws the 1200 × 630 share card with the site's one
link-card painter (`packages/frontend/social_card_render.ts`), which the build also uses for every page and docs
card. A shared hero post links `/api/share?hero=<id>`, which the site rewrites to the game server's one share page
(`packages/server/src/share_preview.ts`, also the allocation card's preview): a crawler cannot hold the socket, so
that page reads the hero from the index and points its card tags at the poster.

## Presentation

`packages/engine` owns one WebGPU renderer per world; there is no WebGL fallback. Fights mount in the world renderer.
The quality profile (`packages/engine/src/quality.ts`) caps visible frames at 30 FPS on Low and 60 on Medium and High
and selects render scale, residency and effects. Missing WebGPU blocks the world and explains why. A failed engine
retries once on a fresh canvas at minimum quality, then stops and offers Reload.

The game core owns world focus and chunk residency; the engine owns meshing workers, GPU resources, atmosphere and
effects behind a plain-data API, and no Three.js type crosses upward. Boot reads engine data through
`@aresrpg/engine/data`, which never loads Three.js. Fight presentation is one ordered cue queue that waits for each
renderer-owned cue before the next; persistent state derives from the checkpoint. Captions share one instanced GPU
overlay with a 128 MiB atlas budget (`packages/engine/src/caption_layer.ts`).

Generated artifacts are compiled offline and checked by `bun run validate:assets`: spell effects from
`seed/content/spell_effects/`, cities from `seed/structures/` and `seed/scenes/`, the asset workshop
(`seed/scenes/asset_workshop.json`) and portrait masks. City compilers are city-specific; cities share artifact
mechanics, not a settlement grammar. City detail archives allow 4,096 cells and 500,000 triangles
(`packages/engine/src/detail_artifact.ts`). Runtime never solves layouts; workers load only the requested columns.

`seed/sounds/` holds the audio files and `seed/content/audio.json` assigns cues. The frontend audio registry is the one
playback pool; it plays from observed state changes, never from packet arrival.

## Content

JSON under `seed/content/` is the authoring truth; assets live beside it under `seed/`. `/world/demo` edits those files
in development without a wallet session. `bun run validate:seed` (`scripts/validate_seed.mjs`) rejects invalid
structure, broken references and immutable-identity changes. Release tooling diffs authored content against published
content through the SDK and writes only the needed batches; the ledger in `pins.json` makes every batch resumable.
`CONTENT_UPGRADES.md` is the operational runbook. Content written on-chain is never indexed: clients ship the seed
catalogue, and the graph projects live state only.

## Verification and release

`bun run test` is the canonical suite: the fight generator check, TypeScript tests with Bun's 60% line / 75% function
coverage floor (`scripts/assert_coverage.mjs`), seed validation and the Move package check. Each package has one core
scenario suite under `test/`. Move floors live only in `scripts/coverage_move.sh`; the indexer's Rust floor is 65%
lines. The browser smoke set (`bun run test:regression`) is the explicit list in
`packages/frontend/e2e/playwright.config.ts`, plus one WebGPU renderer smoke check; other browser cases are
diagnostics and never block.

CI (`.github/workflows/gate.yml`) selects Move, indexer and browser lanes with `scripts/ci_inputs.mjs` against the last
green `edge` push. Every source change runs the production bundle check: no sourcemap, private endpoint or key ships.

Every `edge` push deploys `edge.aresrpg.world`. Production moves only from an owner-created semver tag. Preparation
(`.github/workflows/release.yml`) builds the changed server, bot, Discord and indexer images and stages the Vercel
build. It certifies on the first green `edge` gate of the tag commit or of its parent when the two trees differ only
in the root `package.json` version line. Activation (`.github/workflows/activate-production.yml`) promotes exactly
that preparation without rebuilding. `scripts/release_inputs.mjs` owns the release fingerprints.

## Extending the system

Before adding anything, find the existing owner and compose it. A new fact needs one explicit owner. A new projection
names its owner and stays read-only. A new effect enters through the owning reducer. A new cross-language twin gets a
mechanical parity gate.

```text
owner changed → contract changed → every projection changed → old path deleted → invariant sealed
```

If the explanation needs two owners for one fact, the data model is wrong.

## Documentation ownership

- `ARCHITECTURE.md`: the current system and its laws.
- `DECISIONS.md`: active rulings and their motives; search the domain being changed.
- `AGENTS.md`: the working agreement, the TypeScript code law and the required gates.
- `CONTENT_UPGRADES.md`: content, package publication and release operations.
- `CONTRIBUTING.md`: branch, review and release workflow for contributors.
- Package READMEs: running and configuring one package; they never redefine this file.
- `packages/frontend/public/llms.txt` and `packages/frontend/public/agents/`: the public agent playbook. SDK examples
  under `packages/sdk/examples/` typecheck with the SDK.
- `packages/journal/content/`: editorial articles; only entries marked published are built.
- `changelog/`, provenance files and source lists are history, never current architecture.
