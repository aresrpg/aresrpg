// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Manual testnet proof for the complete admin lifecycle. The temporary signer is resumable after
// a failed probe, returns its remaining SUI on success, and never writes deployment pins.

import { readFile, unlink, writeFile } from 'node:fs/promises'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { create_contract_build_service } from '../../frontend/deployment_dev_server.ts'
import { seed_content } from '../../frontend/src/admin/seed_content.ts'
import { absorb_receipt, receipt_digest, type Receipt } from '../src/cache.ts'
import { SDK, type Pins } from '../src/client.ts'
import {
  create_deployment_bootstrap_transaction,
  create_package_publish_transaction,
  DISPLAY_REGISTRY_ID,
  project_bootstrap_deployment,
  project_game_deployment,
  project_kiosk_package,
  project_math_deployment,
  type BootstrapDeployment,
  type GameDeployment,
  type MathDeployment,
} from '../src/deployment_admin.ts'
import { create_seed_admin, next_seed_batch } from '../src/seed_admin.ts'
import { create_seal_transaction } from '../src/seed.ts'
import { create_seed_session, type SeedSessionRecord, type SeedSessionStore } from '../src/seed_session.ts'

type PublishedGame = GameDeployment & Readonly<{ upgrade_cap: string }>
type State = Readonly<{
  signer_secret: string
  return_address: string
  math?: MathDeployment
  game?: PublishedGame
  bootstrap?: BootstrapDeployment
  seed_session?: SeedSessionRecord
  seed_top_up_mist?: string
  digests: readonly string[]
}>

const RPC_URL = 'https://fullnode.testnet.sui.io:443'
const FUNDING_REQUIRED = 25_000_000_000n
const STATE_PATH = '/private/tmp/aresrpg-admin-e2e-state.json'
const repo_dir = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '')
const [, , return_address] = process.argv
if (!return_address?.startsWith('0x'))
  throw new Error('Usage: bun packages/sdk/scripts/e2e_admin_publish.ts <return-address>')

const load_state = async (): Promise<State> => {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8')) as State
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const signer = new Ed25519Keypair()
    const created = Object.freeze({
      signer_secret: signer.getSecretKey(),
      return_address,
      digests: Object.freeze([]),
    })
    await writeFile(STATE_PATH, `${JSON.stringify(created, null, 2)}\n`, { mode: 0o600 })
    return created
  }
}

const save_state = async (state: State): Promise<State> => {
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  return state
}

const append_digest = (state: State, receipt: Receipt): State =>
  Object.freeze({ ...state, digests: Object.freeze([...state.digests, receipt_digest(receipt)]) })

const pins_from = (state: State): Pins => ({
  package: state.game?.package ?? null,
  math_package: state.math?.package ?? null,
  version: state.game?.version ?? { id: null, shared_version: null },
  template_registry: state.game?.template_registry ?? { id: null, shared_version: null },
  loot_registry: state.game?.loot_registry ?? { id: null, shared_version: null },
  name_registry: state.game?.name_registry ?? { id: null, shared_version: null },
  friend_registry: state.game?.friend_registry ?? { id: null, shared_version: null },
  item_policy: state.bootstrap?.item_policy ?? { id: null, shared_version: null },
  character_policy: state.bootstrap?.character_policy ?? { id: null, shared_version: null },
  item_protected_policy: state.bootstrap?.item_protected_policy ?? { id: null, shared_version: null },
  character_protected_policy: state.bootstrap?.character_protected_policy ?? { id: null, shared_version: null },
})

const sdk_for = (signer: Ed25519Keypair, state: State) =>
  SDK({ signer, network: 'testnet', rpc_url: RPC_URL, pins: pins_from(state) })

const wait_for_funding = async (state: State, signer: Ed25519Keypair): Promise<void> => {
  const sdk = sdk_for(signer, state)
  while (true) {
    const result = await sdk.sui_client.core.getBalance?.({ owner: signer.toSuiAddress() })
    const balance = BigInt(result?.balance.balance ?? 0)
    if (balance >= FUNDING_REQUIRED) return
    console.log(`FUND_REQUIRED ${signer.toSuiAddress()} ${FUNDING_REQUIRED}`)
    await Bun.sleep(2_000)
  }
}

const main = async (): Promise<void> => {
  let state = await load_state()
  if (state.return_address !== return_address) throw new Error(`Recovery state belongs to ${state.return_address}`)
  const signer = Ed25519Keypair.fromSecretKey(state.signer_secret)
  console.log(`E2E_SIGNER ${signer.toSuiAddress()}`)
  if (!state.math) await wait_for_funding(state, signer)
  const builds = create_contract_build_service({ repo_dir })
  let game_receipt: Receipt | null = null
  let bootstrap_receipt: Receipt | null = null

  if (!state.math) {
    console.log('COMPILE math')
    const artifact = await builds.compile_math('testnet')
    console.log('PUBLISH math')
    const sdk = sdk_for(signer, state)
    const receipt = await sdk.execute(
      create_package_publish_transaction({ artifact, recipient: signer.toSuiAddress() }),
      { include: { objectTypes: true } }
    )
    const math = project_math_deployment(receipt)
    state = await save_state(Object.freeze({ ...append_digest(state, receipt), math }))
    console.log(`PUBLISHED math ${math.package} ${receipt_digest(receipt)}`)
  }

  if (!state.game) {
    console.log('COMPILE game')
    const artifact = await builds.compile_game('testnet', state.math!)
    const kiosk_package = project_kiosk_package(artifact, state.math!.package)
    console.log('PUBLISH game')
    const sdk = sdk_for(signer, state)
    game_receipt = await sdk.execute(
      create_package_publish_transaction({ artifact, recipient: signer.toSuiAddress() }),
      { include: { objectTypes: true } }
    )
    const projected = project_game_deployment({ receipt: game_receipt, kiosk_package })
    const game = Object.freeze({ ...projected, upgrade_cap: project_math_deployment(game_receipt).upgrade_cap })
    state = await save_state(Object.freeze({ ...append_digest(state, game_receipt), game }))
    console.log(`PUBLISHED game ${game.package} ${receipt_digest(game_receipt)}`)
  }

  if (!state.bootstrap) {
    console.log('BOOTSTRAP policies')
    const sdk = sdk_for(signer, state)
    if (game_receipt) absorb_receipt(sdk.cache, game_receipt)
    else await sdk.hydrate([state.game!.publisher])
    await sdk.hydrate([DISPLAY_REGISTRY_ID])
    bootstrap_receipt = await sdk.execute(
      await create_deployment_bootstrap_transaction({
        sdk,
        package_id: state.game!.package,
        kiosk_package: state.game!.kiosk_package,
        publisher: state.game!.publisher,
        recipient: signer.toSuiAddress(),
      }),
      { include: { objectTypes: true } }
    )
    const bootstrap = project_bootstrap_deployment(bootstrap_receipt, state.game!.package)
    state = await save_state(Object.freeze({ ...append_digest(state, bootstrap_receipt), bootstrap }))
    console.log(`BOOTSTRAPPED ${receipt_digest(bootstrap_receipt)}`)
  }

  const config = Object.freeze({
    admin_cap: state.game!.admin_cap,
    worlds: Object.freeze(Object.fromEntries(Object.entries(state.game!.worlds).map(([name, pin]) => [name, pin.id]))),
  })
  const permanent_sdk = sdk_for(signer, state)
  if (game_receipt) absorb_receipt(permanent_sdk.cache, game_receipt)
  if (bootstrap_receipt) absorb_receipt(permanent_sdk.cache, bootstrap_receipt)
  const permanent_session = await create_seed_admin({ sdk: permanent_sdk, content: seed_content, config })
  const before = await permanent_session.refresh()
  console.log(
    `INSPECT ${before.batches.filter(({ state: batch_state }) => batch_state === 'complete').length}/${before.batches.length}`
  )

  // ONE custody lifecycle — the exact module the browser admin page runs (file-backed store)
  const session_store: SeedSessionStore = {
    read: () => state.seed_session ?? null,
    write: async (record) => {
      state = await save_state(Object.freeze({ ...state, seed_session: record }))
    },
    clear: async () => {
      const { seed_session: _dropped, ...rest } = state
      state = await save_state(Object.freeze(rest) as State)
    },
  }
  const session = create_seed_session({
    store: session_store,
    super_sdk: permanent_sdk,
    super_admin_cap: state.game!.admin_cap,
    network: 'testnet',
    owner: state.return_address,
    package_id: state.game!.package,
    build_session_sdk: (session_keypair) => sdk_for(session_keypair, state),
  })
  const ensured = await session.ensure()
  if (ensured.authorization_receipt) {
    state = await save_state(append_digest(state, ensured.authorization_receipt))
    console.log(`AUTHORIZED ${ensured.admin_cap} ${receipt_digest(ensured.authorization_receipt)}`)
  }
  const seed_signer = Ed25519Keypair.fromSecretKey(state.seed_session!.secret)

  const requested_top_up = BigInt(process.env.E2E_TOP_UP_MIST ?? 0)
  const previous_top_up = BigInt(state.seed_top_up_mist ?? 0)
  if (requested_top_up > previous_top_up) {
    const amount = requested_top_up - previous_top_up
    console.log(`TOP_UP seed-session ${amount}`)
    const top_up = permanent_sdk.tx()
    const [funds] = top_up.splitCoins(top_up.gas, [amount])
    top_up.transferObjects([funds], seed_signer.toSuiAddress())
    const receipt = await permanent_sdk.execute(top_up)
    state = await save_state(
      Object.freeze({ ...append_digest(state, receipt), seed_top_up_mist: String(requested_top_up) })
    )
    console.log(`TOPPED_UP ${receipt_digest(receipt)}`)
  }

  const delegated_sdk = ensured.sdk
  if (game_receipt) absorb_receipt(delegated_sdk.cache, game_receipt)
  const delegated = await create_seed_admin({
    sdk: delegated_sdk,
    content: seed_content,
    config: { ...config, admin_cap: ensured.admin_cap },
  })
  let snapshot = await delegated.refresh()
  while (true) {
    const next = next_seed_batch(snapshot)
    if (!next) break
    if (next.state !== 'ready')
      throw new Error(`Seed batch ${next.id} is blocked: ${next.missing_dependencies.join(', ')}`)
    console.log(`SEED ${next.id} ${next.targets}`)
    const result = await delegated.execute(next.id)
    state = await save_state(append_digest(state, { digest: result.digest }))
    const { snapshot: updated_snapshot } = result
    snapshot = updated_snapshot
    console.log(`SEEDED ${result.batch} ${result.digest}`)
  }

  console.log('RELEASE seed-session')
  await session.release()
  console.log('RELEASED')

  const complete = await permanent_session.refresh()
  if (complete.sealed || complete.batches.some(({ state: batch_state }) => batch_state !== 'complete'))
    throw new Error('Final chain inspection did not recover every completed seed batch before sealing')
  console.log('PREFLIGHT seal')
  const seal_simulation = await permanent_sdk.simulate(create_seal_transaction(permanent_sdk, state.game!.admin_cap))
  if (seal_simulation.$kind === 'FailedTransaction') throw new Error('The final seal transaction failed preflight')
  console.log('PREFLIGHTED seal')

  console.log('RETURN remaining SUI')
  const cleanup = permanent_sdk.tx()
  cleanup.transferObjects([cleanup.gas], state.return_address)
  const cleanup_receipt = await permanent_sdk.execute(cleanup)
  state = await save_state(append_digest(state, cleanup_receipt))
  console.log(`RETURNED ${receipt_digest(cleanup_receipt)}`)
  console.log(`E2E_COMPLETE ${state.game!.package} ${state.digests.length}`)
  await unlink(STATE_PATH)
}

await main().catch((error) => {
  console.error('E2E_FAILED', error)
  console.error(`E2E_RECOVERY ${STATE_PATH}`)
  process.exitCode = 1
})
