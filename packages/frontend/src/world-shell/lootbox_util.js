// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE loot-box helpers — NO imports (so bun:test can import them; the sibling lootbox_actions/BoxReveal drag
// `../auth` → enoki → `window` at load and are unimportable under bun:test, the repo-wide constraint). The ONE
// home for the box detector, receipt suffixes, and reveal timing/dismiss rules; heavy modules use/re-export here.

/** A box is any item whose slug ends `_lootbox`. @param {string|null|undefined} s @returns {boolean} */
export const is_lootbox = (s) => String(s ?? '').endsWith('_lootbox')

/**
 * Resolve a box's ItemTemplate without replacing an exact stamped identity with a lossy item_type join.
 * Rows predating template_id retain the legacy slug lookup; an exact-id miss refuses instead of burning gas
 * against an unrelated same-slug template.
 * @param {{ template_id?: string|null, item_type?: string|null }} item
 * @param {Map<string, any>|null|undefined} templates_by_id
 * @param {Map<string, any>|null|undefined} templates_by_type
 */
export function resolve_box_template(item, templates_by_id, templates_by_type) {
  if (item?.template_id) return templates_by_id?.get(String(item.template_id)) ?? null
  return templates_by_type?.get(String(item?.item_type ?? '')) ?? null
}

/** The animated phase order after `pending` (a skip / reduced-motion jumps straight to reveal). */
export const ANIM_SEQUENCE = /** @type {const} */ (['charging', 'burst', 'reveal'])

// Pending is bounded below the 60s finality poll. Escape is deliberately delayed so an accidental key press cannot
// hide the wallet flow immediately; closing only dismisses the UI and never retries/cancels an executed transaction.
export const PENDING_ESCAPE_MS = 10_000
export const PENDING_TIMEOUT_MS = 45_000

const LOOT_BOX_OPENED_SUFFIX = '::loot_box::LootBoxOpened'
const PET_BOX_CLAIM_SUFFIX = '::loot_box::PetBoxClaim'

/** Next animated phase after `phase`, or null at the end (the reveal is terminal). @param {string} phase */
export const next_anim_phase = (phase) => {
  const i = ANIM_SEQUENCE.indexOf(/** @type {any} */ (phase))
  return i >= 0 && i < ANIM_SEQUENCE.length - 1 ? ANIM_SEQUENCE[i + 1] : null
}

/** Whether Escape / the backdrop may dismiss the current phase. The reveal ALWAYS dismisses — the claim is
 * automatic and durable (D3), so a collecting flight continues in the background to its one outcome toast;
 * holding the player on a spinner was the dead-end. `resolving` (post-burst, awaiting the pet read) is dismissible
 * too — a hung resolve must never trap the player (no dead-end). Pending arms after the escape delay; the
 * animation is skip-only (it is already the post-confirm celebration). */
export const can_dismiss_reveal = (/** @type {string} */ phase, /** @type {boolean} */ pending_escape_ready) =>
  phase === 'reveal' || phase === 'resolving' || (phase === 'pending' && pending_escape_ready)

/**
 * The stage's honest next state once the celebration ends (UX-A). Both ready ⇒ `reveal`; the animation finished
 * but the pet read still outstanding ⇒ `resolving` (an honest shimmer, NEVER the frozen forwards-filled burst
 * tail that read as blank); animation not done ⇒ hold (`null`). Keyed off refs in the container; pure here so
 * bun:test can prove the reads-slower-than-anim case gives a non-blank state.
 * @param {boolean} anim_done @param {boolean} pet_present @returns {'reveal'|'resolving'|null}
 */
export const reveal_after_celebration = (anim_done, pet_present) =>
  !anim_done ? null : pet_present ? 'reveal' : 'resolving'

/**
 * Whether the pending force-close guard (the 45s open-timeout + the escape-arm) is active (UX-B). It guards ONLY
 * the wait for the RECEIPT: the instant the receipt lands the phase leaves `pending` (→ charging / resolving),
 * this goes false, and the edge effect keyed on it clears the timer — a slow resolve/claim AFTER the win the
 * player already watched can never raise a false "timed out". One-pipeline shape: timer = effect keyed to state.
 * @param {string} phase @returns {boolean}
 */
export const open_timeout_armed = (phase) => phase === 'pending'

/**
 * Collect ONE claim under the honest-toast law (correctness): the success/failure VERDICT — which `settle` and
 * which toast — keys ONLY on the claim tx. The display-name read is cosmetic; its failure degrades the name to
 * the raw id and NEVER flips the verdict or re-latches an already-succeeded claim. Pure over injected effects so
 * bun:test can drive the throwing-display-read case (the module itself drags `../auth`→window, unimportable here).
 * @param {{ claim_id:string, rolled_template:string }} claim
 * @param {{ do_claim:(c:{claim_id:string,rolled_template:string})=>Promise<unknown>,
 *   settle:(id:string, outcome:{error?:unknown})=>void,
 *   resolve_name:(c:{rolled_template:string})=>Promise<string>,
 *   toast_ok:(name:string)=>void, toast_err:(error:unknown)=>void }} fx
 * @returns {Promise<boolean>} whether the claim was collected
 */
export async function collect_one_claim({ claim_id, rolled_template }, fx) {
  try {
    await fx.do_claim({ claim_id, rolled_template })
    fx.settle(claim_id, {})
  } catch (error) {
    fx.settle(claim_id, { error })
    fx.toast_err(error)
    return false
  }
  // COLLECTED — from here nothing may flip the verdict. A cosmetic name read that throws degrades to the raw id.
  let name
  try {
    name = await fx.resolve_name({ rolled_template })
  } catch {
    name = String(rolled_template).replace(/_/g, ' ')
  }
  fx.toast_ok(name)
  return true
}

/** Parse the truthful roll + soulbound claim from the normalized open_box receipt. */
export function parse_open_box_receipt(/** @type {any} */ result) {
  const event = (result?.events ?? []).find((/** @type {any} */ entry) =>
    String(entry?.type ?? '').endsWith(LOOT_BOX_OPENED_SUFFIX)
  )
  const claim = (result?.objectChanges ?? []).find(
    (/** @type {any} */ change) =>
      change?.type === 'created' && String(change?.objectType ?? '').endsWith(PET_BOX_CLAIM_SUFFIX)
  )
  return {
    rolled_template: event?.parsedJson?.rolled_template != null ? String(event.parsedJson.rolled_template) : null,
    claim_id: claim?.objectId != null ? String(claim.objectId) : null,
  }
}
