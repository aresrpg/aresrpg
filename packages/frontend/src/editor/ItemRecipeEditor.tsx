// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  craft_job_of,
  craft_max_ingredients,
  craft_required_level,
  craft_xp_from_ingredient_count,
  job_slugs,
} from '@aresrpg/immutable'
import { Minus, Plus, X } from 'lucide-react'

import { as_record, button_class, SheetSection, string_value, titleize_field } from './ContentFields.tsx'
import { ItemReferencePicker } from './ItemReferencePicker.tsx'
import type { ItemReferenceFilterRow } from './content_list.ts'
import type { JsonPath, JsonValue } from './seed_editor.ts'

export type ItemRecipeBinding = Readonly<{
  value: JsonValue | null
  change: (path: JsonPath, value: JsonValue) => void
  category_changed: (category: string) => void
  create: () => void
  remove: () => void
}>

const icon_button =
  'grid size-7 shrink-0 cursor-pointer place-items-center text-[#737985] transition hover:text-[#d8d3ca] disabled:cursor-not-allowed disabled:opacity-20'

export const ItemRecipeEditor = ({
  category,
  recipe,
  filter_rows,
}: Readonly<{
  category: string
  recipe: ItemRecipeBinding
  filter_rows?: readonly ItemReferenceFilterRow[]
}>) => {
  const value = as_record(recipe.value ?? undefined)
  if (!value)
    return (
      <SheetSection accent="#65c993" note="Recipes remain authored in recipes.json." title="Recipe">
        <button className={button_class} onClick={recipe.create} type="button">
          + Add recipe
        </button>
      </SheetSection>
    )

  const inputs = as_record(value.inputs) ?? Object.freeze({})
  const ingredients = Object.entries(inputs)
  const derived_job = craft_job_of(category)
  const job = derived_job ?? string_value(value.job)
  const required_level = craft_required_level(ingredients.length)
  const excluded_types = (except = ''): ReadonlySet<string> =>
    new Set(ingredients.map(([item_type]) => item_type).filter((item_type) => item_type !== except))
  const replace_ingredient = (current_type: string, next_type: string, amount: number): void =>
    recipe.change(
      ['inputs'],
      Object.freeze(
        Object.fromEntries(
          ingredients.flatMap(([item_type, quantity]) =>
            item_type === current_type ? [[next_type, amount]] : [[item_type, quantity]]
          )
        )
      ) as Readonly<Record<string, JsonValue>>
    )
  const remove_ingredient = (removed_type: string): void =>
    recipe.change(
      ['inputs'],
      Object.freeze(Object.fromEntries(ingredients.filter(([item_type]) => item_type !== removed_type))) as Readonly<
        Record<string, JsonValue>
      >
    )

  return (
    <SheetSection accent="#65c993" note="This separate recipes.json row produces the current item." title="Recipe">
      <div className="space-y-2" data-item-recipe="">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/9 pb-3 text-[8px]">
          {derived_job ? (
            <span className="tracking-[0.12em] text-[#65c993] uppercase">{titleize_field(derived_job)}</span>
          ) : (
            <label className="flex items-center gap-2">
              <span className="tracking-[0.12em] text-[#737883] uppercase">Profession</span>
              <select
                aria-label="Profession"
                className="border-b border-white/15 bg-transparent py-1 text-[9px] text-[#d8d3ca] outline-none focus:border-[#65c993]/60"
                onChange={(event) => recipe.change(['job'], event.target.value)}
                value={job}
              >
                {!job_slugs.includes(job as (typeof job_slugs)[number]) && <option value={job}>{job || 'None'}</option>}
                {job_slugs.map((option) => (
                  <option className="bg-[#090a10]" key={option} value={option}>
                    {titleize_field(option)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="text-[#8a909b]">
            Requires{' '}
            <strong className="font-normal text-[#d8c17d]">
              {titleize_field(job)} Lv. {required_level}
            </strong>
          </span>
          <span className="text-[#737985]">
            Craft XP{' '}
            <strong className="font-normal text-[#67adff]">
              {craft_xp_from_ingredient_count(ingredients.length).toLocaleString()}
            </strong>
          </span>
          <span className="text-[#737985]">
            {ingredients.length} / {craft_max_ingredients} ingredients
          </span>
          <button
            aria-label="Remove recipe"
            className="ml-auto grid size-7 cursor-pointer place-items-center text-[#9a5367] transition hover:text-[#ff6f98]"
            onClick={recipe.remove}
            title="Remove recipe"
            type="button"
          >
            <X size={14} strokeWidth={1.7} />
          </button>
        </div>

        <div>
          {ingredients.map(([item_type, quantity], index) => {
            const amount = typeof quantity === 'number' ? quantity : 1
            return (
              <div
                className="group flex min-w-0 items-center border-b border-white/7 transition-colors hover:bg-white/[0.015]"
                data-recipe-ingredient-row=""
                key={item_type}
              >
                <span className="w-7 shrink-0 text-center text-[7px] tabular-nums text-[#4f5560]">{index + 1}</span>
                <ItemReferencePicker
                  class_name="flex-1 !h-12 !border-0 !bg-transparent !px-1 hover:!border-0"
                  excluded={excluded_types(item_type)}
                  filter_rows={filter_rows}
                  label="ingredient"
                  select={(next_type) => replace_ingredient(item_type, next_type, amount)}
                  value={item_type}
                />
                <span className="w-20 shrink-0 text-right text-[7px] tracking-[0.08em] text-[#666d78] uppercase">
                  Job Lv. {craft_required_level(index + 1)}
                </span>
                <div className="ml-3 flex shrink-0 items-center" aria-label={`${item_type} quantity`}>
                  <button
                    aria-label="Decrease ingredient quantity"
                    className={icon_button}
                    disabled={amount <= 1}
                    onClick={() => replace_ingredient(item_type, item_type, Math.max(1, amount - 1))}
                    type="button"
                  >
                    <Minus size={12} strokeWidth={1.5} />
                  </button>
                  <span className="w-10 text-center text-[10px] tabular-nums text-[#d8d3ca]">×{amount}</span>
                  <button
                    aria-label="Increase ingredient quantity"
                    className={icon_button}
                    onClick={() => replace_ingredient(item_type, item_type, amount + 1)}
                    type="button"
                  >
                    <Plus size={12} strokeWidth={1.5} />
                  </button>
                </div>
                <button
                  aria-label="Remove ingredient"
                  className="ml-2 grid size-8 shrink-0 cursor-pointer place-items-center text-[#873f55] transition hover:text-[#ff5a8b]"
                  onClick={() => remove_ingredient(item_type)}
                  title="Remove ingredient"
                  type="button"
                >
                  <X size={13} strokeWidth={1.7} />
                </button>
              </div>
            )
          })}

          {ingredients.length < craft_max_ingredients && (
            <div
              className="flex min-w-0 items-center border-b border-dashed border-white/7 text-[#68707b] transition-colors hover:bg-white/[0.015]"
              data-recipe-ingredient-placeholder=""
            >
              <span className="w-7 shrink-0 text-center text-[7px] tabular-nums text-[#414751]">
                {ingredients.length + 1}
              </span>
              <ItemReferencePicker
                class_name="flex-1 !h-12 !border-0 !bg-transparent !px-1 hover:!border-0"
                empty_sublabel={`Next slot · job Lv. ${craft_required_level(ingredients.length + 1)}`}
                excluded={excluded_types()}
                filter_rows={filter_rows}
                label="ingredient"
                placeholder="Add ingredient"
                select={(item_type) => recipe.change(['inputs'], Object.freeze({ ...inputs, [item_type]: 1 }))}
                value=""
              />
            </div>
          )}
        </div>
      </div>
    </SheetSection>
  )
}
