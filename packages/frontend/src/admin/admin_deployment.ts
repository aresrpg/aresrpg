// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable max-lines -- One reducer/effect boundary owns the complete resumable package deployment lifecycle. */

import type { ContractArtifact, GameDeployment } from '@aresrpg/sdk/deployment-admin'
import { receipt_digest } from '@aresrpg/sdk/cache'
import type { SeedAdminConfig } from '@aresrpg/sdk/seed-admin'

import { env } from '../env.ts'
import { wait_for_rpc_propagation } from '../rpc_propagation.ts'
import type { AppInput, AppModule } from '../store.ts'

import type { AdminDeploymentState, AdminState, DeploymentPins } from './admin_state.ts'

const artifact_digest = (artifact: ContractArtifact): string =>
  artifact.digest.map((byte) => byte.toString(16).padStart(2, '0')).join('')

export const dependency_artifact_changed = (
  stored_digest: string | null | undefined,
  artifact: ContractArtifact
): boolean => stored_digest !== artifact_digest(artifact)

export const can_reuse_core_artifact = (
  artifact: ContractArtifact | null,
  dependency_changed: boolean
): artifact is ContractArtifact => artifact?.package_name === 'aresrpg' && !dependency_changed

const seed_config_from = (deployment: AdminDeploymentState): SeedAdminConfig =>
  Object.freeze({
    admin_cap: deployment.pins?.admin_cap ?? '',
    content_root: deployment.pins?.content_root?.id ?? '',
    upgrade_caps: Object.freeze(
      [
        [deployment.pins?.math_upgrade_cap, deployment.pins?.math_package],
        [deployment.pins?.control_upgrade_cap, deployment.pins?.control_package],
        [deployment.pins?.seed_upgrade_cap, deployment.pins?.seed_package],
        [deployment.pins?.upgrade_cap, deployment.pins?.package],
      ].flatMap(([cap, package_id]) =>
        typeof cap === 'string' && cap && typeof package_id === 'string' && package_id
          ? [Object.freeze({ cap, package: package_id })]
          : []
      )
    ),
  })

const deployment_bootstrapped = (pins: DeploymentPins | null): boolean =>
  !!pins?.package &&
  !!pins.item_policy?.id &&
  !!pins.character_policy?.id &&
  !!pins.item_protected_policy?.id &&
  !!pins.character_protected_policy?.id

/** Publishing can start from a compiled artifact or resume from receipt-derived game pins. */
export const deployment_can_publish = (deployment: AdminDeploymentState): boolean =>
  ['ready', 'failed'].includes(deployment.status) &&
  !deployment_bootstrapped(deployment.pins) &&
  (!!deployment.pins?.package || !!deployment.artifact)

/** A blank or partially published deployment owns no temporary seed session to release. */
export const republish_needs_seed_cleanup = (pins: DeploymentPins | null): boolean =>
  !!pins?.control_package && !!pins.admin_cap && !!pins.seed_package && !!pins.content_root?.id

/** Package compilation always starts at the pure leaf. Publish can then fingerprint and
 * replace changed dependencies before compiling any consumer against their published ABI. */
export const deployment_compile_target = (_pins: DeploymentPins | null): 'math' => 'math'

const game_from_pins = (pins: DeploymentPins): GameDeployment => {
  const publisher = pins.publisher ?? pins.item_publisher ?? pins.character_publisher
  if (!pins.package || !pins.kiosk_package || !publisher || !pins.version.id || !pins.version.shared_version)
    throw new Error('The saved game publication is incomplete; reload its receipt-derived pins')
  return Object.freeze({
    package: pins.package,
    kiosk_package: pins.kiosk_package,
    publisher,
    item_publisher: publisher,
    character_publisher: publisher,
    version: { id: pins.version.id, shared_version: pins.version.shared_version },
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
  if (input.type === 'admin/contracts_publish' && deployment_can_publish(admin.deployment))
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
  if (
    input.type === 'admin/contracts_upgrade' &&
    ['ready', 'failed'].includes(admin.deployment.status) &&
    deployment_bootstrapped(admin.deployment.pins) &&
    admin.deployment.paused === false
  )
    return update(Object.freeze({ ...admin.deployment, status: 'upgrading', operation: 'upgrade', error: null }))
  if (input.type === 'admin/contracts_upgraded' && admin.deployment.operation === 'upgrade')
    return update(
      Object.freeze({
        ...admin.deployment,
        status: 'ready',
        revision: input.revision,
        pins: input.pins,
        operation: null,
        paused: false,
        error: null,
      })
    )
  if (input.type === 'admin/republish_armed' && ['ready', 'failed'].includes(admin.deployment.status))
    return update(Object.freeze({ ...admin.deployment, republish_armed: input.armed }))
  if (
    input.type === 'admin/contracts_republish' &&
    ['ready', 'failed'].includes(admin.deployment.status) &&
    admin.deployment.republish_armed &&
    !!admin.deployment.pins?.package
  )
    return update(
      Object.freeze({
        ...admin.deployment,
        status: 'resetting',
        operation: 'republish',
        republish_armed: false,
        error: null,
      })
    )
  if (input.type === 'admin/contracts_republished' && admin.deployment.operation === 'republish') {
    const deployment = Object.freeze({
      ...admin.deployment,
      status: 'ready' as const,
      revision: input.revision,
      pins: input.pins,
      artifact: null,
      paused: null,
      operation: null,
      error: null,
    })
    return Object.freeze({
      ...admin,
      deployment,
      config: seed_config_from(deployment),
      snapshot: null,
      status: 'idle',
      operation: null,
      progress: null,
      cleanup: 'unknown',
      seal_armed: false,
      error: null,
    })
  }
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
    ['loading', 'compiling', 'publishing', 'upgrading', 'resetting', 'operating'].includes(admin.deployment.status)
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
    const { pins } = get_state().admin.deployment
    const target = deployment_compile_target(pins)
    const body = { action: 'compile_math' }
    log(`Compiling the ${target} package with warnings as errors…`)
    void request('POST', body)
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
    const math_artifact = deployment.artifact?.package_name === 'aresrpg_math' ? deployment.artifact : null
    if (!connected) return fail(new Error('Connect the admin wallet before deployment'))
    /* eslint-disable complexity -- The publish graph has one explicit resume branch per package boundary. */
    void import('@aresrpg/sdk/deployment-admin')
      .then(
        async ({
          project_bootstrap_deployment,
          project_control_deployment,
          project_game_deployment,
          project_kiosk_package,
          project_math_deployment,
          project_seed_deployment,
        }) => {
          let { revision } = deployment
          const save = async (patch: Readonly<Record<string, unknown>>) => {
            const saved = await request('PUT', { revision, patch })
            revision = String(saved.revision)
            return saved
          }
          let dependency_changed = false
          const saved_math =
            deployment.pins?.math_package && deployment.pins.math_upgrade_cap
              ? Object.freeze({
                  package: deployment.pins.math_package,
                  original_package: deployment.pins.math_package_original ?? deployment.pins.math_package,
                  upgrade_cap: deployment.pins.math_upgrade_cap,
                })
              : null
          if (!saved_math && !math_artifact) throw new Error('Compile the math package before deployment')
          let math = saved_math
          if (!math) {
            log('Publishing the math package; confirm the wallet transaction…')
            const math_result = await connected.publish_contract(math_artifact!)
            const published_math = project_math_deployment(math_result.receipt)
            math = Object.freeze({ ...published_math, original_package: published_math.package })
            log(`Math package published · ${receipt_digest(math_result.receipt)}`, 'success')
            await save({
              math_package: math.package,
              math_package_original: math.package,
              math_upgrade_cap: math.upgrade_cap,
              math_artifact_digest: artifact_digest(math_artifact!),
            })
          } else {
            const compiled = math_artifact
              ? { artifact: math_artifact }
              : await request('POST', { action: 'compile_math' })
            if (!compiled.artifact || typeof compiled.artifact !== 'object')
              throw new Error('The math compiler returned no package artifact')
            const artifact = compiled.artifact as ContractArtifact
            if (dependency_artifact_changed(deployment.pins?.math_artifact_digest, artifact)) {
              log('The retained math package changed; publishing a new lineage before its dependents…')
              const result = await connected.publish_contract(artifact)
              const published = project_math_deployment(result.receipt)
              math = Object.freeze({ ...published, original_package: published.package })
              dependency_changed = true
              log(`Math package republished · ${receipt_digest(result.receipt)}`, 'success')
              await wait_for_rpc_propagation()
              await save({
                math_package: math.package,
                math_package_original: math.package,
                math_upgrade_cap: math.upgrade_cap,
                math_artifact_digest: artifact_digest(artifact),
              })
            }
          }

          const saved_control =
            deployment.pins?.control_package && deployment.pins.control_upgrade_cap && deployment.pins.admin_cap
              ? Object.freeze({
                  package: deployment.pins.control_package,
                  original_package: deployment.pins.control_package_original ?? deployment.pins.control_package,
                  upgrade_cap: deployment.pins.control_upgrade_cap,
                })
              : null
          let control = saved_control
          if (!control) {
            log('Compiling the control package…')
            const control_compiled = await request('POST', { action: 'compile_control' })
            if (!control_compiled.artifact || typeof control_compiled.artifact !== 'object')
              throw new Error('The control compiler returned no package artifact')
            log('Publishing the control package; confirm the wallet transaction…')
            const control_result = await connected.publish_contract(control_compiled.artifact as ContractArtifact)
            const control_deployment = project_control_deployment(control_result.receipt)
            log(`Control package published · ${receipt_digest(control_result.receipt)}`, 'success')
            await save({
              control_package: control_deployment.package,
              control_package_original: control_deployment.package,
              control_upgrade_cap: control_deployment.upgrade_cap,
              control_artifact_digest: artifact_digest(control_compiled.artifact as ContractArtifact),
              admin_cap: control_deployment.admin_cap,
            })
            control = Object.freeze({
              package: control_deployment.package,
              original_package: control_deployment.package,
              upgrade_cap: control_deployment.upgrade_cap,
            })
          } else {
            const compiled = await request('POST', { action: 'compile_control' })
            if (!compiled.artifact || typeof compiled.artifact !== 'object')
              throw new Error('The control compiler returned no package artifact')
            const artifact = compiled.artifact as ContractArtifact
            if (dependency_artifact_changed(deployment.pins?.control_artifact_digest, artifact)) {
              log('The retained control package changed; publishing a new lineage before its dependents…')
              const result = await connected.publish_contract(artifact)
              const published = project_control_deployment(result.receipt)
              control = Object.freeze({
                package: published.package,
                original_package: published.package,
                upgrade_cap: published.upgrade_cap,
              })
              dependency_changed = true
              log(`Control package republished · ${receipt_digest(result.receipt)}`, 'success')
              await wait_for_rpc_propagation()
              await save({
                control_package: control.package,
                control_package_original: control.package,
                control_upgrade_cap: control.upgrade_cap,
                control_artifact_digest: artifact_digest(artifact),
                admin_cap: published.admin_cap,
              })
            }
          }

          const saved_seed =
            deployment.pins?.seed_package && deployment.pins.content_root?.id
              ? Object.freeze({
                  package: deployment.pins.seed_package,
                  original_package: deployment.pins.seed_package_original ?? deployment.pins.seed_package,
                  upgrade_cap: deployment.pins.seed_upgrade_cap ?? '',
                })
              : null
          let seed = saved_seed
          if (!seed) {
            log('Compiling the seed package against published math and control…')
            const seed_compiled = await request('POST', { action: 'compile_seed', math, control })
            if (!seed_compiled.artifact || typeof seed_compiled.artifact !== 'object')
              throw new Error('The seed compiler returned no package artifact')
            log('Publishing the seed package; confirm the wallet transaction…')
            const seed_result = await connected.publish_contract(seed_compiled.artifact as ContractArtifact)
            const seed_deployment = project_seed_deployment(seed_result.receipt)
            log(`Seed package published · ${receipt_digest(seed_result.receipt)}`, 'success')
            await save({
              seed_package: seed_deployment.package,
              seed_package_original: seed_deployment.package,
              seed_upgrade_cap: seed_deployment.upgrade_cap,
              seed_artifact_digest: artifact_digest(seed_compiled.artifact as ContractArtifact),
              content_root: seed_deployment.content_root,
            })
            seed = Object.freeze({
              package: seed_deployment.package,
              original_package: seed_deployment.package,
              upgrade_cap: seed_deployment.upgrade_cap,
            })
          } else {
            const compiled = await request('POST', { action: 'compile_seed', math, control })
            if (!compiled.artifact || typeof compiled.artifact !== 'object')
              throw new Error('The seed compiler returned no package artifact')
            const artifact = compiled.artifact as ContractArtifact
            if (dependency_artifact_changed(deployment.pins?.seed_artifact_digest, artifact)) {
              log('The retained seed package changed; publishing a new content lineage before core…')
              const result = await connected.publish_contract(artifact)
              const published = project_seed_deployment(result.receipt)
              seed = Object.freeze({
                package: published.package,
                original_package: published.package,
                upgrade_cap: published.upgrade_cap,
              })
              dependency_changed = true
              log(`Seed package republished · ${receipt_digest(result.receipt)}`, 'success')
              await wait_for_rpc_propagation()
              await save({
                seed_package: seed.package,
                seed_package_original: seed.package,
                seed_upgrade_cap: seed.upgrade_cap,
                seed_artifact_digest: artifact_digest(artifact),
                content_root: published.content_root,
              })
            }
          }

          let game = deployment.pins?.package ? game_from_pins(deployment.pins) : null
          if (!game) {
            log('Compiling the game against published math, control, seed, and Kiosk packages…')
            const compiled = can_reuse_core_artifact(deployment.artifact, dependency_changed)
              ? { artifact: deployment.artifact }
              : await request('POST', { action: 'compile_game', math, control, seed })
            if (!compiled.artifact || typeof compiled.artifact !== 'object')
              throw new Error('The game compiler returned no package artifact')
            const game_artifact = compiled.artifact as ContractArtifact
            const kiosk_package = project_kiosk_package(game_artifact, [math.package, control.package, seed.package])
            log('Publishing the game package; confirm the wallet transaction…')
            const game_result = await connected.publish_contract(game_artifact)
            game = project_game_deployment({ ...game_result, kiosk_package })
            const game_package = project_math_deployment(game_result.receipt)
            log(`Game package published · ${receipt_digest(game_result.receipt)}`, 'success')
            await wait_for_rpc_propagation()
            await save({
              package: game.package,
              package_original: game.package,
              kiosk_package: game.kiosk_package,
              upgrade_cap: game_package.upgrade_cap,
              package_artifact_digest: artifact_digest(game_artifact),
              publisher: game.publisher,
              item_publisher: game.item_publisher,
              character_publisher: game.character_publisher,
              version: game.version,
              loot_registry: game.loot_registry,
              name_registry: game.name_registry,
              friend_registry: game.friend_registry,
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
          log('Reload the app before making player transactions against this deployment.')
          dispatch({ type: 'admin/contracts_published', pins, revision: String(saved.revision) })
        }
      )
      .catch(fail)
    /* eslint-enable complexity */
  }
  const upgrade = (): void => {
    const { deployment, wallet } = get_state().admin
    const connected = wallet.session
    const { pins } = deployment
    if (
      !connected ||
      !pins?.package ||
      !pins.math_package ||
      !pins.upgrade_cap ||
      !pins.math_upgrade_cap ||
      !pins.control_package ||
      !pins.control_upgrade_cap ||
      !pins.seed_package ||
      !pins.seed_upgrade_cap ||
      !pins.version.id ||
      !pins.admin_cap
    )
      return fail(new Error('A complete deployment and connected admin wallet are required'))
    const { math_upgrade_cap, control_upgrade_cap, seed_upgrade_cap, upgrade_cap: game_upgrade_cap, admin_cap } = pins
    const { id: version } = pins.version
    const math_original = pins.math_package_original ?? pins.math_package
    const control_original = pins.control_package_original ?? pins.control_package
    const seed_original = pins.seed_package_original ?? pins.seed_package
    const game_original = pins.package_original ?? pins.package
    void import('@aresrpg/sdk/deployment-admin')
      .then(async ({ project_package_id }) => {
        let { revision } = deployment
        const save = async (patch: Readonly<Record<string, unknown>>) => {
          const saved = await request('PUT', { revision, patch })
          revision = String(saved.revision)
          return saved
        }
        const current_version = await connected.read_game_version(version)
        if (current_version === 0) throw new Error('Resume the game before upgrading it')
        const [math_cap, control_cap, seed_cap, game_cap] = await Promise.all([
          connected.read_package_upgrade(math_upgrade_cap),
          connected.read_package_upgrade(control_upgrade_cap),
          connected.read_package_upgrade(seed_upgrade_cap),
          connected.read_package_upgrade(game_upgrade_cap),
        ])
        let math_package = math_cap.package
        let control_package = control_cap.package
        let seed_package = seed_cap.package
        let package_id = game_cap.package
        let saved = await save({
          math_package,
          math_package_original: math_original,
          control_package,
          control_package_original: control_original,
          seed_package,
          seed_package_original: seed_original,
          package: package_id,
          package_original: game_original,
        })

        const compiled_artifact = async (body: Readonly<Record<string, unknown>>, label: string) => {
          const result = await request('POST', body)
          if (!result.artifact || typeof result.artifact !== 'object')
            throw new Error(`The compiler returned no ${label} artifact`)
          return result.artifact as ContractArtifact
        }

        const math_artifact = await compiled_artifact(
          {
            action: 'compile_math_upgrade',
            math: { package: math_package, original_package: math_original, upgrade_cap: math_upgrade_cap },
          },
          'math upgrade'
        )
        if (artifact_digest(math_artifact) !== pins.math_artifact_digest) {
          log('Upgrading the math package; confirm the wallet transaction…')
          const math_result = await connected.upgrade_contract({
            artifact: math_artifact,
            upgrade_cap: math_upgrade_cap,
          })
          math_package = project_package_id(math_result.receipt)
          log(`Math package upgraded · ${receipt_digest(math_result.receipt)}`, 'success')
          log('Waiting for the math package to propagate across RPC nodes…')
          await wait_for_rpc_propagation()
          saved = await save({
            math_package,
            math_package_original: math_original,
            math_artifact_digest: artifact_digest(math_artifact),
          })
        } else log('Math package is unchanged.', 'success')

        const control_artifact = await compiled_artifact(
          {
            action: 'compile_control_upgrade',
            control: {
              package: control_package,
              original_package: control_original,
              upgrade_cap: control_upgrade_cap,
            },
          },
          'control upgrade'
        )
        if (artifact_digest(control_artifact) !== pins.control_artifact_digest) {
          log('Upgrading the control package; confirm the wallet transaction…')
          const result = await connected.upgrade_contract({
            artifact: control_artifact,
            upgrade_cap: control_upgrade_cap,
          })
          control_package = project_package_id(result.receipt)
          log(`Control package upgraded · ${receipt_digest(result.receipt)}`, 'success')
          await wait_for_rpc_propagation()
          saved = await save({
            control_package,
            control_package_original: control_original,
            control_artifact_digest: artifact_digest(control_artifact),
          })
        } else log('Control package is unchanged.', 'success')

        const math_publication = {
          package: math_package,
          original_package: math_original,
          upgrade_cap: math_upgrade_cap,
        }
        const control_publication = {
          package: control_package,
          original_package: control_original,
          upgrade_cap: control_upgrade_cap,
        }
        const seed_publication = {
          package: seed_package,
          original_package: seed_original,
          upgrade_cap: seed_upgrade_cap,
        }
        const seed_artifact = await compiled_artifact(
          {
            action: 'compile_seed_upgrade',
            math: math_publication,
            control: control_publication,
            seed: seed_publication,
          },
          'seed upgrade'
        )
        if (artifact_digest(seed_artifact) !== pins.seed_artifact_digest) {
          log('Upgrading the seed package; confirm the wallet transaction…')
          const result = await connected.upgrade_contract({ artifact: seed_artifact, upgrade_cap: seed_upgrade_cap })
          seed_package = project_package_id(result.receipt)
          log(`Seed package upgraded · ${receipt_digest(result.receipt)}`, 'success')
          await wait_for_rpc_propagation()
          saved = await save({
            seed_package,
            seed_package_original: seed_original,
            seed_artifact_digest: artifact_digest(seed_artifact),
          })
        } else log('Seed package is unchanged.', 'success')

        const desired_seed = { ...seed_publication, package: seed_package }
        const game_publication = { package: package_id, original_package: game_original, upgrade_cap: game_upgrade_cap }
        const game_probe = await compiled_artifact(
          {
            action: 'compile_game_probe',
            math: math_publication,
            control: control_publication,
            seed: desired_seed,
            game: game_publication,
          },
          'game probe'
        )
        const upgrade_game = artifact_digest(game_probe) !== pins.package_artifact_digest
        if (upgrade_game) {
          log('Compiling the changed game package…')
          const game_artifact = await compiled_artifact(
            {
              action: 'compile_game_upgrade',
              current_version,
              math: math_publication,
              control: control_publication,
              seed: desired_seed,
              game: game_publication,
            },
            'game upgrade'
          )
          log('Upgrading the game package; confirm the wallet transaction…')
          const game_result = await connected.upgrade_contract({
            artifact: game_artifact,
            upgrade_cap: game_upgrade_cap,
          })
          package_id = project_package_id(game_result.receipt)
          log(`Game package upgraded · ${receipt_digest(game_result.receipt)}`, 'success')
          saved = await save({
            package: package_id,
            package_original: game_original,
            package_artifact_digest: artifact_digest(game_artifact),
          })
          await wait_for_rpc_propagation()
          log('Activating the new game version; confirm the wallet transaction…')
          const activation = await connected.set_game_paused({ package_id, version, admin_cap, paused: false })
          log(`Game version activated · ${activation.digest}`, 'success')
        } else log('Game package is unchanged.', 'success')
        const { network } = deployment
        if (!network) throw new Error('The deployment network is unavailable')
        const saved_pins = (saved.pins as Record<'testnet' | 'mainnet', DeploymentPins>)[network]
        log('Reload the app before making player transactions against this deployment.')
        dispatch({ type: 'admin/contracts_upgraded', pins: saved_pins, revision: String(saved.revision) })
      })
      .catch(fail)
  }
  const republish = (): void => {
    const { deployment, wallet, config } = get_state().admin
    const connected = wallet.session
    if (!connected || !deployment.pins) return fail(new Error('Connect the admin wallet before republishing'))
    const close_seed_session = async (): Promise<void> => {
      if (!republish_needs_seed_cleanup(deployment.pins)) return
      log('Closing any temporary seed session before abandoning this core deployment…')
      const { seed_content } = await import('./seed_content.ts')
      const session = await connected.create_seed_admin(seed_content, config, deployment.pins ?? undefined)
      await session.release?.()
      log('Temporary seed session closed.', 'success')
    }
    void close_seed_session()
      .then(async () => {
        const saved = await request('POST', { action: 'reset', revision: deployment.revision })
        const { network } = deployment
        if (!network) throw new Error('The deployment network is unavailable')
        const pins = (saved.pins as Record<'testnet' | 'mainnet', DeploymentPins>)[network]
        log('Core deployment pins cleared; unchanged math, control, and seed publications were retained.', 'success')
        log('Recreate the local FalkorDB/indexer before indexing the replacement package.')
        dispatch({ type: 'admin/contracts_republished', pins, revision: String(saved.revision) })
      })
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
    if (deployment.status === 'upgrading' && previous_deployment.status !== 'upgrading') return upgrade()
    if (deployment.status === 'resetting' && previous_deployment.status !== 'resetting') return republish()
    if (deployment.status === 'operating' && previous_deployment.status !== 'operating') return change_pause()
    if (
      deployment.status === 'ready' &&
      (previous_deployment.status !== 'ready' || state.admin.wallet.session !== previous.admin.wallet.session)
    )
      discover_pause()
  })
}
