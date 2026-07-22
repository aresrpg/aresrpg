// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { join_world_ptb } from '../../packages/sdk/src/sui/write/game_world.js'
import { make_client } from '../localnet/bots/framework/sui.js'

import { signerOf } from './lib_gold.mjs'

const to_base64 = (bytes) => Buffer.from(bytes).toString('base64')

async function post_json(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok || payload.error) throw new Error(payload.error ?? `sponsor HTTP ${response.status}`)
  return payload
}

/** Drive the station-only two-call protocol with an Ed25519 throwaway wallet under the compose dev bypass. */
export async function sponsored_join_world(manifest) {
  const fixture = manifest.sponsor_fixture
  const wallet = manifest.wallets?.[fixture?.wallet_index]
  if (!fixture?.endpoint || !fixture?.wallet?.address || !fixture?.character || !wallet?.privkey)
    throw new Error('manifest has no sponsor_fixture')
  if (wallet.address !== fixture.wallet.address) throw new Error('sponsor fixture wallet address mismatch')
  const client = make_client(manifest.rpc, 'localnet')
  const signer = await signerOf(wallet.privkey)
  const transaction = join_world_ptb({
    network: 'localnet',
    ids: { aresrpg: manifest.ids.aresrpg },
  })({
    world_id: manifest.world_id,
    ...fixture.character,
  })
  transaction.setSender(fixture.wallet.address)
  const kind = await transaction.build({ client, onlyTransactionKind: true })
  const reservation = await post_json(`${fixture.endpoint}/reserve`, {
    txKindBytes: to_base64(kind),
    sender: fixture.wallet.address,
  })
  transaction.setGasOwner(reservation.sponsorAddress)
  transaction.setGasPayment(reservation.gasCoins)
  transaction.setGasBudget(reservation.gasBudget)
  const bytes = await transaction.build({ client })
  const { signature } = await signer.signTransaction(bytes)
  const executed = await post_json(`${fixture.endpoint}/execute`, {
    reservationId: reservation.reservationId,
    txBytes: to_base64(bytes),
    userSig: signature,
  })
  if (!executed.digest || executed.effects?.status?.status !== 'success')
    throw new Error(`sponsored join failed: ${JSON.stringify(executed.effects?.status ?? executed)}`)
  return {
    ...executed,
    sponsor_address: reservation.sponsorAddress,
    gas_budget_mist: reservation.gasBudget,
  }
}
