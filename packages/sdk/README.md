# @aresrpg/sdk

The game client's ONE write surface — a **generated projection of the Move contract**. Every
public/entry function of `packages/move/sources/api.move` and `trade.move` becomes one PTB builder in
`src/doors.gen.ts`; the generator (`bun run generate`) reads the Move source, so the SDK can
never drift from the chain surface — a Move door change lands with its regenerated builder in
the same commit, and the test suite is red otherwise (the regen-clean tooth).

Gameplay writes are the primary surface. Narrow wallet, object-reference, and explicit tooltip reads
remain here when no projection can own them. Content lives in `seed/`; deployment ids live in the
repo-root `pins.json`. A missing pin throws at the door — never a guess.

## The pre-resolved game-object law

The SDK builds every PTB from **pre-resolved game inputs**. Only gas remains a wallet concern:

- shared objects → `sharedObjectRef` (the initial shared version is STABLE — learned once,
  valid forever; pins carry theirs in `pins.json`)
- owned objects → exact `objectRef` (version + digest) from the **receipt-fed cache**
- clock/random → the SDK's offline system helpers
- gas → Sui core resolution, including payment selection and automatic budget estimation

An object id the cache does not know **throws** — the SDK never falls back to an RPC lookup
inside a build. `sdk.hydrate([ids])` is the ONE sanctioned bootstrap roundtrip for game object
refs. Sui resolves gas while building; after execution, every receipt keeps cached object
versions fresh — the loop sustains itself with zero game-object reads.

```ts
import { SDK } from '@aresrpg/sdk'

const sdk = SDK({ client, signer })
await sdk.hydrate([kiosk, cap]) // once per session

// one door: compose → resolver simulation → sign → execute → receipt
const stat_tx = sdk.tx()
sdk.doors.raise_stat(stat_tx, { kiosk, cap, character_id, stat: 'strength', points: 5 })
const receipt = await sdk.execute(stat_tx)

// composed PvM birth: the packed personal cap keeps terminal Random truly last
await sdk.hydrate([kiosk, personal, zone_object, world_content, catalog, template])
const tx = sdk.tx()
const build = sdk.doors.engage_fight(tx, {
  kiosk,
  personal,
  character_id,
  zone_object,
  world_content,
  group_index: 0,
  access: 0,
  catalog,
})
const grown = sdk.doors.add_fight_mob(tx, { build, template })
sdk.doors.launch_fight(tx, { build: grown }) // terminal &Random command
await sdk.execute(tx)
```

- `sdk.execute(tx)` lets the official resolver select gas and simulate once, signs only a green
  transaction, executes once, logs digest plus net gas, **throws on any failed status** (a digest
  exists = gas burned — never auto-retry), absorbs the receipt into the cache, and returns it for
  client prediction.
- Authenticated actions resolve the stable kiosk identity once per session. The shared kiosk runner
  overlays receipt-fresh cap refs and performs one fresh lookup only after a proven pre-submission
  stale-cap failure.
- Doors marked **TERMINAL** take `&Random`: such a call must be the LAST command of its
  transaction (the terminal-random law).
