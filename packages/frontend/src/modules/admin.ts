// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { next_seed_batch, type SeedAdminSession } from '@aresrpg/sdk/seed-admin'

import {
  initial_admin_state,
  type AdminInput,
  type AdminOverviewState,
  type AdminState,
  type AdminView,
  type SeedEditorState,
  type SeedEditorStatus,
} from '../admin/admin_state.ts'
import { observe_admin_wallet, reduce_admin_wallet } from '../admin/admin_wallet.ts'
import { observe_admin_deployment, reduce_admin_deployment } from '../admin/admin_deployment.ts'
import {
  admin_content_domains,
  is_seed_file,
  replace_json_value,
  type JsonValue,
  type SeedDomain,
} from '../admin/seed_editor.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export { initial_admin_state }
export type { AdminInput, AdminState, AdminView, SeedEditorStatus }

const with_admin = (state: AppState, admin: AdminState): AppState => Object.freeze({ ...state, admin })

const can_execute = (admin: AdminState, batch: string): boolean =>
  admin.status === 'ready' && !admin.snapshot?.sealed && next_seed_batch(admin.snapshot)?.id === batch

const can_seal = (admin: AdminState): boolean =>
  admin.status === 'ready' &&
  admin.seal_armed &&
  !admin.snapshot?.sealed &&
  admin.snapshot?.batches.every(({ state }) => state === 'complete') === true

const reduce_editor = (admin: AdminState, input: AppInput): AdminState | null => {
  const update = (editor: SeedEditorState): AdminState => Object.freeze({ ...admin, editor })
  if (input.type === 'admin/editor_load' && admin.editor.status === 'idle')
    return update(Object.freeze({ ...admin.editor, status: 'loading', error: null }))
  if (input.type === 'admin/editor_loaded' && admin.editor.status === 'loading') {
    const domains_by_file = new Map(admin_content_domains.map(({ id, file }) => [file, id] as const))
    const files = Object.freeze(
      Object.fromEntries(
        input.files.flatMap((loaded) => {
          const domain = domains_by_file.get(loaded.file)
          return domain
            ? [[domain, Object.freeze({ ...loaded, saved_value: loaded.value, dirty: false, validation: null })]]
            : []
        })
      )
    )
    return update(
      Object.freeze({
        ...admin.editor,
        status: 'ready',
        token: input.token,
        files,
        validation: input.validation,
        error: null,
      })
    )
  }
  if (input.type === 'admin/editor_unavailable' && admin.editor.status === 'loading')
    return update(Object.freeze({ ...admin.editor, status: 'unavailable', error: null }))
  if (input.type === 'admin/editor_domain_selected')
    return update(Object.freeze({ ...admin.editor, domain: input.domain, entity_id: null, query: '' }))
  if (input.type === 'admin/editor_entity_selected')
    return update(Object.freeze({ ...admin.editor, entity_id: input.entity_id }))
  if (input.type === 'admin/editor_query_changed') return update(Object.freeze({ ...admin.editor, query: input.query }))
  if (input.type === 'admin/editor_value_changed') {
    const file = admin.editor.files[input.domain]
    if (!file || admin.editor.status !== 'ready') return null
    const value = replace_json_value(file.value, input.path, input.value)
    return update(
      Object.freeze({
        ...admin.editor,
        files: Object.freeze({
          ...admin.editor.files,
          [input.domain]: Object.freeze({ ...file, value, dirty: true, validation: null }),
        }),
      })
    )
  }
  if (input.type === 'admin/editor_reset') {
    const file = admin.editor.files[input.domain]
    if (!file || admin.editor.status !== 'ready') return null
    return update(
      Object.freeze({
        ...admin.editor,
        files: Object.freeze({
          ...admin.editor.files,
          [input.domain]: Object.freeze({ ...file, value: file.saved_value, dirty: false, validation: null }),
        }),
      })
    )
  }
  if (input.type === 'admin/editor_save') {
    const file = admin.editor.files[input.domain]
    return file?.dirty && admin.editor.status === 'ready'
      ? update(Object.freeze({ ...admin.editor, status: 'saving', saving_domain: input.domain, error: null }))
      : null
  }
  if (input.type === 'admin/editor_saved' && admin.editor.saving_domain === input.domain) {
    const file = admin.editor.files[input.domain]
    if (!file) return null
    const saved = Object.freeze({
      ...file,
      revision: input.revision,
      value: input.value,
      saved_value: input.value,
      dirty: false,
      validation: input.validation,
    })
    return update(
      Object.freeze({
        ...admin.editor,
        status: 'ready',
        saving_domain: null,
        validation: input.validation,
        files: Object.freeze({ ...admin.editor.files, [input.domain]: saved }),
        error: null,
      })
    )
  }
  if (input.type === 'admin/editor_failed' && ['loading', 'saving'].includes(admin.editor.status))
    return update(
      Object.freeze({
        ...admin.editor,
        status: admin.editor.status === 'saving' ? 'ready' : 'failed',
        saving_domain: null,
        error: input.error,
      })
    )
  return null
}

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
  const editor = reduce_editor(admin, input)
  if (editor) return with_admin(state, editor)
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
      Object.freeze({ ...admin, snapshot: input.snapshot, status: 'ready', operation: null, error: null })
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
  let editor_generation = 0
  const log = (message: string, tone: 'info' | 'success' | 'error' = 'info'): void =>
    dispatch({ type: 'admin/log', message, tone })
  const invalidate_seed_session = (): void => {
    seed_session = null
    generation += 1
  }
  const clear = (): void => {
    invalidate_seed_session()
    editor_generation += 1
  }
  observe_admin_wallet({ events, dispatch, signal, get_state }, invalidate_seed_session)
  observe_admin_deployment({ events, dispatch, signal, get_state })
  events.on('auth/disconnected', clear)
  events.on('auth/rejected', clear)
  const load_editor = (): void => {
    if (!import.meta.env.DEV) return dispatch({ type: 'admin/editor_unavailable' })
    const request = ++editor_generation
    void fetch('/__seed/files', { cache: 'no-store' })
      .then(async (response) => {
        if (signal.aborted || request !== editor_generation) return
        if (response.status === 404) return dispatch({ type: 'admin/editor_unavailable' })
        const body = (await response.json()) as Readonly<{
          files?: readonly Readonly<{ file: string; revision: string; value: JsonValue }>[]
          token?: string
          validation?: Readonly<{ reds: readonly string[]; warns: readonly string[] }>
          error?: string
        }>
        if (!response.ok || !body.files || !body.token || !body.validation)
          throw new Error(body.error || `Seed files returned ${response.status}`)
        dispatch({
          type: 'admin/editor_loaded',
          files: body.files.filter(is_seed_file),
          token: body.token,
          validation: body.validation,
        })
      })
      .catch((error) => {
        if (signal.aborted || request !== editor_generation) return
        console.error('Seed files could not be loaded.', error)
        dispatch({ type: 'admin/editor_failed', error: error instanceof Error ? error.message : String(error) })
      })
  }
  const save_editor = (domain: SeedDomain): void => {
    const { editor } = get_state().admin
    const file = editor.files[domain]
    if (!file || editor.saving_domain !== domain) return
    const request = ++editor_generation
    void fetch(`/__seed/files/${encodeURIComponent(file.file)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-aresrpg-seed-token': editor.token },
      body: JSON.stringify({ revision: file.revision, value: file.value }),
    })
      .then(async (response) => {
        if (signal.aborted || request !== editor_generation) return
        const body = (await response.json()) as Readonly<{
          revision?: string
          value?: JsonValue
          validation?: Readonly<{ reds: readonly string[]; warns: readonly string[] }>
          error?: string
        }>
        if (!response.ok || !body.revision || body.value === undefined || !body.validation)
          throw new Error(body.error || `Seed save returned ${response.status}`)
        dispatch({
          type: 'admin/editor_saved',
          domain,
          revision: body.revision,
          value: body.value,
          validation: body.validation,
        })
      })
      .catch((error) => {
        if (signal.aborted || request !== editor_generation) return
        console.error('Seed file could not be saved.', error)
        dispatch({ type: 'admin/editor_failed', error: error instanceof Error ? error.message : String(error) })
      })
  }
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.navigation.page === 'admin' && state.admin.editor.status === 'idle') {
      dispatch({ type: 'admin/editor_load' })
      return
    }
    if (state.admin.editor.status === 'loading' && previous.admin.editor.status !== 'loading') {
      load_editor()
      return
    }
    if (state.admin.editor.status === 'saving' && previous.admin.editor.status !== 'saving') {
      const domain = state.admin.editor.saving_domain
      if (domain) save_editor(domain)
      return
    }
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
            snapshot.sealed
              ? 'Seed authority is permanently sealed.'
              : `Seed status checked · ${complete}/${snapshot.batches.length} batches complete${next ? ` · next ${next.id}` : ''}`,
            'success'
          )
          dispatch({ type: 'admin/refreshed', snapshot })
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
        .then((result) => {
          if (signal.aborted || request !== generation) return
          log(`Seed batch ${result.batch} published · ${result.digest}`, 'success')
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
        }
        dispatch({
          type: 'admin/progress',
          progress: { phase: 'cleanup', current: 0, total: 1, label: null },
        })
        log('Returning unused temporary seed-session gas…')
        await active.release?.()
        log('All seed batches are published and the temporary session is closed.', 'success')
        dispatch({ type: 'admin/publish_all_succeeded', snapshot })
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
      log('Permanently sealing seed authority; confirm the wallet transaction…')
      void active
        .seal()
        .then(({ digest, snapshot }) => {
          if (!signal.aborted && request === generation) {
            log(`Seed authority permanently sealed · ${digest}`, 'success')
            dispatch({ type: 'admin/sealed', snapshot })
          }
        })
        .catch(failed)
    }
  })
}

export default Object.freeze({ name: 'admin', reduce, observe }) satisfies AppModule
