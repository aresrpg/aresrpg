// PROMPT STACK registry (S-18 discovery, DECISIONS 07-09 pick + addendum) — the ONE home for world
// proximity prompts. Sources (dungeon NPC, zone search, gather, ride) REGISTER a prompt when their signal
// is live and CLEAR it when it dies; the PromptStack HUD component renders every live prompt as the shipped
// option-1 pill in a vertical stack: the highest-priority (closest / most-actionable) prompt sits at the
// bottom-center anchor — the exact spot the single [E] pill occupied — and the others stack UPWARD, so the
// anchor never jumps as prompts come and go. Key handling is centralized in the renderer (one keydown
// listener, D154 typing guard), so two sources can never fight over a key silently.
//
// OPTIMISTIC-PENDING: pressing search zone once instantly makes the search zone
// button disappear until reconciled on chain, to avoid pressing twice or thinking it didn't work — every
// press funnels through `trigger_prompt` — when a source's `on_trigger` returns a PROMISE (a tx-firing press),
// the prompt goes PENDING: hidden instantly and single-flight until the promise settles. Re-appearance is then
// pure chain truth — the source either derives the prompt OFF the refreshed state (success) or leaves it
// registered (failure → honest re-arm; the source owns its error toast). ONE shared mechanism for [F]/[G]/[R]/
// any future tx prompt — never a per-button flag. `clear_prompt` deliberately never touches `pending`: sources
// re-register on every dep change, and a mid-flight re-register must not resurface the button; the pending
// lifecycle is exactly the promise's (every seam settles — their error paths are caught internally).
//
// PENDING IS KEYED BY SUBJECT, not by prompt id (a reported vanish bug): a press latches
// `prompt.pending_key ?? prompt.id`, so a source whose prompt spans many subjects (the [F] SEARCH prompt spans
// ZONES) keys each press to its subject (`search:<world>:<zx>:<zy>`) — searching zone A must never suppress
// the button over zone B. A source with one subject (gather node, dungeon door) just omits `pending_key` and
// keeps the old id-latch behavior. Crossing back into a still-pending subject re-hides — same latch, no reset.

import { create } from 'zustand'

/**
 * @typedef {object} WorldPrompt
 * @property {string} id        stable source id ('dungeon' | 'search' | 'gather' | 'attack' | 'ride')
 * @property {string} key       the KeyboardEvent.code suffix rendered on the pill ('E' | 'F' | 'G' | 'R')
 * @property {string} label     the pill copy (already translated by the source)
 * @property {string} [mobile_label] keyless tap copy when the desktop label itself contains a key hint
 * @property {number} priority  higher = more actionable/closer → anchors the bottom row
 * @property {boolean} [busy]   render the honest-block variant (gold→muted), still clickable
 * @property {string} [pending_key] the SUBJECT a press latches (defaults to `id`) — a multi-subject source
 *   (per-zone search) scopes it so one subject's in-flight press never hides the prompt over another
 * @property {() => (void | Promise<unknown>)} on_trigger  fired on key press or pill click; returning a
 *   promise marks the prompt PENDING (hidden + single-flight) until it settles
 */

/** The latch a prompt's press holds while in flight — its subject, defaulting to the source id. */
const pending_key_of = (/** @type {WorldPrompt} */ prompt) => prompt.pending_key ?? prompt.id

export const use_prompt_stack = create((set, get) => ({
  /** @type {Record<string, WorldPrompt>} */
  prompts: {},
  /** @type {Record<string, true>} pending-keys whose press is in flight — hidden + single-flight until settle. */
  pending: {},
  /** Register (or update) a prompt — idempotent per id. @param {WorldPrompt} prompt */
  register_prompt: (prompt) => set((s) => ({ prompts: { ...s.prompts, [prompt.id]: prompt } })),
  /** Clear a source's prompt (no-op when absent). NEVER clears `pending` — see the module header. @param {string} id */
  clear_prompt: (id) =>
    set((s) => {
      if (!(id in s.prompts)) return s
      const next = { ...s.prompts }
      delete next[id]
      return { prompts: next }
    }),
  /** THE press choke (key + click both land here). Fires `on_trigger`; a returned promise latches the prompt's
   * pending-key until it settles (rejections settle identically — surfacing errors is the source's job). @param {string} id */
  trigger_prompt: (id) => {
    const { prompts, pending } = get()
    const prompt = prompts[id]
    if (!prompt || pending[pending_key_of(prompt)]) return // unregistered or subject in flight (single-flight law)
    const result = prompt.on_trigger()
    if (!result || typeof result.then !== 'function') return // sync press (toast/modal) — never pending
    const key = pending_key_of(prompt) // latch the SUBJECT at press time (re-registers must not move it)
    set((s) => ({ pending: { ...s.pending, [key]: true } }))
    const settle = () =>
      set((s) => {
        const next = { ...s.pending }
        delete next[key]
        return { pending: next }
      })
    result.then(settle, settle)
  },
}))

/** The prompts the HUD may render/trigger — a subject with an in-flight press hides its prompt until settle. */
export const visible_prompts = (
  /** @type {{ prompts: Record<string, WorldPrompt>, pending: Record<string, true> }} */ s
) => Object.values(s.prompts).filter((p) => !s.pending[pending_key_of(p)])
