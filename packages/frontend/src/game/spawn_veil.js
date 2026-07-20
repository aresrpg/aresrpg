// IN-FIGHT VEIL — hide EVERY roam population while a world fight is mounted, then hand them all back on the flip.
// Fixes: other mobs must not be visible during a fight (2026-07-15), reconciled with the earlier requirement to
// release mobs back after a fight so they're visible again (2026-07-13): the rigs STAY resident + roaming under the tactical board so
// the post-fight world is instantly alive — only their VISUALS hide for the fight's duration. world_spawns.js
// drives this on the edge-detected fight-mount flip; idempotent, so an unveil restores exactly what a veil hid.
//
// KIND-AGNOSTIC BY LAW (a gatherable resource used to float above the fight board): a mob group (its
// member rigs) and a gatherable node (its billboard mesh) are the SAME masked population — the mask hides both.
// Exempting the node is exactly the bug that floated wheat/ore stands + their name chips above the board; the
// general mask now covers it with no gatherable special case. The engaged group is already hidden by its own
// optimistic fight-entry beat, so it stays hidden here too.
//
// Pure over the entry SHAPE (members[].rig.root.visible · mesh.visible · chip.style.display) — no three, no
// engine, no DOM — so the mask contract unit-tests headless (spawn_veil.test.js).

/**
 * @param {Iterable<{ engaged?: boolean,
 *   members?: ({ rig?: { root: { visible: boolean } } | null })[],
 *   mesh?: { visible: boolean } | null, chip?: { style: { display: string } } | null }>} entries
 * @param {boolean} fight_veiled
 */
export function apply_veil(entries, fight_veiled) {
  for (const e of entries) {
    const show = !fight_veiled && !e.engaged
    for (const mem of e.members ?? []) if (mem.rig) mem.rig.root.visible = show
    if (e.mesh) e.mesh.visible = show
    if (e.chip) e.chip.style.display = show ? '' : 'none'
  }
}
