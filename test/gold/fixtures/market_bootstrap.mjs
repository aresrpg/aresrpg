// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { buy_many_ptb } from '../../../packages/sdk/src/sui/write/items_shop.js'
import { build_context, make_kiosk_client } from '../../localnet/bots/framework/context.js'
import { Transaction } from '../../localnet/bots/framework/deps.js'
import { submit } from '../../localnet/bots/framework/sui.js'
import { signerOf } from '../lib_gold.mjs'

import { build_market_two_actor_fixture } from './market_two_actor.mjs'

const FIXED_RANDOM_GAS_MIST = 5_000_000_000
const FIXTURE_SALE_PRICE_MIST = 1_000_000
const STACK_CATEGORIES = new Set(['resource', 'consumable', 'rune'])

const json = async (url) => (await fetch(url)).json()

function some_u64(tx, value) {
  return tx.moveCall({
    target: '0x1::option::some',
    typeArguments: ['u64'],
    arguments: [tx.pure.u64(value)],
  })
}

async function create_stack_sale({ client, signer, ids, template_id }) {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ids.LATEST_PACKAGE_ID}::shop::create_sale`,
    arguments: [
      tx.object(ids.ADMIN_ARESRPG),
      tx.pure.id(template_id),
      tx.pure.u64(FIXTURE_SALE_PRICE_MIST),
      some_u64(tx, 111),
      tx.object(ids.VERSION),
    ],
  })
  const result = await submit({ client, signer, tx, sender: signer.toSuiAddress() })
  const sale_id = result.created?.('::shop::Sale')
  if (!result.ok || !sale_id) throw new Error(`market stack Sale creation failed: ${result.abort ?? result.error}`)
  return { sale_id, template_id, price_mist: String(FIXTURE_SALE_PRICE_MIST), digest: result.digest }
}

async function buy_fixture_lot({ client, signer, context, sale, character, quantity }) {
  const tx = buy_many_ptb(context)({
    sale_id: sale.sale_id,
    template_id: sale.template_id,
    price_mist: sale.price_mist,
    quantity,
    kiosk_id: character.kiosk_id,
    personal_kiosk_cap_id: character.personal_kiosk_cap_id,
    gas_budget_mist: FIXED_RANDOM_GAS_MIST,
  })
  const result = await submit({ client, signer, tx, sender: signer.toSuiAddress(), budget: FIXED_RANDOM_GAS_MIST })
  if (!result.ok) throw new Error(`market fixture shop buy x${quantity} failed: ${result.abort ?? result.error}`)
  return { item_ids: result.createdAll('::item::Item'), digest: result.digest }
}

function select_sales(sales, items) {
  const by_template = new Map(items.map((item) => [item.template_id, item]))
  const [unique] = sales
    .filter((sale) => {
      const category = String(by_template.get(sale.template_id)?.category ?? '').toLowerCase()
      return (
        !STACK_CATEGORIES.has(category) &&
        (sale.supply_remaining == null || Number(sale.supply_remaining) >= 2) &&
        BigInt(sale.price_mist) > 0n
      )
    })
    .sort((left, right) => (BigInt(left.price_mist) < BigInt(right.price_mist) ? -1 : 1))
  const stack_template = items.find((item) => STACK_CATEGORIES.has(String(item.category ?? '').toLowerCase()))
  if (!unique) throw new Error('market fixture needs an active non-stackable shop Sale with supply >=2')
  if (!stack_template) throw new Error('market fixture needs a seeded resource/consumable/rune template')
  return { unique, stack_template }
}

/** Mint deterministic seller inventory and return the JSON-safe `market_two_actor` manifest fixture. */
export async function create_market_two_actor({
  api,
  client,
  admin_signer,
  ids,
  kiosk_pkg,
  wallets,
  characters,
  wait_v1,
}) {
  const [{ sales }, { items }] = await Promise.all([
    json(`${api}/v1/shop?active=true`),
    json(`${api}/v1/encyclopedia?kind=items`),
  ])
  const selected = select_sales(sales ?? [], items ?? [])
  const stack_sale = await create_stack_sale({
    client,
    signer: admin_signer,
    ids,
    template_id: selected.stack_template.template_id,
  })
  const seller = characters.find((row) => row.wallet_index === 0 && row.slot === 0)
  const buyers = [1, 2].map((wallet_index) =>
    characters.find((row) => row.wallet_index === wallet_index && row.slot === 0)
  )
  if (!seller || buyers.some((row) => !row)) throw new Error('market fixture needs seller w0 and buyers w1/w2')
  const signer = await signerOf(wallets[0].privkey)
  const kiosk_client = make_kiosk_client(client, 'testnet', {
    personalKioskRulePackageId: kiosk_pkg,
    kioskLockRulePackageId: kiosk_pkg,
    royaltyRulePackageId: kiosk_pkg,
  })
  const context = build_context({ manifest: { ids: { aresrpg: ids } }, network: 'localnet', kiosk_client })
  const policy_type = `${ids.PACKAGE_ID}::item::Item`
  const [policy] = await kiosk_client.getTransferPolicies({ type: policy_type })
  if (!policy) throw new Error(`market fixture could not resolve TransferPolicy<${policy_type}>`)

  const unique_sale = {
    sale_id: selected.unique.sale_id,
    template_id: selected.unique.template_id,
    price_mist: String(selected.unique.price_mist),
  }
  const unique = await buy_fixture_lot({
    client,
    signer,
    context,
    sale: unique_sale,
    character: seller,
    quantity: 2,
  })
  if (unique.item_ids.length !== 2) throw new Error(`unique fixture buy created ${unique.item_ids.length}, expected 2`)
  const stacks = {}
  const digests = { unique: unique.digest }
  for (const quantity of [1, 10, 100]) {
    const bought = await buy_fixture_lot({
      client,
      signer,
      context,
      sale: stack_sale,
      character: seller,
      quantity,
    })
    if (bought.item_ids.length !== 1)
      throw new Error(`stack fixture buy x${quantity} created ${bought.item_ids.length}, expected 1`)
    ;[stacks[quantity]] = bought.item_ids
    digests[`stack_${quantity}`] = bought.digest
  }
  const all_items = [...unique.item_ids, ...Object.values(stacks)]
  await wait_v1(
    `/v1/owner-items?address=${wallets[0].address}`,
    (payload) => all_items.every((id) => (payload.items ?? []).some((item) => item.id === id)),
    120_000,
    'market seller inventory visible'
  )
  const fixture = build_market_two_actor_fixture({
    characters: [seller, ...buyers],
    unique_item_ids: unique.item_ids,
    stack_item_ids: stacks,
    policy: { ...policy, balance: '0' },
  })
  return {
    ...fixture,
    shop_fixture: {
      unique_sale,
      stack_sale,
      unique_template_id: unique_sale.template_id,
      stack_template_id: stack_sale.template_id,
      digests,
    },
  }
}
