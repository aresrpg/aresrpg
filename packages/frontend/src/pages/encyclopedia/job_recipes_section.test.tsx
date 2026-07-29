// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST for #1670: the FARMER / HERBALIST / MINER encyclopedia pages rendered ZERO recipes — the jobs
// tab only ever drew a flat RELATED ITEMS list, so a player could not discover how flours/powders/blends
// are crafted even though `/v1/encyclopedia?kind=recipes` had been serving those rows since the 07-29
// re-jobbing (95 recipe heals + 36 re-jobs). The read path was never stale: this section projects the SAME
// live rows through the ONE home (craft_recipes_for_job), so a gathering job's recipes appear the moment
// the chain says `required_job` is that job.
// Render idiom: pet_food_section.test.tsx — real EN i18n, real markup, no DOM library, no RPC.
import { expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../i18n/locales/en.json'

import { JobRecipesSection } from './job_recipes_section'

const EN_I18N = i18next.createInstance()
EN_I18N.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const FARMER = 0
const BAKER = 13

// Shaped exactly like the /v1 rows (rpc/views.ts RpcRecipe / RpcEncyclopediaItem): a farmer flour craft
// (gathered wheat -> flour, the #1670 acceptance case) plus a baker recipe that must never leak in.
const WHEAT = {
  template_id: '0xtpl_wheat',
  item_type: 'wheat',
  name: 'Wheat',
  description: null,
  level: 1,
  category: 'resource',
  supply: 0,
  last_sale_mist: null,
}
const FLOUR = {
  template_id: '0xtpl_wheat_flour',
  item_type: 'wheat_flour',
  name: 'Wheat Flour',
  description: null,
  level: 4,
  category: 'resource',
  supply: 0,
  last_sale_mist: null,
}
const BREAD = {
  template_id: '0xtpl_barley_bread',
  item_type: 'barley_bread',
  name: 'Barley Bread',
  description: null,
  level: 6,
  category: 'consumable',
  supply: 0,
  last_sale_mist: null,
}
const FLOUR_RECIPE = {
  recipe_id: '0xrecipe_wheat_flour',
  output_template_id: FLOUR.template_id,
  output_quantity: 2,
  required_job: FARMER,
  required_level: 5,
  craft_xp: 42,
  inputs: [{ template_id: WHEAT.template_id, quantity: 3 }],
}
const BREAD_RECIPE = {
  recipe_id: '0xrecipe_barley_bread',
  output_template_id: BREAD.template_id,
  output_quantity: 1,
  required_job: BAKER,
  required_level: 8,
  craft_xp: 60,
  inputs: [{ template_id: FLOUR.template_id, quantity: 1 }],
}

const render = (job_index: number) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={EN_I18N}>
      <JobRecipesSection
        recipes={[FLOUR_RECIPE, BREAD_RECIPE]}
        items={[WHEAT, FLOUR, BREAD]}
        job_index={job_index}
        on_navigate_to_item={() => {}}
      />
    </I18nextProvider>
  )

test('a GATHERING job (farmer) shows its own crafts — output, chain gate, xp and the bill of materials', () => {
  const html = render(FARMER)
  expect(html).toContain('RECIPES')
  expect(html).toContain(`data-job-recipe="${FLOUR_RECIPE.recipe_id}"`)
  expect(html).toContain('Wheat Flour')
  // the bill of materials, verbatim chain quantities — this is the "how is flour crafted" answer
  expect(html).toContain('×3')
  expect(html).toContain('Wheat<')
  // the chain's own gates ride along: knowledge level, craft xp, and the >1 output quantity
  expect(html).toContain('Req. Lv. 5')
  expect(html).toContain('+42 XP')
  expect(html).toContain('×2')
  // another job's recipe never leaks onto this page
  expect(html).not.toContain('Barley Bread')
})

test('recipes lay out MULTI-COLUMN (the single-column list wasted the page)', () => {
  expect(render(FARMER)).toContain('repeat(auto-fill, minmax(210px, 1fr))')
})

test('a job with no live recipe renders nothing — the honest gap, never an empty shell', () => {
  expect(render(9 /* tailor: no recipe in this corpus */)).toBe('')
})
