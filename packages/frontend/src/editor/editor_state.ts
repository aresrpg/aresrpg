// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { JsonPath, JsonValue, SeedDomain, SeedFileName } from './seed_editor.ts'

export type SeedEditorStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'failed'
type SeedValidationReport = Readonly<{ reds: readonly string[]; warns: readonly string[] }>
export type SeedFileDraft = Readonly<{
  file: SeedFileName
  revision: string
  value: JsonValue
  saved_value: JsonValue
  dirty: boolean
}>
export type SeedEditorState = Readonly<{
  status: SeedEditorStatus
  token: string
  files: Readonly<Partial<Record<SeedDomain, SeedFileDraft>>>
  domain: SeedDomain
  // the selected row's address (its JSON path joined) — stable across identity renames
  entity_id: string | null
  query: string
  focused_domain: SeedDomain | null
  saving_domain: SeedDomain | null
  validation: SeedValidationReport | null
  error: string | null
}>

export type EditorInput =
  | Readonly<{ type: 'editor/load' }>
  | Readonly<{
      type: 'editor/loaded'
      token: string
      files: readonly Readonly<{ file: SeedFileName; revision: string; value: JsonValue }>[]
      validation: SeedValidationReport
    }>
  | Readonly<{ type: 'editor/unavailable' }>
  | Readonly<{ type: 'editor/domain_selected'; domain: SeedDomain }>
  | Readonly<{ type: 'editor/entity_selected'; entity_id: string | null }>
  | Readonly<{ type: 'editor/query_changed'; query: string }>
  | Readonly<{ type: 'editor/focus_changed'; domain: SeedDomain; focused: boolean }>
  | Readonly<{ type: 'editor/value_changed'; domain: SeedDomain; path: JsonPath; value: JsonValue }>
  | Readonly<{ type: 'editor/save'; domain: SeedDomain }>
  | Readonly<{
      type: 'editor/saved'
      domain: SeedDomain
      revision: string
      value: JsonValue
      sent: JsonValue
      validation: SeedValidationReport
    }>
  | Readonly<{ type: 'editor/failed'; error: string }>

export const initial_editor_state = (): SeedEditorState =>
  Object.freeze({
    status: 'idle',
    token: '',
    files: Object.freeze({}),
    domain: 'items',
    entity_id: null,
    query: '',
    focused_domain: null,
    saving_domain: null,
    validation: null,
    error: null,
  })
