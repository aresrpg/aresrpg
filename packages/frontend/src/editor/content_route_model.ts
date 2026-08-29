// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type SpellEditorRoute = Readonly<{ classe: string; spell: string | null }>

export const spell_editor_hash = (classe: string, spell?: string): string =>
  `#content/spells/${encodeURIComponent(classe)}${spell ? `/${encodeURIComponent(spell)}` : ''}`

export const spell_editor_route = (hash: string): SpellEditorRoute | null => {
  const [view, domain, classe = '', spell] = hash.replace(/^#/u, '').split('/')
  return view === 'content' && domain === 'spells' && classe ? Object.freeze({ classe, spell: spell ?? null }) : null
}
