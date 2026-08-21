// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo, useState } from 'react'
import { Gift, Package, Skull, Sparkles, Store, Trees, type LucideIcon } from 'lucide-react'
import { craft_job_of } from '@aresrpg/immutable'

import { item_icon, mob_icon, spell_icon } from '../content/assets.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import type { SeedSpell } from '../content/catalog.ts'
import { SpellCard } from '../encyclopedia/SpellCard.tsx'
import { dispatch_app, useAppStore } from '../store.ts'
import { item_category_colors } from '../visual_identity.ts'

import { ContentEntityEditor } from './ContentEntityEditor.tsx'
import { titleize_field } from './ContentFields.tsx'
import type { SeedFileDraft } from './editor_state.ts'
import {
  content_navigation_domains,
  content_row_category,
  content_row_level,
  filter_content_rows,
  find_selected_row,
  item_category_rows,
  order_content_rows,
  reordered_spell_levels,
  row_address,
  spell_class_rows,
} from './content_list.ts'
import type { ItemRecipeBinding } from './ItemRecipeEditor.tsx'
import {
  entity_asset_reference,
  entity_rows,
  is_readonly_seed_path,
  type EntityAssetReference,
  type JsonPath,
  type JsonValue,
  type SeedEntityRow,
} from './seed_editor.ts'

const item_recipe_binding = (
  selected: SeedEntityRow | undefined,
  recipes_file: SeedFileDraft | undefined
): ItemRecipeBinding | undefined => {
  if (!selected || !recipes_file) return undefined
  const recipe_rows = entity_rows('recipes', recipes_file.value)
  const recipe_row = recipe_rows.find(({ id }) => id === selected.id)
  const replace_file = (value: JsonValue): void =>
    dispatch_app({ type: 'editor/value_changed', domain: 'recipes', path: [], value })

  return Object.freeze({
    value: recipe_row?.value ?? null,
    change: (path: JsonPath, value: JsonValue): void => {
      if (!recipe_row) return
      dispatch_app({
        type: 'editor/value_changed',
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
        type: 'editor/value_changed',
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
  })
}

const domain_icons: Readonly<Record<string, LucideIcon>> = Object.freeze({
  airdrop: Gift,
  items: Package,
  mobs: Skull,
  shop: Store,
  spells: Sparkles,
  structure_packs: Trees,
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

type FacetOption = Readonly<{ value: string; label: string; count: number; color?: string }>

const FacetColumn = ({
  all_label,
  options,
  selected,
  total,
  on_select,
}: Readonly<{
  all_label: string
  options: readonly FacetOption[]
  selected: string | null
  total: number
  on_select: (value: string | null) => void
}>) => (
  <aside className="min-h-0 overflow-y-auto border-r border-white/8 bg-black/[0.04] py-3">
    <button
      className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-[8px] uppercase ${
        selected === null
          ? 'border-[#c8963c] bg-[#c8963c]/7 text-[#efbd45]'
          : 'border-transparent text-[#747883] hover:bg-white/[0.025] hover:text-[#d8d3ca]'
      }`}
      onClick={() => on_select(null)}
      type="button"
    >
      <span>{all_label}</span>
      <span className="tabular-nums opacity-55">{total}</span>
    </button>
    {options.map(({ value, label, count, color }) => (
      <button
        className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-[8px] uppercase ${
          selected === value
            ? 'bg-white/[0.035] text-[#e8e4dc]'
            : 'border-transparent text-[#747883] hover:bg-white/[0.025] hover:text-[#d8d3ca]'
        }`}
        key={value}
        onClick={() => on_select(value)}
        style={selected === value ? { borderColor: color ?? '#777b86' } : undefined}
        type="button"
      >
        <span className="truncate">{label}</span>
        <span className="tabular-nums opacity-55">{count}</span>
      </button>
    ))}
  </aside>
)

export const ContentPage = () => {
  const editor = useAppStore((state) => state.editor)
  const [item_category, set_item_category] = useState<string | null>(null)
  const [spell_classe, set_spell_classe] = useState<string | null>(null)
  const [drag_from, set_drag_from] = useState<number | null>(null)
  const [drag_over, set_drag_over] = useState<number | null>(null)
  const file = editor.files[editor.domain]
  const rows = useMemo(
    () => order_content_rows(editor.domain, file ? entity_rows(editor.domain, file.value) : []),
    [editor.domain, file]
  )
  const categories = useMemo(() => (editor.domain === 'items' ? item_category_rows(rows) : []), [editor.domain, rows])
  const classes = useMemo(() => (editor.domain === 'spells' ? spell_class_rows(rows) : []), [editor.domain, rows])
  const filtered = useMemo(
    () =>
      filter_content_rows(
        rows,
        editor.query,
        editor.domain === 'items' ? item_category : null,
        editor.domain === 'spells' ? spell_classe : null
      ),
    [editor.domain, editor.query, item_category, spell_classe, rows]
  )
  const selected = find_selected_row(filtered, editor.entity_id) ?? filtered[0]

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
      type: 'editor/value_changed',
      domain: editor.domain,
      path: Object.freeze([...selected.path, ...relative_path]),
      value,
    })
  }
  // the ladder is only what the eye sees when exactly one class is listed unfiltered — reordering
  // a partial list would re-stamp levels the user never saw
  const ladder_reorder = editor.domain === 'spells' && !!spell_classe && editor.query.trim() === ''
  const drop_spell = (to: number): void => {
    const from = drag_from
    set_drag_from(null)
    set_drag_over(null)
    if (from === null || !Array.isArray(file.value)) return
    const levels = reordered_spell_levels(filtered, from, to)
    if (!levels) return
    dispatch_app({
      type: 'editor/value_changed',
      domain: 'spells',
      path: [],
      value: Object.freeze(
        file.value.map((entry, index) => {
          const level = levels[index]
          return level === undefined || entry === null || typeof entry !== 'object' || Array.isArray(entry)
            ? entry
            : Object.freeze({ ...entry, unlock_level: level })
        })
      ),
    })
    dispatch_app({ type: 'editor/save', domain: 'spells' })
  }
  const selected_asset = selected ? entity_asset_reference(editor.domain, selected.value) : null
  const item_recipe = item_recipe_binding(editor.domain === 'items' ? selected : undefined, editor.files.recipes)

  return (
    <div
      className={`grid min-h-0 flex-1 overflow-hidden ${
        editor.domain === 'items' || editor.domain === 'spells'
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
              onClick={() => dispatch_app({ type: 'editor/domain_selected', domain: domain.id })}
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
        <FacetColumn
          all_label="All items"
          on_select={(value) => {
            set_item_category(value)
            dispatch_app({ type: 'editor/entity_selected', entity_id: null })
          }}
          options={categories.map(({ category, count }) => ({
            color: item_category_colors[category],
            count,
            label: titleize_field(category),
            value: category,
          }))}
          selected={item_category}
          total={rows.length}
        />
      )}

      {editor.domain === 'spells' && (
        <FacetColumn
          all_label="All spells"
          on_select={(value) => {
            set_spell_classe(value)
            dispatch_app({ type: 'editor/entity_selected', entity_id: null })
          }}
          options={classes.map(({ classe, count }) => ({ count, label: classe.toUpperCase(), value: classe }))}
          selected={spell_classe}
          total={rows.length}
        />
      )}

      <aside className="flex min-h-0 flex-col border-r border-white/8 bg-black/[0.06]">
        <div className="border-b border-white/8 p-3">
          <input
            className="h-8 w-full border border-white/10 bg-black/25 px-2 text-[9px] text-[#d8d3ca] outline-none focus:border-[#4a9eff]/50"
            onChange={(event) => dispatch_app({ type: 'editor/query_changed', query: event.target.value })}
            placeholder="Search…"
            value={editor.query}
          />
          <p className="mt-2 text-[8px] text-[#5f636d]">
            {filtered.length.toLocaleString()} rows
            {ladder_reorder && <span className="text-[#626670]"> · drag to move a spell up the unlock ladder</span>}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {filtered.map((row, index) => (
            <button
              className={`flex w-full items-center gap-2 border-l-2 px-2 py-1.5 text-left text-[9px] ${
                selected && row_address(selected) === row_address(row)
                  ? 'border-[#4a9eff] bg-[#4a9eff]/6 text-[#b9d8ff]'
                  : 'border-transparent text-[#858994] hover:bg-white/[0.025] hover:text-[#d8d3ca]'
              } ${ladder_reorder ? 'cursor-grab active:cursor-grabbing' : ''} ${
                drag_from === index ? 'opacity-40' : ''
              } ${
                drag_from !== null && drag_from !== index && drag_over === index
                  ? drag_from < index
                    ? 'shadow-[inset_0_-2px_0_0_#c8963c]'
                    : 'shadow-[inset_0_2px_0_0_#c8963c]'
                  : ''
              }`}
              draggable={ladder_reorder}
              key={row_address(row)}
              onClick={() => dispatch_app({ type: 'editor/entity_selected', entity_id: row_address(row) })}
              onDragEnd={() => {
                set_drag_from(null)
                set_drag_over(null)
              }}
              onDragOver={(event) => {
                if (drag_from === null) return
                event.preventDefault()
                set_drag_over(index)
              }}
              // Firefox refuses a drag without payload
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', String(index))
                set_drag_from(index)
              }}
              onDrop={(event) => {
                event.preventDefault()
                drop_spell(index)
              }}
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
          <div className="flex shrink-0 items-center gap-3">
            {editor.validation && (editor.validation.reds.length > 0 || editor.validation.warns.length > 0) && (
              <p className="flex items-center gap-2 text-[8px] tracking-[0.12em] uppercase">
                {editor.validation.reds.length > 0 && (
                  <span className="text-[#ff8caa]">{editor.validation.reds.length} red</span>
                )}
                {editor.validation.warns.length > 0 && (
                  <span className="text-[#ffca57]">{editor.validation.warns.length} warn</span>
                )}
              </p>
            )}
            <p className="text-[8px] tracking-[0.14em] uppercase">
              {editor.status === 'saving' ? (
                <span className="animate-pulse text-[#efbd45]">Saving…</span>
              ) : file.dirty ? (
                <span className="text-[#efbd45]">● unsaved</span>
              ) : (
                <span className="text-[#65c993]">Saved · autosave on</span>
              )}
            </p>
          </div>
        </header>
        {editor.error && (
          <div className="mb-4 whitespace-pre-wrap border border-[#ff5a8b]/30 bg-[#ff5a8b]/6 p-3 text-[9px] leading-5 text-[#ff8caa]">
            {editor.error}
          </div>
        )}
        {selected && (
          <div className="space-y-4">
            {editor.domain === 'spells' ? (
              <SpellCard
                edit={
                  editor.status === 'ready'
                    ? {
                        change: replace,
                        save: () => dispatch_app({ type: 'editor/save', domain: editor.domain }),
                      }
                    : undefined
                }
                key={row_address(selected)}
                spell={selected.value as unknown as SeedSpell}
              />
            ) : (
              <ContentEntityEditor
                domain={editor.domain}
                is_readonly={(path) => is_readonly_seed_path(editor.domain, path)}
                key={row_address(selected)}
                on_change={replace}
                item_recipe={item_recipe}
                save={() => dispatch_app({ type: 'editor/save', domain: editor.domain })}
                value={selected.value}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
