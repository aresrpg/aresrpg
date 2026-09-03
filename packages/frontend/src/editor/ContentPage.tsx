// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo, useState } from 'react'
import { craft_job_of, item_acquisition, type AcquisitionContent, type AcquisitionEstimate } from '@aresrpg/immutable'

import { item_icon, mob_icon, spell_icon } from '../content/assets.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import type { SeedSpell } from '../content/catalog.ts'
import { FacetRail, type FacetOption } from '../components/FacetRail.tsx'
import { SpellCard } from '../encyclopedia/SpellCard.tsx'
import { dispatch_app, useAppStore } from '../store.ts'
import { element_colors, item_category_colors } from '../visual_identity.ts'

import { ContentEntityEditor } from './ContentEntityEditor.tsx'
import { content_domain_icon } from './content_domain_icons.ts'
import { titleize_field } from './ContentFields.tsx'
import { SpellAutosaveBoundary } from './SpellAutosaveBoundary.tsx'
import type { SeedEditorState, SeedEditorStatus, SeedFileDraft } from './editor_state.ts'
import {
  content_navigation_domains,
  content_category_for_filter,
  content_page_columns,
  content_result_columns,
  content_row_category,
  content_row_level_label,
  content_types_for_domain,
  filter_content_rows,
  find_selected_row,
  item_filter_rows,
  type ItemFilterRow,
  item_types_for_filter,
  mob_filter_rows,
  order_content_rows,
  reordered_spell_levels,
  row_address,
  spell_class_rows,
  spell_row_has_effects,
} from './content_list.ts'
import { useContentEditorRoute } from './content_route.ts'
import { item_filter_view } from './item_filter_view.ts'
import type { ItemRecipeBinding } from './ItemRecipeEditor.tsx'
import {
  entity_asset_reference,
  entity_rows,
  is_readonly_seed_path,
  type EntityAssetReference,
  type JsonPath,
  type JsonValue,
  type SeedDomain,
  type SeedEntityRow,
} from './seed_editor.ts'
import { ValidationCounters, type ValidationKind, ValidationPanel } from './ValidationReport.tsx'

const item_recipe_binding = (
  selected: SeedEntityRow | undefined,
  recipes_file: SeedFileDraft | undefined,
  acquisition: AcquisitionEstimate | undefined
): ItemRecipeBinding | undefined => {
  if (!selected || !recipes_file) return undefined
  const recipe_rows = entity_rows('recipes', recipes_file.value)
  const recipe_row = recipe_rows.find(({ id }) => id === selected.id)
  const replace_file = (value: JsonValue): void =>
    dispatch_app({ type: 'editor/value_changed', domain: 'recipes', path: [], value })
  return Object.freeze({
    acquisition,
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
const mob_facet_options = (rows: ReturnType<typeof mob_filter_rows>): readonly FacetOption[] =>
  rows.map((row, index) => {
    const previous = rows[index - 1]
    const section =
      row.kind === 'world' && previous?.kind !== 'world' && !previous?.parent
        ? 'Worlds'
        : row.kind === 'family' && previous?.kind !== 'family'
          ? 'Families'
          : row.kind === 'element' && previous?.kind !== 'element'
            ? 'Elements'
            : row.kind === 'protector' && previous?.kind !== 'protector'
              ? 'Protectors'
              : undefined
    const label =
      row.kind === 'protector'
        ? `Protector ${titleize_field(row.id)}`
        : row.parent
          ? titleize_field(row.id.slice(row.id.indexOf(':') + 1))
          : titleize_field(row.id)
    return Object.freeze({
      value: `${row.kind}:${row.id}`,
      label,
      count: row.count,
      color: row.kind === 'element' ? element_colors[row.id] : row.kind === 'protector' ? '#65c993' : undefined,
      section,
      indent: Boolean(row.parent),
    })
  })
const mob_types_for_filter = (
  filter: string | null,
  rows: ReturnType<typeof mob_filter_rows>
): ReadonlySet<string> | null => {
  if (!filter) return null
  const selected = rows.find((row) => `${row.kind}:${row.id}` === filter)
  return new Set(selected?.mob_types ?? [])
}
const resource_filter_colors: Readonly<Record<string, string>> = Object.freeze({
  pet_food: '#ef8bbd',
  gatherable: '#4a9eff',
  intermediary: '#b584e8',
  raw: '#9a795d',
})
const item_filter_color = ({ kind, id }: ItemFilterRow): string | undefined => {
  if (kind === 'category') return item_category_colors[id]
  if (kind === 'resource') return resource_filter_colors[id]
  if (kind === 'craft') return '#65c993'
  if (kind === 'gather') return '#4a9eff'
  return '#e8b44f'
}
const item_facet_options = (rows: readonly ItemFilterRow[]): readonly FacetOption[] =>
  rows.map((row, index) =>
    Object.freeze({
      ...item_filter_view(row, rows[index - 1]?.kind),
      color: item_filter_color(row),
      count: row.count,
    })
  )
const content_gate = (status: SeedEditorStatus): Readonly<{ class_name: string; message: string }> | null => {
  if (status === 'loading' || status === 'idle')
    return Object.freeze({
      class_name: 'grid flex-1 place-items-center text-[9px] tracking-[0.18em] text-[#c8963c] uppercase',
      message: 'Loading seed files…',
    })
  if (status === 'unavailable')
    return Object.freeze({
      class_name: 'grid flex-1 place-items-center p-8 text-center text-[10px] leading-6 text-[#777b86]',
      message: 'File editing is available only from the local Vite development server. Production has no write door.',
    })
  return null
}
const result_row_class = (selected: boolean, effectless: boolean): string => {
  if (selected)
    return effectless
      ? 'border-[#4a9eff] bg-amber-400/10 text-amber-100 ring-1 ring-inset ring-amber-400/30'
      : 'border-[#4a9eff] bg-[#4a9eff]/6 text-[#b9d8ff]'
  return effectless
    ? 'border-amber-400/70 bg-amber-400/[0.07] text-amber-200 hover:bg-amber-400/[0.12]'
    : 'border-transparent text-[#969ba7] hover:bg-white/[0.045] hover:text-[#ebe7df]'
}
const is_effectless_spell_row = (domain: string, row: SeedEntityRow): boolean =>
  domain === 'spells' && !spell_row_has_effects(row)
const data_presence = (value: boolean): true | undefined => (value ? true : undefined)
const EffectlessSpellBadge = ({ visible }: Readonly<{ visible: boolean }>) =>
  visible ? (
    <span className="shrink-0 border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[6px] font-semibold tracking-[0.1em] text-amber-300 uppercase">
      No effects
    </span>
  ) : null
const draft_value = (files: SeedEditorState['files'], domain: SeedDomain): JsonValue | undefined => files[domain]?.value
const acquisition_from_drafts = (
  files: SeedEditorState['files'],
  item_type: string | undefined
): AcquisitionEstimate | undefined => {
  const items = draft_value(files, 'items')
  const recipes = draft_value(files, 'recipes')
  const mobs = draft_value(files, 'mobs')
  const worlds = draft_value(files, 'worlds')
  const dungeons = draft_value(files, 'dungeons')
  const spells = draft_value(files, 'spells')
  if (!item_type || ![items, recipes, mobs, worlds, dungeons, spells].every(Array.isArray)) return undefined
  return item_acquisition(
    {
      items: items as unknown as AcquisitionContent['items'],
      recipes: recipes as unknown as AcquisitionContent['recipes'],
      mobs: mobs as unknown as AcquisitionContent['mobs'],
      worlds: worlds as unknown as AcquisitionContent['worlds'],
      dungeons: dungeons as unknown as AcquisitionContent['dungeons'],
      spells: spells as unknown as NonNullable<AcquisitionContent['spells']>,
    },
    item_type
  )
}
const selected_item_identity = (domain: SeedDomain, selected: SeedEntityRow | undefined): string | undefined =>
  domain === 'items' ? selected?.id : undefined
export const ContentPage = () => {
  const editor = useAppStore((state) => state.editor)
  const [item_filter, set_item_filter] = useState<string | null>(null)
  const [mob_filter, set_mob_filter] = useState<string | null>(null)
  const [drag_from, set_drag_from] = useState<number | null>(null)
  const [drag_over, set_drag_over] = useState<number | null>(null)
  const [validation_kind, set_validation_kind] = useState<ValidationKind>(null)
  const file = editor.files[editor.domain]
  const rows = useMemo(
    () => order_content_rows(editor.domain, file ? entity_rows(editor.domain, file.value) : []),
    [editor.domain, file]
  )
  const { spell_classe, select_domain, select_row, select_spell_classe } = useContentEditorRoute(
    editor.domain,
    editor.entity_id,
    rows
  )
  const recipe_rows = useMemo(
    () => (editor.files.recipes ? entity_rows('recipes', editor.files.recipes.value) : []),
    [editor.files.recipes]
  )
  const world_rows = useMemo(
    () => (editor.files.worlds ? entity_rows('worlds', editor.files.worlds.value) : []),
    [editor.files.worlds]
  )
  const item_mob_rows = useMemo(
    () => (editor.files.mobs ? entity_rows('mobs', editor.files.mobs.value) : []),
    [editor.files.mobs]
  )
  const item_filters = useMemo(
    () => (editor.domain === 'items' ? item_filter_rows(rows, recipe_rows, item_mob_rows, world_rows) : []),
    [editor.domain, item_mob_rows, recipe_rows, rows, world_rows]
  )
  const mob_facets = useMemo(
    () => (editor.domain === 'mobs' ? mob_filter_rows(rows, world_rows) : []),
    [editor.domain, rows, world_rows]
  )
  const classes = useMemo(() => (editor.domain === 'spells' ? spell_class_rows(rows) : []), [editor.domain, rows])
  const selected_item_types = useMemo(
    () => item_types_for_filter(item_filter, item_filters),
    [item_filter, item_filters]
  )
  const selected_mob_types = useMemo(() => mob_types_for_filter(mob_filter, mob_facets), [mob_facets, mob_filter])
  const filtered = useMemo(
    () =>
      filter_content_rows(
        rows,
        editor.query,
        content_category_for_filter(editor.domain, item_filter),
        editor.domain === 'spells' ? spell_classe : null,
        content_types_for_domain(editor.domain, selected_item_types, selected_mob_types)
      ),
    [editor.domain, editor.query, item_filter, selected_item_types, selected_mob_types, spell_classe, rows]
  )
  const selected = find_selected_row(filtered, editor.entity_id) ?? filtered[0]
  const selected_item_type = selected_item_identity(editor.domain, selected)
  const acquisition = useMemo(
    () => acquisition_from_drafts(editor.files, selected_item_type),
    [editor.files, selected_item_type]
  )
  const gate = content_gate(editor.status)
  if (gate) return <div className={gate.class_name}>{gate.message}</div>
  if (!file)
    return (
      <div className="grid flex-1 place-items-center text-[10px] text-[#ff8caa]">
        {editor.error ?? 'Seed files unavailable'}
      </div>
    )
  const replace = (relative_path: JsonPath, value: JsonValue): void => {
    if (!selected) return
    if (is_readonly_seed_path(editor.domain, relative_path)) return
    const selected_address = row_address(selected)
    if (editor.entity_id !== selected_address)
      dispatch_app({ type: 'editor/entity_selected', entity_id: selected_address })
    dispatch_app({
      type: 'editor/value_changed',
      domain: editor.domain,
      path: Object.freeze([...selected.path, ...relative_path]),
      value,
    })
  }
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
  }
  const selected_asset = selected ? entity_asset_reference(editor.domain, selected.value) : null
  const item_recipe = item_recipe_binding(
    editor.domain === 'items' ? selected : undefined,
    editor.files.recipes,
    acquisition
  )
  return (
    <div
      className={`grid min-h-0 flex-1 overflow-hidden bg-bg ${content_page_columns(editor.domain)}`}
      data-content-editor-shell=""
    >
      <nav className="overflow-y-auto border-r border-white/10 bg-surface-low py-3">
        {content_navigation_domains.map((domain) => {
          const domain_file = editor.files[domain.id]
          const count = domain_file ? entity_rows(domain.id, domain_file.value).length : 0
          const DomainIcon = content_domain_icon(domain.id)
          return (
            <button
              className={`flex w-full items-center justify-between border-l-2 px-3 py-2.5 text-left text-[9px] uppercase ${
                editor.domain === domain.id
                  ? 'border-[#c8963c] bg-[#c8963c]/7 text-[#c8963c]'
                  : 'border-transparent text-[#858b98] hover:bg-white/[0.045] hover:text-[#e6e2da]'
              }`}
              key={domain.id}
              onClick={() => select_domain(domain.id)}
              type="button"
            >
              <span className="flex items-center gap-2">
                <DomainIcon size={12} strokeWidth={1.5} />
                {domain.label}
              </span>
              <span className={domain_file?.dirty ? 'text-[#ffca57]' : 'text-[#6d7382]'}>
                {domain_file?.dirty ? '●' : count}
              </span>
            </button>
          )
        })}
      </nav>
      {editor.domain === 'items' && (
        <FacetRail
          all_label="All items"
          on_select={(value) => {
            set_item_filter(value)
            dispatch_app({ type: 'editor/entity_selected', entity_id: null })
          }}
          options={item_facet_options(item_filters)}
          selected={item_filter}
          total={rows.length}
        />
      )}
      {editor.domain === 'spells' && (
        <FacetRail
          all_label="All spells"
          on_select={select_spell_classe}
          options={classes.map(({ classe, count }) => ({ count, label: classe.toUpperCase(), value: classe }))}
          selected={spell_classe}
          total={rows.length}
        />
      )}
      {editor.domain === 'mobs' && (
        <FacetRail
          all_label="All mobs"
          on_select={(value) => {
            set_mob_filter(value)
            dispatch_app({ type: 'editor/entity_selected', entity_id: null })
          }}
          options={mob_facet_options(mob_facets)}
          selected={mob_filter}
          total={rows.length}
        />
      )}
      <aside className="flex min-h-0 flex-col border-r border-white/10 bg-surface">
        <div className="border-b border-white/10 bg-surface-high p-3">
          <input
            className="h-8 w-full border border-white/14 bg-bg px-2 text-[9px] text-[#e3dfd7] outline-none focus:border-[#4a9eff]/60"
            onChange={(event) => dispatch_app({ type: 'editor/query_changed', query: event.target.value })}
            placeholder="Search…"
            value={editor.query}
          />
          <div className="mt-2 flex min-h-4 items-center justify-between gap-3">
            <p className="text-[8px] text-[#5f636d]">
              {filtered.length.toLocaleString()} rows
              {ladder_reorder && <span className="text-[#626670]"> · drag to move a spell up the unlock ladder</span>}
            </p>
          </div>
        </div>
        <div
          className={`min-h-0 flex-1 overflow-y-auto py-1 ${
            content_result_columns(editor.domain) === 2 ? 'grid grid-cols-2 content-start' : ''
          }`}
        >
          {filtered.map((row, index) => {
            const active = selected !== undefined && row_address(selected) === row_address(row)
            const effectless = is_effectless_spell_row(editor.domain, row)
            return (
              <button
                className={`flex w-full items-center gap-2 border-l-2 px-2 py-1.5 text-left text-[9px] ${result_row_class(active, effectless)} ${ladder_reorder ? 'cursor-grab active:cursor-grabbing' : ''} ${
                  drag_from === index ? 'opacity-40' : ''
                } ${
                  drag_from !== null && drag_from !== index && drag_over === index
                    ? drag_from < index
                      ? 'shadow-[inset_0_-2px_0_0_#c8963c]'
                      : 'shadow-[inset_0_2px_0_0_#c8963c]'
                    : ''
                }`}
                data-effectless-spell={data_presence(effectless)}
                draggable={ladder_reorder}
                key={row_address(row)}
                onClick={() => select_row(row)}
                onDragEnd={() => {
                  set_drag_from(null)
                  set_drag_over(null)
                }}
                onDragOver={(event) => {
                  if (drag_from === null) return
                  event.preventDefault()
                  set_drag_over(index)
                }}
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
                <EffectlessSpellBadge visible={effectless} />
                {content_row_level_label(editor.domain, row) !== null && (
                  <span className="shrink-0 text-[7px] text-[#626670] uppercase">
                    {content_row_level_label(editor.domain, row)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </aside>
      <main className="min-h-0 overflow-y-auto bg-surface-high p-4">
        <header className="sticky top-0 z-[2] -mx-4 -mt-4 mb-4 flex items-center justify-between gap-3 border-b border-white/12 bg-surface-raised/96 px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.16)] backdrop-blur-lg">
          <div className="flex min-w-0 items-center gap-3">
            {selected && <EntityIcon detail reference={selected_asset} />}
            <div className="min-w-0">
              <p className="truncate text-[11px] text-[#e8e4dc]">{selected?.label ?? 'No row selected'}</p>
              <p className="mt-1 text-[8px] tracking-[0.12em] text-[#626670] uppercase">{file.file}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ValidationCounters active={validation_kind} report={editor.validation} select={set_validation_kind} />
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
        <div className="mb-4 h-[68px] shrink-0" data-editor-error-lane="">
          <ValidationPanel active={validation_kind} error={editor.error} report={editor.validation} />
        </div>
        {selected && (
          <div className="space-y-4">
            {editor.domain === 'spells' ? (
              <SpellAutosaveBoundary>
                <SpellCard
                  edit={
                    editor.status === 'ready'
                      ? {
                          change: replace,
                          save: () => undefined,
                        }
                      : undefined
                  }
                  key={row_address(selected)}
                  spell={selected.value as unknown as SeedSpell}
                />
              </SpellAutosaveBoundary>
            ) : (
              <ContentEntityEditor
                domain={editor.domain}
                is_readonly={(path) => is_readonly_seed_path(editor.domain, path)}
                key={row_address(selected)}
                mob_templates={editor.domain === 'mobs' && Array.isArray(file.value) ? file.value : undefined}
                on_change={replace}
                item_recipe={item_recipe}
                item_filters={item_filters}
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
