import { is_living_item } from '../pages/encyclopedia/living_corpus'

/**
 * Keep the on-chain template-identity gate exact. `item_type` is deliberately non-unique (all cosmetic
 * cloaks use `cloak`), so only the freshly-read Item's stamped template id may cross into equip_ptb.
 * Previous-generation ids remain refused by the current living-id ledger.
 * @param {{item_id:string, slot:string, item_type:string, item_template_id?:string|null}[]} rows
 */
export function resolve_equip_templates(rows) {
  const resolved = []
  const unresolved = []
  const stale = []
  for (const row of rows) {
    const item_template_id = String(row.item_template_id ?? '')
    if (!item_template_id) unresolved.push(row)
    else if (!is_living_item({ template_id: item_template_id })) stale.push(row)
    else resolved.push({ ...row, item_template_id })
  }
  return { resolved, unresolved, stale }
}
