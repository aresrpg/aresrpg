// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo, useState } from 'react'
import { Gift, Package, Skull, Sparkles, Store, type LucideIcon } from 'lucide-react'
import { craft_job_of } from '@aresrpg/immutable'

import { item_icon, mob_icon, spell_icon } from '../content/assets.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import type { SeedSpell } from '../content/catalog.ts'
import { SpellCard } from '../encyclopedia/SpellCard.tsx'
import { dispatch_app, useAppStore } from '../store.ts'
import { item_category_colors } from '../visual_identity.ts'

import { ContentEntityEditor } from './ContentEntityEditor.tsx'
import { titleize_field } from './ContentFields.tsx'
import type { SeedFileDraft, SeedEditorStatus } from './admin_state.ts'
import {
  content_navigation_domains,
  content_row_category,
  content_row_level,
  filter_content_rows,
  item_category_rows,
  order_content_rows,
} from './content_list.ts'
import type { ItemRecipeBinding } from './ItemRecipeEditor.tsx'
import { RawJsonEditor } from './RawJsonEditor.tsx'
import {
  entity_asset_reference,
  entity_rows,
  is_readonly_seed_path,
  json_value_at_path,
  type EntityAssetReference,
  type JsonPath,
  type JsonValue,
  type SeedEntityRow,
} from './seed_editor.ts'

const action_class =
  'h-8 cursor-pointer border border-[#4a9eff]/35 bg-[#4a9eff]/7 px-3 text-[8px] tracking-[0.14em] text-[#67adff] uppercase hover:border-[#4a9eff]/65 disabled:cursor-not-allowed disabled:opacity-35'

const same_json = (left: JsonValue | null, right: JsonValue | null): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const item_recipe_binding = (
  selected: SeedEntityRow | undefined,
  recipes_file: SeedFileDraft | undefined,
  status: SeedEditorStatus,
  saving_domain: string | null
): ItemRecipeBinding | undefined => {
  if (!selected || !recipes_file) return undefined
  const recipe_rows = entity_rows('recipes', recipes_file.value)
  const saved_recipe_rows = entity_rows('recipes', recipes_file.saved_value)
  const recipe_row = recipe_rows.find(({ id }) => id === selected.id)
  const saved_recipe_row = saved_recipe_rows.find(({ id }) => id === selected.id)
  const replace_file = (value: JsonValue): void =>
    dispatch_app({ type: 'admin/editor_value_changed', domain: 'recipes', path: [], value })

  return Object.freeze({
    value: recipe_row?.value ?? null,
    change: (path: JsonPath, value: JsonValue): void => {
      if (!recipe_row) return
      dispatch_app({
        type: 'admin/editor_value_changed',
        domain: 'recipes',
        path: Object.freeze([...recipe_row.path, ...path]),
        value,
      })
    },
    category_changed: (category: string): void => {
      if (
        !recipe_row ||
        recipe_row.value === null ||
        typeof recipe_row.value !== 'object' ||
        Array.isArray(recipe_row.value)
      )
        return
      const { job, ...recipe } = recipe_row.value as Readonly<Record<string, JsonValue>>
      const derived_job = craft_job_of(category)
      dispatch_app({
        type: 'admin/editor_value_changed',
        domain: 'recipes',
        path: recipe_row.path,
        value: Object.freeze(derived_job ? recipe : { ...recipe, job: typeof job === 'string' ? job : '' }),
      })
    },
    create: (): void => {
      if (!Array.isArray(recipes_file.value) || recipe_row) return
      replace_file(
        Object.freeze([
          ...recipes_file.value,
          Object.freeze({
            output_type: selected.id,
            inputs: Object.freeze({}),
            ...(craft_job_of(content_row_category(selected)) ? {} : { job: '' }),
          }),
        ])
      )
    },
    remove: (): void => {
      if (!Array.isArray(recipes_file.value) || !recipe_row) return
      const index = Number(recipe_row.path[0])
      replace_file(Object.freeze(recipes_file.value.filter((_, row_index) => row_index !== index)))
    },
    reset: (): void => {
      if (!Array.isArray(recipes_file.value)) return
      if (!recipe_row && saved_recipe_row) {
        replace_file(Object.freeze([...recipes_file.value, saved_recipe_row.value]))
        return
      }
      if (!recipe_row) return
      const index = Number(recipe_row.path[0])
      replace_file(
        saved_recipe_row
          ? Object.freeze(
              recipes_file.value.map((row, row_index) => (row_index === index ? saved_recipe_row.value : row))
            )
          : Object.freeze(recipes_file.value.filter((_, row_index) => row_index !== index))
      )
    },
    save: (): void => dispatch_app({ type: 'admin/editor_save', domain: 'recipes' }),
    dirty: !same_json(recipe_row?.value ?? null, saved_recipe_row?.value ?? null),
    file_dirty: recipes_file.dirty,
    saving: status === 'saving' && saving_domain === 'recipes',
  })
}

const domain_icons: Readonly<Record<string, LucideIcon>> = Object.freeze({
  airdrop: Gift,
  items: Package,
  mobs: Skull,
  shop: Store,
  spells: Sparkles,
})

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
  const [item_category, set_item_category] = useState<string | null>(null)
  const file = editor.files[editor.domain]
  const rows = useMemo(
    () => order_content_rows(editor.domain, file ? entity_rows(editor.domain, file.value) : []),
    [editor.domain, file]
  )
  const categories = useMemo(() => (editor.domain === 'items' ? item_category_rows(rows) : []), [editor.domain, rows])
  const filtered = useMemo(
    () => filter_content_rows(rows, editor.query, editor.domain === 'items' ? item_category : null),
    [editor.domain, editor.query, item_category, rows]
  )
  const selected = filtered.find(({ id }) => id === editor.entity_id) ?? filtered[0]
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
  const item_recipe = item_recipe_binding(
    editor.domain === 'items' ? selected : undefined,
    editor.files.recipes,
    editor.status,
    editor.saving_domain
  )

  return (
    <div
      className={`grid min-h-0 flex-1 overflow-hidden ${
        editor.domain === 'items'
          ? 'grid-cols-[140px_150px_250px_minmax(420px,1fr)] max-xl:grid-cols-[120px_130px_210px_minmax(360px,1fr)]'
          : 'grid-cols-[150px_260px_minmax(420px,1fr)] max-xl:grid-cols-[130px_220px_minmax(360px,1fr)]'
      }`}
    >
      <nav className="overflow-y-auto border-r border-white/8 bg-black/10 py-3">
        {content_navigation_domains.map((domain) => {
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

      {editor.domain === 'items' && (
        <aside
          className="min-h-0 overflow-y-auto border-r border-white/8 bg-black/[0.04] py-3"
          data-item-category-column=""
        >
          <button
            className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-[8px] uppercase ${
              item_category === null
                ? 'border-[#c8963c] bg-[#c8963c]/7 text-[#efbd45]'
                : 'border-transparent text-[#747883] hover:bg-white/[0.025] hover:text-[#d8d3ca]'
            }`}
            onClick={() => {
              set_item_category(null)
              dispatch_app({ type: 'admin/editor_entity_selected', entity_id: null })
            }}
            type="button"
          >
            <span>All items</span>
            <span className="tabular-nums opacity-55">{rows.length}</span>
          </button>
          {categories.map(({ category, count }) => {
            const color = item_category_colors[category] ?? '#777b86'
            return (
              <button
                className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-[8px] uppercase ${
                  item_category === category
                    ? 'bg-white/[0.035] text-[#e8e4dc]'
                    : 'border-transparent text-[#747883] hover:bg-white/[0.025] hover:text-[#d8d3ca]'
                }`}
                key={category}
                onClick={() => {
                  set_item_category(category)
                  dispatch_app({ type: 'admin/editor_entity_selected', entity_id: null })
                }}
                style={item_category === category ? { borderColor: color } : undefined}
                type="button"
              >
                <span className="truncate">{titleize_field(category)}</span>
                <span className="tabular-nums opacity-55">{count}</span>
              </button>
            )
          })}
        </aside>
      )}

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
              {content_row_level(editor.domain, row) !== null && (
                <span className="shrink-0 text-[7px] text-[#626670] uppercase">
                  Lv. {content_row_level(editor.domain, row)}
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
                  item_recipe={item_recipe}
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
