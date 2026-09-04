// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_groups, type JobSlug } from '@aresrpg/immutable'

import { encyclopedia_catalog, type ItemDetail, type SeedRecipe } from '../content/catalog.ts'
import { encyclopedia_item_path } from '../encyclopedia/routes.ts'

const ALL_JOBS = Object.freeze(Object.values(job_groups).flat())

export type IngredientSelection = Readonly<{ item_type: string; recipe: SeedRecipe | null }>
export type IngredientDestination = Readonly<{
  kind: 'craft' | 'encyclopedia'
  pathname: string
  job: JobSlug | null
  selection: IngredientSelection | null
}>

const valid_job = (job: string | undefined): JobSlug | null =>
  job && ALL_JOBS.includes(job as JobSlug) ? (job as JobSlug) : null

const is_craftable_resource = (detail: ItemDetail | null, has_recipe: boolean): boolean =>
  detail?.item.category === 'resource' && has_recipe

export const job_from_path = (pathname: string): JobSlug => {
  const selected = new URLSearchParams(pathname.split('?')[1]?.split('#')[0] ?? '').get('job')
  return selected && ALL_JOBS.includes(selected as JobSlug) ? (selected as JobSlug) : 'FARMER'
}

export const job_path = (job: JobSlug): string => `/characters/jobs?job=${encodeURIComponent(job)}`

export const ingredient_destination = (item_type: string): IngredientDestination => {
  const detail = encyclopedia_catalog.item(item_type)
  const recipe = encyclopedia_catalog.recipes.find(({ output_type }) => output_type === item_type)
  const craft_job = valid_job(detail?.recipe?.job)
  return is_craftable_resource(detail, recipe !== undefined) && recipe && craft_job
    ? Object.freeze({
        kind: 'craft',
        pathname: job_path(craft_job),
        job: craft_job,
        selection: Object.freeze({ item_type, recipe }),
      })
    : Object.freeze({
        kind: 'encyclopedia',
        pathname: encyclopedia_item_path(item_type),
        job: null,
        selection: null,
      })
}
