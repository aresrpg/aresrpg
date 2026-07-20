// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/**
 * Select the ItemTemplate row for one owned item. New `/v1/owner-items` rows carry the exact stamped template id;
 * never fall back to the lossy slug map when that identity is present. Legacy chain-read rows have no template id
 * and retain the item_type fallback.
 *
 * @param {{ template_id?: string|null, item_type?: string }} item
 * @param {Map<string, any>|null|undefined} by_id
 * @param {Map<string, any>|null|undefined} by_type
 * @returns {any|null}
 */
export function resolve_crush_template(item, by_id, by_type) {
  const template_id = String(item?.template_id ?? '')
  if (template_id) return by_id?.get(template_id) ?? null
  return by_type?.get(item?.item_type) ?? null
}
