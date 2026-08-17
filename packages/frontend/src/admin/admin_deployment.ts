// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ContractArtifact, GameDeployment } from '@aresrpg/sdk/deployment-admin'
import { receipt_digest } from '@aresrpg/sdk/cache'
import type { SeedAdminConfig } from '@aresrpg/sdk/seed-admin'

import { env } from '../env.ts'
import type { AppInput, AppModule } from '../store.ts'

import type { AdminDeploymentState, AdminState, DeploymentPins } from './admin_state.ts'

const seed_config_from = (deployment: AdminDeploymentState): SeedAdminConfig =>
  Object.freeze({
    admin_cap: deployment.pins?.admin_cap ?? '',
    worlds: Object.freeze(
      Object.fromEntries(Object.entries(deployment.pins?.worlds ?? {}).map(([name, pin]) => [name, pin.id]))
    ),
  })

const deployment_bootstrapped = (pins: DeploymentPins | null): boolean =>
  !!pins?.package &&
  !!pins.item_policy?.id &&
  !!pins.character_policy?.id &&
  !!pins.item_protected_policy?.id &&
  !!pins.character_protected_policy?.id

const game_from_pins = (pins: DeploymentPins): GameDeployment => {
  const publisher = pins.publisher ?? pins.item_publisher ?? pins.character_publisher
  if (
    !pins.package ||
    !pins.kiosk_package ||
    !pins.admin_cap ||
    !publisher ||
    !pins.version.id ||
    !pins.version.shared_version ||
    !pins.template_registry.id ||
    !pins.template_registry.shared_version
  )
    throw new Error('The saved game publication is incomplete; reload its receipt-derived pins')
  return Object.freeze({
    package: pins.package,
    kiosk_package: pins.kiosk_package,
    admin_cap: pins.admin_cap,
    publisher,
    item_publisher: publisher,
    character_publisher: publisher,
    version: { id: pins.version.id, shared_version: pins.version.shared_version },
    template_registry: {
      id: pins.template_registry.id,
      shared_version: pins.template_registry.shared_version,
    },
    worlds: pins.worlds,
  })
}

// eslint-disable-next-line complexity -- The reducer routes one discriminated deployment lifecycle without nested effects.
export const reduce_admin_deployment = (admin: AdminState, input: AppInput): AdminState | null => {
  const update = (deployment: AdminDeploymentState): AdminState =>
    Object.freeze({ ...admin, deployment, config: seed_config_from(deployment) })
  if (input.type === 'admin/deployment_load' && admin.deployment.status === 'idle')
    return update(Object.freeze({ ...admin.deployment, status: 'loading', error: null }))
  if (input.type === 'admin/deployment_unavailable' && admin.deployment.status === 'loading')
    return update(Object.freeze({ ...admin.deployment, status: 'unavailable', error: null }))
  if (input.type === 'admin/deployment_loaded' && admin.deployment.status === 'loading')
    return update(
      Object.freeze({
        ...admin.deployment,
        status: 'ready',
        network: input.network,
        token: input.token,
        revision: input.revision,
        pins: input.pins,
        error: null,
      })
    )
  if (input.type === 'admin/contracts_compile' && ['ready', 'failed'].includes(admin.deployment.status))
    return update(
      Object.freeze({ ...admin.deployment, status: 'compiling', artifact: null, operation: 'compile', error: null })
    )
  if (input.type === 'admin/contracts_compiled' && admin.deployment.operation === 'compile')
    return update(
      Object.freeze({ ...admin.deployment, status: 'ready', artifact: input.artifact, operation: null, error: null })
    )
  if (
    input.type === 'admin/contracts_publish' &&
    admin.deployment.status === 'ready' &&
    !deployment_bootstrapped(admin.deployment.pins) &&
    (!!admin.deployment.artifact || (!!admin.deployment.pins?.math_package && !!admin.deployment.pins.math_upgrade_cap))
  )
    return update(Object.freeze({ ...admin.deployment, status: 'publishing', operation: 'publish', error: null }))
  if (input.type === 'admin/contracts_published' && admin.deployment.operation === 'publish')
    return update(
      Object.freeze({
        ...admin.deployment,
        status: 'ready',
        revision: input.revision,
        pins: input.pins,
        artifact: null,
        operation: null,
        paused: false,
        error: null,
      })
    )
  if (input.type === 'admin/game_pause' && admin.deployment.status === 'ready' && admin.deployment.pins?.package)
    return update(
      Object.freeze({
        ...admin.deployment,
        status: 'operating',
        operation: input.paused ? 'pause' : 'resume',
        error: null,
      })
    )
  if (input.type === 'admin/game_pause_changed' && admin.deployment.status === 'operating')
    return update(
      Object.freeze({ ...admin.deployment, status: 'ready', paused: input.paused, operation: null, error: null })
    )
  if (input.type === 'admin/game_pause_discovered' && admin.deployment.status === 'ready')
    return update(Object.freeze({ ...admin.deployment, paused: input.paused }))
  if (
    input.type === 'admin/deployment_failed' &&
    ['loading', 'compiling', 'publishing', 'operating'].includes(admin.deployment.status)
  )
    return update(Object.freeze({ ...admin.deployment, status: 'failed', operation: null, error: input.error }))
  return null
}

export const observe_admin_deployment = ({
  events,
  dispatch,
  get_state,
}: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  const log = (message: string, tone: 'info' | 'success' | 'error' = 'info'): void =>
    dispatch({ type: 'admin/log', message, tone })
  const fail = (error: unknown): void => {
    console.error('Admin deployment operation failed.', error)
    const message = error instanceof Error ? error.message : String(error)
    log(message, 'error')
    dispatch({ type: 'admin/deployment_failed', error: message })
  }
  const request = async (method: 'POST' | 'PUT', body: Readonly<Record<string, unknown>>) => {
    const { deployment } = get_state().admin
    const response = await fetch('/__admin/deployment', {
      method,
      headers: { 'content-type': 'application/json', 'x-aresrpg-admin-token': deployment.token },
      body: JSON.stringify({ network: deployment.network, ...body }),
    })
    const result = (await response.json()) as Record<string, unknown>
    if (!response.ok) throw new Error(String(result.error || `Deployment operation returned ${response.status}`))
    return result
  }
  const load = (): void => {
    if (!import.meta.env.DEV) return dispatch({ type: 'admin/deployment_unavailable' })
    void fetch('/__admin/deployment', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 404) return dispatch({ type: 'admin/deployment_unavailable' })
        const body = (await response.json()) as Readonly<{
          pins?: Readonly<Record<'testnet' | 'mainnet', DeploymentPins>>
          revision?: string
          token?: string
          error?: string
        }>
        const pins = body.pins?.[env.network]
        if (!response.ok || !pins || !body.revision || !body.token)
          throw new Error(body.error || `Deployment state returned ${response.status}`)
        dispatch({
          type: 'admin/deployment_loaded',
          network: env.network,
          pins,
          revision: body.revision,
          token: body.token,
        })
      })
      .catch(fail)
  }
  const discover_pause = (): void => {
    const { deployment, wallet } = get_state().admin
    const version = deployment.pins?.version.id
    if (!wallet.session || !version) return
    void wallet.session
      .read_game_paused(version)
      .then((paused) => dispatch({ type: 'admin/game_pause_discovered', paused }))
      .catch((error) => console.warn('Published game state could not be read.', error))
  }
  const compile = (): void => {
    log('Compiling the math package with warnings as errors…')
    void request('POST', { action: 'compile_math' })
      .then(({ artifact }) => {
        if (!artifact || typeof artifact !== 'object') throw new Error('The compiler returned no package artifact')
        log('Math package compiled.', 'success')
        dispatch({ type: 'admin/contracts_compiled', artifact: artifact as ContractArtifact })
      })
      .catch(fail)
  }
  const publish = (): void => {
    const { deployment, wallet } = get_state().admin
    const connected = wallet.session
    const math_artifact = deployment.artifact
    if (!connected) return fail(new Error('Connect the admin wallet before deployment'))
    void import('@aresrpg/sdk/deployment-admin')
      .then(
        async ({
          project_bootstrap_deployment,
          project_game_deployment,
          project_kiosk_package,
          project_math_deployment,
        }) => {
          let { revision } = deployment
          const save = async (patch: Readonly<Record<string, unknown>>) => {
            const saved = await request('PUT', { revision, patch })
            revision = String(saved.revision)
            return saved
          }
          const saved_math =
            deployment.pins?.math_package && deployment.pins.math_upgrade_cap
              ? Object.freeze({
                  package: deployment.pins.math_package,
                  upgrade_cap: deployment.pins.math_upgrade_cap,
                })
              : null
          if (!saved_math && !math_artifact) throw new Error('Compile the math package before deployment')
          let math = saved_math
          if (!math) {
            log('Publishing the math package; confirm the wallet transaction…')
            const math_result = await connected.publish_contract(math_artifact!)
            math = project_math_deployment(math_result.receipt)
            log(`Math package published · ${receipt_digest(math_result.receipt)}`, 'success')
            await save({ math_package: math.package, math_upgrade_cap: math.upgrade_cap })
          }

          let game = deployment.pins?.package ? game_from_pins(deployment.pins) : null
          if (!game) {
            log('Compiling the game against the published math and Kiosk packages…')
            const compiled = await request('POST', { action: 'compile_game', math })
            if (!compiled.artifact || typeof compiled.artifact !== 'object')
              throw new Error('The game compiler returned no package artifact')
            const game_artifact = compiled.artifact as ContractArtifact
            const kiosk_package = project_kiosk_package(game_artifact, math.package)
            log('Publishing the game package; confirm the wallet transaction…')
            const game_result = await connected.publish_contract(game_artifact)
            game = project_game_deployment({ ...game_result, kiosk_package })
            const game_package = project_math_deployment(game_result.receipt)
            log(`Game package published · ${receipt_digest(game_result.receipt)}`, 'success')
            await save({
              package: game.package,
              kiosk_package: game.kiosk_package,
              upgrade_cap: game_package.upgrade_cap,
              admin_cap: game.admin_cap,
              publisher: game.publisher,
              item_publisher: game.item_publisher,
              character_publisher: game.character_publisher,
              version: game.version,
              template_registry: game.template_registry,
              loot_registry: game.loot_registry,
              name_registry: game.name_registry,
              friend_registry: game.friend_registry,
              worlds: game.worlds,
            })
          }
          if (!connected.bootstrap_deployment)
            throw new Error('The connected admin session cannot bootstrap deployment')
          log('Creating displays and transfer policies; confirm the wallet transaction…')
          const bootstrap_receipt = await connected.bootstrap_deployment(game)
          const bootstrap = project_bootstrap_deployment(bootstrap_receipt, game.package)
          log(`Deployment bootstrap complete · ${receipt_digest(bootstrap_receipt)}`, 'success')
          const saved = await save(bootstrap)
          const { network } = deployment
          if (!network) throw new Error('The deployment network is unavailable')
          const pins = (saved.pins as Record<'testnet' | 'mainnet', DeploymentPins>)[network]
          dispatch({ type: 'admin/contracts_published', pins, revision: String(saved.revision) })
        }
      )
      .catch(fail)
  }
  const change_pause = (): void => {
    const { deployment, wallet } = get_state().admin
    const { pins } = deployment
    const paused = deployment.operation === 'pause'
    if (!wallet.session || !pins?.package || !pins.version.id || !pins.admin_cap)
      return fail(new Error('The admin wallet and deployment caps are required'))
    log(`${paused ? 'Pausing' : 'Resuming'} game operations; confirm the wallet transaction…`)
    void wallet.session
      .set_game_paused({ package_id: pins.package, version: pins.version.id, admin_cap: pins.admin_cap, paused })
      .then(({ digest }) => {
        log(`Game operations ${paused ? 'paused' : 'resumed'} · ${digest}`, 'success')
        dispatch({ type: 'admin/game_pause_changed', paused })
      })
      .catch(fail)
  }

  events.on('STATE_UPDATED', (state, previous) => {
    const { deployment } = state.admin
    const previous_deployment = previous.admin.deployment
    if (state.navigation.page === 'admin' && deployment.status === 'idle')
      return dispatch({ type: 'admin/deployment_load' })
    if (deployment.status === 'loading' && previous_deployment.status !== 'loading') return load()
    if (deployment.status === 'compiling' && previous_deployment.status !== 'compiling') return compile()
    if (deployment.status === 'publishing' && previous_deployment.status !== 'publishing') return publish()
    if (deployment.status === 'operating' && previous_deployment.status !== 'operating') return change_pause()
    if (
      deployment.status === 'ready' &&
      (previous_deployment.status !== 'ready' || state.admin.wallet.session !== previous.admin.wallet.session)
    )
      discover_pause()
  })
}
