// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * Join live ItemTemplate ids to authored render slugs through the template name that survives a republish.
 * The authored name→slug catalog is injected by a composition root; fight-path modules stay virtual-free.
 * @param {Map<string, { name?: string | null }>} template_map
 * @param {Readonly<Record<string, string>>} slug_by_name
 * @returns {Record<string, string>}
 */
export const slug_by_template_id_from = (template_map, slug_by_name) =>
  Object.fromEntries(
    [...template_map].flatMap(([template_id, template]) => {
      const slug = template?.name ? slug_by_name[template.name] : undefined
      return slug ? [[String(template_id), slug]] : []
    })
  )
