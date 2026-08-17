// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { craft_job_of, craft_xp_from_ingredient_count, job_slugs } from '@aresrpg/immutable'

import {
  as_record,
  button_class,
  FieldLabel,
  SelectField,
  SheetSection,
  string_value,
  titleize_field,
} from './ContentFields.tsx'
import { ItemReferencePicker } from './ItemReferencePicker.tsx'
import type { JsonPath, JsonValue } from './seed_editor.ts'

export type ItemRecipeBinding = Readonly<{
  value: JsonValue | null
  change: (path: JsonPath, value: JsonValue) => void
  category_changed: (category: string) => void
  create: () => void
  remove: () => void
  reset: () => void
  save: () => void
  dirty: boolean
  file_dirty: boolean
  saving: boolean
}>

export const ItemRecipeEditor = ({ category, recipe }: Readonly<{ category: string; recipe: ItemRecipeBinding }>) => {
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
      <div className="space-y-3" data-item-recipe="">
        <div className="flex flex-wrap items-end gap-3">
          {derived_job ? (
            <div>
              <FieldLabel label="Profession" />
              <div className="grid h-8 min-w-44 place-items-center border border-white/8 bg-white/[0.02] px-3 text-[9px] tracking-[0.1em] text-[#65c993] uppercase">
                {titleize_field(derived_job)}
              </div>
            </div>
          ) : (
            <SelectField
              change={(next) => recipe.change(['job'], next)}
              label="Profession"
              options={job_slugs}
              value={string_value(value.job)}
            />
          )}
          <div className="border border-[#4a9eff]/25 bg-[#4a9eff]/5 px-3 py-2">
            <p className="text-[7px] tracking-[0.12em] text-[#737883] uppercase">Craft XP</p>
            <p className="mt-1 text-[10px] tabular-nums text-[#67adff]">
              {craft_xp_from_ingredient_count(ingredients.length).toLocaleString()}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              className={button_class}
              disabled={!recipe.dirty || recipe.saving}
              onClick={recipe.reset}
              type="button"
            >
              Reset recipe
            </button>
            <button
              className={button_class}
              disabled={!recipe.file_dirty || recipe.saving}
              onClick={recipe.save}
              type="button"
            >
              {recipe.saving ? 'Saving…' : 'Save recipes.json'}
            </button>
            <button className={button_class} disabled={recipe.saving} onClick={recipe.remove} type="button">
              Remove recipe
            </button>
          </div>
        </div>
        <div className="grid gap-2 xl:grid-cols-2">
          {ingredients.map(([item_type, quantity]) => (
            <div className="flex min-w-0 items-center gap-2" key={item_type}>
              <ItemReferencePicker
                class_name="min-w-0 flex-1"
                excluded={new Set(ingredients.map(([type]) => type).filter((type) => type !== item_type))}
                label="ingredient"
                select={(next_type) =>
                  replace_ingredient(item_type, next_type, typeof quantity === 'number' ? quantity : 1)
                }
                value={item_type}
              />
              <input
                aria-label={`${item_type} quantity`}
                className="h-10 w-16 border border-white/10 bg-[#090a10] px-2 text-right text-[10px] tabular-nums outline-none focus:border-[#4a9eff]/60"
                min={1}
                onChange={(event) => replace_ingredient(item_type, item_type, Number(event.target.value))}
                type="number"
                value={typeof quantity === 'number' ? quantity : 1}
              />
              <button className={button_class} onClick={() => remove_ingredient(item_type)} type="button">
                Remove
              </button>
            </div>
          ))}
        </div>
        <ItemReferencePicker
          excluded={new Set(ingredients.map(([item_type]) => item_type))}
          label="ingredient"
          select={(item_type) => recipe.change(['inputs'], Object.freeze({ ...inputs, [item_type]: 1 }))}
          value=""
        />
      </div>
    </SheetSection>
  )
}
