// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The seed content editor: a dev-server-only surface (the /__seed doors exist only on the local
// Vite process). It owns no wallet and no game session — file truth in, file truth out.

import {
  seed_content_domains,
  is_seed_file,
  replace_json_value,
  type JsonValue,
  type SeedDomain,
} from '../editor/seed_editor.ts'
import { initial_editor_state, type EditorInput, type SeedEditorState } from '../editor/editor_state.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export { initial_editor_state }
export type { EditorInput, SeedEditorState }

const with_editor = (state: AppState, editor: SeedEditorState): AppState => Object.freeze({ ...state, editor })

const reduce = (state: AppState, input: AppInput): AppState => {
  const { editor } = state
  if (input.type === 'editor/load' && editor.status === 'idle')
    return with_editor(state, Object.freeze({ ...editor, status: 'loading', error: null }))
  if (input.type === 'editor/loaded' && editor.status === 'loading') {
    const domains_by_file = new Map(seed_content_domains.map(({ id, file }) => [file, id] as const))
    const files = Object.freeze(
      Object.fromEntries(
        input.files.flatMap((loaded) => {
          const domain = domains_by_file.get(loaded.file)
          return domain ? [[domain, Object.freeze({ ...loaded, saved_value: loaded.value, dirty: false })]] : []
        })
      )
    )
    return with_editor(
      state,
      Object.freeze({
        ...editor,
        status: 'ready',
        token: input.token,
        files,
        validation: input.validation,
        error: null,
      })
    )
  }
  if (input.type === 'editor/unavailable' && editor.status === 'loading')
    return with_editor(state, Object.freeze({ ...editor, status: 'unavailable', error: null }))
  if (input.type === 'editor/domain_selected')
    return with_editor(state, Object.freeze({ ...editor, domain: input.domain, entity_id: null, query: '' }))
  if (input.type === 'editor/entity_selected')
    return with_editor(state, Object.freeze({ ...editor, entity_id: input.entity_id }))
  if (input.type === 'editor/query_changed') return with_editor(state, Object.freeze({ ...editor, query: input.query }))
  if (input.type === 'editor/value_changed') {
    const file = editor.files[input.domain]
    // typing stays legal while an autosave is in flight — the finished save never clobbers it
    if (!file || !['ready', 'saving'].includes(editor.status)) return state
    const value = replace_json_value(file.value, input.path, input.value)
    return with_editor(
      state,
      Object.freeze({
        ...editor,
        files: Object.freeze({
          ...editor.files,
          [input.domain]: Object.freeze({ ...file, value, dirty: true }),
        }),
      })
    )
  }
  if (input.type === 'editor/save') {
    const file = editor.files[input.domain]
    return file?.dirty && editor.status === 'ready'
      ? with_editor(state, Object.freeze({ ...editor, status: 'saving', saving_domain: input.domain, error: null }))
      : state
  }
  if (input.type === 'editor/saved' && editor.saving_domain === input.domain) {
    const file = editor.files[input.domain]
    if (!file) return state
    // edits made while the save was in flight survive: the server echo only wins when the
    // in-memory value is still the exact one that was sent
    const untouched = file.value === input.sent
    const saved = Object.freeze({
      ...file,
      revision: input.revision,
      value: untouched ? input.value : file.value,
      saved_value: input.value,
      dirty: !untouched,
    })
    return with_editor(
      state,
      Object.freeze({
        ...editor,
        status: 'ready',
        saving_domain: null,
        validation: input.validation,
        files: Object.freeze({ ...editor.files, [input.domain]: saved }),
        error: null,
      })
    )
  }
  if (input.type === 'editor/failed' && ['loading', 'saving'].includes(editor.status))
    return with_editor(
      state,
      Object.freeze({
        ...editor,
        status: editor.status === 'saving' ? 'ready' : 'failed',
        saving_domain: null,
        error: input.error,
      })
    )
  return state
}

const observe = ({ events, dispatch, signal, get_state }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  // Production ships NO seed I/O by construction: this early return lets the minifier strip both
  // fetch closures (reader AND writer) from the bundle — any load attempt answers unavailable.
  if (!import.meta.env.DEV) {
    events.on('STATE_UPDATED', (state, previous) => {
      if (state.editor.status === 'loading' && previous.editor.status !== 'loading')
        dispatch({ type: 'editor/unavailable' })
    })
    return
  }
  let generation = 0
  const load = (): void => {
    const request = ++generation
    void fetch('/__seed/files', { cache: 'no-store' })
      .then(async (response) => {
        if (signal.aborted || request !== generation) return
        if (response.status === 404) return dispatch({ type: 'editor/unavailable' })
        const body = (await response.json()) as Readonly<{
          files?: readonly Readonly<{ file: string; revision: string; value: JsonValue }>[]
          token?: string
          validation?: Readonly<{ reds: readonly string[]; warns: readonly string[] }>
          error?: string
        }>
        if (!response.ok || !body.files || !body.token || !body.validation)
          throw new Error(body.error || `Seed files returned ${response.status}`)
        dispatch({
          type: 'editor/loaded',
          files: body.files.filter(is_seed_file),
          token: body.token,
          validation: body.validation,
        })
      })
      .catch((error) => {
        if (signal.aborted || request !== generation) return
        console.error('Seed files could not be loaded.', error)
        dispatch({ type: 'editor/failed', error: error instanceof Error ? error.message : String(error) })
      })
  }
  const save = (domain: SeedDomain): void => {
    const { editor } = get_state()
    const file = editor.files[domain]
    if (!file || editor.saving_domain !== domain) return
    const sent = file.value
    const request = ++generation
    void fetch(`/__seed/files/${encodeURIComponent(file.file)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-aresrpg-seed-token': editor.token },
      body: JSON.stringify({ revision: file.revision, value: sent }),
    })
      .then(async (response) => {
        if (signal.aborted || request !== generation) return
        const body = (await response.json()) as Readonly<{
          revision?: string
          value?: JsonValue
          validation?: Readonly<{ reds: readonly string[]; warns: readonly string[] }>
          error?: string
        }>
        if (!response.ok || !body.revision || body.value === undefined || !body.validation)
          throw new Error(body.error || `Seed save returned ${response.status}`)
        dispatch({
          type: 'editor/saved',
          domain,
          revision: body.revision,
          value: body.value,
          sent,
          validation: body.validation,
        })
      })
      .catch((error) => {
        if (signal.aborted || request !== generation) return
        console.error('Seed file could not be saved.', error)
        dispatch({ type: 'editor/failed', error: error instanceof Error ? error.message : String(error) })
      })
  }
  // ── autosave: every edit lands on disk after a short settle; git is the owner's undo ──
  const AUTOSAVE_DEBOUNCE_MS = 800
  let save_timer: ReturnType<typeof setTimeout> | null = null
  // a save the validator refused pins its failing value — retry only once the value changes,
  // never in a loop against the same rejection
  const refused_values = new Map<SeedDomain, JsonValue>()
  const next_dirty_domain = (): SeedDomain | null => {
    const { editor } = get_state()
    if (editor.status !== 'ready') return null
    const entry = Object.entries(editor.files).find(
      ([domain, file]) => file?.dirty && refused_values.get(domain as SeedDomain) !== file.value
    )
    return (entry?.[0] as SeedDomain) ?? null
  }
  const schedule_save = (): void => {
    if (save_timer) clearTimeout(save_timer)
    save_timer = setTimeout(() => {
      save_timer = null
      if (signal.aborted) return
      const domain = next_dirty_domain()
      if (domain) dispatch({ type: 'editor/save', domain })
    }, AUTOSAVE_DEBOUNCE_MS)
  }
  signal.addEventListener('abort', () => {
    if (save_timer) clearTimeout(save_timer)
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.editor === previous.editor) return
    if (state.editor.status === 'loading' && previous.editor.status !== 'loading') return load()
    if (state.editor.status === 'saving' && previous.editor.status !== 'saving') {
      const domain = state.editor.saving_domain
      if (domain) save(domain)
      return
    }
    if (state.editor.error && !previous.editor.error && previous.editor.saving_domain)
      refused_values.set(
        previous.editor.saving_domain,
        state.editor.files[previous.editor.saving_domain]?.value ?? null
      )
    if (state.editor.status === 'ready' && Object.values(state.editor.files).some((file) => file?.dirty))
      schedule_save()
  })
}

export default Object.freeze({ name: 'editor', reduce, observe }) satisfies AppModule
