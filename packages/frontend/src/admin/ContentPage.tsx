// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo, useState } from 'react'
import { Gift, Hammer, Package, Skull, Sparkles, Store, type LucideIcon } from 'lucide-react'

import { item_icon, mob_icon, spell_icon } from '../content/assets.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import type { SeedSpell } from '../content/catalog.ts'
import { SpellCard } from '../encyclopedia/SpellCard.tsx'
import { dispatch_app, useAppStore } from '../store.ts'

import { ContentEntityEditor } from './ContentEntityEditor.tsx'
import { RawJsonEditor } from './RawJsonEditor.tsx'
import {
  admin_content_domains,
  entity_asset_reference,
  entity_rows,
  is_readonly_seed_path,
  json_value_at_path,
  type EntityAssetReference,
  type JsonPath,
  type JsonValue,
} from './seed_editor.ts'

const action_class =
  'h-8 cursor-pointer border border-[#4a9eff]/35 bg-[#4a9eff]/7 px-3 text-[8px] tracking-[0.14em] text-[#67adff] uppercase hover:border-[#4a9eff]/65 disabled:cursor-not-allowed disabled:opacity-35'

const content_domains = admin_content_domains.filter(({ id }) => id !== 'worlds')
const domain_icons: Readonly<Record<string, LucideIcon>> = Object.freeze({
  airdrop: Gift,
  items: Package,
  mobs: Skull,
  recipes: Hammer,
  shop: Store,
  spells: Sparkles,
})

const spell_unlock_level = (value: JsonValue): number | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const level = (value as Readonly<Record<string, JsonValue>>).unlock_level
  return typeof level === 'number' ? level : null
}

const icon_url = (reference: EntityAssetReference | null, detail = false): string | null => {
  if (!reference) return null
  if (reference.kind === 'item') return detail ? item_detail_icon(reference.id) : item_icon(reference.id)
  if (reference.kind === 'mob') return mob_icon(reference.id)
  return spell_icon(reference.classe, reference.name)
}

const EntityIcon = ({
  reference,
  detail = false,
}: Readonly<{ reference: EntityAssetReference | null; detail?: boolean }>) => {
  const url = icon_url(reference, detail)
  return (
    <div
      className={`${detail ? 'size-16' : 'size-8'} grid shrink-0 place-items-center border border-white/10 bg-black/30`}
    >
      {url ? (
        <img alt="" className="size-full object-contain p-1" decoding="async" loading="lazy" src={url} />
      ) : (
        <span className="text-[6px] tracking-[0.08em] text-[#555b66] uppercase">No icon</span>
      )}
    </div>
  )
}

export const ContentPage = () => {
  const editor = useAppStore((state) => state.admin.editor)
  const [raw, set_raw] = useState(false)
  const file = editor.files[editor.domain]
  const rows = useMemo(() => {
    const source = file ? entity_rows(editor.domain, file.value) : []
    if (editor.domain !== 'spells') return source
    return source.toSorted(
      (left, right) =>
        (spell_unlock_level(left.value) ?? 0) - (spell_unlock_level(right.value) ?? 0) ||
        left.label.localeCompare(right.label)
    )
  }, [editor.domain, file])
  const filtered = useMemo(() => {
    const query = editor.query.trim().toLowerCase()
    return query ? rows.filter(({ label }) => label.toLowerCase().includes(query)) : rows
  }, [editor.query, rows])
  const selected = rows.find(({ id }) => id === editor.entity_id) ?? filtered[0] ?? rows[0]
  const show_raw = raw && editor.domain !== 'spells'

  if (editor.status === 'loading' || editor.status === 'idle')
    return (
      <div className="grid flex-1 place-items-center text-[9px] tracking-[0.18em] text-[#c8963c] uppercase">
        Loading seed files…
      </div>
    )
  if (editor.status === 'unavailable')
    return (
      <div className="grid flex-1 place-items-center p-8 text-center text-[10px] leading-6 text-[#777b86]">
        File editing is available only from the local Vite development server. Production intentionally has no write
        door.
      </div>
    )
  if (!file)
    return (
      <div className="grid flex-1 place-items-center text-[10px] text-[#ff8caa]">
        {editor.error ?? 'Seed files unavailable'}
      </div>
    )

  const replace = (relative_path: JsonPath, value: JsonValue): void => {
    if (!selected) return
    if (is_readonly_seed_path(editor.domain, relative_path)) return
    dispatch_app({
      type: 'admin/editor_value_changed',
      domain: editor.domain,
      path: Object.freeze([...selected.path, ...relative_path]),
      value,
    })
  }
  const selected_asset = selected ? entity_asset_reference(editor.domain, selected.value) : null
  const validate_raw = (candidate: JsonValue): string | null => {
    if (
      editor.domain !== 'items' ||
      !selected ||
      candidate === null ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    )
      return null
    const current = selected.value
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return null
    const candidate_item = candidate as Readonly<Record<string, JsonValue>>
    const current_item = current as Readonly<Record<string, JsonValue>>
    return candidate_item.item_type === current_item.item_type
      ? null
      : 'item_type is a stable identity and cannot be changed'
  }
  const duplicate = (): void => {
    if (!selected) return
    const parent_path = selected.path.slice(0, -1)
    const parent = json_value_at_path(file.value, parent_path)
    if (!Array.isArray(parent)) return
    dispatch_app({
      type: 'admin/editor_value_changed',
      domain: editor.domain,
      path: parent_path,
      value: Object.freeze([...parent, JSON.parse(JSON.stringify(selected.value)) as JsonValue]),
    })
  }
  const remove = (): void => {
    if (!selected) return
    const parent_path = selected.path.slice(0, -1)
    const parent = json_value_at_path(file.value, parent_path)
    const index = Number(selected.path[selected.path.length - 1])
    if (!Array.isArray(parent) || !Number.isInteger(index)) return
    dispatch_app({
      type: 'admin/editor_value_changed',
      domain: editor.domain,
      path: parent_path,
      value: Object.freeze(parent.filter((_, row_index) => row_index !== index)),
    })
    dispatch_app({ type: 'admin/editor_entity_selected', entity_id: null })
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[150px_260px_minmax(420px,1fr)] overflow-hidden max-xl:grid-cols-[130px_220px_minmax(360px,1fr)]">
      <nav className="overflow-y-auto border-r border-white/8 bg-black/10 py-3">
        {content_domains.map((domain) => {
          const domain_file = editor.files[domain.id]
          const count = domain_file ? entity_rows(domain.id, domain_file.value).length : 0
          const DomainIcon = domain_icons[domain.id]!
          return (
            <button
              className={`flex w-full items-center justify-between border-l-2 px-3 py-2.5 text-left text-[9px] uppercase ${
                editor.domain === domain.id
                  ? 'border-[#c8963c] bg-[#c8963c]/7 text-[#c8963c]'
                  : 'border-transparent text-[#747883] hover:bg-white/[0.025] hover:text-[#d8d3ca]'
              }`}
              key={domain.id}
              onClick={() => dispatch_app({ type: 'admin/editor_domain_selected', domain: domain.id })}
              type="button"
            >
              <span className="flex items-center gap-2">
                <DomainIcon size={12} strokeWidth={1.5} />
                {domain.label}
              </span>
              <span className={domain_file?.dirty ? 'text-[#ffca57]' : 'text-[#555963]'}>
                {domain_file?.dirty ? '●' : count}
              </span>
            </button>
          )
        })}
      </nav>

      <aside className="flex min-h-0 flex-col border-r border-white/8 bg-black/[0.06]">
        <div className="border-b border-white/8 p-3">
          <input
            className="h-8 w-full border border-white/10 bg-black/25 px-2 text-[9px] text-[#d8d3ca] outline-none focus:border-[#4a9eff]/50"
            onChange={(event) => dispatch_app({ type: 'admin/editor_query_changed', query: event.target.value })}
            placeholder="Search…"
            value={editor.query}
          />
          <p className="mt-2 text-[8px] text-[#5f636d]">{filtered.length.toLocaleString()} rows</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {filtered.map((row) => (
            <button
              className={`flex w-full items-center gap-2 border-l-2 px-2 py-1.5 text-left text-[9px] ${
                selected?.id === row.id
                  ? 'border-[#4a9eff] bg-[#4a9eff]/6 text-[#b9d8ff]'
                  : 'border-transparent text-[#858994] hover:bg-white/[0.025] hover:text-[#d8d3ca]'
              }`}
              key={row.id}
              onClick={() => dispatch_app({ type: 'admin/editor_entity_selected', entity_id: row.id })}
              title={row.label}
              type="button"
            >
              <EntityIcon reference={entity_asset_reference(editor.domain, row.value)} />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {editor.domain === 'spells' && spell_unlock_level(row.value) !== null && (
                <span className="shrink-0 text-[7px] text-[#626670] uppercase">
                  Lv. {spell_unlock_level(row.value)}
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>

      <main className="min-h-0 overflow-y-auto p-4">
        <header className="sticky top-0 z-[2] -mx-4 -mt-4 mb-4 flex items-center justify-between gap-3 border-b border-white/8 bg-[#0d0d14]/96 px-4 py-3 backdrop-blur-lg">
          <div className="flex min-w-0 items-center gap-3">
            {selected && <EntityIcon detail reference={selected_asset} />}
            <div className="min-w-0">
              <p className="truncate text-[11px] text-[#e8e4dc]">{selected?.label ?? 'No row selected'}</p>
              <p className="mt-1 text-[8px] tracking-[0.12em] text-[#626670] uppercase">{file.file}</p>
            </div>
          </div>
          {editor.domain !== 'spells' && (
            <div className="flex shrink-0 items-center gap-2">
              <button className={action_class} disabled={!selected} onClick={duplicate} type="button">
                Duplicate
              </button>
              <button className={action_class} disabled={!selected} onClick={remove} type="button">
                Delete
              </button>
              <button className={action_class} onClick={() => set_raw((value) => !value)} type="button">
                {show_raw ? 'Form' : 'JSON'}
              </button>
              <button
                className={action_class}
                disabled={!file.dirty || editor.status === 'saving'}
                onClick={() => dispatch_app({ type: 'admin/editor_reset', domain: editor.domain })}
                type="button"
              >
                Reset
              </button>
              <button
                className={`${action_class} !border-[#c8963c]/45 !bg-[#c8963c]/8 !text-[#efc15a]`}
                disabled={!file.dirty || editor.status === 'saving'}
                onClick={() => dispatch_app({ type: 'admin/editor_save', domain: editor.domain })}
                type="button"
              >
                {editor.status === 'saving' ? 'Validating…' : `Save ${file.file}`}
              </button>
            </div>
          )}
        </header>
        {editor.error && (
          <div className="mb-4 whitespace-pre-wrap border border-[#ff5a8b]/30 bg-[#ff5a8b]/6 p-3 text-[9px] leading-5 text-[#ff8caa]">
            {editor.error}
          </div>
        )}
        {file.validation && (
          <div className="mb-4 grid gap-2 text-[8px] text-[#777b86] sm:grid-cols-2">
            <div>{file.validation.reds.length} existing red findings</div>
            <div>{file.validation.warns.length} warnings</div>
          </div>
        )}
        {selected &&
          (show_raw ? (
            <RawJsonEditor
              key={selected.id}
              on_apply={(value) => replace([], value)}
              validate={validate_raw}
              value={selected.value}
            />
          ) : (
            <div className="space-y-4">
              {editor.domain === 'spells' ? (
                <SpellCard
                  edit={
                    editor.status === 'ready'
                      ? {
                          change: replace,
                          save: () => dispatch_app({ type: 'admin/editor_save', domain: editor.domain }),
                        }
                      : undefined
                  }
                  key={selected.id}
                  spell={selected.value as unknown as SeedSpell}
                />
              ) : (
                <ContentEntityEditor
                  domain={editor.domain}
                  is_readonly={(path) => is_readonly_seed_path(editor.domain, path)}
                  key={selected.id}
                  on_change={replace}
                  save={() => dispatch_app({ type: 'admin/editor_save', domain: editor.domain })}
                  value={selected.value}
                />
              )}
            </div>
          ))}
      </main>
    </div>
  )
}
