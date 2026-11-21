# Telegram companion

A thin client of the hosted bot. The listener receives Telegram webhook updates, turns each one into one
card or one behaviour-tree request through the shared hosted OAuth/MCP client, and delivers the answer. It
owns Telegram ingress and delivery, the chat-to-owner link and its encrypted records. It owns no run, no
key and no game truth. No live Telegram, Google or chain execution has been validated by the local tests.

## Player flow

Tap Log in with Google on the welcome card → tap START when the browser returns to Telegram → join the
waitlist → operator admits the verified game-owner address → select an existing agent-multisig character →
Play → review → Approve.
Each character has its own strategy, status and Stop; several characters run different strategies at once.

Logging in is one link and one confirming tap, with nothing to type (owner ruling 2026-11-21). The
welcome card's only button opens the login page. The browser asks for a Google sign-in only when it has
no game session, shows no consent screen, and returns to Telegram on the bot's deep link, where Telegram
shows its START button. Tapping it links the chat and shows its current card. There is no second link, no
code to read or type and no command to enable anything. The web page approves the request by itself only
when the hosted bot reports that its registered redirect is this service's callback
(`VITE_TELEGRAM_CALLBACK_URL` on the frontend build, equal to `callback_url` below); when that setting
is absent or different, the page shows the assistants' consent dialog instead and approves nothing alone.

The browser's return proves an account, never a chat: any web page can send a signed-in player through a
login page that another chat asked for. So the return links nothing. The service holds the verified
grant with the attempt and sends the browser to `https://t.me/<bot>?start=<token>` with a fresh one-use
token: 32 random bytes, 43 characters of the alphabet Telegram allows in a start parameter, stored only
as a SHA-256 hash and never written to a chat or a log. Telegram sends `/start <token>` from the account
that tapped START, and the service compares it only with the attempts of that same chat. The tap is
therefore the proof that the person who signed in controls the chat that asked. A player driven through
someone else's login page lands in their own chat, where the token matches nothing: no chat is linked,
that chat gets its ordinary card, and the held grant is revoked when its attempt ends. Until the tap, the
asking chat gets nothing of the account: no card, no hero, no identity. A token is used once, belongs to
one attempt and ends with it at `link_ttl_ms`. A player who returns to the chat without tapping START
gets the welcome card with a new login page; the unconfirmed login is ended and its grant revoked.

The link is bound to the chat that asked for it: the attempt carries the sender of the chat's own private
update, and nothing the browser sends names a chat. The Google account that signs in owns the link: the
owner is read back from the hosted bot with the fresh tokens, and a typed wallet address never
establishes identity. Every login requests observe, play and pause scope.
Whether a chat may play is the allowlist's answer alone, read on every update: an owner who is not
admitted sees the waitlist card and reaches nothing of the hosted bot but its own identity; once
admitted, its next update plays with the login it already has. `/join` records that owner address only,
once, with the time it joined. Joining the waitlist does not grant admission: only the operator's
allowlist does. Telegram sender IDs identify chats and links, never admission. The home page's Telegram
card joins the same waitlist through the hosted bot.

## Admission

The allowlist and the waitlist live in the permanent Redis, as `telegram:admitted` (a set) and
`telegram:waitlist` (a sorted set scored by joining time). The running listener reads them on every
update, so a change takes effect at the owner's next message with no restart. An owner address is
canonical lowercase `0x` + 64 hexadecimal characters; anything else is refused.

```bash
bun run waitlist                      # who waits, oldest first with joining time, and who is admitted
bun run waitlist admit 0x<64 hex>     # admit one owner
bun run waitlist remove 0x<64 hex>    # refuse one owner at once, then revoke its Telegram login
```

Every form needs `TELEGRAM_REDIS_URL`. `remove` also needs `TELEGRAM_STORAGE_KEY` and
`TELEGRAM_CONNECTED_CONFIG`, because it revokes the owner's login at the hosted bot so nothing that owner
started keeps running. If that step fails the owner is already refused; the command names the reason and
can be run again. The waitlist holds no credentials, chat text or profiles. The listener sends no
message on its own: every message answers an update or a login the player started.

`seed/content/strategies.json` is the shared strategy catalogue. Telegram offers two of its entries:

- **City patrol · 1 mob** fights observed groups containing exactly one mob inside the reviewed city.
  The city comes from the selected character's authoritative observed checkpoint and stays fixed in the
  script. Approval rechecks that city, identity and revisions. Engage and combat leaves carry the same
  count, type and area constraints, so an existing multi-mob or outside-city fight cannot bypass them.
  The canonical bot rechecks the selected target, fight roster/origin and every movement segment.
  Unknown or out-of-area state stops progress. When observed groups are exhausted, it researches eligible city zones through the same bounded
  movement path, respecting the canonical research cooldown. It uses existing weapon/bare-hand tactics and settlement, with no victory
  guarantee, automatic healing or loss-based adaptation. SUI gas continues for actions until stopped;
  there is no total run allowance. A service restart may repeat work after fresh observations.
- **Gather and craft** stays in the reviewed world. Its canonical profession selector chooses useful
  recipes using shared XP/acquisition-time ranking across current job levels and live ingredient
  feasibility. The complete recipe graph remains available for reachability checks. With no useful
  feasible craft it chooses an available level-eligible harvest, equips an available matching tool,
  and gathers. Missing every usable tool yields instead of spending gas on endless searches.
  Protectors use existing resolution/combat actions. Exhausted observations advance through adjacent
  world zones in a deterministic cycle; there is no separate traversal history or Telegram scheduler.
  Existing refresh actions certify movement even when a recently researched zone does not repopulate.
  Craft ingredients can be consumed on failed rolls, fights can be lost and every action costs gas.
  Neither strategy promises a total spending cap, optimal combat or exactly-once execution after crash.

The hosted bot's contract is per character: one behaviour tree and one run per character, addressed by
`character_id`. A reviewed tree is sent once with `bot_start_behavior`; a character that already runs is
replaced with `bot_replace_behavior` at its current revision, read with `bot_behavior_status` right before.
Approval binds the tree again from that update's observation and sends it only when the character still
stands in the reviewed area and the card's start or replacement still holds. The bot validates the tree, keeps one run per
character and enforces its run limit; Telegram checks none of that first and renders the bot's refusal.
There is no user-authored script input. `bot_stop_behavior` stops one character. Free text shows the menu.
The shared catalogue also holds team hunts and dungeon raids; Telegram offers neither.

The separate Connect Your Agent flow is unchanged; external MCP clients can also use the new optional target constraints. Telegram is a deterministic
client of that same execution boundary. It has no provider credentials, prompt, generated strategy,
usage allowance, unlock purchase or subsidy. Every gameplay action uses the grant-bound agent multisig,
never the owner's Google wallet. SUI gas and consumables remain real costs. No strict per-run SUI cap is
introduced; existing wallet funding and execution checks remain authoritative.

## Configuration

Every variable is required unless stated. A refused start names the variable to fix.

- `TELEGRAM_LOCAL_SECRET`: webhook secret, the value given to Telegram as `secret_token`.
- `TELEGRAM_REDIS_URL`: the persistent Redis that also serves the hosted bot, and the same logical database:
  the hosted bot writes the home page's waitlist joins there. Telegram uses only the `telegram:` namespace;
  `@aresrpg/protocol/hosted-keys` owns every key name. Run one listener: navigation is process-local, so
  replace it instead of rolling it.
- `TELEGRAM_LOCAL_PORT`, `TELEGRAM_MAX_REQUEST_BYTES`: explicit listener/body limits. A callback update
  carries the whole message it was pressed on; Telegram redelivers an update refused as too large, so
  the body limit must exceed the largest update (a full 4096-character page).
- `TELEGRAM_BIND_HOST`: optional, defaults to `127.0.0.1`; only explicit `0.0.0.0` enables container-network listening.
- `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_STORAGE_KEY` (64 lowercase hexadecimal characters, never stored in Redis).
- `TELEGRAM_CONNECTED_CONFIG`: JSON with the existing HTTPS `issuer`, the HTTPS `callback_url` ending in
  `/oauth/callback`, and `limits` with exactly three positive safe integers: `request_ms` (the deadline of
  one request to the hosted bot or to Telegram), `link_ttl_ms` (how long a login attempt lives, which is
  how long the welcome card's button works; keep it at or below the hosted bot's request lifetime) and
  `proposal_ttl_ms` (how long a strategy review stays approvable). No production defaults are supplied.
  The frontend build's `VITE_TELEGRAM_CALLBACK_URL` must equal `callback_url`.

POST private sender-owned Telegram updates to `/telegram` with the configured webhook secret.
Public TLS and webhook registration are separate operator actions. An authentic update the bot does
not act on (group, edited, forwarded, media, membership) is answered 200 and ignored, because Telegram
redelivers every update that is not answered 2xx.

The door uses the shared request limiter. The browser pages (`/link/…`, `/oauth/callback`) allow 600
requests a minute per visitor address (Cloudflare's `CF-Connecting-IP`) and answer 429 with a plain page past it. The webhook is limited after
its secret is verified, per Telegram sender: 60 updates a minute. An update past that is answered 200 and
dropped, because Telegram would redeliver anything else. Counts are in process memory.

The listener opens its port only after Redis connected and the startup pass retired ended login attempts. The Redis client
reconnects through a short outage; once it gives up, the listener stops with exit code 1 so its
supervisor starts a fresh one. There is no HTTP health route.

## Authority and recovery

The login reuses the hosted bot's authorization, PKCE, exact issuer/resource binding and the browser
cookie: only the browser that opened a link can finish it, a link opens one browser, and its return is
exchanged once. That return only holds the grant; the chat that asked establishes the link by sending
back the one-use token (see Player flow). The authenticated identity binds owner, descriptor, generation,
grant and multisig. An unlinked chat always has one login button: an unopened link is offered again, and
one that was opened and never finished, a held grant its chat never confirmed included, is ended and
replaced by the chat's next update. A login whose owner is already linked to another chat is refused in
the browser, or at the START tap when two chats held the same account, and its grant revoked at once. A login that ended (expired, revoked, or stored
with view-only scope by the earlier two-step flow) is answered with Log in again, which replaces it and
shows the welcome card. Existing encrypted OAuth credentials and scoped revoke/cleanup behavior remain
in place.

Telegram keeps one record per linked sender in process memory: its button revision, the login it belongs
to, the selected character and the one open strategy review. One reducer writes it from an update and one
fresh `bot_observe`. Every update takes the next revision, so a button acts only as the next update after
its card; any older button answers that it was updated and shows the current state. Nothing about a run,
an outcome or a pending request is kept: the hosted bot owns every run, and the menu reads it again.

A request is sent once. The shared client's result settles it: `uncertain` means the bot may have acted,
so the player is told the result is not confirmed and offered Status only, which asks the bot again; any
other code is a refusal that changed nothing. The same approval is never sent twice; a new start needs a
new review. A lost start therefore concerns one character only, and the others stay usable.
`/menu` and `/status` show the same card. `/stop` lists the running characters; choosing one stops it, and
Stop all appears when several run. `/pause` and `/resume` act on the whole wallet, other connectors
included, and are confirmed on their own card. Stop and Pause do not undo submitted transactions.

A restart loses that record and nothing else: the next update observes the bot and shows every run again.
The hosted bot's current stateless execution can repeat a non-idempotent step after process loss.
Continuous play is not an exactly-once guarantee across crashes. There is no automatic paid entry, retry
or repurchase in this catalogue. Custom strategy building, creation, funding and economy changes are
outside this implementation.

Redis retains the allowlist, the waitlist (an owner address and the time it joined) and encrypted OAuth
records, not game truth or strategy history. The waitlist stores no sender, username, profile or chat
text. Each entity is its own AES-256-GCM record, authenticated with its record id: a sender's
established link, an owner's sender index, each link attempt and each sender's attempt list. Every
change compares the stored ciphertext and commits all touched records atomically; a concurrent change
fails closed and is never replayed. Every link attempt ends `link_ttl_ms` after it was created, whatever
its phase. Redis expires an unopened one; one that may hold tokens (a grant waiting for its chat's START
included) is retired, revoking its grant, on the sender's next interaction or at startup. A consumed or retired attempt is deleted; an established link
never expires. The encryption key stays outside Redis. The sender record lives only in process memory
and exists only for linked senders.

There is no update deduplication. Telegram redelivers an update only when the webhook did not answer
2xx; every mutating input is guarded by its link phase or its sender revision, so a
redelivery acts at most once and is answered with the current state. `bun run waitlist remove <address>`
ends an owner's access and its login together. To revoke one login without changing admission, use
`bun run cleanup --owner <address>`, or `--sender <id>` for a known chat; the listener keeps running. An
unfinished login has no owner index; it ends by itself at its `link_ttl_ms` deadline. Cleanup needs `TELEGRAM_REDIS_URL`, the storage
key and issuer/callback plus request/link deadlines; it does not require Telegram credentials or change
admission. Failed cleanup names its reason and preserves credentials. Revocation does not undo an
admitted submission.

## What observations can establish

The menu shows a fresh verified multisig SUI sample and one line per run the wallet hosts, by character,
whichever client started it: active, waiting, stopped, completed or needing attention. The bot's run list
carries the catalogue entry each tree was bound from, and a line names it when Telegram offers that entry.
A tree authored by hand, or an entry only another client offers, reads "Strategy from another app"; it is
listed and can be stopped all the same. Listing reads no run on its own.
Inventory is a separate paged read using indexed item names and amounts; missing loading evidence is
unknown, not an empty bag. Pages use Telegram's documented 4096-character text limit, with no item cap.
Fighting and ambushed characters remain visible. The patrol can continue an existing fight only when its
actual roster and origin satisfy the reviewed constraints. Ambushes, other fights or missing evidence may
need recovery through the existing game or external agent. City eligibility uses the observed chain
checkpoint, not a transient visual pose; walking in the game alone may not yet change that checkpoint.

The bot's observation does not say whether the wallet is paused. A start refused as busy or paused says
both and names `/resume`. Until its authenticated baseline is ready the bot reports no roster: the menu
says it is loading, and only Pause still works.

## Image and release

`packages/telegram/Dockerfile` builds from the repository root with `Dockerfile.dockerignore` beside it as
its whole context. The image installs the locked production dependencies and runs from source, so the
locale documents keep their repository path; its build executes the runtime graph once. The operator
commands above run in that same container. Release preparation publishes the image when its inputs
change; `CONTENT_UPGRADES.md` owns the deployment steps, the webhook registration and the first admission.

## Verification

Run `bun test` and `bun run typecheck` in this package with the repository-pinned Bun version. Unit tests use an
in-memory store with the same compare-and-set and expiry semantics; set `TEST_TELEGRAM_REDIS_URL` to a
disposable loopback Redis to also run the Redis suite.
The hosted bot is a stand-in that enforces its per-character contract: argument names, one run per
character, its refusal codes, and the bot's real script parser. Fixtures cover two characters on different
strategies, stopping one, replacement, a lost reply, the run limit, a busy or paused agent, recovery mode,
the login through the service's own door with its START confirmation, a drive-by login played from both
chats, live admission and removal, the waitlist cards, the
operator command, door limits, stale buttons, duplicate delivery, OAuth races and cleanup. A stand-in is not proof of live deployment, successful harvesting or
profitable play.
All copy comes from the supported YAML locales. No replacement game artwork is introduced.
