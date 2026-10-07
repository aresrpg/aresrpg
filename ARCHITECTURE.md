# AresRPG architecture law

This file describes the current system, in present tense. It is the first document to read when
changing architecture. It contains no history and no implementation checklist.

One sentence owns the model:

> Move owns game truth; the indexer projects it; the server pushes it; reducers retain it; the SDK writes it; the engine presents it; `seed/` authors content.

## The one law

Every fact has one owner. Every other appearance is a derivation, transport, cache, or
presentation. A derived copy must be disposable and must never become another write authority.

When an owner or public contract changes, every projection and consumer changes in the same
work. The old path is deleted. This monorepo does not keep compatibility twins between its own
packages.

## System flow

```text
AUTHORED CONTENT
seed/*.json ──SDK publication──▶ Sui content objects

LIVE WRITES
UI intent ──reducer──▶ observer ──SDK PTB──▶ Sui Move
                                             │
                                             └──certified receipt──▶ reducer

LIVE READS
Sui checkpoints ──▶ indexer ──▶ FalkorDB graph + evt:* pub/sub
                                      │                 │
                                      └──────▶ server ◀─┘
                                                  │
                                           protocol packets
                                                  │
                                             app reducers
                                                  │
                                      React UI + Three.js engine

EPHEMERAL REALTIME
client presence/chat/fight drafts ◀──server Redis mesh──▶ other clients
```

The chain is authoritative. Receipts and server packets can describe the same transaction at
different times, so reducers are monotonic and idempotent. Arrival order is never authority.

## Package ownership

| Home                   | Owns                                                                                                                                                                               | Must not own                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/move-math`   | Pure on-chain values, validation, curves, grids, and deterministic transforms                                                                                                      | Objects, capabilities, clocks, entropy, state writes                                         |
| `packages/control`     | The deployment lineage's administrative capability and freeze authority                                                                                                            | Gameplay, content values, player state                                                       |
| `packages/kares`       | Retired currency ABI retained only for compatible game upgrades                                                                                                                    | Game state, content, external pool creation                                                  |
| `packages/rewards`     | Upgradeable currency binding, prefunded staking, boss emissions and community vesting                                                                                              | Currency issuance, game state, external market fees                                          |
| `packages/move-combat` | Authority-free deterministic fight state and transitions over plain values                                                                                                         | UID, keys, custody, transfers, events, clocks, entropy sources, transaction context          |
| `packages/seed`        | Registry-rooted living content objects and AdminCap-gated content mutation                                                                                                         | Player state or gameplay custody                                                             |
| `packages/move`        | Player and world objects, authority, custody, events, randomness, clocks, and the thin fight lifecycle wrapper                                                                     | Duplicated combat rules, authored content, browser or indexer policy                         |
| `packages/fight`       | Deterministic TypeScript fight runtime and presentation inputs mirroring Move                                                                                                      | Chain access, React, rendering                                                               |
| `packages/immutable`   | Shared TypeScript vocabularies and tested mirrors of stable game math                                                                                                              | Live state, network access                                                                   |
| `packages/sdk`         | Every client-side Sui transaction plus the explicit one-shot Party checkpoint and linked-Item tooltip reads, PTB composition, object-ref cache, receipt projection, gas accounting | General player-facing reads, app state                                                       |
| `packages/indexer`     | Checkpoint decoding and the only writes to the FalkorDB projection and indexer pub/sub                                                                                             | Game authority, authored content                                                             |
| `packages/server`      | Initial snapshots, graph reads, subscriptions, presence/chat/fight relay, one reducer per connection                                                                               | Durable game truth, chain writes                                                             |
| `packages/discord`     | Live Redis notification forwarding and compact PNG cards                                                                                                                           | Game authority, graph writes, realtime connections                                           |
| `packages/protocol`    | Client/server packet types, parsing, domain routing lists, shared wire-safe projections                                                                                            | Independent gameplay state                                                                   |
| `packages/frontend`    | App reducers, effect observers, UI, local prediction, reconciliation                                                                                                               | Direct `@mysten` access, authoritative game state                                            |
| `packages/ui`          | Shared visual tokens, accessible React controls, windows, and responsive game layouts                                                                                              | Stores, wallet/SDK calls, gameplay calculations, or authored content                         |
| `packages/mobile`      | Landscape player presentation, touch adapters, and fullscreen management overlays using the shared frontend runtime and controllers                                                | Separate game state, transaction execution, authored content, or duplicated page controllers |
| `packages/journal`     | Static editorial publication at `journal.aresrpg.world`, rendering seed-authored Markdown and published-only feeds, routes, metadata, and cover assets                             | Game runtime, chain writes, browser-visible drafts                                           |
| `packages/engine`      | Terrain, models, cameras, audio, effects, rendering, collision presentation                                                                                                        | Network, wallet, gameplay authority                                                          |
| `seed/`                | Authored items, mobs, spells, recipes, worlds, boards, distributions, Mastery offers, structures, and assets                                                                       | Live player state                                                                            |
| `pins.json`            | Current mainnet lineage, shared object addresses, and active content reconciliation metadata                                                                                       | Authored gameplay values                                                                     |

Root `pins.json` describes one current mainnet deployment. It contains no previous deployments,
address-book copies, or retired Registry maps. The optional flat `seed_ledger` contains only the
current Registry's reconciliation metadata and is cleared on game republishing.
Browser builds configured for testnet select ignored `.dev/pins.json`; `ARES_PINS_FILE` can explicitly
override the file in the environment or deployable configuration. They never
rewrite the committed file or fall back to mainnet. Both files declare their network. Frontend and SDK imports resolve the same selected file through `scripts/browser_pins.ts`, which
excludes `seed_ledger` from browser output. Production workflows accept mainnet only.

Dependencies point toward smaller owners: frontend composes engine/fight/immutable/protocol/SDK;
server composes engine/fight/protocol; Discord composes immutable/UI art and the server’s leaf SuiNS/logger helpers; protocol composes fight/immutable. Engine, fight, and
immutable do not depend on application packages.

## State and effects

The frontend and server use the same shape:

```text
input ──▶ pure reducer ──▶ new state ──▶ observer ──▶ effect
                                      effect result ──▶ new input
```

- One reducer owns each stateful domain.
- Callbacks, promises, timers, sockets, and render loops never write stores directly.
- Long-lived mutable maps belong inside an observer or reducer boundary and are not game truth.
- Selected UI state derives from per-identity state; it is not maintained as a synchronized
  second copy.
- Presentation fires from state deltas. Events may enrich a delta but do not make arrival order
  authoritative.

The frontend has one entry, build, environment and authentication lifecycle. That entry selects
`packages/mobile` for compact or touch-capable gameplay viewports; demo and finance retain their responsive surfaces.
Printed gifts select a portrait-friendly DOM entry before gameplay imports. That entry reuses Wallet Standard
authentication and shared UI materials, mounts no canvas, and defers the game and its offline cache until handoff. `PlayerRuntime.tsx` owns the canvas, shared login (including Play Demo), and
global recovery. Desktop and mobile share the full-viewport canvas HUD and `GamePageWindow` feature host.
The mobile surface adds touch input beneath the shared HUD in the same canvas stacking context.
Feature windows consume the same equipment, allocation, spell, crafting, forge and marketplace
controllers; mobile never imports the entry that loads it. Feature navigation selects HUD modals, with URLs retained for deep links. There is no page-versus-overlay mode. The world HUD and fight presentation remain mounted while feature modals suspend manual input. The
shared social dock keeps wallet information, Settings and the party roster during combat; the minimap,
nearby-fight browser and gathering controls remain overworld-only. Portrait blocks gameplay
controls without replacing the canvas. Pending confirmations use compact dialogs.

The existing world input device accepts bounded touch axes and jump alongside keyboard and mouse input.
The mobile joystick and jump button serve both the signed-in world and the local adventure; each scene
supplies its existing input device. Touch-capable tablets retain controls regardless of viewport width.
The joystick and jump button remain faintly visible at rest and brighten during a press.
The canvas camera adapter owns mouse and touch dragging across exposed game space;
HUD controls never enter that adapter. Releasing a touch clears its manual input without cancelling an automated run.
Camera rotation is manual. Touch drags turn faster than mouse drags, and the joystick and canvas
retain separate pointer identities so movement and looking work together with two thumbs.
World prompts expose the same actions through buttons and keyboard shortcuts, with localized tap
instructions on touch devices. Character taps open the existing context menu through the same body
picker as desktop. Camera drags and cancelled touches never become menu taps.
Fight interaction retains one action, inspection target and optional reviewed checkpoint. Touch taps
preview through one pointer-gesture path; compatibility clicks never select again. Confirmation
requires a fresh press on its control and revalidates the same checkpoint through the existing cell-selection door.
Changed checkpoints, action changes and locked actions invalidate review. Board input belongs to the
scene's exact canvas; dragging, cancellation and other UI canvases cannot select a fight cell.
Fight panning lets the camera focus reach every board edge, so touch users can pull cells clear
of HUD controls; the focus remains bounded to the board footprint.

Development module reloads retain the same app-store instance for mounted and lazy consumers.
Stateful core edits restart the app to rebuild reducer and observer lifecycles together.

`@aresrpg/ui` owns the shared visual system and browser modal lifecycle. Its components consume
presentation props and emit callbacks; they import neither application stores nor game services.
The single toast host uses a non-blocking manual popover above game windows. It lives inside the
active native dialog so its actions remain interactive, and follows the shared DOM window observer
without taking focus or restarting notification lifetimes.
Frontend and mobile controllers keep data projection, validation, and writes. The `/demo#ui`
workshop exercises these components with local fixtures and the existing feature controllers.
Marketplace and leaderboard views accept isolated presentation sources; their live controllers remain
the default. Crafting context supplies local inventory throughout preview trees, including portals,
so mock item details cannot fall back to a connected account.
Layout adapts to both viewport and window-container width; touch controls retain native keyboard
semantics and at least 44px targets. Migration replaces each old primitive at its existing owner;
unmigrated feature layouts remain in their application package until converted.

The player app and `/demo` arm different observers. The player app owns wallet/server effects;
the demo owns content editing and local simulation. The public adventure remains local until its
ending modal is ready, then activates the same player observers for direct Google sign-in. The
ending scene stays mounted during authentication; successful login replaces it with the player
runtime in the same app store, without showing the home screen. One ordered registry in
`packages/frontend/src/store.ts` declares each module’s player, demo, or shared observer lifetime.
Activation lists derive from that registry; reducers retain the same shared order.
The world demo exposes Hillaire preview controls through the ordinary world and engine API.
Engine-owned ranges and preset defaults resolve finite, bounded plain-data overrides. The renderer
retains the latest preview through backend startup and quality changes; Hillaire updates uniforms
and rebuilds its existing LUTs only when physical parameters change. Reset and panel teardown
restore the world's preset. These controls never write seed content or persisted player settings.
Localization
observation is shared by player, demo and adventure. Adventure feature windows use real pages
with their actual session state; public finance reads may run, but opening a page never creates
a wallet or submits a transaction.

The read-only `/demo#assets` workshop presents the complete seed-authored kit in one grass-grid
world, through the ordinary world runtime, camera, terrain, detail-cell and plant renderers.
`seed/structures/workshop.recipe.json` owns authored assets, street parcels, landmarks and workshop layout.
`seed/structures/townhouse.family.json` owns townhouse bay dimensions, facade patterns and allowed
variants. The offline neighborhood compiler expands parcels into building plans, uses deterministic
uniform-weight WFC with propagation and bounded backtracking to choose compatible neighboring
roof forms and heights, then constructs geometry from those plans. WFC does not plan roads or
terrain. Floor bands, structural bays, recessed windows, planters, roofs and entrance clearances
derive from each building plan. Attached sides have continuous walls and parcel-contained roofs;
exposed sides receive windows. The original authored house remains the visual reference and street landmark.
The rejected demonstration keep, wall circuit and separate urban-tree asset are removed.

A module declares its cell volume and named boundary ports: position, normal face, opening span
and connection profile. Sealed ports prove solid half-cell coverage over their declared contact
patch. Clearances reject architectural occupancy both within the module and after all placements
are composed. Placement plans name exact port pairs; validation rejects mismatched or reused
endpoints. One offline placement transform applies quarter turns and optional mirroring to geometry,
decoration, clearances and ports; mirrored detail faces retain outward winding. The browser receives
neither architectural plans nor the solver. Existing production city compilers retain their ownership.

Building recipes accept only integer-grid full blocks, top/bottom half-slabs, and straight/inner/outer
stairs in four quarter-turn orientations. Named prop exceptions are chains, cords, banners, lanterns, fences
and the complete campfire. `building_kit.mjs` expands architectural pieces into half-cell occupancy,
rejects intersecting volumes, removes internal faces and merges exposed slab/stair faces offline.
Full blocks remain ordinary voxels; partial pieces become non-colliding detail cells. Both use
the same world-aligned texture coordinates. Square voxel normals retain material micro-relief
without a synthetic edge bevel or convex-edge merge classes. House recipes cannot smuggle arbitrary
boxes or beams through nested building parts. Wall vines reuse scenery.

`bake_schematic.mjs` composes placement plans into existing render formats. The workshop compiler
packs the catalogue into bounded grid cells, partitions full voxels into 32³ structures, and bakes the composition once into
`seed/scenes/asset_workshop.json`. One abortable fetch owns the scene; the normal world-label layer
names its cells. The generated street is the initial camera focus; catalogue captions hide while the
camera focus is inside its cell and return when inspecting the surrounding kit. There is no selection
list, per-asset scene loader or second camera controller.
Authoring stays in seed/code. Banners, ropes and chain links are static baked geometry; plants retain
rooted wind. Campfire assets place bounded GPU flame/smoke batches under the existing scenery lifecycle.
The canonical test command checks the single workshop artifact. City-specific compilers remain the
owners of production cities; the module workshop does not introduce another runtime generation path.

The public adventure owns its local hero, recruited companion, selection, dialogue and combat progress in
one adventure reducer. `seed/content/adventure.json` authors its encounters, companion and quest order;
these never enter the published catalogue. Quest progress derives from those facts. After the first
victory, the equipment quest requires confirming every earned item, including the pet, through the
ordinary inventory staging and acceptance flow before Sceat becomes interactive. Its completion is
retained even if equipment later changes. The tutorial explains that confirmation is a Sui transaction
in the real game; local confirmation stays free and never initializes a wallet. Live gameplay, the local tutorial and `/demo#ui` share the same character selector and quest journal.
The journey source boundary changes facts and actions, never markup; the existing production `JourneyPanel`
owns both the compact tracker and full journal, including progress, quest art, milestones and checklist. The local source also reuses party controls, speech captions and the ordinary multi-character fight resolver.
Recruiting Sceat requires an explicit context-menu invitation; the talk shortcut cannot recruit him.
The local party uses the shared social dock. Speaking actors face the listener, and caption context-menu
picking uses the caption renderer’s own projected bounds. Speech wraps whole words, with grapheme
fallback for long unbroken text.
The world owns disposable actor positions; selection restores each actor once, while equipment changes
preserve its position. Companion following uses the shared automatic-travel navigator and locomotion controller.
The quest tracker and compass supply objective guidance. Local fight presentation takes its encounter anchor from the active fight identity, including its authored floor height; it never falls back to the simulator origin. The first victory advances level 199 to 200; the boss fight ends the local adventure regardless of the combat winner. Local fight sources derive experience from their authored level, so every participant
retains the same level in result projections. The final result waits for the fight animation queue
to drain. A victory then orbits the two heroes, gradually blurs the view as poison takes hold, and
awaits both ordinary entity death animations before opening the rebirth modal. Defeat opens that
modal directly. Its shared Continue with Google button uses the existing authentication reducer
and provider; cancellation stays in the modal and permits retry. Only an authenticated session
can hand off to the real player runtime. Local adventure progress never becomes live character data.

The `/kares` staking route uses the same app entry, navigation reducer and shared feature-window host as
other game routes. Its finance reads and writes use the neutral finance reducer and SDK. The root external-wallet reducer owns one persistent Wallet Standard session shared by admin royalties,
staking, and gift import. It retains authorized accounts grouped by provider for live switching, with one active signing session.
Switching disposes the previous SDK session without disconnecting its provider, and claim transfers or
redemptions block user-requested wallet changes. It persists only the selected provider name and exact public address per
network and origin, restores through silent authorization, and forgets the selection on disconnect
or provider invalidation. Connecting it never replaces the game account. Finance runtimes bind a
session for their lifetime and own only disposable read projections and pending actions. The SDK projects the pool’s next-24-hour funded emissions across schedule boundaries. Staking
presentation derives current rewards and proposed-stake gains from each account’s changing pool
share. The session reducer alone owns game-wallet SUI and KARES balances; staking and Mastery
consume those values directly. Managed staking reads positions and shared finance state without
querying or retaining another balance. External finance sessions own their separate wallet balances.
Staking presents one aggregate per account; the SDK claims rewards or distributes a withdrawal
across its underlying positions in one atomic PTB. Position objects never become UI selections.
The SDK checks Enoki's network-scoped session before signing. Missing or expired authorization
invalidates the wallet session and returns the player to sign-in; background server challenges
never renew authorization by opening a popup. Temporary read failures remain reconnectable.
The frontend production entry initializes Vercel Web Analytics and Speed Insights once for both
game and wallet-finance routes. The independent journal entry initializes Vercel Web Analytics.
The journal renders complete HTML at build time and initializes analytics only on its canonical production hostname.
Telemetry strips URL queries and fragments before sending, so
claim bearer keys never become analytics data. Development and browser-test builds omit the trackers.
The frontend also initializes PostHog product analytics in production, excluding the editor and OAuth
callback. Explicit state-delta events describe anonymous visits, demo fights, login and character creation.
Certified game-wallet transactions feed the analytics reducer through the SDK's shared receipt observer;
`transaction_executed` reports success or failure and certified net gas without sending its digest.
Craft outcome deltas report the recipe, attempts and successes. Both carry the loaded beginner journey
step to measure early crafting friction without identifying characters or wallets. Simulations and unsigned
refusals emit nothing. `fight_started` observes owned participation moving from placement into real combat,
once per fight rather than per character; spectators, local demos and restored active fights emit nothing.
Demo request capture precedes the lazy game/demo download. The existing loading observer reports
playability only after terrain, rendering and the hero model are ready; navigation-to-playable duration
and playable-to-first-horizontal-movement duration use the monotonic browser clock. Initial failures
report only a bounded loading stage. Quality changes and repeated samples do not replay startup events.
Fight start/completion retains the encounter number and outcome. Quest completion uses authored quest
IDs and real progress deltas, including the confirmed equipment quest; restored journey progress emits
nothing. Funding captures modal opens, method views, successful address copies and deduplicated bridge
execution transitions. Viewing direct deposit is not a payment; a balance change cannot infer its source.
The first-character funding welcome and creation form have separate events. Shared telemetry metadata
marks the tutorial revision so the equipment-quest funnel can be compared with earlier cohorts.
The session retains the submitted creation outcome; only the SDK's certified creation receipt marks activation,
never an acquired roster member. PostHog retains a browser-local anonymous identity across reloads; no wallet
address or player name identifies it. An outbound property allowlist excludes URLs, referrers and nested person
properties. Autocapture, replay, surveys and remote feature flags are disabled. Events use the same-origin `/ingest` Vercel proxy, with static and remote-config routes sent to
PostHog's US asset host before the US ingestion route. Both the deployment and service-worker page
fallbacks exclude that namespace. The document referrer policy is origin-only, including same-origin
requests that the proxy forwards. The public project-token build variable overrides the default project;
an empty token disables capture. Analytics failures never block gameplay.
The frontend initializes the shared errors-only Sentry reporter. Caught toast failures retain their raw
exception before translation; React root failures and boot failures use the same reporter. The shared
world observer reports terminal engine failures once per failed-state transition, before UI recovery.
Reports retain caught stacks, device-loss reasons, quality, elapsed time, and browser capability context;
missing WebGPU is a compatibility warning. Disposal removes the observer. The outbound
filter removes credentials and bearer URL data, and Move aborts group by package, module, function and
code. Deployed builds require a public Sentry DSN and label events with their network, deployment target
and available commit SHA. Development and browser-test builds do not initialize remote reporting.

## Chain write law

The SDK owns batching, optional preparation, framework Display setup, and non-random action-plus-close
composition. Move exposes the smallest custody-safe primitives. Branches over current shared truth,
sealed randomness, and inseparable authority checks remain on-chain; no client hint becomes authority.

The frontend never imports `@mysten/*`. It asks the SDK to compose a transaction from resolved
objects, simulates the exact unsigned bytes, signs once, executes once, and folds the certified
receipt. An executed failure has a digest and is never automatically retried. The SDK derives the
digest from the signed bytes before submitting once. A bounded submission request that loses its
response recovers that exact receipt through the gRPC Core transaction reader. GraphQL remains
available for reads; its capped event pages cannot supply complete business receipts for writes. Missing or incomplete
receipts remain uncertain; no retry handler may treat them as an unsubmitted transaction.
One pending record owns both submission recovery and the next-write visibility barrier. Browser
tabs persist uncertain digests and receipt requirements in session storage, scoped by network and
account, before submission; signatures and transaction bytes are never stored. Reloading cannot
erase uncertainty. Recovery before a later write rejects that stale intent and earlier queued
intents; that SDK session requires a refresh after resolving the previous outcome. The normal
visibility barrier remains lazy and never delays an already completed receipt.

Wallet asset selection, including address balances, uses the official Sui coin intent and resolver
before signing. It does not add a second transaction executor or a gameplay-object read fallback.

The SDK logs every certified transaction once with digest and net gas. Its receipt-fed cache owns
fresh object references; explicit hydration is the only bootstrap read for unknown transaction
inputs, while the lazy previous-digest barrier synchronizes consecutive writes. Narrow presentation reads are explicit exceptions: Party may snapshot one external
character checkpoint for run-to, and an item hover in chat or trades may read that exact Item plus its
rolled-stat and pet-feed fields through a session-bounded LRU. Linked pet tooltips derive current bonuses
through the same power scaling as equipment. The external-wallet giftcard import explicitly inspects only that
wallet's canonical vouchers through the SDK, on connection or manual refresh. Game-wallet holdings
remain indexed and pushed. Package type identity uses original package IDs;
Move-call targets use latest package IDs.

## Projection law

The indexer is a layout twin of Move and the sole FalkorDB writer. Transactions retain checkpoint
order. Each removes consumed pre-state before applying surviving outputs; a surviving same-ID
output wins. Custody and current-world context resolve within that transaction. Events publish receipt/lifecycle facts; authoritative object writes
may publish full-row invalidations after projection. The graph is a rebuildable current-state
cache, not another authority. Personal-kiosk ownership comes from certified personal caps and
immutable owner markers, including input observations; the native Kiosk owner label is cosmetic
and never writes ownership edges.

Each indexer owns one private disposable FalkorDB and can run independently in any location.
Nothing coordinates or migrates databases between indexers; a destroyed store replays from the
original package publication and reconstructs every graph and chain-analytics projection.

Production ingests historical checkpoints from the official HTTP checkpoint store, then follows
the live edge through the fullnode gRPC checkpoint subscription. Helm requires that streaming
endpoint, and the HTTP source remains only backfill and failure fallback; an omitted production
stream is a render error, never a silent polling deployment.

The same sequential checkpoint pass owns a separate rebuildable analytics projection in that
indexer's FalkorDB. Successful calls across the game-package lineage write exact UTC activity
membership plus one first-interaction timestamp per address. Character lifecycle observations remain
in daily buckets; the server derives their chart intervals and reads the current Character count
from the graph. Active-player membership stays in 15-minute, hourly, daily, weekly, and calendar-month sets.
Numeric analytics combine transaction count, signed net gas, and all four revenue channels into one
fixed-size record per visible time bucket plus one all-time record. Every record stores its exact
integer totals and last applied checkpoint together; the sequential writer groups all contributions
within each checkpoint before replacing records. Retries cannot double count a partly committed batch.
Fine buckets expire after two/eight days; daily, weekly, and monthly records retain four hundred days
plus their bucket width. Dashboard numeric reads fetch bounded records, never historical checkpoint fields.
Deployment-only core calls and publish, upgrade, and seed transactions contribute neither gas nor activity.

Before its writer starts, an older database converts its numeric hashes through its committed watermark.
Uncommitted checkpoint fragments are excluded and normal replay reapplies them. Conversion publishes its
schema marker only after verified replacements; restarting an interrupted conversion recomputes from
untouched originals. Once complete, original numeric hashes receive at most seven more days of retention.
The schema marker gates readers; mixed binary versions require indexer-before-reader rollout.
Independent indexer databases still reconstruct all projections by replaying from original publication.

Leaderboards are another projection of that same checkpoint pass. Rankings reset at each UTC
calendar month boundary, using checkpoint timestamps. Only the current standings are retained. Earned combat
and job XP stay with the earning address across character transfers. Fight victories count mobs once
per winning address, while successful dungeon completion counts once per fight and address even
when settlement crosses months. Public marketplace purchase receipts own gross buying and selling
volume; mandatory game policy proofs emit the immutable seller address so historical checkpoints
need not retain read-only owner-marker objects. Exclusive listings and private trades do not contribute.
Kolizeum payouts, first Zone creation, pet-feeding actions, and harvested resource quantities supply the other rankings. No
connection, roster cap, or name registration gates participation. Exact integer totals and ordered
ranks commit through replayable absolute replacements; a bounded pending batch prevents partial
Redis failures from double-counting. Rollover removes every ranking table before applying the new
month's absolute totals. Dungeon completion markers remain solely to prevent duplicate credit.

Item rows and departures carry certified versions; inventory rejects stale rows and retains deletion
tombstones. Quantity receipts fold exact final balances without waiting for the indexer.
Stack fragments are normal. The UI groups available same-type holdings, while spend-time SDK PTBs
attempt feasible merges before the action. Deposit targets are hints: Move merges a fitting live stack
or locks a new one. Optional preparation may be dropped after a rejected unsigned preflight, never
after an executed transaction.
Item deltas are bidirectional: current kiosk custody streams the complete row, while pre-state
custody streams removal when an item moves away or is destroyed. Clients never retain absent graph rows.
The graph bus resolves each item invalidation once and delivers only to its pre/post custodians.

The indexer retains timestamped public-sale subtotals per checkpoint in daily buckets for 32 days.
The server sums exact rolling 24-hour and 30-day windows; the existing heartbeat carries both totals
to marketplace observers. Once tracking starts, both windows report recorded volume immediately. The sample carries complete
history days; the UI marks a total as a lower bound until its full window is covered.

The indexer publishes confirmed sale, rare-gathering, dungeon-victory and fight-loot facts through
its existing Redis pub/sub writer on `evt:notifications:<game-original>`. Fight gear must match a
winning seat's consumed drop budget, natural stat revision and personal-kiosk custody. A boss
FightEnded produces one party event, independent of later per-character settlement.

`packages/discord` runs from its own `ghcr.io/aresrpg/discord` image and one-replica Helm release.
It only forwards events received by its live Redis subscription. It filters gear using the exact
unweighted mean of normalized variable rolls, strictly above 90%, excluding fixed stats. It resolves
verified SuiNS names and renders compact PNGs with canonical seed artwork, shared UI stat identities,
the SUI logo, palette and bundled Nunito fonts. Copy comes from the existing YAML locales.
There is no polling, notification store, replay, delivery cursor, SQLite or persistent volume.
Missed events stay missed. Received events are serialized in memory; explicit Discord rate limits
are respected, while other failures are logged without replay. Bot image updates and scaling remain
independent of the realtime server. Production images come from GHCR and cluster updates use Helmfile.

Stackable price history folds completed public item sales into daily hashes in the same private Redis.
Each item/day value retains exact decimal MIST, units and sale counts with its checkpoint in one
atomic replacement; interrupted batches skip already-applied contributions. Absolute expiry retains
365 days plus boundary-day padding. Existing indexers begin at their next processed checkpoint,
recording their collection start without moving ingestion cursors or requesting a backfill. The server
reads at most 366 fields in one pipeline for the selected item, pushes refreshed snapshots and marks
uninitialized history unavailable. Server-local five-second samples share each selected item’s history
read across viewers; periodic client observations refresh these samples only while items are viewed. The marketplace reducer owns selection and response identity;
TradingView Lightweight Charts presents unit-weighted daily prices excluding fees in the existing
purple palette. Listings and history occupy two columns when the detail pane fits, stacking below
that width. The price line connects recorded daily averages across untraded dates; those dates remain unpriced
in hover details, without fabricated sales or prices.
The selected stackable item’s response carries price history and total existing indexed units across all custody independently.
A bounded server-local cache shares supply reads for thirty seconds. Its header derives estimated market
capitalization from that supply and the chart’s latest recorded daily average. Missing supply does not hide the chart,
and missing price history does not hide known supply.

Marketplace snapshots include native Listing versions and kiosk catalogue Lamport revisions in one
query, including empty owned catalogues. Catalogue markers follow their relation writes. The client
reconciles receipts and snapshots by version and `(asset,kiosk)` relation, then prunes confirmed
departures. Own listings supply the owned rows of the bounded public window. Sale history never
deletes a current listing: the same asset may already have been relisted.
Marketplace write effects retain their originating wallet session. Account changes cannot let an
old completion clear another account's proceeds, pending state, or operation slot.

Indexer writes complete before their pub/sub notification. The server can therefore re-read the
graph on a notification or gap. Async reads are latest-request-wins per identity.

`packages/indexer/src/gates.rs` pins decoded layouts and routed event fields against compiled Move
bytecode. A Move layout or event change is incomplete until the indexer twin and its consumers
pass those gates.

## Realtime server law

Each connection owns one server reducer tracking every allowed character. The graph Redis carries
`evt:*` chain projections. The mesh Redis carries only ephemeral presence, chat, heartbeats, and
fight-action courtesy relays.

Outgoing positions coalesce by character into bounded 50 ms batches; input speed validation still sees
every sample. Reliable appearance/departure packets clear pending positions for that identity. Native
socket buffers and position queues have hard ceilings; stalled movement closes for reconnect. Frontend
presence changes submit models at most once per animation frame.

Online history is the deliberate exception to chain replay: authenticated websocket presence is
off-chain. Each server heartbeat publishes its short-lived authenticated-address snapshot; their
cluster union collapses into one-minute samples, 15-minute aggregates through seven days, and daily
aggregates afterward. Rolling replicas cannot multiply one player. The admin surface labels this
separate source and freshness; the indexer never pretends it can reconstruct past connections.

One latest reader per account domain serves baseline and refresh demand. Required subscriptions
precede baseline reads; `packet/characters` becomes the ready barrier only after every prerequisite
completes. Connection closure terminates its reducer and subscription lifetime, including pending
acquisitions. Public equipment and zone projections share one subscription and at most one in-flight
read per watched identity in the server process. Indexed invalidations supersede older reads;
the last viewer releases the projection. Zone populations are derived once per retained seed.
Mesh appearances never replace indexed equipment. Discovery replies target the requesting session
and zone acquisition, while ordinary presence deltas remain zone-scoped. Mesh ingress dispatches moves
to process-local character/zone listeners registered only for admitted visible identities. Appearance,
departure and probes retain their zone broadcast. Listener retirement is synchronous with visibility
and world-window removal; it adds no Redis channels or retained presence roster. A failed shared snapshot
closes affected sessions so normal reconnect rebuilds their subscriptions. Unverified transports and verifiers share one finite admission budget; a claimed
address grants no capacity exemption. After readiness, graph events and narrow reads push deltas. The server validates identity, locality, rate,
and relay voice, but it never becomes game authority.
The existing server-info heartbeat carries the fullnode's latest checkpoint timestamp and the
elapsed server time since that read. The frontend clock reducer reconstructs the sample's monotonic
observation time, so cache reuse does not make time run several seconds behind. Automated world
actions and placement countdowns interpolate fresh samples; Force start requires an observed chain
timestamp past the deadline.
Device wall-clock changes cannot unlock placement, and stale or disconnected samples cannot authorize it.

Overworld movement packets name their character and exact chain checkpoint (world, x, z, timestamp).
The indexer routes changed checkpoint children to their Character channel; zone notifications never refresh unrelated rosters.
A roster checkpoint change synchronously resets the server's presence and movement allowance before
that roster is sent. Packets captured under another checkpoint are ignored; matching packets still
obey the speed budget. Client live poses, follower poses, and resume writes retain that same checkpoint
provenance. One follow tick publishes all changed owned poses together; continuing followers reuse
their controller footing instead of probing spawn height again. A new checkpoint invalidates old poses; a duplicate roster preserves ordinary walking.

Reader processes boot independently of projection freshness. The server pushes its cached
checkpoint lag every five seconds; a connected client blocks interaction while freshness is
unknown or more than 300 checkpoints behind, shows rolling progress and ETA, and unlocks
automatically inside that safe window.

The leaderboard server observes one category per connection and pushes the current month's top 100
addresses plus that address's personal rank. SuiNS default-name lookup is an explicit direct-read
exception for optional display enrichment. One expiring 2,000-entry LRU per server process caches
verified names and misses, with a short failure cache. Optional names and badges share a 250 ms
deadline, so each refresh publishes one coherent window without waiting on stalled enrichment.
Lookup failure leaves the address visible and never changes a score. The page always renders ranks
1–100, including empty slots, and shows a day-based countdown to the next monthly reset.

Leaderboard player profiles use correlated, on-demand indexed reads over the existing websocket.
One leaderboard-owned inspection retains the current roster page and selected character's equipment;
it never changes gameplay selection or the tracked roster. Current ownership includes fight custody.
Profiles paginate all holdings by character ID and aggregate profession maxima across that owner,
independently of monthly earned scores. Equipment reads qualify both owner and character and carry
rolled stats, damage and pet power for local tooltips. Each connection runs one inspection at a time
and retains only its latest pending intent. Closing, navigation and disconnect retire the inspection;
request identities reject stale replies. Opening samples again; there is no
profile subscription, polling loop, or retained profile cache. The live profile and UI workshop share one window: identity in the title bar, character roster,
compact equipped-item icons with existing stat tooltips, and account-wide profession maxima.

Settings exposes the game wallet's default SuiNS name through a dedicated reducer, separate from
device preferences. The SDK reads owned registrations and resolves names already targeting that
wallet. One explicit action sets the default; an owned name can update its target in the same
transaction. A target-only subname requires no NFT transfer. Certified results update the Settings
view; the leaderboard's verified-name cache refreshes independently. Full names remain the identity
used for resolution even when a repeated self-subname is displayed as a shorter handle.

## Critical workflows

### Authentication

The `/enoki` OAuth callback is a passive popup. It never starts application observers, navigation,
or telemetry. Enoki in the original tab consumes its callback URL and closes the popup.

The frontend obtains an Enoki or wallet-backed signing session, then opens the websocket. The
server issues a challenge and verifies the personal-message signature. Until
`packet/connection_accepted`, the socket carries no application packets. One address owns one live
connection; replacement is terminal until the player explicitly reconnects. Login reads no game
state from chain—the app becomes ready only after the server's indexed snapshot.

### Funding

Mainnet funding offers direct SUI deposits, external card/PayPal providers, and a lazily loaded LI.FI
widget. The bridge owns its external EVM/Solana source-wallet connections and route execution;
the game wallet is only the fixed native-SUI recipient. Destination chain, token and address are
locked, URL defaults are disabled, and transfer history is scoped to the receiving game address.
LI.FI completion requests an ordinary wallet refresh; only the existing SDK balance read updates
the session. The funding surface shares the vendor's focus-managed DOM modal stack so wallet and
WalletConnect portals remain interactive; game dialogs retain their native top-layer shell.
Testnet funding exposes only the faucet. Mainnet bridge quotes request a 1% integrator fee for
the registered `aresrpg` integration. LI.FI routes that fee to its configured fee wallets and shows
the AresRPG name and percentage in the fee breakdown. No LI.FI API key or game-wallet signer is passed to the bridge.
Solana funding reads use a same-origin, read-only Vercel function. Its `SOLANA_RPC_URL` credential
stays server-side. The relay restricts methods, origin, request and response sizes, and upstream
time; provider failures never expose credentials. Successful response bytes retain exact u64
values. LI.FI broadcasts signed Solana transactions through its separate public write RPC.
Vite serves the same handler locally; no second wallet-balance state or chain writer exists.
The first-character welcome embeds the same wallet card and funding controls as the HUD.
Its mainnet character cost and fee reserve include optional, minute-refreshed LI.FI USD estimates;
unavailable quotes hide those estimates. Only the canonical SUI amounts and wallet balance gate creation.

### Equipment

The Character's existing equipment map owns both stat gear and the statless `cosmetic_hat` and
`cosmetic_cloak` slots. All slots use the same equip/unequip custody flow. Seed rejects cosmetic
stats and damage lines. Presence retains the raw slots; one shared pure presentation rule selects
each cosmetic before its regular hat or cloak. Equip and unequip refresh the indexed visible slots
through latest-request-wins reads, so delayed enrichment cannot restore removed equipment.
Browser builds emit GLB models as files regardless of size. The model loader fetches them under
the production security policy; embedded data URLs are not an allowed connection source.

Equipped title identity uses those same visible-equipment snapshots and deltas, including owned followers.
Fight appearance rows retain that title through normalization for participants and spectators. The frontend
maps equipped title and existing custody-wallet identity to one engine aura descriptor beside model
appearance; title changes do not alter model asset keys or crowd eligibility. One bounded engine layer renders Unbroken's rising emerald energy
and motion trail in two shared billboard batches. The canonical admin wallet selects a client-only red/purple
profile regardless of title, with priority over Unbroken. A third shared normal-blended haze batch runs only
for visible admin bearers; the server sends neither an aura ID nor a special admin-appearance flag. The layer
follows rendered world or animated fight positions, uses canonical character scale, and reduces range and particle count with quality. Trails emit from observed
horizontal displacement; idle replay emits nothing, and teleports or visibility gaps reset retained particles.
Unequipping a title retires its derived effect; hidden/invisible actors, removal and scene teardown retire
all effects, including the admin override. No aura packets, polling, chain writes, dynamic lights or
per-character render passes exist. World Lab's title selector exercises the
same title mapping and renderer used by gameplay; its Admin preview supplies only a local fixture owner.

### World actions

The selected character's projected checkpoint and live pose compose one SDK action. Move proves
travel and writes the result. The receipt folds facts it certifies; the indexer/server projection
reconciles surrounding world state. Each discovered zone is a deterministic shared object derived
under its slim World. Only first discovery mutates World to claim that address; refresh, gather, and
engage mutate the target Zone, so unrelated zones never share a consensus write. Zone populations
are server-derived from published content, never re-rolled by the client. WorldContent stores
seed-derived ordinary-mob-to-archimob mappings
in an upgrade-safe dynamic field. Move and the server twin use a separate deterministic stream to
give every generated eligible member one independent 1% identity replacement while preserving its
group, position, and level scalar.

Move consumes a resource node, banks job XP, deposits the harvest, and retains a protector verdict.
A fired verdict roots the character until deterministic fight creation uses its committed board,
level scalar, and gather-moment HP cap. The frontend retains one attempt per character.
Receipt callbacks match that attempt identity;
Character projections own its root deadline and protector obligation. Observers rebuild timers
from retained state and recheck deadlines on wake. Toast and audio lifetimes cannot gate gameplay
completion, and authoritative protectors can resolve independently of a delayed gather receipt.

Completing every beginner journey quest unlocks the collapsible gathering automation HUD.
Access derives from the current account’s loaded completion record, after pending persistence finishes;
resetting the journey or changing accounts revokes access and stops any run. One frontend automation reducer
owns a selected character's gathering run and emits existing run-to, zone-search, gather, and
fight inputs. Automated run-to mounts an available equipped companion through the ordinary
proximity rule, retains riding between harvests, and remounts on later legs after a fight.
Biome/city eligibility guides nearby zone exploration; only server populations and zone consumption
establish available resources. Expiring depleted-zone visits survive window
eviction without copying populations. Each harvest waits for its confirmed consumption and root.
Automation uses the manual interaction radius and the age-corrected chain clock for travel
readiness. Device wall time cannot release an automated action early. Pose and state changes
advance ready actions immediately.
Only the exact gather-correlated protector is automatically forfeited, once; confirmed return and
fight presentation gate resumption. Browser visibility and app navigation never own the run's
lifetime. Active automation keeps the same world simulation and renderer alive behind other pages;
hidden browsers use timer frames, with bounded physics substeps and no suspended-time teleport.
Temporary connection or clock gaps retain the run and suppress writes until readiness returns.
Unsigned movement/cooldown refusals wait 500 ms before re-entering inspection; the target and
travel proof are checked again. Stop, manual control, identity changes, and all other failed or
uncertain actions stop further automated writes. Executed transactions never retry. Its controls remain available on other pages. Reload never resumes a run.

One automatic-travel navigator owns run-to for position links, party snapshots, nearby fights and
gathering, plus owned-party and adventure following. Open ground uses a one-block clearance probe
without a route search. Obstacles trigger an incremental local search capped at 128 retained cells,
16 expansions per update and an eight-block leg. Easy routes retain full body collision, ordinary
one-block steps and bridge/tunnel layers. Steering targets the furthest clear point among at most
four upcoming waypoints and only reduces run input near the final destination. A failed search or locomotion stall selects a four-block
direct segment through terrain at the ordinary movement speed; its endpoint height uses the shared
collision projection. Segment endpoints resume local navigation, and a materially moved target
invalidates the old route. No world blocks change and no second follower navigator exists.
The locomotion controller owns both ordinary collision and bounded direct motion. Explicit movement
areas remain enforced. Manual input cancels run-to immediately, including inside solid geometry;
cancellation neither ejects nor rewinds the character. Another target can move it out.
City readiness remains per requested chunk; unknown collision suspends navigation rather than
becoming passable terrain. Voxel contact snaps to the crossed grid face within the bounded axis step; it does not binary-search
occupancy. Collision retains only completed immutable structure columns, evicts the oldest column
at capacity, and keeps existing columns when unrelated city artifacts become ready.
Terrain obstruction no longer terminates automatic travel. Only the final
target completes travel; partial routes supply no invented ETA. Gathering retains its final-arrival,
chain-time and transaction gates, while server speed validation and combat restrictions remain unchanged.

Party run-to is the sole direct player checkpoint read. The authenticated SDK reads another
member's current-world and checkpoint dynamic fields once, refuses a different world, then the
client runs toward that immutable snapshot. It never polls or claims to know the member's live pose.

Gathering-job level 30 also unlocks a finite Collect All run for the targeted resource pack,
independently of journey completion. The same automation reducer owns both run scopes. A finite
run stays at that pack, waits for its confirmed harvest, consumed-node projection, and newer character checkpoint, then waits
for a fresh observed chain timestamp to satisfy the next travel/root proof. It never extrapolates
a cooldown unlock from wall time. Page changes preserve finite collection and run-to movement; the existing background world ticker
keeps their simulation alive. Finite collection exposes its progress and Stop control on other pages.
A protector, manual cancellation, connection loss, character/world change, or transaction failure ends
the finite run; finite runs never forfeit protectors. Unsigned timing refusals
retain the existing bounded-delay reinspection rule. Pack depletion or generation replacement
finishes collection without selecting another pack. The HUD derives aggregate progress and an
estimated remaining time from the live pack and current harvest; it owns no action deadline.

### Fights

Overworld exploration automatically observes one public fight within 50 blocks of the selected
character. Public discovery expires one hour after the chain placement timestamp. The server excludes
older fights from discovery reads and releases expired ambient streams. The frontend heartbeat prunes
the shared discovery cache, so swords, ambient boards and nearby dialogs disappear together.
Participant custody, recovery and settlement remain available regardless of age.
The nearest eligible fight is chosen once and retained while it stays in range;
leaving, ending, changing worlds, entering a dungeon, or mounting an immersive fight releases it.
The server independently validates locality and caps this ambient interest at one fight per
connection. Participant, explicit spectator, modal preview and ambient demand share subscriptions.
Fight checkpoint reads coalesce across viewers for each indexer event, while each connection
retains its ordered witness delivery and its own projected authority.

Explicit spectating presents turn order and played turn portraits through the shared fight HUD;
only participants receive action controls.
The ambient board replaces its sword but retains the join marker. It uses the ordinary fight
models, spectator visibility and animation queue alongside world entities. It takes neither
camera nor movement ownership and shows no combat HUD or non-spatial combat audio. Leaving drops
queued animations and releases the runtime unless another watch still needs it. Every board temporarily
clears terrain, foliage, scatter and water above its floor within its footprint and a feathered two-block
rim, through the existing occlusion shader. Ambient clearance is camera-independent; only immersive
fights dissolve foreground geometry toward the camera. Unmount restores the ordinary terrain material;
world occupancy and collision remain unchanged. The selected
character's own or explicitly spectated fight takes precedence and retains immersive presentation.

An active forfeit removes the fighter before advancing through mobs to the next living player in
one terminal transaction. Placement and out-of-turn forfeits leave turn order unchanged; a side
wipe ends combat without another turn. All three fight modes share that lifecycle.

Core Move owns Fight identity, player authority, character custody, entropy, events, and settlement.
`packages/move-combat` owns the deterministic authority-free state machine embedded in that object.
Core authenticates an action and supplies bounded plain entropy and time values; combat returns one
deterministic transition. Mob turns derive a cast limit from the Move-owned row-work ceiling and
the kit's largest normal-or-critical branch. The existing cast ledger enforces it even when spells
refund AP; the presentation twin imports the generated ceiling. Fight entropy is pipelined one boundary ahead: each boundary executes the
previously committed `u64`, then its terminal Random draw commits the next one. An out-of-gas retry
therefore repeats the same combat result without adding a second transaction. `packages/fight` is
the TypeScript presentation twin. One terminal end-turn door reads the post-command Fight state: it
advances a live turn or seals loot entropy after a lethal action, so clients never predict which
chain door applies. Local drafts relay
through the mesh for immediate presentation; End Turn commits the ordered draft as one PTB. Receipts
and indexed witnesses converge through structural turn identities.
Only a successful locally authored action may queue an automatic remote commit when it ends combat
or kills the active player. Streamed courtesy drafts never authorize spending. The terminal door
accepts that dead but unsettled owned seat; live-action gates remain intact. Local simulation advances
through its existing turn boundary. Each eligible numeric effect application resolves one magnitude
from the committed stream; fixed-valued/control rows add no magnitude draw, and duration rows retain their roll.
Each side's six start cells also bound its lifetime admissions. Forfeits return character custody
but do not restore admission capacity; leaving and settlement remain available. Placement occupancy
still follows living fighters, so a departed fighter's cell can be used by a remaining teammate.

Accepted server fight snapshots carry their normalized checkpoint directly to the rollback owner.
Raw packet handlers never read the app cache as a substitute: nested reducer inputs may still be
queued. A rejected placement restores the latest confirmed roster and positions, including joins
that arrived during submission. Hover retains one fight-scoped cell or fighter intent; every range
and preview derives its current cell and valid seat from the same checkpoint.

The terminal checkpoint supplies the settlement plan after presentation drains. Owned participants
returning to one personal kiosk settle and collect through one Random-bound PTB; different kiosks
form separate batches. Their gas budget comes from the existing checked resolver simulation, so a
fixed reserve cannot block an affordable settlement. Team drop selection uses entropy sealed when combat ended, while settlement
Random rolls only fixed-shape item statistics. The certified settlement receipt enables Continue immediately. `RESULT_FOR`
exists only for interrupted-client recovery. Character XP awards restore maximum HP when the character level increases. Settlement writes
combat damage before awarding XP; the existing HP projection carries the healed value and clock.
Character level and experience come from the projected Character row. Level-up overlays the result; dismissing it reveals the result and loot.
The mounted fight board owns HUD visibility; pending settlement custody does not hide the overworld HUD.
Settlement status and explicit Retry remain visible for solo fights as well as groups.
Each remote fight retains its first selected owned character. Ending its presentation restores that
character if the player still controls a participant and still owns the return character. The SDK's
wallet-scoped gas ledger supplies every seat's result total; each settlement and final cleanup refreshes
all results for that fight, including storage rebates. Results disclose the ledger's 24-hour window.

### Sound presentation

`seed/sounds/` owns the file-backed effects; `seed/content/audio.json` assigns semantic cues and
spell names to those files. The frontend audio registry is the one bounded playback pool for
fight and interface sounds. It applies the master volume to both new and active voices and releases
players with the app observer lifetime. Named spells play through the ordered fight cue edge;
unmapped spells retain their elemental fallback. Game feedback observes copied state slices,
not receipt or packet arrivals. The fight-over cue follows the newly visible result once, for
both player and local-demo fights, regardless of outcome or boss rewards. Payout updates do not replay it. Craft and consumable
receipts retain their latest digest and outcome in the session so duplicate delivery cannot repeat
the feedback or the receipt fold. Adventure quest cues diff the same completed-ID projection used
by the journal, including the final encounter. Level-up audio shares the dialog’s eligibility rule,
even when that dialog overlays an open result. The quest chime restarts one voice on rapid completions
instead of dropping cues or stacking them. Observer initialization and account changes establish silent baselines.
Trusted DOM control activation has separate local feedback in the shared settings lifecycle, so
demo and player buttons work without an account. One delegated listener covers keyboard, touch,
portals and native controls. It waits until dispatch completes and yields to any semantic sound
already emitted by that action. Disabled controls, programmatic clicks and disposed observers stay silent.
Overworld footsteps use recorded samples for every engine material preset. Grounded distance owns
cadence; the audio edge decodes and level-balances each source once, varies successive samples, and releases its
Web Audio context with the world. Each stride fades the previous voice before starting the next;
long material tails cannot stack while running. Reset, disable and disposal also retire the active voice.
Missing recordings remain silent rather than synthesizing a substitute.
Water footsteps sample liquid at the feet using the collision skin, independently of head-depth
swimming. Five short cuts from the owner-provided splash recording use the same stride cadence.
Descending air-to-water contact emits one presentation pulse across fixed physics substeps;
the shared audio registry plays the owner-provided water-entry recording once. Spawning,
teleporting and shallow wading do not invent an entry splash. Jumping itself has no sound.

The anonymous main menu mounts one bounded camera view through the normal engine and chunk manager;
it does not mount the gameplay canvas. Its authored winter scene lives in `seed/scenes/main_menu.recipe.json`,
compiled by `scripts/generate_main_menu.mjs` into the validated scene recipe. Harbor houses reference the original workshop architecture and the newer townhouse family through
`seed/structures/main_menu_houses.recipe.json`; the former wing grammar and diagonal timber meshes
are removed. The menu adapter adds only a winter palette and half-block snow caps. Tower roofs
use the same strict kit; heraldry reads the canonical workshop banner, including its larger quay standard. Catalogue firs replace the bespoke menu tree builder. `tree_placement.ts` owns the
shared grounded placement used by both the menu compiler and cities. Harbor dressing samples the
compiled height grid, so it follows the same surface as rendering and collision. That recipe is an abortable
static-asset fetch scoped to the mounted menu, rather than part of the shared gameplay JavaScript bundle. The aerial camera follows
a bounded orbit around the authored harbor focus. That subject anchors chunk residency, the far-shell
opening, water, and sunlight shadows; the camera stays inside the loaded area on a clearance-tested route. The scene pauses while the document is hidden
and releases its engine and workers on unmount. Existing demo-visit storage selects the start prompt or
existing sign-in actions. Seed also authors three slow, collision-checked resident routes. The menu
projects these into ordinary character world anchors and animation clips; it creates no gameplay
actors or network observers. Reduced motion pins the camera and keeps residents idle.
Menu and biome music share the mounted `MusicBed` media lifecycle and volume settings.
Menu, gameplay, adventure and editor stages share one centered world-loading presentation. It reads
the owning world's engine and chunk snapshots during startup and explicit quality/distance changes,
then stops sampling after readiness. Terrain progress counts completed requested chunks; graphics,
asset and atmosphere preparation remain indeterminate because no shader-completion percentage exists.
Ordinary movement streaming does not reopen the overlay. Its local presentation reducer owns no
engine state; teardown cancels its frame callbacks and polling.

### Terrain presentation

The WebGPU backend owns one Neutral tone mapper and fixed exposure for world and fight rendering.
The post-processing pipeline reads those renderer settings instead of declaring a second tone mapper.
This preserves stronger authored colors without adding a saturation pass; existing quality-specific
grading and atmosphere retain their lifetimes. Sun-shadow depth bias derives from a small world-space
offset and the shadow camera depth range, so ledge contacts do not drift with projection depth.

Optional seed-authored scenery places waterfalls, their derived spray, bounded mist, spore volumes,
and up to 384 hanging-vine placements in one shader-animated batch. Optional butterfly volumes share one opaque instanced wing mesh, with bounded GPU flight
and wing articulation; quality selects 4/8/16 insects per volume. The WebGPU world backend owns
these batches and shader animation.
Optional snow uses one batch capped at 96/384/768 flakes per volume by quality. Glow billboards use
one batch capped at 96 placements. Up to four authored glow sources may also illuminate nearby
surfaces through shadowless point lights, with 1/2/4 active on Low/Medium/High. No extra shadow maps
are created. One merged mesh owns at most 512 authored plants, ice sprites, and distant conifer
silhouettes. These reuse ordinary ground-scatter builders and rooted wind; hanging ice remains still.
Scenery appears after terrain, hides during fights and dungeon stages, and releases its buffers,
materials and lights with the world. These are presentation assets; fixed voxel structures retain
ordinary residency and collision. The public adventure remains authored in `seed/content/adventure_environment.json`.

Authored architectural detail uses one offline mesh compiler for thin trim, railings, rigging,
lantern housings, canvas and snow caps. It clips triangles into 32-block cells and writes bounded,
little-endian vertex artifacts with named material palettes. Runtime validates the artifact, remaps
palette IDs, and admits bounded interleaved buffer parts per resident cell; it never rebuilds prop geometry.
The terrain pool owns these cells through its existing column residency. Each admitted mesh owns its
material instance as well as its geometry; final eviction disposes both so Three.js releases the mesh's
WebGPU uniform bindings. Instances share the node graph, pipeline and borrowed atlas, not their lifetime. Retention queues detail parts rather than constructing a whole
column synchronously. The backend's single upload queue admits voxel and detail buffers under the same
byte and CPU-time budgets; detail parts fit the minimum tier's byte budget. Eviction cancels queued
parts before releasing admitted buffers, and readiness includes all pending uploads. Details borrow
the pool's material atlas, share material tint,
roughness and emission, use ordinary frustum culling and the existing sun shadow pass, and hide with
world dressing during fights and dungeons. There are no per-lamp or per-rope runtime objects.
These surfaces are explicitly non-colliding ornament; walkable floors, walls and structural occupancy
remain voxel-owned. A thin visual snow cap does not define a second collision surface. Worker recipe
projection excludes baked details and scenery before transfer, preserving identical terrain inputs
without cloning rendering assets into planning, meshing or horizon workers. Worlds without
baked details allocate no detail material or geometry. Generated city artifacts carry the same detail cells.
Meshing workers return only the requested column; the existing layer registers them on terrain admission,
retains them across vertical layers, and releases them at final column eviction. City artifacts and maps
share one provenance; the current version is required rather than accepting an older geometry path. The home screen authors its lantern kit in
`seed/structures/harbor_details.json`; its old voxel lamp, railing, rigging and window-trim emitters
are replaced rather than retained as quality alternatives.

The runtime owner validates and compiles a world once, then passes that compiled world to the renderer
and its terrain, water and material consumers. Character collision initializes at the requested world
focus. Rendering layers do not recompile recipes. Each worker
compiles its transported terrain projection once within its isolated lifetime. Material palette IDs
are invariant under structure-compilation options. Height-grid validation is shared by world recipes,
city compilation and imported city maps; malformed grids fail before terrain sampling. The canonical
test command checks menu artifact freshness alongside generated cities. Scene compiler files belong
to the shared browser-check and frontend-release input classification.

World materials may author bounded `emission` radiance (0–8), independent of AO and illumination.
Near terrain and the far shell use the same compiled emission table; ordinary materials remain zero.
Plaster, slate, oxidized copper, brick and ice own their seamless detail in the existing texture atlas.
Tree trunks use a separate bark preset with irregular fissures; constructed wood retains plank joints.
Bark reuses wood footstep recordings and adds no rendering pass.
The origin portal uses a seed-authored arch profile shared by its voxel frame, collision opening, effect mesh,
and shader boundary. The portal material is a translucent flowing membrane: local-space noise
warps the rendered scene, depth rejection protects foreground silhouettes, and the aperture edge
seals the distortion to the frame. The center gate uses blue emission. Dungeon entrances use the same upright arch and a refractive red-purple membrane behind a Sceat guide.
Their seed-authored demonic basalt, masonry and emissive crimson inlays use the ordinary voxel frame,
terrain residency and collision path. Palette entries append identically for render and surface-only compilation.
Both gates share the same aperture geometry and portal material. Water and portals
share the viewport-copy lifecycle helper; every material releases its private color/depth captures.
The origin arch uses the local terrain filler palette. Ordinary fixed-structure residency owns both
frame types; explicit portal frames bypass the reserved origin clearing. A scenery recipe may disable the origin
`portal`; the same switch removes the frame, effect, and structure-clearance cutout.
The frontend world composes dungeon guides into its ordinary entity list using the tutorial's
seed-authored Sceat appearance. Guides and their labels use the portal’s authored terrain height,
so preparing remote guides never requests city collision. Guide yaw continuously tracks the local controlled player's world position,
independently of dialogue. Facing changes reuse loaded appearance and stationary anchors without resampling
terrain; unchanged player positions do not resubmit entities. Guide labels retain the existing dungeon interaction range and
chain anchor. Interaction uses the same unlocked-key selector as the entry transaction: possession
opens the normal entry modal; absence produces a localized speech caption naming the required key.
The dungeon frame and membrane derive their shared offset from one seed profile; the offset is presentation only. Guide models, captions and pending appearance loads
retire with their markers and world, and immersive fights exclude them with other world actors.

Water uses one calm Genshin-derived material on every quality tier. A single sea-level plane
reconstructs world-space bed depth from the rendered scene; there is no water sampling worker,
heightfield mesh or legacy quality shader. Depth-checked refraction, moving normal maps, bounded
caustics and shoreline foam share per-target color/depth copies. Those copies are released with
their render target and world. The surface sits exactly at sea level so coplanar sand stays dry.
Body, foam, ice and immersed in-scatter read the scene key and hemisphere lights. Surface optics
own dry-camera views; immersion starts continuously below the waterline and uses ray distance,
so it cannot tint the surface twice. Water borrows the active sky sampler: Hillaire's sky-view LUT
with its shared horizon grade when active, or the analytic sky when that is displayed. Authored
glows contribute at most eight analytic light highlights. An optional `planar` water reflection
reuses the world scene and Three's clipped reflection camera, capped at 12 updates/second and
1024 pixels on its longest axis. Low uses 12.5% resolution at six updates/second, Medium 25%,
and High 40%. It creates no second world, worker or shadow map. Optional `frozen_shore`
shading uses the same rendered bed depth; the deep channel retains liquid optics. Quality changes
and world teardown own all reflection resources. The `winter` atmosphere keeps cool ambient fill and bounded haze alongside the
existing cinematic and clear presets; omitted presets preserve the shipped appearance. Optional sky
azimuth rotates the shared sun/moon direction once at its owner; sky, shadows and water consume that
same direction without changing celestial elevation or the day/night cycle.
Recipes select engine-owned atmosphere presets. The `clear` preset supplies the owner-tuned haze,
height mist, horizon brightness and physical sky parameters through the same defaults used by the
demo controls. Omitted presets retain cinematic atmosphere. Quality still owns the distant horizon
closure independently of the preset's aerial-perspective range.
Far terrain samples the same biome material texture generator as direct terrain, with flat triangle
material IDs and world-space UVs. Focus updates transfer only heights and material IDs; static XZ
vertices and the material palette stay resident. Vertex-stage palette lookups preserve interpolated
appearance without resending colors and roughness. Opaque baked details omit their color graph
during shadow passes, so chunk-owned material lifetimes reuse one constant shadow program. Its texture cache is bounded by quality resolution and released with
the world. Nature rendering shares one neutral four-tile atlas definition across resources, ground scatter and authored
scenery. Each layer owns one texture lifetime; palettes and climate tint still own color. Padded tiles supply
leaf veins, mineral striations, mushroom caps, gills and stem fibres. Bent botanical ribbons and faceted ore
reuse the existing merged or instanced batches, wind, culling and disposal. The dedicated mushroom-only
texture factory and old city shrub silhouette are removed.
Recipes may opt into `canopy: clusters`; the default remains voxel crowns. Workers replace exposed
foliage faces with compact six-face volumes in the existing packed terrain pool. Near, mid and far
chunks use progressively coarser occupied-cell grids and clump sizes from `canopy_transforms.ts`.
Centers belong to occupied cells behind the source faces, rather than to the faces themselves.
A neutral seed-authored texture supplies biome-tinted foliage atlas pixels; there are no crossed
cards, silhouette-rectangle payloads, alpha tests or separate tree render objects.
Workers retain a separate foliage occupancy mask when using clusters. Solid faces and AO probes
treat foliage as non-occluding because the replacement volumes do not fill every source voxel;
foliage interiors still cull against occupied neighbours. Collision occupancy is unchanged.
Packed face codes 6/7 identify opposing faces. Word A holds the center; word B holds material,
quarter-block size, face axis, source AO and deterministic rotation. The same bounded transforms
serve all tiers, with jitter confined to the coarser clumps. Existing pool capacity, upload budgets,
culling, shadows and disposal remain the owners. Leaf clumps suppress direct and indirect specular in
the shared lighting model; ordinary voxel materials retain their physical response. A camera-independent rounded lighting basis
prevents dark slabs when viewing crowns from below. Internal canopy attenuation multiplies actual
external shadow visibility; roofs still block direct sunlight. Bounds include every rotated corner.
The source PNG and generation prompt live beside the derived atlas data in `seed/textures`;
`scripts/bake_canopy_texture.py --check` verifies the texture samples against that source.
Authored local shaft bounds opt High quality into one reduced-resolution sunlight pass. It borrows
scene depth and the existing sun shadow texture, integrates only inside those bounds, and reconstructs
against depth to protect foreground silhouettes. The shared cloud field modulates that light. Quality
owns finite sampling and distance budgets; Low, Medium, worlds without bounds, and fight-only renderers
allocate no local shaft target. The pass stops outside the visible bounds, underwater, during fights and
dungeons; quality changes and world teardown release its owned material and target, never the borrowed shadow map.

Biome structure packs own sparse deterministic slots, weighted voxel types, terrain-fit limits, and an optional
integer scale range. Each placement derives its type, 90-degree rotation, and scale from its world cell. Search
margins derive per pack, so a colossal landmark never makes dense tree packs scan its footprint. A biome may opt
into rare engine-shaped mountain passes or ravines; the canonical column sampler subtracts their feathered cuts
before city terrain, so near terrain, far terrain, preview, scatter, and collision consume the same surface.

The game chunk manager owns effective terrain residency. It starts at the requested quality and
distance, then contracts outer rings when the engine reports blocked GPU uploads. The visible voxel footprint drives the far-terrain opening. Movement retains that capacity bound; an explicit quality or
distance change starts a new request. The GPU pool never grows to absorb an oversized residency plan.
That manager also owns bounded planning and meshing retries, including stationary focus. Worker
replies settle their exact request, and cancelled or superseded requests settle explicitly. Backend
request serials remain monotonic while per-key metadata follows only live work. Exhaustion or device
loss terminates that world lifetime; late callbacks cannot revive a failed engine. The player app
retries once on a fresh canvas with persisted low quality and the minimum render distance. A second
failure stops the world and exposes Reload. Missing WebGPU blocks world rendering immediately and
explains the secure-context requirement; missing authored world content remains a separate error.
Neither condition reduces graphics settings. Terrain always retains its source elevation; there is no flat mode or playable grid fallback.
GPU attributes upload through explicit version changes and bounded update ranges. Engine-owned
buffers never use WebGPU's forced-per-render `DynamicDrawUsage`; stationary far-shell indices and
unchanged instance colors stay resident, including across shadow and color passes.
Nearby character bodies batch by rig and animation pose. Hair and equipment select their own instance
subsets without changing body identity. Shared model loading owns part preparation, bone mounting and
disposal. Native skinning precedes geometry-bound instance transforms; immutable texture expressions
share shader plans without sharing skeletons or instance data. Interactive/tactical characters retain individual models. This rendering path does not use temporal motion vectors.

The localized spawn welcome display uses a fixed, depth-tested world plane with the canonical
AresRPG wordmark. Seed owns its position, orientation and size. The shared game world controller
rasters text only when the locale changes, then updates a retained canvas texture in the ordinary
renderer. World panels share backend replay and disposal, hide with world dressing, and never face
the camera automatically. World Lab and the real game mount that same controller.

Each resource owner releases its workers, GPU objects, audio nodes, and callbacks on teardown. DOM labels use a separate label-only scene
with the same world camera and world-space anchors; CSS2D never traverses game meshes or skeletons.
Resource label anchors are plain world-space vectors, not invisible game-scene objects.
Passive names, speech, fight health and floating numbers share typed caption descriptors and one instanced
GPU overlay per backend. Browser-shaped text occupies reference-counted atlas tiles; movement and health
fractions do not rasterize text again. Visible captions allocate first, and offscreen tiles yield under the
128 MiB GPU atlas budget. NPC captions share a 50-block camera-distance limit; rendering, accessible
text and hit testing use that same visibility rule. Accessible text derives from the same descriptors. Interactive resource and
fight-sword prompts retain their DOM hit targets. Captions and interactive labels replay after backend boot.

World content owns cities: fixed 3x3 regions, stable slugs, anchors, structure packs, and one dungeon slug each.
Dungeon content independently owns each stable dungeon slug, key, and ordered room composition.
The `/demo` content editor authors both sources directly. City structures and map entrances derive
from world content; zone discovery carries no copied portal fact.
The city build registry maps a slug to one city-specific deterministic compiler; cities share artifact mechanics,
not a universal settlement grammar. Each compiler owns its complete 3x3 land-use map, sparse eight-block target
height grid, structures, and local dressing rules. Thebes authored landmarks and districts live in `seed/structures/thebes_*.recipe.json`:
the arrival court, farmstead, guardian gate, entrance street, left-bank districts, castle and fortified lower ward. They compile through the same strict schematic
baker and canonical prop assets as the workshop. The farm reuses the original house architecture;
the separate procedural farmstead and entrance-gate builders are removed. The guardian gate
uses buried full statue volumes with native integer scaling. The left bank contains attached market rows and separate terrain-fitted hillside homes,
a market court, cathedral, cemetery and a terrain-fitted curtain with roofed bastions.
Seed-side excavation bounds subtract rock before authored masonry is packed; narrow paths and
quarry homes use the existing explicit-air voxel operation, preserving relief and rock ceilings. The cemetery
descends into the existing explicit-air catacomb network. Shared schematic components bake separately
into one detail builder; voxel output partitions into native 32³ placement cells before city packing. Reserved parcel bounds in the city plan own land-use and exclude incidental park trees and procedural road lamps. The city build
adds those voxel placements and details to its existing compressed artifact; there is no standalone
spawn renderer or runtime construction path. World scenery owns the grove’s rooted plants and hanging
vines through the existing batches. The central portal and both court approaches retain clear space.
Thebes reads its landmark layout from `seed/scenes/thebes.recipe.json`:
terraces, explicit lots, routes with elevations, river, bridges, ridges, grove and fortress circuit share that plan.
River points carry channel half-widths. The same interpolated bank distance owns carving and river
land use; the mouth widens into natural ocean, and carving never raises the existing seabed.
Terrain preserves relief outside its local terraces and route grading. The castle recipe owns its dominant keep,
offset donjon, stepped wings, gatehouse, curtain walks, galleries and interior stair flights. The former native keep,
curtain and keep-stair builders are removed. The lower ward continues the castle defenses and uses
the same authored house family plus the workshop manor. The native house-style generator and its
facade decorator are removed; reserved parcels are the sole building land-use and scenery exclusion input. Cathedral and castle use the same strict schematic ingredients;
houses have connected interiors, varied proportions and shared baked facade details.
The former WFC layout, its unused solver, and blanket land grading are removed. City trees are placements of the same packed structure catalogue used by the procedural world.
The ordinary structure voxel transform owns integer scale and quarter turns; city seed data owns
placement, source selection and material remapping. Giant placements use the broad-trunked swamp
assets also used at spawn, remapped to temperate bark and foliage. Tree anchoring samples the bottom footprint
and lowers its origin to meet descending terrain. The separate Thebes branching generator is removed. Land-use policy owns nature density, including the quiet portal grove. Scatter reads the
mesher's existing material and occupancy buffers, including the upper chunk halo, rather than excluding whole
structure bounds. Route, bridge, tree-volume and catacomb tests verify support and clearance. Underground passages
use ordinary explicit-air operations. One target-height adapter drives near terrain, far terrain,
collision, roads, bridges, and plateaus. Generated voxel
operations are tri-state: absent preserves procedural terrain, a material adds or replaces it, and explicit air
subtracts it. The same operation function owns render and collision occupancy, so caves create no parallel world
store or gameplay coordinate system; dungeon entrances remain at the authored surface anchor. Generation
partitions final operations into provenance-hashed, palette-compressed 32³ chunks. Runtime solves nothing:
workers compile terrain immediately and request only intersecting city artifacts. Voxel decoding and
caching are scoped to intersecting chunks. The active version stores voxel runs and unindexed float32
detail triangles as base64 inside JSON; each loading worker currently parses the whole city and validates
all detail vertices before returning requested columns. The ordinary collision and WebGPU voxel-mesh paths remain the consumers. City detail archives permit
4,096 cells and 500,000 triangles across the complete settlement; small scenes retain their 512-cell,
100,000-triangle limits. Per-column residency and GPU upload budgets remain unchanged.

### Dungeons and progression

Dungeon runs are Character dynamic-field state coordinated by `packages/move/sources/dungeon.move`.
Between rooms, kiosk custody permits healing, stat/spell resets, allocation, and inventory preparation.
The existing dungeon checkpoint root confines travel; Recall and City consumables remain refused for
the entire run. Gathering and ambush roots still block ordinary consumables.
Entering proves travel to the authored city anchor and burns the dungeon's key. Rooms compose
ordinary fights; the fight machine has no parallel dungeon path. A run stores only dungeon slug,
room, and committed seed. The server/UI scope its lobby by dungeon slug, while Move remains the
authority on legal run and room transitions.

Mastery is one soulbound derived object per address. Once per Sui epoch, an owned free Character
proves access to a player-chosen WorldContent; Move draws one of that world's city dungeons and
snapshots the entry-level reward. Any owned winner may validate it only through a final-room Fight
created in the assigned world strictly after assignment. Earned points persist across missed epochs.
Seed-authored MasteryOffer objects have immutable prices and mutable availability. They exchange
earned points or 1,000 burned whole KARES per point of the authored price for statless items. KARES redemption neither
requires a Mastery quest object nor changes earned points. Loot-box rewards retain
their existing open/claim randomness, while direct consumables such as reset scrolls mint directly.
Seed-authored Giftcards are the only distribution entitlement. Each is a portable `key + store`
object with a template and amount; possession authorizes its one burn-on-redemption mint into a
personal kiosk. Statless items and fixed-endpoint pets need no entropy; pet feed scaling keeps the
stored endpoint neutral until feeding. Issuance is AdminCap-gated and stops at permanent freeze.
Ordinary transfers distribute existing vouchers without mint authority, whitelists, or claim counters.
Holder allocations derive from saved, checkpoint-scoped mainnet collection snapshots.
The airdrop catalogue describes seed-authored campaigns, eligibility, and delivery routes; it is not
a separate entitlement store. Historical-player awards become frozen recipient batches through offline
ranking of a saved database export. The runtime never queries the retired game database.
Content sync mints each configured voucher directly to its custody address. The SDK also supports
issuance scoped to one reviewed airdrop campaign on the selected network through the same seed administrator,
without changing content or gameplay pause state. Permanent derived claim markers
keep redeemed vouchers complete during issuance recovery. Compact recipient batches
expand in the SDK into ordinary per-recipient vouchers. Giftcard rows may select
one network; creation and reconciliation use the same network filter. Prime Machin allocations target
mainnet NFT object IDs. The local Sui CLI batch sender transfers already-issued vouchers; collection
snapshots and partner-specific receiving remain outside the runtime projection.
Without a bearer link, `/claim` imports wallet-held vouchers into the authenticated zkLogin account and automatically
redeems them. The external wallet pays transport; the game wallet pays redemption.
Imports and redemptions each use one atomic PTB for up to 100 vouchers. Redemption
constructs ordinary stack fragments in one personal kiosk and uses the Sui resolver's gas estimate.
The claim view groups rewards by template without replacing voucher identities. Cross-wallet claims fold
the confirmed transfer receipt into the recipient SDK before redemption; owned voucher refs refresh
on each attempt, while shared template refs remain cached. A failed
redemption leaves the voucher recoverable. Browser-local attempt markers, scoped by network and
account, are retained before the SDK call and prevent automatic retries across reloads, including
certified failures. Missing or unavailable persistence disables automation; manual redemption remains explicit.
Loot boxes accept one reviewed quantity of up to 50 units in one terminal Random call. Each unit creates its own soulbound claim and reveal event; an ordered batch event binds those outcomes to claim IDs. The quantity modal defaults to one, and one shared animation timeline reveals the results in a viewport grid. Redemption prepares authenticated item plans before one terminal call for up to 50 claims. Single redemption uses the same Move implementation. The receipt folds the batch together; routine collection stays invisible, and failed attempts appear as grouped recovery actions.
Box and crush claims use the same one-attempt rule and remain visible for explicit collection in
inventory. Their automation markers are written before submission and survive reloads; a failed
attempt never creates an automatic retry timer.
Voucher pre/post ownership invalidates both custodians through the indexer, including plain transfers
without game events. Certified redemption tombstones prevent stale snapshots resurrecting spent cards.
Printed `/gift` URLs (also accepted on `/claim`) carry the zkSend bearer key only in their fragment,
which survives Google login without reaching the server. The printed URLs remain unchanged. A dedicated sponsor pays for the fixed zkSend voucher transport;
the QR key signs in the browser and never reaches the gateway. The 100 seed-authored Basecamp vouchers use the lightweight gift reducer and a Vercel
`/api/gift` gateway for sponsored transfer, redemption, opening and collection. Confirmed SDK receipts advance the gift reducer directly; gateway status is used only for restoration and explicit recovery. Restoring a session only checks
status; it does not automatically submit another transaction. Uncertain submissions use the existing SDK
transaction tracking; there is no separate gift journal. One explicit continuation checks current state and resumes the unfinished step. The gift page hands players to the normal game entry, which owns character selection and creation. Character creation and ordinary gameplay keep their normal SUI costs.

Read-only gift status is public and does not request a wallet signature. For sponsorship, the gateway
verifies an expiring wallet signature over the complete intent, resolves campaign membership
from seed-derived voucher identities, and proves each descendant crate/claim through certified receipts.
It accepts fixed operations, never caller-built transaction bytes. Transfer proves one campaign voucher
in the supplied public bag, fixes its recipient to the authenticated account, and rejects other assets. The SDK composes each PTB, and the
server builds gas data using a lightly funded signer and returns its signature for those exact bytes.
The SDK verifies the sponsor signature, obtains the sender signature, and submits both through its
existing execution boundary. There is no execution relay or gas pool. Both server and SDK
validate the sponsored envelope and simulate before signing; sponsor gas never becomes player-paid gas
in the wallet ledger. The sponsor private key exists only in the server environment. Enoki remains the login provider. Node function entry points import SDK
source by relative path so Vercel rewrites TypeScript extensions; workspace exports retain their source extensions.
Gift status is a narrow SDK read exception: current voucher/claim custody and exact receipt provenance,
with bounded archived event hints for recovery. Historical single-gift receipts may use GraphQL after
gRPC pruning; their validated fixed PTBs emit fewer than its fifty-event cap. Historical package calls
must prove the same original game lineage. Signed write receipts still require gRPC.
The shared box presentation preloads and decodes its box and reward images before starting charge, burst, carousel and reveal from the confirmed result. Failed artwork skips the carousel so a confirmed reward remains accessible. The reveal plays the existing level-up cue once; restoring a reward never replays it. Each reel
contains the authored reward pool and lands on that result; one lead reel schedules overlapping recorded
ticks for batches. Skip and teardown cancel its sounds, while reduced motion shows the result directly.
The SDK administrative adapter creates links from previously retained bearer keys.
The distribution reducer retains a dismissible reward summary from observed additions to wallet-held
voucher IDs. It survives automatic redemption, and the existing funding modal explains the received
gift when gas is missing. Funding never automatically retries a failed claim. Missing zkSend links
show an already-claimed/unavailable notice; a provider failure cannot establish that absence.
The local batch sender uses the owner's configured Sui CLI signer and journals each submission.

### Beginner journey

The tutorial host owns one acknowledged, device-local notice for the first observed failed craft.
It waits during combat or a hidden tab; passive feature tips do not suppress it. Settings retain dismissal.
After Welcome, a beginner quest teaches map travel and obstacle recovery. The accepted run retains its
map origin, and only arrival completes the quest; opening, cancellation and other travel sources do not.
The journey reducer observes arrival before the run-to reducer releases the target. There is no timed reminder.
The minimap and full map combine remote presence with the world's checkpoint-validated owned-character
pose feed. Party membership determines cyan member markers and the larger gold leader marker.

The frontend owns a browser-local beginner journey, separate from first-open tutorial tooltips and
on-chain Mastery. `seed/content/journey.json` authors its ordered objectives for browser bundling;
it is not published on-chain. One journey reducer retains completion and transient presentation,
deriving its storage scope directly from the session in the same reducer pass. Observers never
initialize a second account state.
Inventory and equipped-item projections prove ownership; confirmed gathering deltas and settled
fight wins prove actions. Terminal fight results retain defeated mob identities for introductory hunts;
final-room identity proves dungeon completion. The first tool's preparation derives quantities from
its seed recipe and counts only available fragments in the configured crafting character’s kiosk, using
the same listing and trade exclusions as crafting. Changes to selection, crafting preference or custody
refresh both displayed quantities and completion eligibility. Its practice step accepts one certified craft
attempt, including failure. Seed-authored superseding milestones retire unfinished introductory steps
for returning players and market buyers without inventing completed actions.
These observations never submit transactions or award on-chain assets. Completing the journey
reveals an automation reward card and unlocks gathering controls without starting a run.
The controls collapse to a compact status and Stop action; collapsing never stops automation.
IndexedDB stores only completed quest IDs per network, original game package, and account. The next
quest and progress derive from those IDs; journal visibility and celebration queues remain in memory.
Settings can reset the local completion set. Completion celebrations wait for the local write;
loading saved completion never replays them. Storage failures remain visible and never overwrite an
unknown saved set after a failed read.

### Combat effect duration

Timed fighter effects count down at the affected fighter’s turn end and remain active at zero
until that fighter’s next start. Expiration precedes AP/MP modifier application, poison/regeneration
ticks, and glyph refresh. Inactive AP/MP pool estimates exclude zero rows. Glyph zone lifetimes and
spell cooldowns retain their independent clocks. The HUD distinguishes pending expiration from
remaining usable turns; both combat implementations emit the same resulting state.

### Forging

Pure forging math owns signed-stat eligibility, outcome probabilities, and the loss ledger.
The game consumes one rune and resolves scribing through one terminal-randomness transaction.
Every outcome visits the same fixed stat block and writes the same event shape. Item-owned
RolledStats stores statistics, exact ×20 puits, and one write revision in the same dynamic field.
Every attempt increments that revision, so Sui cannot omit an unchanged child write. The revision
never gates rune eligibility, and scribing grants no profession XP. The receipt carries
net gain and all fifteen net losses, which the frontend folds before indexed reconciliation.
Crushing retains its separate committed seed, deterministic reveal, and explicit redemption.
The result uses projected rune rows for identity and the reveal receipt’s committed amounts for
received quantities; existing inventory totals do not become crush awards.

### Content

JSON under `seed/content/` is the authoring truth. The `/demo` editors change those files without
arming a wallet session. Validation rejects invalid structure before publication. The admin SDK
diffs authored content against published content and writes only the required batches. Creation
checkpoints record only targets absent before that certified batch. Untouched ledger entries retain
their previous fingerprints and revisions so pending mutable rewrites cannot disappear. Recipe
reconciliation compares live inputs, quantities, job, level, and active state even when ledger hashes
and revisions match. Older-than-certified reads fail instead of authorizing repeat writes. See
`CONTENT_UPGRADES.md` for the operational ceremony.

### Marketplace

Sui Kiosk objects own listings and custody. The indexer projects the current market and sales
history. Category selection observes its shared listed-type projection. Category badges count distinct publicly
listed item types, including the viewer’s public offers and excluding private offers. One watched server-local
snapshot refreshes only when dirty, at most once per five seconds; parent groups sum their subcategories.
Counts stop refreshing when the last marketplace viewer leaves. They are sampled navigation information,
separate from purchase-critical offer freshness. Selecting
a type requests twenty groups with three cheapest public offers per group, excluding the viewer's own
listings before ranking. Stack quantities and complete indexed equipment rolls define groups; unknown
rolls remain distinct objects. Character listings have their own bounded query and filters. Cursor pages
carry observation generations and kiosk revisions; the frontend retains the current live page and cursor history. Up to ten recent offer-page snapshots
provide immediate display when returning to an item. They never enter the live purchase catalogue;
selection, reopening, and reconnects require a fresh observation before buying. Repeated selection of
the current query is a no-op, and certified writes discard historical display snapshots. One marketplace reducer reconciles packets and certified receipts without treating unseen rows
as deleted. Indexed changes refresh affected scopes. Hover details use indexed purchase-relevant fields.

### KARES and reward reserves

The currency and rewards have independent identities. The game accepts one nine-decimal, native
burn-only Currency through the `packages/rewards` Economy proof. That package imports
neither the currency issuer nor the game. The retired `packages/kares` remains a build dependency
only as three type-layout stubs needed by published game signatures and Trade custody. It has no
production issuance, sale, staking or payout code. Retired game payment doors abort.

Publication creates one shared, non-generic Economy before a token exists. Its empty token field
proves the unfunded state. Boss settlement then records a zero payout without a placeholder currency
or pool. Funding atomically binds the token and reserves; afterward the same proof requires the
mandatory funded payout path. The SDK reads that state before composing settlement, and the shared
object serializes funding races. There is no separate activation flag.

One setup consumes exactly 410 million tokens from the one-billion-token external supply:
200 million for staking, 100 million for combat and 110 million for community. Setup consumes its
unique Setup and borrows the genuine first-publication UpgradeCap. The signing wallet must be the
nonzero treasury recipient and hold both capabilities. The treasury keeps its UpgradeCap.
It binds the Currency, treasury and original game BossVictory witness once. Compatible game
upgrades preserve that witness; fresh game publications require a separate monetary migration.
Rewards remain upgradeable so a future reviewed upgrade can recover or migrate reserves while
preserving principal and earned claims. No reserve sweep or witness rotation exists in the current API.
The separate final project freeze destroys all six active UpgradeCaps, including rewards, with
content freeze in one cold-wallet transaction. Its signer must own all six caps and the AdminCap.
The 30 million team allocation is separate from reward funding. The remaining 560 million tokens
and external market arrangements belong to the issuer's presale terms.

Blast owns issuance and its standalone presale. The game creates no offering and cannot start,
settle or accept presale contributions. A compact pink Blast card above the game chat links to the
reviewed Blast page. Its SDK reader fetches only the pinned standalone Presale and native Clock,
verifies the package and KARES/SUI type pair, and projects authoritative lifecycle and funding progress.
Without a presale pin it shows an upcoming sale and performs no network request. Failed reads hide
progress; an expired open window shows settlement pending, never an invented successful launch.
The card's reducer rejects older object versions; its observer stops polling on disposal or a final
sale state. The encyclopedia owns tokenomics. Token art lives in seed and the game's public metadata
asset uses that same image; there is no separate token website.

Community tokens vest over 1,825 wall-clock days from setup. Only the immutable treasury can claim
unlocked tokens. Cumulative entitlement minus prior withdrawals makes claim cadence irrelevant.
Community/PvP distributions remain manual treasury operations.

Core constructs its private BossVictory witness only after a proved victory. The combat pot enforces
floor(100 million tokens / 1,825) per wall-clock day, without catch-up debt. Donations extend runway.
Each chain epoch lazily averages the prior quota with observed boss levels per elapsed day, with a
20,000-level floor. Fight snapshots authored boss identity and actual scaled levels. Its first winning
settlement pays one proportional bounty equally to all non-forfeited winning seats, including dead or
disconnected characters, before terminal item randomness. Fight records even a zero payout exactly once.
Quiet days preserve the reserve. No treasury withdrawal or counter-reset door exists.

Staking keeps principal separate from KARES and SUI rewards. Its active clock pauses when principal
is zero. The initial 200 million reward stream lasts 1,825 active days. Supplementary deposits share a
bounded daily schedule beginning at the next active-day boundary and lasting 30 active days.
Cumulative per-asset indexes retain earned rewards across stake changes and anytime claims.
Marketplace royalties are the game's revenue source for staking; external pool fees do not feed it.

Wallet finance is an explicit SDK read exception: the pinned Economy, Currency, community, combat and
staking objects, owned positions, balances and chain time come directly from Sui. The SDK verifies
all reserve links and rejects foreign identities and receipt-older snapshots. The UI derives estimated
accrual; certified execution owns actual payouts. Finance receipts do not create a game projection.

The admin claim PTB combines both policy withdrawals, funds staking with 20% of their actual SUI,
and delivers the remainder to the selected treasury wallet. Its certified RoyaltyFunded event owns
displayed claim amounts. Policy-cap custody remains with the owner; the PTB split does not constrain
other withdrawals by the cap holder.

Trade preserves its published layout. Active currency balances occupy one native dynamic field,
`vector<u8>(b"kares") → vector<Balance<Token>>`, with exactly two balances in participant order.
The Economy proof binds token operations to the configured currency. The indexer projects that child
only under a certified game Trade parent. Child-only writes invalidate the trade without implying
parent deletion. Retired inline balances are never interpreted as the active currency.
SDK trade closure reads the canonical Economy: unfunded trades use the token-independent close,
while funded trades use its exact token type to remove even an empty currency balance field.

## Verification and release preparation

Verification has three purposes: fast native unit coverage, bounded browser regressions, and opt-in
performance measurement. Independent source jobs run lint/formatting, types, unit coverage with
seed validation, and authored artifact freshness in parallel. The native test command does not repeatedly regenerate the cities;
`validate:assets` checks all generated scenes once. Expensive production-sized inputs belong in
artifact validation or performance measurements, not tests of array dimensions or wiring.

One input classifier selects Move, indexer parity, and browser checks against the last successful
`edge` push, including for PRs. Missing evidence runs every lane. Conditional Move and Rust jobs
retain their native coverage and authority/parity checks. The final gate rejects failed, cancelled,
or unjustifiably skipped verification. PRs also retain the production bundle check.

Required browser checks cover authentication, irreversible-action confirmation, exact item selection,
and fight/session input boundaries. Two Chrome workers run those critical interactions. One isolated
macOS worker runs one renderer smoke check: present bounded flat terrain through WebGPU and release
its GPU allocations. Both jobs stop on their first failure; a failed job cancels the browser matrix.
New browser scenarios are manual diagnostics unless explicitly included in the critical set.

Layout, pixels, lighting, animation choreography, camera timing, and extended renderer lifecycle
scenarios run only through the manual browser diagnostics command. They never block routine changes.
Fixtures still use production components with controlled inputs; no fallback renderer or skipped
GPU requirement can certify the smoke check. Screenshots belong to the test output directory.

Full authored city/forest workloads run through the manually dispatched performance workflow or
`test:performance`. They record actual hardware and completed GPU work; there is no universal FPS
claim derived from an OS name. Performance runs use one worker and no tracing. The native suites
remain the owners of deterministic correctness, and no coverage floor is lowered for test deletion.

Owner-authorized release preparation builds immutable images and stages Vercel output concurrently
with verification of that exact source SHA. Only a successful `edge` push gate permits the prepared
release manifest. Activation requires that exact successful preparation and promotes its existing
artifacts without rebuilding. Failed verification cannot produce a certified manifest or activate production.

## Extending the system

Before adding anything, locate the existing owner and compose it. A new fact requires an explicit
owner. A new projection names that owner and stays read-only. A new effect enters through the
owning reducer. A new cross-language twin receives a mechanical parity gate.

A change is architecturally complete when it can be explained as:

```text
owner changed → contract changed → every projection changed → old path deleted → invariant sealed
```

If the explanation needs two owners for one fact, the data model is wrong.

## Documentation ownership

- `seed/content/journal/`: English editorial articles and publication catalogue. `seed/icons/journal/`
  owns their cover artwork. Only explicitly published entries enter the journal's static output;
  drafts remain source-only. The journal deploys independently of game releases and seed transactions.
- `ARCHITECTURE.md`: current system topology and laws.
- `DECISIONS.md`: active rulings and their motives; search the domain being changed.
- `AGENTS.md`: repository working agreement, TypeScript code law, safety, and required gates.
- `CONTENT_UPGRADES.md`: content and package publication operations.
- `CONTRIBUTING.md`: branch, release, and contributor workflow.
- Package READMEs: package-specific operation only; they do not redefine this file.
- Changelogs, provenance, source lists, and `worlds-study/`: history or research, never current
  architecture.
