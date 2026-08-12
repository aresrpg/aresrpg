# @aresrpg/sdk

The game client's ONE write surface — a **generated projection of the Move contract**. Every
public/entry function of `packages/move/sources/api.move` becomes one PTB builder in
`src/doors.gen.js`; the generator (`bun run generate`) reads the Move source, so the SDK can
never drift from the chain surface — a Move door change lands with its regenerated builder in
the same commit, and the test suite is red otherwise (the regen-clean tooth).

Write-only by design: reads flow through the indexer, content lives in `seed/`, deployment ids
live in the repo-root `pins.json`. A missing pin throws at the door — never a guess.

## The zero-roundtrip law

Sui finality is sub-second — so must every transaction be. The SDK therefore builds every PTB
from **pre-resolved inputs only**, with zero resolution RPCs between intent and submission:

- shared objects → `sharedObjectRef` (the initial shared version is STABLE — learned once,
  valid forever; pins carry theirs in `pins.json`)
- owned objects → exact `objectRef` (version + digest) from the **receipt-fed cache**
- clock/random → the SDK's offline system helpers
- gas → cached reference gas price + the signer's cached gas coin ref

An object id the cache does not know **throws** — the SDK never falls back to an RPC lookup
inside a build. `sdk.hydrate([ids])` is the ONE sanctioned bootstrap roundtrip (seeds refs, the
gas price, and the gas coin); after it, every `execute` receipt keeps the cache fresh — the
loop sustains itself with zero reads.

```js
import { SDK } from '@aresrpg/sdk'

const sdk = SDK({ client, signer })
await sdk.hydrate([kiosk, cap]) // once per session

// one-shot — sub-second: build (0 RPC) → signAndExecute (1 RPC) → receipt
const receipt = await sdk.call.raise_stat({ kiosk, cap, character_id, stat: 'strength', amount: 5 })

// composed PTB (hot potatoes chain through returned results)
const tx = sdk.tx()
const build = sdk.doors.engage_fight(tx, { kiosk, cap, character_id, w: world, zx, zz, group_index: 0, access: 0 })
sdk.doors.add_fight_mob(tx, { build, template })
sdk.doors.launch_fight(tx, { build })
await sdk.execute(tx)
```

- `sdk.execute(tx)` sets sender/gas offline, signs, executes (`showEffects + showObjectChanges +
showEvents`), **throws on a failed status** (a digest exists = gas burned — never auto-retry),
  absorbs the receipt into the cache, and returns the receipt for client prediction.
- `sdk.with_kiosk(tx, kiosk_client, cap, (kiosk, kiosk_cap) => …)` — kiosk composition through
  the official `@mysten/kiosk` `KioskTransaction` (`cap` from `getOwnedKiosks`, fetched once per
  session): a personal cap is borrowed/returned automatically; doors take the bare
  `&KioskOwnerCap` (the wrapper stays out of Move by ruling).
- Doors marked **TERMINAL** take `&Random`: such a call must be the LAST command of its
  transaction (the terminal-random law).
