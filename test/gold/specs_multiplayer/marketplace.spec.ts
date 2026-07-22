// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

import { verify_expected_abort } from '../bot/behavior.mjs'
import { build_sdk_backend } from '../bot/backend_sdk.mjs'
import { run_actor_orchestrator } from '../bot/orchestrator.mjs'
import { get_fields, sui_balance } from '../../localnet/bots/framework/sui.js'

const gold = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest_path = path.join(gold, '.gold-deployment.json')
const manifest = fs.existsSync(manifest_path) ? JSON.parse(fs.readFileSync(manifest_path, 'utf8')) : null
const api = manifest?.api ?? 'http://127.0.0.1:3100'

const fetch_json = async (pathname: string) => (await fetch(`${api}${pathname}`)).json()

function mist_value(value: any): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'string' || typeof value === 'number') return BigInt(value)
  if (!value || typeof value !== 'object') return 0n
  for (const key of ['value', 'balance', 'profits']) if (value[key] != null) return mist_value(value[key])
  if (value.fields != null) return mist_value(value.fields)
  return 0n
}

async function make_actors() {
  const actors = await Promise.all(
    manifest.wallets.slice(0, 4).map(async (wallet: any, wallet_index: number) => {
      const selected_character = manifest.characters.find(
        (row: any) => row.wallet_index === wallet_index && row.slot === 0
      )
      const backend = await build_sdk_backend({ manifest, wallet, selected_character })
      return { id: `actor_${wallet_index}`, wallet, backend, page: null, selected_character }
    })
  )
  expect(actors).toHaveLength(4)
  return actors
}

async function owner_items(address: string) {
  return (await fetch_json(`/v1/owner-items?address=${address}`)).items ?? []
}

async function expect_listing_gone(item_id: string) {
  await expect
    .poll(async () =>
      ((await fetch_json('/v1/listings?limit=200')).listings ?? []).some((row: any) => row.item_id === item_id)
    )
    .toBe(false)
}

test.describe('four-actor native kiosk marketplace', () => {
  test.skip(!manifest?.market_two_actor, 'no market_two_actor fixture — run test/gold/up_gold.mjs')

  test('seller lists, buyer pays ask plus royalty, and the item remains buyer-kiosk locked', async () => {
    const fixture = manifest.market_two_actor
    const actors = await make_actors()
    const [seller, buyer] = actors
    const item_id = fixture.listing_plan.trade_item_id
    const ask_mist = BigInt(fixture.listing_plan.ask_mist)
    const seller_kiosk_before = mist_value(
      await get_fields(seller.backend.get_client(), seller.selected_character.kiosk_id)
    )
    const policy_before = mist_value(await get_fields(seller.backend.get_client(), fixture.policy.id))
    const buyer_before = await sui_balance(buyer.backend.get_client(), buyer.wallet.address)
    let purchase: any = null

    await run_actor_orchestrator({
      actors,
      lanes: {
        actor_0: [{ id: 'listed', do: 'list' }],
        actor_1: [{ barrier: { actor: 'actor_0', step: 'listed' } }, { id: 'bought', do: 'marketplace_buy' }],
        actor_2: [],
        actor_3: [],
      },
      execute_step: async ({ actor, step }: any) => {
        if (step.do === 'list')
          return actor.backend.verbs.get('list')({ item_id, price_mist: ask_mist, policy: fixture.policy })
        purchase = await actor.backend.verbs.get('marketplace_buy')({
          item_id,
          seller_kiosk_id: seller.selected_character.kiosk_id,
          price_mist: ask_mist,
          policy: fixture.policy,
        })
        return purchase
      },
    })

    expect(purchase.ok).toBe(true)
    expect(purchase.kiosk_id).toBe(buyer.selected_character.kiosk_id)
    const seller_kiosk_after = mist_value(
      await get_fields(seller.backend.get_client(), seller.selected_character.kiosk_id)
    )
    const policy_after = mist_value(await get_fields(seller.backend.get_client(), fixture.policy.id))
    const buyer_after = await sui_balance(buyer.backend.get_client(), buyer.wallet.address)
    expect(seller_kiosk_after - seller_kiosk_before).toBe(100_000_000n)
    expect(policy_after - policy_before).toBe(10_000_000n)
    expect(buyer_before - buyer_after - BigInt(purchase.gas_mist)).toBe(110_000_000n)

    await expect
      .poll(async () => (await owner_items(buyer.wallet.address)).find((row: any) => row.id === item_id) ?? null)
      .toMatchObject({ id: item_id, kiosk_id: purchase.kiosk_id })
    await expect_listing_gone(item_id)
    const seller_lots = (await owner_items(seller.wallet.address))
      .filter((row: any) => fixture.stack_lots.some((lot: any) => lot.item_id === row.id))
      .map((row: any) => row.amount)
      .sort((left: number, right: number) => left - right)
    expect(seller_lots).toEqual([1, 10, 100])
  })

  test('two buyers contend for one unique listing; exactly one purchase commits', async () => {
    const fixture = manifest.market_two_actor
    const actors = await make_actors()
    const [seller] = actors
    const item_id = fixture.listing_plan.race_item_id
    const ask_mist = BigInt(fixture.listing_plan.ask_mist)
    const before = new Map<string, any>()
    const outcomes = new Map<string, any>()
    for (const buyer of actors.slice(1, 3)) before.set(buyer.id, await owner_items(buyer.wallet.address))

    await run_actor_orchestrator({
      actors,
      lanes: {
        actor_0: [{ id: 'listed', do: 'list' }],
        actor_1: [{ barrier: { actor: 'actor_0', step: 'listed' } }, { id: 'attempted', do: 'marketplace_buy' }],
        actor_2: [{ barrier: { actor: 'actor_0', step: 'listed' } }, { id: 'attempted', do: 'marketplace_buy' }],
        actor_3: [],
      },
      execute_step: async ({ actor, step }: any) => {
        if (step.do === 'list')
          return actor.backend.verbs.get('list')({ item_id, price_mist: ask_mist, policy: fixture.policy })
        const result = await actor.backend.verbs.get('marketplace_buy')({
          item_id,
          seller_kiosk_id: seller.selected_character.kiosk_id,
          price_mist: ask_mist,
          policy: fixture.policy,
        })
        outcomes.set(actor.id, result)
        return { ...result, ok: true }
      },
    })

    const successes = [...outcomes].filter(([, result]) => result.ok)
    const losers = [...outcomes].filter(([, result]) => !result.ok)
    expect(successes).toHaveLength(1)
    expect(losers).toHaveLength(1)
    await expect_listing_gone(item_id)
    const [[winner_id, winner]] = successes
    const winner_actor = actors.find((actor) => actor.id === winner_id)!
    expect(winner.kiosk_id).toBe(winner_actor.selected_character.kiosk_id)
    await expect
      .poll(async () => (await owner_items(winner_actor.wallet.address)).find((row: any) => row.id === item_id) ?? null)
      .toMatchObject({ id: item_id, kiosk_id: winner.kiosk_id })

    const [[loser_id, loser]] = losers
    const loser_actor = actors.find((actor) => actor.id === loser_id)!
    const loser_after = await owner_items(loser_actor.wallet.address)
    const snapshots = [before.get(loser_id), loser_after].map((items) =>
      (items ?? [])
        .map((item: any) => ({ id: item.id, kiosk_id: item.kiosk_id, amount: item.amount }))
        .sort((a: any, b: any) => a.id.localeCompare(b.id))
    )
    await verify_expected_abort({
      step: {
        expect_abort: {
          do: 'marketplace_buy',
          module: 'dynamic_field',
          abort_code: 1,
          no_digest: false,
          no_state_delta: ['v1.buyer.items'],
        },
      },
      execute: async () => loser,
      snapshot: async () => snapshots.shift(),
    })
    expect(loser.digest, 'executed loser burns gas once and is never retried').toBeTruthy()
  })
})
