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
  project_control_deployment,
  project_game_deployment,
  project_kiosk_package,
  project_math_deployment,
  project_seed_deployment,
  type BootstrapDeployment,
  type ControlDeployment,
  type GameDeployment,
  type MathDeployment,
  type SeedDeployment,
} from '../src/deployment_admin.ts'
import { create_seed_admin, next_seed_batch, type SeedLedger } from '../src/seed_admin.ts'
import { create_freeze_forever_transaction } from '../src/seed.ts'
import { create_seed_session, type SeedSessionRecord, type SeedSessionStore } from '../src/seed_session.ts'

type PublishedGame = GameDeployment & Readonly<{ upgrade_cap: string }>
type State = Readonly<{
  signer_secret: string
  return_address: string
  math?: MathDeployment
  control?: ControlDeployment
  seed?: SeedDeployment
  game?: PublishedGame
  bootstrap?: BootstrapDeployment
  seed_session?: SeedSessionRecord
  seed_top_up_mist?: string
  /** one fingerprint per written content row — what "check changes" compares the files against */
  seed_ledger?: SeedLedger
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

// eslint-disable-next-line complexity -- The resumable manual proof projects every optional publication boundary independently.
const pins_from = (state: State): Pins => ({
  package: state.game?.package ?? null,
  math_package: state.math?.package ?? null,
  control_package: state.control?.package ?? null,
  control_package_original: state.control?.package ?? null,
  seed_package: state.seed?.package ?? null,
  seed_package_original: state.seed?.package ?? null,
  content_root: state.seed?.content_root ?? { id: null, shared_version: null },
  version: state.game?.version ?? { id: null, shared_version: null },
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

  if (!state.control) {
    console.log('COMPILE control')
    const artifact = await builds.compile_control('testnet')
    console.log('PUBLISH control')
    const sdk = sdk_for(signer, state)
    const receipt = await sdk.execute(
      create_package_publish_transaction({ artifact, recipient: signer.toSuiAddress() }),
      { include: { objectTypes: true } }
    )
    const control = project_control_deployment(receipt)
    state = await save_state(Object.freeze({ ...append_digest(state, receipt), control }))
    console.log(`PUBLISHED control ${control.package} ${receipt_digest(receipt)}`)
  }

  if (!state.seed) {
    console.log('COMPILE seed')
    const artifact = await builds.compile_seed('testnet', state.math!, state.control!)
    console.log('PUBLISH seed')
    const sdk = sdk_for(signer, state)
    const receipt = await sdk.execute(
      create_package_publish_transaction({ artifact, recipient: signer.toSuiAddress() }),
      { include: { objectTypes: true } }
    )
    const seed = project_seed_deployment(receipt)
    state = await save_state(Object.freeze({ ...append_digest(state, receipt), seed }))
    console.log(`PUBLISHED seed ${seed.package} ${receipt_digest(receipt)}`)
  }

  if (!state.game) {
    console.log('COMPILE game')
    const artifact = await builds.compile_game('testnet', state.math!, state.control!, {
      package: state.seed!.package,
      original_package: state.seed!.package,
      upgrade_cap: state.seed!.upgrade_cap,
    })
    const kiosk_package = project_kiosk_package(artifact, [
      state.math!.package,
      state.control!.package,
      state.seed!.package,
    ])
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
    admin_cap: state.control!.admin_cap,
    content_root: state.seed!.content_root.id,
    upgrade_caps: [
      { cap: state.math!.upgrade_cap, package: state.math!.package },
      { cap: state.control!.upgrade_cap, package: state.control!.package },
      { cap: state.seed!.upgrade_cap, package: state.seed!.package },
      { cap: state.game!.upgrade_cap, package: state.game!.package },
    ],
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
    super_admin_cap: state.control!.admin_cap,
    network: 'testnet',
    owner: state.return_address,
    package_id: state.control!.package,
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

  // creates are done — write every row the files changed since the last run, and the fight
  // boards (a fresh catalog is born empty; the change lane is its one writer)
  const applied = await delegated.apply_changes(state.seed_ledger ?? {})
  for (const digest of applied.digests) {
    state = await save_state(append_digest(state, { digest }))
    console.log(`CHANGES ${digest}`)
  }
  state = await save_state(Object.freeze({ ...state, seed_ledger: applied.ledger }))
  console.log(
    `SYNCED new:${applied.view.new_rows.length} changed:${applied.view.changed.length} up_to_date:${applied.view.unchanged}`
  )

  console.log('RELEASE seed-session')
  await session.release()
  console.log('RELEASED')

  const complete = await permanent_session.refresh()
  if (complete.batches.some(({ state: batch_state }) => batch_state !== 'complete'))
    throw new Error('Final chain inspection did not recover every completed seed batch')
  console.log('PREFLIGHT freeze_forever')
  const freeze_simulation = await permanent_sdk.simulate(
    create_freeze_forever_transaction(permanent_sdk, state.control!.admin_cap, state.seed!.content_root.id, [
      state.math!.upgrade_cap,
      state.control!.upgrade_cap,
      state.seed!.upgrade_cap,
      state.game!.upgrade_cap,
    ])
  )
  if (freeze_simulation.$kind === 'FailedTransaction')
    throw new Error('The freeze_forever transaction failed preflight')
  console.log('PREFLIGHTED freeze_forever (NOT executed — the game stays rebalanceable)')

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
