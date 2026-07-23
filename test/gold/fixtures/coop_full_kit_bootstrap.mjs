// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gold-only progression bootstrap for the isolated full-kit coop actors. Every level comes from the shipped
// enter/search/fight/settle doors; the final gate reads the Character's live Progression dynamic field.
import { build_context, make_kiosk_client } from '../../localnet/bots/framework/context.js'
import { Driver } from '../../localnet/bots/framework/driver.js'
import { get_fields, LOCALNET_GAS_BUDGET, SubmitStats } from '../../localnet/bots/framework/sui.js'
import { reach_zone, win_fight } from '../../localnet/bots/framework/world_flow.js'
import { signerOf } from '../lib_gold.mjs'

const unwrap = (value) => (value && typeof value === 'object' && 'fields' in value ? value.fields : value)

async function progression_field(client, character_id) {
  let cursor = null
  do {
    const page = await client.getDynamicFields({
      parentId: character_id,
      ...(cursor ? { cursor } : {}),
    })
    const row = (page.data ?? []).find((field) =>
      String(field.name?.type ?? '').includes('::character_link::ProgressionKey')
    )
    if (row?.objectId) return get_fields(client, row.objectId)
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return null
}

export async function read_character_progression(client, character_id) {
  const field = await progression_field(client, character_id)
  const value = unwrap(field?.value)
  if (value?.level == null || value?.xp == null) return null
  return { level: Number(value.level), xp: BigInt(value.xp) }
}

function driver_for({ client, ids, kiosk_pkg, wallet, signer }) {
  const kiosk_client = make_kiosk_client(client, 'testnet', {
    personalKioskRulePackageId: kiosk_pkg,
    kioskLockRulePackageId: kiosk_pkg,
    royaltyRulePackageId: kiosk_pkg,
  })
  const context = build_context({
    manifest: { ids: { aresrpg: ids } },
    network: 'localnet',
    kiosk_client,
  })
  return new Driver({
    bot: { name: 'coop_full_kit_bootstrap', address: wallet.address, keypair: signer },
    context,
    client,
    signer,
    coverage: { record: () => [] },
    stats: new SubmitStats(),
    budget: LOCALNET_GAS_BUDGET,
  })
}

async function discover_leveler_group({ driver, client, character, game_ids, world, fixture }) {
  let last = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    last = await reach_zone({
      driver,
      client,
      ids: character,
      world,
      pkg_origin: game_ids.PACKAGE_ID,
      prefer_template: fixture.mob_template_id,
    })
    if (last?.mob?.template_id === fixture.mob_template_id) return last
  }
  throw new Error(`coop full-kit leveler found no live group after 6 searches: ${JSON.stringify(last?.trace ?? [])}`)
}

/** Level four isolated actors through one honest solo victory apiece and return manifest-ready rows. */
export async function level_coop_full_kit_fighters({
  client,
  ids,
  kiosk_pkg,
  wallets,
  fighters,
  fixture,
  target_level = 100,
}) {
  if (!fixture?.world_id || !fixture?.mob_template_id)
    throw new Error('coop full-kit bootstrap requires the coop_full_kit_leveler fight fixture')
  const world_fields = await get_fields(client, fixture.world_id)
  if (!world_fields) throw new Error(`coop full-kit leveler world ${fixture.world_id} is unreadable`)
  const world = {
    id: fixture.world_id,
    offset_x: Number(world_fields.offset_x ?? 0),
    offset_z: Number(world_fields.offset_z ?? 0),
    zone_size: Number(world_fields.zone_size ?? fixture.zone_size),
  }
  const leveled = []
  for (const fighter of fighters) {
    const wallet = wallets[fighter.wallet_index]
    if (!wallet) throw new Error(`coop full-kit fighter wallet ${fighter.wallet_index} is missing`)
    const signer = await signerOf(wallet.privkey)
    const driver = driver_for({ client, ids, kiosk_pkg, wallet, signer })
    driver.select_character(fighter)
    const character = {
      character_id: fighter.character_id,
      kiosk_id: fighter.kiosk_id,
      personal_kiosk_cap_id: fighter.personal_kiosk_cap_id,
    }
    const zone = await discover_leveler_group({
      driver,
      client,
      character,
      game_ids: ids,
      world,
      fixture,
    })
    const victory = await win_fight({
      driver,
      client,
      ids: character,
      world,
      zone,
      max_turns: 24,
    })
    if (!victory.won || !victory.settle?.res?.ok)
      throw new Error(
        `coop full-kit leveler failed for ${fighter.class}: ${victory.reason ?? victory.settle?.res?.abort ?? 'no xp'}`
      )
    const progression = await read_character_progression(client, fighter.character_id)
    if (!progression || progression.level !== target_level)
      throw new Error(
        `coop full-kit ${fighter.class} reached L${progression?.level ?? 0} ` +
          `(xp ${progression?.xp ?? 0}), expected exactly L${target_level}`
      )
    leveled.push({ ...fighter, level: progression.level })
  }
  return leveled
}
