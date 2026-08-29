// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useMemo, useState } from 'react'

import { dispatch_app } from '../store.ts'

import { content_row_classe, row_address } from './content_list.ts'
import { spell_editor_hash, spell_editor_route } from './content_route_model.ts'
import type { SeedDomain, SeedEntityRow } from './seed_editor.ts'

const replace_hash = (hash: string): void => {
  if (typeof globalThis.history !== 'undefined') globalThis.history.replaceState(null, '', hash)
}

export const useContentEditorRoute = (domain: SeedDomain, entity_id: string | null, rows: readonly SeedEntityRow[]) => {
  const hash = typeof globalThis.location === 'undefined' ? '' : globalThis.location.hash
  const route = useMemo(() => spell_editor_route(hash), [hash])
  const [spell_classe, set_spell_classe] = useState<string | null>(route?.classe ?? null)

  useEffect(() => {
    if (!route) return
    if (spell_classe !== route.classe) set_spell_classe(route.classe)
    if (domain !== 'spells') {
      dispatch_app({ type: 'editor/domain_selected', domain: 'spells' })
      return
    }
    if (!route.spell) return
    const routed = rows.find(
      (row) => content_row_classe(row) === route.classe && encodeURIComponent(row.label) === route.spell
    )
    if (routed && entity_id !== row_address(routed))
      dispatch_app({ type: 'editor/entity_selected', entity_id: row_address(routed) })
  }, [domain, entity_id, route, rows, spell_classe])

  const select_domain = (next_domain: SeedDomain): void => {
    replace_hash(`#content/${next_domain}`)
    dispatch_app({ type: 'editor/domain_selected', domain: next_domain })
  }
  const select_spell_classe = (classe: string | null): void => {
    replace_hash(classe ? spell_editor_hash(classe) : '#content/spells')
    set_spell_classe(classe)
    dispatch_app({ type: 'editor/entity_selected', entity_id: null })
  }
  const select_row = (row: SeedEntityRow): void => {
    if (domain === 'spells') replace_hash(spell_editor_hash(content_row_classe(row), row.label))
    dispatch_app({ type: 'editor/entity_selected', entity_id: row_address(row) })
  }
  return Object.freeze({ spell_classe, select_domain, select_row, select_spell_classe })
}
