// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-30 HEALTHZ — assert the on-chain stack is LIVE before any golden-path step. The truth is the switches,
// not a port probe: GameConfig.enabled + every package Version.enabled + the seed objects readable.
import { IDS, seed, ceremony, fields, getObj, balanceMist, ADDR, logline } from './_qa.mjs'

const check = (name, cond, detail = '') =>
  logline(`${cond ? 'LIVE ' : 'DEAD '} ${name}${detail ? ' :: ' + detail : ''}`)

logline(`\n===== S-30 HEALTHZ @ ${new Date().toISOString()} =====`)
logline(`signer=${ADDR}`)
const bal = await balanceMist()
logline(`balance=${(bal / 1e9).toFixed(4)} SUI (${bal} mist)`)

// GameConfig.enabled — the global master switch
const gc = await fields(IDS.gameConfig)
check(
  'GameConfig.enabled',
  gc?.enabled === true,
  `enabled=${gc?.enabled} team_size=${gc?.team_size_bound} placement_ms=${gc?.placement_ms} turn_ms=${gc?.turn_duration_ms} listing_gate=${gc?.listing_level_gate} koli_gate=${gc?.pvp_level_gate} loot_mult=${gc?.loot_multiplier}`
)

// Every package Version.enabled
for (const [name, vid] of [
  ['items', IDS.itemsVersion],
  ['game', IDS.gameVersion],
  ['fight', IDS.fightVersion],
  ['dungeon', IDS.dungeonVersion],
  ['pools', IDS.poolsVersion],
  ['kolizeum', IDS.kolizeumVersion],
  ['social', IDS.socialVersion],
  ['spells', ceremony.spells.version],
]) {
  const f = await fields(vid)
  check(`Version[${name}].enabled`, f?.enabled === true, `enabled=${f?.enabled} version=${f?.version ?? '?'}`)
}

// Creation gate — price / paused / senshi whitelisted
const cr = await fields(IDS.creation)
logline(
  `Creation.price=${cr?.price} (${Number(cr?.price) / 1e9} SUI) paused=${cr?.paused} free_enabled=${cr?.free_enabled} sponsor=${JSON.stringify(cr?.sponsor)}`
)

// Seed objects readable
const world = await fields(seed.world.id)
check(
  'World',
  !!world,
  `biome=${world?.biome} seed=${world?.seed} req_lvl=${world?.required_level} zone_size=${world?.zone_size} spawn=(${world?.spawn_zone_x},${world?.spawn_zone_z}) bounds=(${world?.bounds_x},${world?.bounds_z}) dungeon_key=${JSON.stringify(world?.dungeon_key_template)}`
)
const healer = await getObj(seed.mobs.healer.id)
check('Mob[healer]', !!healer?.data, `type=${healer?.data?.type?.split('::').slice(-1)[0]}`)
const heal = await getObj(seed.items.heal_potion)
check('Template[heal_potion]', !!heal?.data, `id=${seed.items.heal_potion}`)
const key = await getObj(seed.items.crypt_key)
check('Template[crypt_key]', !!key?.data)
const ore = await getObj(seed.items.iron_ore)
check('Template[iron_ore]', !!ore?.data)

logline(`===== HEALTHZ DONE =====\n`)
