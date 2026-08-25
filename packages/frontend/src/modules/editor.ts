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
import { board_catalog_errors, type AuthoredBoard } from '../editor/board_editor.ts'
import { initial_editor_state, type EditorInput, type SeedEditorState } from '../editor/editor_state.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export { initial_editor_state }
export type { EditorInput, SeedEditorState }

const with_editor = (state: AppState, editor: SeedEditorState): AppState => Object.freeze({ ...state, editor })

const AUTOSAVE_DEBOUNCE_MS = 800
const BOARD_AUTOSAVE_DEBOUNCE_MS = 500
const SPELL_FOCUS_LOSS_AUTOSAVE_MS = 5_000
export const editor_autosave_delay_ms = (domain: SeedDomain): number =>
  domain === 'fight_boards'
    ? BOARD_AUTOSAVE_DEBOUNCE_MS
    : domain === 'spells'
      ? SPELL_FOCUS_LOSS_AUTOSAVE_MS
      : AUTOSAVE_DEBOUNCE_MS
export const editor_domain_autosave_ready = (domain: SeedDomain, focused_domain: SeedDomain | null): boolean =>
  domain !== 'spells' || focused_domain !== 'spells'
const mob_spell_drafts_complete = (value: JsonValue): boolean =>
  Array.isArray(value) &&
  value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const { spells } = entry as Readonly<Record<string, JsonValue>>
    return (
      Array.isArray(spells) &&
      spells.every((spell) => {
        if (!spell || typeof spell !== 'object' || Array.isArray(spell)) return false
        const { levels } = spell as Readonly<Record<string, JsonValue>>
        if (!Array.isArray(levels) || levels.length !== 1) return false
        const [level] = levels
        if (!level || typeof level !== 'object' || Array.isArray(level)) return false
        const row = level as Readonly<Record<string, JsonValue>>
        return (
          (Array.isArray(row.effects) && row.effects.length > 0) ||
          (Array.isArray(row.crit_effects) && row.crit_effects.length > 0)
        )
      })
    )
  })
export const editor_domain_saveable = (domain: SeedDomain, value: JsonValue): boolean => {
  if (domain === 'mobs') return mob_spell_drafts_complete(value)
  if (domain !== 'fight_boards') return true
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const { boards } = value as Readonly<Record<string, JsonValue>>
  return (
    Array.isArray(boards) && boards.length > 0 && board_catalog_errors(boards as readonly AuthoredBoard[]).length === 0
  )
}

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
    return with_editor(
      state,
      Object.freeze({ ...editor, domain: input.domain, entity_id: null, query: '', focused_domain: null })
    )
  if (input.type === 'editor/entity_selected')
    return with_editor(state, Object.freeze({ ...editor, entity_id: input.entity_id }))
  if (input.type === 'editor/query_changed') return with_editor(state, Object.freeze({ ...editor, query: input.query }))
  if (input.type === 'editor/focus_changed') {
    const focused_domain = input.focused
      ? input.domain
      : editor.focused_domain === input.domain
        ? null
        : editor.focused_domain
    return focused_domain === editor.focused_domain
      ? state
      : with_editor(state, Object.freeze({ ...editor, focused_domain }))
  }
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
  // A refused save pins the exact SENT value. Edits may continue while that request is in flight;
  // pinning the newer live value would suppress the corrective save that follows the rejection.
  const refused_values = new Map<SeedDomain, JsonValue>()
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
        refused_values.set(domain, sent)
        console.error('Seed file could not be saved.', error)
        dispatch({ type: 'editor/failed', error: error instanceof Error ? error.message : String(error) })
      })
  }
  // Board strokes and text edits debounce independently; requests remain serialized, so a drag
  // gesture coalesces into one validated board write instead of one transaction per crossed cell.
  let save_timer: ReturnType<typeof setTimeout> | null = null
  const next_dirty_domain = (): SeedDomain | null => {
    const { editor } = get_state()
    if (editor.status !== 'ready') return null
    const entries = Object.entries(editor.files).filter(
      ([domain, file]) =>
        file?.dirty &&
        refused_values.get(domain as SeedDomain) !== file.value &&
        editor_domain_autosave_ready(domain as SeedDomain, editor.focused_domain) &&
        editor_domain_saveable(domain as SeedDomain, file.value)
    )
    const entry = entries.find(([domain]) => domain === 'fight_boards') ?? entries[0]
    return (entry?.[0] as SeedDomain) ?? null
  }
  const schedule_save = (): void => {
    if (save_timer) clearTimeout(save_timer)
    const scheduled_domain = next_dirty_domain()
    if (!scheduled_domain) return
    save_timer = setTimeout(() => {
      save_timer = null
      if (signal.aborted) return
      const domain = next_dirty_domain()
      if (domain) dispatch({ type: 'editor/save', domain })
    }, editor_autosave_delay_ms(scheduled_domain))
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
    if (state.editor.status === 'ready' && Object.values(state.editor.files).some((file) => file?.dirty))
      schedule_save()
  })
}

export default Object.freeze({ name: 'editor', reduce, observe }) satisfies AppModule
