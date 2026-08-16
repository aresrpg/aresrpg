// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { next_seed_batch, type SeedAdminConfig, type SeedAdminSession } from '@aresrpg/sdk/seed-admin'

import {
  initial_admin_state,
  type AdminInput,
  type AdminOverviewState,
  type AdminState,
  type AdminView,
  type SeedEditorState,
  type SeedEditorStatus,
} from '../admin/admin_state.ts'
import { read_admin_storage, save_admin_storage } from '../admin/admin_storage.ts'
import { observe_admin_wallet, reduce_admin_wallet } from '../admin/admin_wallet.ts'
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

const reduce_config = (admin: AdminState, input: AppInput): AdminState | null => {
  if (input.type === 'admin/storage_loaded')
    return Object.freeze({
      ...admin,
      config: input.config,
      snapshot: null,
      status: 'idle',
      operation: null,
      seal_armed: false,
      error: null,
    })
  if (input.type === 'admin/publisher_changed')
    return Object.freeze({
      ...admin,
      config: Object.freeze({ ...admin.config, publisher: input.publisher.trim() }),
      snapshot: null,
      status: 'idle',
      error: null,
    })
  if (input.type === 'admin/world_changed')
    return Object.freeze({
      ...admin,
      config: Object.freeze({
        ...admin.config,
        worlds: Object.freeze({ ...admin.config.worlds, [input.world]: input.object_id.trim() }),
      }),
      snapshot: null,
      status: 'idle',
      error: null,
    })
  return null
}

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

const reduce = (state: AppState, input: AppInput): AppState => {
  const { admin } = state
  if (input.type === 'admin/view_changed') return with_admin(state, Object.freeze({ ...admin, view: input.view }))
  const editor = reduce_editor(admin, input)
  if (editor) return with_admin(state, editor)
  const overview = reduce_overview(admin, input)
  if (overview) return with_admin(state, overview)
  const wallet = reduce_admin_wallet(admin, input)
  if (wallet) return with_admin(state, wallet)
  const configured = reduce_config(admin, input)
  if (configured) return with_admin(state, configured)
  if (input.type === 'admin/refresh' && admin.status !== 'loading' && admin.status !== 'executing')
    return with_admin(state, Object.freeze({ ...admin, status: 'loading', operation: null, error: null }))
  if (input.type === 'admin/refreshed' && admin.status === 'loading')
    return with_admin(state, Object.freeze({ ...admin, snapshot: input.snapshot, status: 'ready', error: null }))
  if (input.type === 'admin/execute' && can_execute(admin, input.batch))
    return with_admin(
      state,
      Object.freeze({ ...admin, status: 'executing', operation: Object.freeze({ type: 'batch', batch: input.batch }) })
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
            error: null,
          })
        )
      : state
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
    return with_admin(state, Object.freeze({ ...admin, status: 'failed', operation: null, error: input.error }))
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return with_admin(state, initial_admin_state())
  return state
}

const observe = ({ events, dispatch, signal, get_state }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  let seed_session: SeedAdminSession | null = null
  let generation = 0
  let editor_generation = 0
  let storage_loaded = false
  const invalidate_seed_session = (): void => {
    seed_session = null
    generation += 1
  }
  const clear = (): void => {
    invalidate_seed_session()
    editor_generation += 1
    storage_loaded = false
  }
  observe_admin_wallet({ events, dispatch, signal, get_state }, invalidate_seed_session)
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
    if (state.navigation.page === 'admin' && !storage_loaded) {
      storage_loaded = true
      dispatch({ type: 'admin/storage_loaded', ...read_admin_storage() })
      return
    }
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
    if (state.admin.config !== previous.admin.config) save_admin_storage(state.admin)

    if (state.admin.status === 'loading' && previous.admin.status !== 'loading') {
      const connected = state.admin.wallet.session
      const request = ++generation
      if (!connected) return dispatch({ type: 'admin/failed', error: 'Connect the admin wallet before publishing' })
      void import('../admin/seed_content.ts')
        .then(({ seed_content }) => connected.create_seed_admin(seed_content, state.admin.config))
        .then(async (created) => {
          const snapshot = await created.refresh()
          if (signal.aborted || request !== generation) return
          seed_session = created
          dispatch({ type: 'admin/refreshed', snapshot })
        })
        .catch((error) => {
          if (signal.aborted || request !== generation) return
          console.error('Seed plan inspection failed.', error)
          dispatch({ type: 'admin/failed', error: error instanceof Error ? error.message : String(error) })
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
      dispatch({ type: 'admin/failed', error: error instanceof Error ? error.message : String(error) })
    }
    if (operation.type === 'batch') {
      void active
        .execute(operation.batch)
        .then((result) => {
          if (signal.aborted || request !== generation) return
          dispatch({ type: 'admin/batch_succeeded', batch: result.batch, snapshot: result.snapshot })
        })
        .catch(failed)
    } else {
      void active
        .seal()
        .then(({ snapshot }) => {
          if (!signal.aborted && request === generation) dispatch({ type: 'admin/sealed', snapshot })
        })
        .catch(failed)
    }
  })
}

export default Object.freeze({ name: 'admin', reduce, observe }) satisfies AppModule
