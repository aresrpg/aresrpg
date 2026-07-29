// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Which sub-tabs a Jobs-drawer detail offers, and which one is actually showing. Pure — the drawer only
// renders the answer.
//
// A GATHERING job has BOTH: its resource ladder (what it harvests) and its recipes (what it crafts from
// them — the farmer's flours, the miner's powders, the herbalist's blends). The drawer used to hard-coerce
// a gathering job back to the ladder, which hid those crafts everywhere in game (#1670) even though the
// projection behind them (craft_recipes_for_job over the live /v1 read) already had the rows. A craft job
// harvests nothing, so it has recipes only.

/** @param {boolean} is_gathering @returns {('resources' | 'recipes')[]} the job's tabs, natural default first */
export const job_subtabs = is_gathering => (is_gathering ? ['resources', 'recipes'] : ['recipes'])

/** The showing tab: the selection when the job has it, otherwise the job's natural default. */
export const effective_job_tab = (is_gathering, tab) => {
  const tabs = job_subtabs(is_gathering)
  return tabs.includes(tab) ? tab : tabs[0]
}
