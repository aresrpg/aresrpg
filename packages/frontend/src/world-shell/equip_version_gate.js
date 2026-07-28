// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/**
 * Keep the on-chain template-identity gate exact. `item_type` is deliberately non-unique (all cosmetic
 * cloaks use `cloak`), so only the freshly-read Item's stamped template id may cross into equip_ptb — an
 * item that carries none refuses HONESTLY here, before any transaction is built.
 *
 * WHICH template ids are alive is NOT this gate's call (#1467). `equipment::equip` already compares the
 * Item's stamped template id against the &ItemTemplate exactly, and run_tx dry-runs before it signs, so a
 * genuinely retired template refuses at simulate for zero gas — the chain is the gate. The client used to
 * pre-refuse against the BUILD-TIME seed receipt, which is frozen into the deployed bundle: one republish
 * outrunning one redeploy turned that into "you cannot equip anything", refusing live items the chain would
 * have accepted. A redundant client fence that can only produce FALSE refusals is not a safety net.
 *
 * @param {{item_id:string, slot:string, item_type:string, item_template_id?:string|null}[]} rows
 */
export function resolve_equip_templates(rows) {
  const resolved = []
  const unresolved = []
  for (const row of rows) {
    const item_template_id = String(row.item_template_id ?? '')
    if (!item_template_id) unresolved.push(row)
    else resolved.push({ ...row, item_template_id })
  }
  return { resolved, unresolved }
}
