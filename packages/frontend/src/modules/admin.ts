// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { next_seed_batch, type SeedAdminSession, type SeedLedger, type SeedSyncView } from '@aresrpg/sdk/seed-admin'

import { env } from '../env.ts'
import {
  initial_admin_state,
  type AdminInput,
  type AdminOverviewState,
  type AdminState,
  type AdminView,
} from '../admin/admin_state.ts'
import { observe_admin_wallet, reduce_admin_wallet } from '../admin/admin_wallet.ts'
import { observe_admin_deployment, reduce_admin_deployment } from '../admin/admin_deployment.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export { initial_admin_state }
export type { AdminInput, AdminState, AdminView }

const with_admin = (state: AppState, admin: AdminState): AppState => Object.freeze({ ...state, admin })

const can_execute = (admin: AdminState, batch: string): boolean =>
  admin.status === 'ready' && next_seed_batch(admin.snapshot)?.id === batch

const can_seal = (admin: AdminState): boolean =>
  admin.status === 'ready' &&
  admin.seal_armed &&
  admin.changes !== null &&
  admin.changes.new_count === 0 &&
  admin.changes.changed.length === 0 &&
  admin.changes.board_removals.length === 0 &&
  admin.changes.fixed.length === 0 &&
  admin.changes.errors.length === 0 &&
  admin.snapshot?.batches.every(({ state }) => state === 'complete') === true

const reduce_overview = (admin: AdminState, input: AppInput): AdminState | null => {
  const update = (overview: AdminOverviewState): AdminState => Object.freeze({ ...admin, overview })
  if (input.type === 'admin/overview_refresh' && admin.overview.status !== 'loading')
    return update(Object.freeze({ ...admin.overview, status: 'loading', request_id: null, error: null }))
  if (input.type === 'admin/overview_requested' && admin.overview.status === 'loading')
    return update(Object.freeze({ ...admin.overview, request_id: input.request_id }))
  if (
    input.type === 'server/packet' &&
    input.packet.type === 'packet/admin_response' &&
    input.packet.id === admin.overview.request_id
  ) {
    const { result } = input.packet
    const counts =
      result !== null && typeof result === 'object' && !Array.isArray(result)
        ? Object.freeze(
            Object.fromEntries(
              Object.entries(result).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
            )
          )
        : Object.freeze({})
    return update(Object.freeze({ status: 'ready', request_id: null, counts, error: null }))
  }
  const error =
    input.type === 'admin/overview_failed' && admin.overview.status === 'loading'
      ? input.error
      : input.type === 'server/packet' &&
          input.packet.type === 'packet/error' &&
          input.packet.id === admin.overview.request_id
        ? input.packet.reason
        : null
  return error
    ? update(Object.freeze({ status: 'failed', request_id: null, counts: admin.overview.counts, error }))
    : null
}

// eslint-disable-next-line complexity -- This root reducer only routes discriminated inputs to small domain reducers.
const reduce = (state: AppState, input: AppInput): AppState => {
  const { admin } = state
  if (input.type === 'admin/log') {
    const entry = Object.freeze({
      id: (admin.log.at(-1)?.id ?? 0) + 1,
      tone: input.tone ?? ('info' as const),
      message: input.message,
    })
    return with_admin(state, Object.freeze({ ...admin, log: Object.freeze([...admin.log, entry].slice(-100)) }))
  }
  if (input.type === 'admin/progress') return with_admin(state, Object.freeze({ ...admin, progress: input.progress }))
  if (input.type === 'admin/view_changed') return with_admin(state, Object.freeze({ ...admin, view: input.view }))
  const overview = reduce_overview(admin, input)
  if (overview) return with_admin(state, overview)
  const deployment = reduce_admin_deployment(admin, input)
  if (deployment) return with_admin(state, deployment)
  const wallet = reduce_admin_wallet(admin, input)
  if (wallet) return with_admin(state, wallet)
  if (input.type === 'admin/refresh' && admin.status !== 'loading' && admin.status !== 'executing')
    return with_admin(
      state,
      Object.freeze({ ...admin, status: 'loading', operation: null, progress: null, error: null })
    )
  if (input.type === 'admin/refreshed' && admin.status === 'loading') {
    const complete = input.snapshot.batches.every(({ state: batch_state }) => batch_state === 'complete')
    return with_admin(
      state,
      Object.freeze({
        ...admin,
        snapshot: input.snapshot,
        status: 'ready',
        progress: null,
        cleanup: complete && admin.cleanup !== 'closed' ? 'needed' : admin.cleanup,
        error: null,
      })
    )
  }
  if (input.type === 'admin/execute' && can_execute(admin, input.batch))
    return with_admin(
      state,
      Object.freeze({
        ...admin,
        status: 'executing',
        operation: Object.freeze({ type: 'batch', batch: input.batch }),
        cleanup: 'needed',
      })
    )
  if (
    input.type === 'admin/publish_all' &&
    admin.status === 'ready' &&
    next_seed_batch(admin.snapshot)?.state === 'ready'
  )
    return with_admin(
      state,
      Object.freeze({
        ...admin,
        status: 'executing',
        operation: Object.freeze({ type: 'all' }),
        cleanup: 'needed',
      })
    )
  if (input.type === 'admin/batch_succeeded' && admin.operation?.type === 'batch')
    return admin.operation.batch === input.batch
      ? with_admin(
          state,
          Object.freeze({
            ...admin,
            snapshot: input.snapshot,
            status: 'ready',
            operation: null,
            progress: null,
            error: null,
          })
        )
      : state
  if (input.type === 'admin/publish_all_succeeded' && admin.operation?.type === 'all')
    return with_admin(
      state,
      Object.freeze({
        ...admin,
        snapshot: input.snapshot,
        status: 'ready',
        operation: null,
        progress: null,
        cleanup: 'closed',
        error: null,
      })
    )
  if (input.type === 'admin/release' && admin.cleanup === 'needed' && admin.status !== 'executing')
    return with_admin(
      state,
      Object.freeze({
        ...admin,
        status: 'executing',
        operation: Object.freeze({ type: 'release' }),
        progress: Object.freeze({ phase: 'cleanup', current: 0, total: 1, label: null }),
        error: null,
      })
    )
  if (input.type === 'admin/released' && admin.operation?.type === 'release')
    return with_admin(
      state,
      Object.freeze({
        ...admin,
        status: 'ready',
        operation: null,
        progress: null,
        cleanup: 'closed',
        error: null,
      })
    )
  if (input.type === 'admin/changes_checked')
    return with_admin(state, Object.freeze({ ...admin, changes: input.changes }))
  if (input.type === 'admin/frozen_discovered')
    return with_admin(state, Object.freeze({ ...admin, frozen: input.frozen }))
  if (
    input.type === 'admin/apply_changes' &&
    admin.status === 'ready' &&
    ((admin.changes?.changed.length ?? 0) > 0 || (admin.changes?.board_removals.length ?? 0) > 0) &&
    !admin.changes?.errors.length
  )
    return with_admin(
      state,
      Object.freeze({
        ...admin,
        status: 'executing',
        operation: Object.freeze({ type: 'changes' }),
        cleanup: 'needed',
      })
    )
  if (input.type === 'admin/changes_applied' && admin.operation?.type === 'changes')
    return with_admin(
      state,
      Object.freeze({ ...admin, changes: input.changes, status: 'ready', operation: null, error: null })
    )
  if (input.type === 'admin/seal_armed' && admin.status === 'ready')
    return with_admin(state, Object.freeze({ ...admin, seal_armed: input.armed }))
  if (input.type === 'admin/seal' && can_seal(admin))
    return with_admin(
      state,
      Object.freeze({ ...admin, status: 'executing', operation: Object.freeze({ type: 'seal' }), seal_armed: false })
    )
  if (input.type === 'admin/sealed' && admin.operation?.type === 'seal')
    return with_admin(
      state,
      Object.freeze({ ...admin, snapshot: input.snapshot, frozen: true, status: 'ready', operation: null, error: null })
    )
  if (input.type === 'admin/failed' && (admin.status === 'loading' || admin.status === 'executing'))
    return with_admin(
      state,
      Object.freeze({ ...admin, status: 'failed', operation: null, progress: null, error: input.error })
    )
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return with_admin(state, initial_admin_state())
  return state
}

const observe = ({ events, dispatch, signal, get_state }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  let seed_session: SeedAdminSession | null = null
  let generation = 0
  const log = (message: string, tone: 'info' | 'success' | 'error' = 'info'): void =>
    dispatch({ type: 'admin/log', message, tone })
  const invalidate_seed_session = (): void => {
    seed_session = null
    generation += 1
  }
  const changes_summary = (view: SeedSyncView): NonNullable<AdminState['changes']> =>
    Object.freeze({
      new_count: view.new_rows.length,
      changed: Object.freeze(view.changed.map(({ label }) => label)),
      board_removals: Object.freeze(view.board_removals.map(({ label }) => label)),
      removed: Object.freeze(view.removed.map(({ label }) => label)),
      fixed: Object.freeze(view.fixed.map(({ label }) => label)),
      unchanged: view.unchanged,
      errors: view.errors,
    })
  const get_ledger = async (): Promise<SeedLedger> => {
    const { content_root } = get_state().admin.config
    const response = await fetch(
      `/__admin/seed-ledger?network=${env.network}&content_root=${encodeURIComponent(content_root)}`,
      { cache: 'no-store' }
    )
    if (!response.ok) throw new Error(`The content record returned ${response.status}`)
    const body = (await response.json()) as Readonly<{ ledger?: SeedLedger }>
    return body.ledger ?? {}
  }
  const put_ledger = async (ledger: SeedLedger, addresses: Readonly<Record<string, string>>): Promise<void> => {
    const { token } = get_state().admin.deployment
    const { content_root } = get_state().admin.config
    const response = await fetch('/__admin/seed-ledger', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-aresrpg-admin-token': token },
      body: JSON.stringify({ network: env.network, content_root, ledger, addresses }),
    })
    if (!response.ok) throw new Error(`The content record refused the update (${response.status})`)
  }

  observe_admin_wallet({ events, dispatch, signal, get_state }, invalidate_seed_session)
  observe_admin_deployment({ events, dispatch, signal, get_state })
  events.on('auth/disconnected', invalidate_seed_session)
  events.on('auth/rejected', invalidate_seed_session)
  events.on('STATE_UPDATED', (state, previous) => {
    if (
      state.navigation.page === 'admin' &&
      state.admin.view === 'overview' &&
      state.admin.overview.status === 'idle'
    ) {
      dispatch({ type: 'admin/overview_refresh' })
      return
    }
    if (state.admin.config !== previous.admin.config) {
      seed_session = null
      generation += 1
    }
    if (state.admin.status === 'loading' && previous.admin.status !== 'loading') {
      const connected = state.admin.wallet.session
      const request = ++generation
      if (!connected) return dispatch({ type: 'admin/failed', error: 'Connect the admin wallet before publishing' })
      log('Checking deterministic seed addresses against chain state…')
      void import('../admin/seed_content.ts')
        .then(({ seed_content }) =>
          connected.create_seed_admin(seed_content, state.admin.config, state.admin.deployment.pins ?? undefined)
        )
        .then(async (created) => {
          const snapshot = await created.refresh((progress) => {
            if (!signal.aborted && request === generation)
              dispatch({
                type: 'admin/progress',
                progress: {
                  phase: 'inspection',
                  current: progress.inspected,
                  total: progress.total,
                  label: progress.batch,
                },
              })
          })
          if (signal.aborted || request !== generation) return
          seed_session = created
          const complete = snapshot.batches.filter(({ state: batch_state }) => batch_state === 'complete').length
          const next = next_seed_batch(snapshot)
          log(
            `Seed status checked · ${complete}/${snapshot.batches.length} batches complete${next ? ` · next ${next.id}` : ''}`,
            'success'
          )
          dispatch({ type: 'admin/refreshed', snapshot })
          const view = await created.check_changes(await get_ledger())
          if (signal.aborted || request !== generation) return
          const summary = changes_summary(view)
          log(
            `Files vs chain · ${summary.new_count} new · ${summary.changed.length} changed · ${summary.board_removals.length} boards removed · ` +
              `${summary.removed.length} removed from files · ${summary.unchanged} up to date`,
            'success'
          )
          dispatch({ type: 'admin/changes_checked', changes: summary })
          const frozen = await created.read_frozen()
          if (signal.aborted || request !== generation) return
          dispatch({ type: 'admin/frozen_discovered', frozen })
          if (frozen) log('The game content is permanently frozen on chain.', 'info')
        })
        .catch((error) => {
          if (signal.aborted || request !== generation) return
          console.error('Seed plan inspection failed.', error)
          const message = error instanceof Error ? error.message : String(error)
          log(message, 'error')
          dispatch({ type: 'admin/failed', error: message })
        })
      return
    }
    if (state.admin.status !== 'executing' || previous.admin.status === 'executing') return
    const active = seed_session
    const { operation } = state.admin
    if (!active || !operation)
      return dispatch({ type: 'admin/failed', error: 'Refresh the seed plan before executing' })
    const request = generation
    const failed = (error: unknown): void => {
      if (signal.aborted || request !== generation) return
      console.error('Seed transaction failed.', error)
      const message = error instanceof Error ? error.message : String(error)
      log(message, 'error')
      dispatch({ type: 'admin/failed', error: message })
    }
    if (operation.type === 'batch') {
      log(`Publishing seed batch ${operation.batch}…`)
      void active
        .execute(operation.batch)
        .then(async (result) => {
          if (signal.aborted || request !== generation) return
          log(`Seed batch ${result.batch} published · ${result.digest}`, 'success')
          await put_ledger(await active.created_ledger(await get_ledger()), await active.address_book())
          dispatch({ type: 'admin/batch_succeeded', batch: result.batch, snapshot: result.snapshot })
        })
        .catch(failed)
    } else if (operation.type === 'all') {
      void (async () => {
        let snapshot = await active.refresh((progress) => {
          if (!signal.aborted && request === generation)
            dispatch({
              type: 'admin/progress',
              progress: {
                phase: 'inspection',
                current: progress.inspected,
                total: progress.total,
                label: progress.batch,
              },
            })
        })
        while (true) {
          const next = next_seed_batch(snapshot)
          if (!next) break
          if (next.state !== 'ready') throw new Error(`Seed batch ${next.id} is blocked`)
          const complete = snapshot.batches.filter(({ state: batch_state }) => batch_state === 'complete').length
          dispatch({
            type: 'admin/progress',
            progress: {
              phase: 'publishing',
              current: complete,
              total: snapshot.batches.length,
              label: next.id,
            },
          })
          log(`Publishing seed batch ${next.id}…`)
          const result = await active.execute(next.id)
          const { snapshot: updated_snapshot } = result
          snapshot = updated_snapshot
          log(`Seed batch ${result.batch} published · ${result.digest}`, 'success')
          // Every successful creation transaction durably records its addresses before the
          // next wallet operation. A later crash can resume from pins.json alone.
          await put_ledger(await active.created_ledger(await get_ledger()), await active.address_book())
        }
        // creates done — now write every changed row so one click fully matches the files
        // (the board list also lands here: a fresh catalog is born empty)
        const applied = await active.apply_changes(await get_ledger())
        await put_ledger(applied.ledger, await active.address_book())
        for (const digest of applied.digests) log(`Changes written · ${digest}`, 'success')
        dispatch({ type: 'admin/changes_checked', changes: changes_summary(applied.view) })
        dispatch({
          type: 'admin/progress',
          progress: { phase: 'cleanup', current: 0, total: 1, label: null },
        })
        log('Returning unused temporary seed-session gas…')
        await active.release?.()
        log('All content is published, up to date with the files, and the temporary session is closed.', 'success')
        dispatch({ type: 'admin/publish_all_succeeded', snapshot })
      })().catch(failed)
    } else if (operation.type === 'changes') {
      void (async () => {
        const ledger = await get_ledger()
        const { changes } = get_state().admin
        const count = (changes?.changed.length ?? 0) + (changes?.board_removals.length ?? 0)
        log(`Rewriting ${count} changed row${count === 1 ? '' : 's'} on chain…`)
        const result = await active.apply_changes(ledger)
        await put_ledger(result.ledger, await active.address_book())
        for (const digest of result.digests) log(`Changes written · ${digest}`, 'success')
        if (signal.aborted || request !== generation) return
        log('Every changed row now matches its file.', 'success')
        dispatch({ type: 'admin/changes_applied', changes: changes_summary(result.view) })
      })().catch(failed)
    } else if (operation.type === 'release') {
      if (!active.release) return failed(new Error('This admin session cannot clean up its temporary signer'))
      log('Closing the temporary seed session and returning its remaining SUI…')
      void active.release().then(() => {
        if (signal.aborted || request !== generation) return
        log('Temporary seed session closed.', 'success')
        dispatch({ type: 'admin/released' })
      }, failed)
    } else {
      log('Freezing ALL game content forever; confirm the wallet transaction…')
      // a wallet popup dismissed by CLOSING it never settles its promise — every later
      // transaction then queues silently behind it. Surface the stall instead of hiding it.
      const stall_timer = setTimeout(() => {
        if (!signal.aborted && request === generation)
          log(
            'Still waiting on the wallet after 30s — open the wallet extension: a pending ' +
              'request may be stuck there (approve or reject it), or reload this page to retry.',
            'error'
          )
      }, 30_000)
      void active
        .freeze_forever()
        .then(({ digest, snapshot }) => {
          if (!signal.aborted && request === generation) {
            log(`Game content frozen forever · ${digest}`, 'success')
            dispatch({ type: 'admin/sealed', snapshot })
          }
        })
        .catch(failed)
        .finally(() => clearTimeout(stall_timer))
    }
  })
}

export default Object.freeze({ name: 'admin', reduce, observe }) satisfies AppModule
