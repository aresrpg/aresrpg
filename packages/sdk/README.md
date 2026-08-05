<h1 align=center>@aresrpg/sdk</h1>
<p align=center>
  <a href="https://discord.gg/aresrpg">
    <img src="https://img.shields.io/discord/265104803531587584.svg?logo=discord&style=for-the-badge" alt="Chat"/>
  </a>
</p>
<h3 align=center>Shared JS SDK for AresRPG on Sui — PTB builders, chain reads, and pure game math</h3>

## What this is

A vanilla-JS (JSDoc-typed) library over the on-chain AresRPG Move packages. It has **no backend**: it
composes Programmable Transaction Blocks the wallet signs, reads chain state directly over gRPC/GraphQL,
and ships the deterministic off-chain math (xp, stats, chunks, job/craft, pool quotes). Package ids resolve
lazily from `src/deployment/aresrpg.js` — an un-stamped network never breaks construction, only a call
against it refuses loudly.

## Install

```bash
bun add @aresrpg/sdk
```

Peer deps: `@mysten/sui`, `@mysten/kiosk`. Requires `moduleResolution: "nodenext"`.

## The SDK factory — `@aresrpg/sdk/sui`

```js
import { SDK } from '@aresrpg/sdk/sui'

const sdk = await SDK({ network: 'testnet' }) // opens gRPC/GraphQL/kiosk clients; build once + memoise
```

The returned object bundles context-bound **PTB builders** and **reads**. Each builder takes an args object
and returns a `@mysten/sui` `Transaction` for the wallet to sign. Highlights:

- **Characters / items**: `create_character_free_ptb`, `create_character_paid_ptb`, `onboard_kiosk_ptb`,
  `equip_ptb`, `unequip_ptb`, `buy_ptb`, `buy_many_ptb`, `craft_ptb`, `consume_potion_ptb`.
- **Fight lifecycle**: `create_fight_ptb`, `join_fight_ptb`, `place_ptb`, `force_start_ptb`, `crank_ptb`,
  `act_move_ptb`, `act_weapon_ptb`, `act_cast_ptb`, `act_pass_ptb`, `settle_fight_ptb`, `mint_rolled_ptb`.
- **Dungeon / kolizeum / game**: `activate_ptb`, `settle_run_ptb`, `kolizeum_create_public_ptb`,
  `raise_spell_level_ptb`, `feed_ptb`, `crush_ptb`, `join_world_ptb`, `gather_ptb`.
- **Reads**: `get_user_kiosks`, `get_policies_profit`, `get_royalty_fee`, `get_world`, `get_expedition`,
  `get_creation_state`, `is_name_taken`, `get_item_template`, `get_rolled_stats`, `get_sui_balance`.

The same builders are also exported per-domain (`@aresrpg/sdk/fight`, `/dungeon`, `/kolizeum`, `/game`,
`/items`, `/social`) for use without the full factory.

## Pure game math (no chain, deterministic — mirrors the Move contracts)

```js
import {
  experience_to_level,
  level_to_experience,
} from '@aresrpg/sdk/experience'
import {
  get_total_stat,
  get_max_health,
  get_secondary_stats,
} from '@aresrpg/sdk/stats'
import { to_chunk_position, spiral_array } from '@aresrpg/sdk/chunk'
import {
  get_job,
  job_level,
  craft_recipes,
  item_icon_url,
} from '@aresrpg/sdk/jobs'
```

## Static data exports (JSON)

`@aresrpg/sdk/items-data`, `/classes`, `/mobs`, `/mob-models`, `/mastery`, `/zones`, `/quests`,
`/settings`, `/shops`, `/npcs`, `/chests`, `/recipes`, `/missing-item-icons`.

## Development

```bash
bun test          # unit suite
bun run lint      # eslint + prettier + typecheck
bun run typecheck # tsc --build → emits types/*.d.ts (checkJs over the JSDoc)
```

**Pruning generated types:** `types/` is `tsc --build` output. `tsc` never deletes a `.d.ts` whose source
was removed, so after **deleting** any `src/**` file, regenerate cleanly:

```bash
rm -rf types && bun run typecheck
```

Otherwise orphan declarations accumulate (and get tracked). Committed `types/*.d.ts` must match live sources.

## License

[MIT](https://choosealicense.com/licenses/mit/)
