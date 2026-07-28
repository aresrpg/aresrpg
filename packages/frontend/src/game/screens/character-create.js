// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST char-create — class + 3 colours + name only (hats/capes moved to in-game
// equipment). LEFT = the haired character GLB on a drag-to-rotate pedestal with LIVE 3-colour mesh
// recolour (the real production render path: DRACO base body + the `_hair` mesh parented to the head
// bone + the customizable-texture recolour SSOT). RIGHT = a 12-class grid (GLB thumbnail for
// senshi/yajin, an honest colored square + "model soon" for the 10 without a local GLB yet),
// 3 colour pickers (= on-chain color_1/2/3), a name field, and the gold Create & Play CTA. Built to
// design's mockup `p2-charcreate-v827-grid.png`, companion tokens. On validate it hands the draft to
// the existing create flow (IndexedDB draft -> zkLogin/dev-login -> auto-create on-chain).

import './character-create.css'
import classes_json from '@aresrpg/sdk/classes' with { type: 'json' }
import i18n from '../../i18n'
import { character_pedestal, render_character_thumbnail } from './character-pedestal.js'
import { has_character_model, preload_character_model } from './character-glb.js'
import { latching_single_flight } from '../../utils/single_flight.js'
import { get_sdk } from '../../chain/sdk'

// Name bounds MIRROR the on-chain rule in move/sources/character/character.move (4..=19 ASCII bytes,
// no whitespace). Kept in lockstep with the contract — a name that passes here but aborts the mint
// with ENameInvalid is the exact onboarding failure we must prevent.
export const NAME_MIN = 4
export const NAME_MAX = 19
const NAME_RE = /^[a-zA-Z0-9_]+$/

// Client mirror of the on-chain Creation gate price (default 10 SUI). The GATE is authoritative — hosts pass
// the LIVE `s.sui.character_price_sui` (load_roster's chain read of get_creation_state) and the paid mint
// re-reads it right before building; this constant is the display fallback only, never the charged price.
export const ADDITIONAL_CHARACTER_PRICE_SUI = 10

/** @param {string} name @returns {boolean} */
export const is_valid_name = (name) => name.length >= NAME_MIN && name.length <= NAME_MAX && NAME_RE.test(name)

/**
 * PAID-vs-FREE create discriminator — THE single home (the second zkLogin character costs 10 SUI —
 * swap free for paid and label the button accordingly). Paid when the account holds a
 * character, has ALREADY claimed its one free character on-chain (the C2 law: a claimed-then-emptied
 * account at count 0 must be PAID — count alone would promise FREE then abort at the gate), OR the
 * connected session is NOT zkLogin (#443: the free sponsored mint is zkLogin-ONLY by design — money law
 * #73 / auth's `is_zklogin_session` idiom — a connected wallet self-pays every tx and never rides the
 * sponsor door, so its first character routes through the same paid self-pay mint an additional
 * character already uses). The creator's price button AND the hosts' PTB routing (free `create_character`
 * vs paid `create_character_paid`) both read THIS predicate, so the label and the submitted tx can never
 * disagree — the promised-free-then-charged trap is unrepresentable in both directions.
 * @param {{ character_count?: number, claimed_free?: boolean, zklogin_session?: boolean }} args @returns {boolean}
 */
export const is_paid_create = ({ character_count = 0, claimed_free = false, zklogin_session = true }) =>
  character_count >= 1 || !!claimed_free || !zklogin_session

/**
 * The in-creator insufficient-funds line (paid mode, valid name, balance short of the price) — the honest
 * price + live balance, localized ×6. Exported as the unit-tested copy seam.
 * @param {{ price_sui: number, balance_sui: number | null }} args @returns {string}
 */
export const insufficient_funds_copy = ({ price_sui, balance_sui }) =>
  i18n.t('characters.create.insufficient_funds', {
    price: price_sui,
    balance: (balance_sui ?? 0).toLocaleString('en-US', { maximumFractionDigits: 3 }),
  })

/**
 * The header PRICE/FREE badge copy (#443) — ONE home for the exact string rendered in the `cc__free`
 * span, so a wallet session can never be shown the free banner while a paid tx is what actually gets
 * submitted (the label-vs-tx invariant `is_paid_create` already protects, extended to this literal).
 * FREE only when `paid` is false. Paid splits two honest reasons that read DIFFERENTLY: a genuinely
 * ADDITIONAL character (roster ≥1 or the free slot already claimed) vs a WALLET session's own FIRST
 * character (count 0, unclaimed, paid only because the session isn't zkLogin) — labelling the latter
 * "Additional character" would lie (there is no earlier one). Exported as the unit-tested copy seam.
 * @param {{ paid: boolean, character_count: number, claimed_free: boolean, price_sui: number }} args
 * @returns {string}
 */
export const create_badge_copy = ({ paid, character_count, claimed_free, price_sui }) =>
  !paid
    ? '★ First character free'
    : i18n.t(
        character_count === 0 && !claimed_free
          ? 'characters.create.wallet_price'
          : 'characters.create.additional_price',
        { price: price_sui }
      )

// S-84 — the create modal's `allowed_classes` now comes from the LIVE on-chain Creation whitelist (was a hardcoded
// 4-class stand-in; T51's "on-chain allowlist enforcement is a separate republish" has landed). Un-whitelisted
// classes render disabled + "coming soon"; and the mint-time abort 103 EUnknownClass carries the same copy.
/**
 * Read the on-chain Creation class whitelist for `allowed_classes`. Returns the whitelisted class ids, or
 * `undefined` when the chain read is empty/unavailable — character_create reads `undefined` as "every class
 * selectable", so a read hiccup NEVER blocks the creation funnel (a genuinely un-whitelisted pick still aborts
 * honestly at mint with "This class is coming soon"). @returns {Promise<string[] | undefined>}
 */
export async function read_allowed_classes() {
  try {
    const sdk = await get_sdk()
    const classes = await sdk.get_creation_classes()
    return classes?.length ? classes : undefined
  } catch {
    return undefined
  }
}

// Presentation flavour per class (role + grid-swatch colour mirror design's approved mockup; UI
// metadata, NOT present in classes.json). Classes are NOT tagged with a combat element (decoupled per
// owner review #1.5 — elements belong to spells, not classes). Keyed by the canonical class id; the
// insertion order below is the approved grid layout. id + display name come from @aresrpg/sdk classes.json.
const CLASS_PRESENTATION = {
  senshi: { role: 'Warrior · balanced melee burst', color: '#e0533a' },
  yajin: { role: 'Assassin · invisibility + traps', color: '#4ec97a' },
  yogen: { role: 'Archer · ranged + pierce', color: '#2bb6a8' },
  tomoda: { role: 'Tomoda · board presence', color: '#caa14a' },
  ikari: { role: 'Berserker · high-risk rage', color: '#c0334a' },
  mori: { role: 'Druid · glyphs + poison', color: '#7faa45' },
  tokei: { role: 'Chronomancer · time control', color: '#5a8fe0' },
  shugo: { role: 'Guardian · shields + taunt', color: '#b07a3a' },
  rojin: { role: 'Prospector · earth + utility', color: '#9c7b52' },
  shusen: { role: 'Brawler · displacement', color: '#54c0a0' },
  asobi: { role: 'Gambler · high variance', color: '#c95aa8' },
  iyashi: { role: 'Healer · heal + cleanse', color: '#6fc6e0' },
}

// The 12-class roster in the approved grid order; id + display name read from the @aresrpg/sdk SSOT.
const CLASSES = Object.entries(CLASS_PRESENTATION).map(([id, presentation]) => ({
  id,
  name: classes_json[id].name,
  ...presentation,
}))

// tomoda_female_hair.glb is a BROKEN artist export — its mesh/skin data is
// baked in full-body world-space instead of head-bone-local space, so attach_class_hair's normal
// "parent to Head bone" (the same path senshi/yajin use correctly) stacks a whole duplicate
// head+hair chunk ~2 heads above the character. Confirmed by rendering the raw GLB alone (headless
// three.js, no app code) — the artifact is in the asset, not the runtime. Disable female-tomoda in
// the picker until the artist re-exports the hair rig; re-enable by deleting this line + its 2 call
// sites once tomoda_female_hair.glb is replaced.
const FEMALE_DISABLED_CLASSES = new Set(['tomoda'])

// Default 3-colour sets (color_1/2/3 = Primary/Secondary/Accent). senshi/yajin = the production defaults
// (aresrpg-legacy character_colors.js); the rest use a neutral set the player tunes freely.
const DEFAULT_COLORS = {
  senshi: ['#ffffff', '#d9af57', '#8b6539'],
  yajin: ['#1a237e', '#ffffff', '#ffd700'],
}
const NEUTRAL_COLORS = ['#d8b48a', '#9aa6b8', '#b23838']
const default_colors_for = (id) => /** @type {[string,string,string]} */ ([...(DEFAULT_COLORS[id] ?? NEUTRAL_COLORS)])

/**
 * Colors for a creator form transition (a male/female switch must never reset the picked colors). A SEX
 * toggle PRESERVES the player's picks — the palette has NO sex dimension (DEFAULT_COLORS is
 * keyed by class id only; both gender rigs share the same 3-channel recolour masks), so there is nothing to
 * remap. A CLASS switch adopts the new class's authored defaults (unchanged behavior — mask regions are
 * authored per class). Exported as the unit-tested seam.
 * @param {{ kind: 'sex' | 'class', class_id: string, current: [string,string,string] }} t
 * @returns {[string,string,string]}
 */
export const transition_colors = ({ kind, class_id, current }) =>
  kind === 'sex' ? /** @type {[string,string,string]} */ ([...current]) : default_colors_for(class_id)

/**
 * Build the create-character screen.
 * @param {object} opts
 * @param {(c: { name: string, class_id: string, color_1: string, color_2: string, color_3: string }) => void | Promise<void>} opts.on_created
 * @param {() => void} opts.on_cancel
 * @param {string} [opts.cancel_label]  cancel button text (e.g. "Log out" on the forced first create)
 * @param {number} [opts.character_count]  roster size on open (first char free, 2nd+ costs price_sui)
 * @param {boolean} [opts.claimed_free]  has this account ALREADY claimed its one free character on-chain
 *   (the server's C2 free-vs-paid marker)? A claimed account is ALWAYS paid even at 0 characters: the
 *   count drops to 0 on delete while the on-chain claim is permanent, so labelling by count alone would
 *   promise FREE then have the server charge/block — the trap this closes. Defaults false (never claimed).
 * @param {number} [opts.price_sui]  the LIVE additional-character price in SUI (from the server); the
 *   default mirror is a fallback only, never the source of truth for the displayed price.
 * @param {boolean} [opts.zklogin_session]  is the connected session zkLogin (Enoki)? Defaults true
 *   (existing hosts keep the free-first-character assumption). false — a connected wallet — forces
 *   `is_paid_create` PAID even at roster 0 / unclaimed (#443: the free sponsored mint is zkLogin-only).
 * @param {() => Promise<number | null>} [opts.get_balance_sui]
 * @param {'overlay' | 'inline'} [opts.placement]  Overlay for secondary-character modals; inline when the
 *   first-character flow replaces the world slot without covering the surrounding app chrome.
 * @param {string[]} [opts.allowed_classes]  Optional class-id allowlist (ids from @aresrpg/sdk classes.json).
 *   When OMITTED, every class is selectable (the prod hosts pass nothing → unchanged). When provided, only
 *   the listed ids are pickable; the rest render disabled with a "coming soon" badge and cannot be selected
 *   or submitted. Frontend gate only — the on-chain `character_new` class restriction is a separate change.
 * @returns {{ root: HTMLElement, destroy: () => void }}
 */
export function character_create(opts) {
  const {
    on_created,
    on_cancel,
    character_count = 0,
    claimed_free = false,
    zklogin_session = true,
    price_sui = ADDITIONAL_CHARACTER_PRICE_SUI,
    get_balance_sui,
    placement = 'overlay',
    allowed_classes,
    // The cancel button text — defaults to "Cancel". The forced FIRST create (confirmed-empty roster) has
    // nowhere to cancel back TO and covers the companion chrome, so the host passes "Log out" + wires
    // on_cancel to a full logout (the always-escapable invariant).
    cancel_label = 'Cancel',
    // Calm "new era" context line — shown ONLY when the wallet owns characters from an EARLIER package generation
    // (they don't appear in the current roster because they live on an older on-chain era). Reassurance, not a block.
    show_new_era_notice = false,
  } = opts
  // No allowlist → every class pickable (prod hosts pass nothing). With one, only listed ids are pickable.
  const is_allowed = (/** @type {string} */ id) => !allowed_classes || allowed_classes.includes(id)
  const coming_soon_label = i18n.t('characters.create.coming_soon')
  // The default selection MUST land on an allowed class, else the pedestal + Create would arm a locked
  // pick. findIndex falls back to 0 if (mis-config) nothing is allowed.
  const initial = Math.max(
    0,
    CLASSES.findIndex((c) => is_allowed(c.id))
  )

  let selected = initial
  let male = true // D212 — the gender the picker holds; packed into the mint payload
  let name = ''
  let colors = default_colors_for(CLASSES[initial].id)
  let balance_sui = /** @type {number | null} */ (null)
  // Double-submit guard: at most ONE sponsored mint per screen. Latches on success (button stays disabled
  // until the screen closes), re-arms on failure (retry). See utils/single_flight.js + its test.
  const flight = latching_single_flight()
  // Paid ⇔ the shared is_paid_create predicate (single home, see its export) — the SAME rule the hosts
  // route the mint PTB on, so this screen's price labels can never disagree with the submitted tx.
  const paid = is_paid_create({ character_count, claimed_free, zklogin_session })
  const can_afford = () => !paid || balance_sui == null || balance_sui >= price_sui

  const root = document.createElement('div')
  root.className = placement === 'inline' ? 'cc cc--inline' : 'cc'
  root.innerHTML = `
    <div class="cc__veil"></div>
    <div class="cc__panel">
      <div class="cc__head">
        <h1>Create your character</h1>
        <span class="cc__free${paid ? ' is-paid' : ''}" data-free>${create_badge_copy({
          paid,
          character_count,
          claimed_free,
          price_sui,
        })}</span>
      </div>
      <p class="cc__lead">Pick a class, set your colors, name it. The world is already live behind you.</p>
      <div class="cc__era" data-era hidden>
        <span class="cc__era-tag">${i18n.t('characters.create.new_era_tag')}</span>
        <span class="cc__era-note">${i18n.t('characters.create.new_era_notice')}</span>
      </div>
      <div class="cc__body">
        <div class="cc__hero">
          <div class="cc__stage">
            <canvas class="cc__canvas" data-canvas></canvas>
            <div class="cc__soon" data-soon hidden>model soon</div>
            <div class="cc__rot">↺ drag to rotate</div>
          </div>
          <div class="cc__meta">
            <h2 data-hname></h2>
            <div class="cc__role" data-hrole></div>
            <div class="cc__tags" data-htags></div>
          </div>
        </div>
        <div class="cc__ctl">
          <div>
            <div class="cc__label">Class</div>
            <div class="cc__grid" data-grid></div>
          </div>
          <div>
            <div class="cc__label">Appearance · 3 colors</div>
            <div class="cc__swrow" data-swrow></div>
          </div>
          <div class="cc__foot">
            <div class="cc__namebox">
              <div class="cc__label">Name</div>
              <input class="cc__name" type="text" maxlength="${NAME_MAX}" placeholder="Enter name..." data-name />
              <div class="cc__inputmeta"><span class="cc__err" data-err></span><span class="cc__count" data-count>0/${NAME_MAX}</span></div>
            </div>
            <div class="cc__go">
              <button class="cc__cancel" data-cancel>Cancel</button>
              <button class="cc__create" data-create disabled>Create &amp; Play →</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `

  const q = (s) => /** @type {HTMLElement} */ (root.querySelector(s))
  const canvas = /** @type {HTMLCanvasElement} */ (q('[data-canvas]'))
  const soon = q('[data-soon]')
  const grid = q('[data-grid]')
  const swrow = q('[data-swrow]')
  const hname = q('[data-hname]')
  const hrole = q('[data-hrole]')
  const htags = q('[data-htags]')
  const name_input = /** @type {HTMLInputElement} */ (q('[data-name]'))
  const err = q('[data-err]')
  const count = q('[data-count]')
  const create_btn = /** @type {HTMLButtonElement} */ (q('[data-create]'))
  const cancel_btn = /** @type {HTMLButtonElement} */ (q('[data-cancel]'))
  cancel_btn.textContent = cancel_label
  if (show_new_era_notice) q('[data-era]').hidden = false

  const pedestal = character_pedestal(canvas)

  // ---- class meta + pedestal ------------------------------------------------
  const render_meta = () => {
    const c = CLASSES[selected]
    hname.textContent = c.name
    hrole.textContent = c.role
    htags.innerHTML =
      `<span class="cc__tag">${i18n.t('characters.create.casting_ap')}</span>` +
      `<span class="cc__tag">${i18n.t('characters.create.casting_limits')}</span>`
  }

  // Re-rig the pedestal for the CURRENT selection + gender. Colors are re-APPLIED (never re-derived) — the
  // one shared tail both the class switch and the sex toggle end on, so the toggle can't wipe the picks.
  const rig_pedestal = async () => {
    pedestal.set_colors(colors)
    const loaded = await pedestal.set_class(CLASSES[selected].id, { male })
    soon.hidden = loaded
    canvas.style.visibility = loaded ? 'visible' : 'hidden'
  }

  // Forces male + re-locks the gender row whenever the CURRENT class has no working female rig
  // (see FEMALE_DISABLED_CLASSES). No-op for every other class.
  const enforce_gender_lock = () => {
    const broken = FEMALE_DISABLED_CLASSES.has(CLASSES[selected].id)
    female_btn.disabled = broken
    female_btn.title = broken ? i18n.t('characters.create.female_unavailable') : ''
    female_btn.classList.toggle('is-disabled', broken)
    if (broken && !male) {
      male = true
      gender_row.querySelectorAll('.cc__gender-opt').forEach((el, idx) => el.classList.toggle('is-sel', idx === 0))
    }
  }

  const select_class = async (i) => {
    if (!is_allowed(CLASSES[i].id)) return // locked class — ignore (cells also carry no click handler)
    selected = i
    colors = transition_colors({ kind: 'class', class_id: CLASSES[i].id, current: colors })
    grid.querySelectorAll('.cc__cls').forEach((el, idx) => el.classList.toggle('is-sel', idx === i))
    render_meta()
    update_swatches()
    enforce_gender_lock()
    await rig_pedestal()
  }

  // ---- D212 gender picker (a boolean male/female choice, as in aresrpg legacy) -----------
  // The chain field always existed (character.move sex/male; sdk character_new packs it) — the creator
  // just never collected it. Two-state toggle, house style; the pedestal re-rigs live on switch.
  const gender_row = document.createElement('div')
  gender_row.className = 'cc__gender'
  const gender_btn = (/** @type {boolean} */ is_male, /** @type {string} */ label) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cc__gender-opt'
    b.textContent = label
    b.addEventListener('click', () => {
      if (b.disabled || male === is_male) return
      male = is_male
      gender_row
        .querySelectorAll('.cc__gender-opt')
        .forEach((el, idx) => el.classList.toggle('is-sel', (idx === 0) === male))
      // Re-rig with the chosen gender ONLY — never via select_class, whose class-arm derives fresh default
      // colors and so WIPED the player's picks. transition_colors 'sex' arm = preserve.
      colors = transition_colors({ kind: 'sex', class_id: CLASSES[selected].id, current: colors })
      void rig_pedestal()
    })
    return b
  }
  const male_btn = gender_btn(true, i18n.t('characters.create.male'))
  male_btn.classList.add('is-sel')
  const female_btn = gender_btn(false, i18n.t('characters.create.female'))
  gender_row.append(male_btn, female_btn)
  swrow.parentElement?.insertBefore(gender_row, swrow)
  enforce_gender_lock() // covers the initial selection landing on a female-disabled class

  // ---- class grid -----------------------------------------------------------
  CLASSES.forEach((c, i) => {
    const allowed = is_allowed(c.id)
    const cell = document.createElement('div')
    cell.className = 'cc__cls' + (i === initial ? ' is-sel' : '') + (allowed ? '' : ' is-soon')
    const has_glb = has_character_model(c.id)
    cell.innerHTML =
      (has_glb
        ? `<div class="cc__thumb" data-thumb="${c.id}"></div>`
        : `<div class="cc__sq" style="background:${c.color}"></div>`) +
      `<div class="cc__cn">${c.name}</div>` +
      (allowed ? '' : `<div class="cc__soonbadge">${coming_soon_label}</div>`)
    // Locked classes carry no click handler → unselectable; select_class also re-checks defensively.
    if (allowed) cell.addEventListener('click', () => void select_class(i))
    grid.appendChild(cell)
  })

  // GLB grid thumbnails (senshi/yajin) — rendered once, off a throwaway context, then cached as img.
  for (const c of CLASSES)
    if (has_character_model(c.id))
      void render_character_thumbnail(c.id, 128, default_colors_for(c.id))
        .then((url) => {
          if (!url) return
          const slot = grid.querySelector(`[data-thumb="${c.id}"]`)
          if (slot) slot.style.backgroundImage = `url(${url})`
        })
        .catch(() => {})

  // ---- 3-colour swatches + palette -----------------------------------------
  // Primary/Secondary/Accent = on-chain color_1/2/3. The per-class mask regions are authored, so each
  // color paints DIFFERENT mesh parts per class (e.g. senshi color_1 = metal armor, color_2 = hair+belt,
  // color_3 = tunic). Generic, class-agnostic labels stay honest; the live mesh recolor is the truth and
  // teaches what each channel does.
  const LABELS = ['Primary', 'Secondary', 'Accent']
  // Build the 3 swatches ONCE: rebuilding on select would destroy the native colour <input>
  // mid-click and cancel the OS picker. Each swatch is its own native OS colour picker (the preset
  // chip palette was removed per owner review #1.2 — a picker only); values update live on the mesh.
  const swatches = LABELS.map((label, i) => {
    const sw = document.createElement('label')
    sw.className = 'cc__sw'
    sw.innerHTML =
      `<span class="cc__sw-c"></span>` + `<span class="cc__sw-l">${label}</span>` + `<input type="color" />`
    const cc = /** @type {HTMLElement} */ (sw.querySelector('.cc__sw-c'))
    const input = /** @type {HTMLInputElement} */ (sw.querySelector('input'))
    input.addEventListener('input', () => set_color(i, input.value))
    swrow.appendChild(sw)
    return { cc, input }
  })

  const update_swatches = () => {
    swatches.forEach(({ cc, input }, i) => {
      const hex = colors[i] ?? '#000000'
      cc.style.background = hex
      if (input.value.toLowerCase() !== hex.toLowerCase()) input.value = hex
    })
  }

  const set_color = (i, hex) => {
    colors = /** @type {[string,string,string]} */ ([...colors])
    colors[i] = hex
    update_swatches()
    pedestal.set_colors(colors)
  }

  // ---- name + create --------------------------------------------------------
  const validate = () => {
    const t = name.trim()
    let msg = ''
    if (t.length > 0 && t.length < NAME_MIN) msg = `Name must be at least ${NAME_MIN} characters`
    else if (t.length > NAME_MAX) msg = `Name must be at most ${NAME_MAX} characters`
    else if (t.length > 0 && !NAME_RE.test(t)) msg = 'Only letters, numbers, and underscores'
    const name_ok = is_valid_name(t)
    const afford = can_afford()
    const balance_msg = name_ok && !afford ? insufficient_funds_copy({ price_sui, balance_sui }) : ''
    err.textContent = msg || balance_msg
    count.textContent = `${t.length}/${NAME_MAX}`
    name_input.classList.toggle('is-invalid', msg !== '')
    if (!flight.busy) {
      create_btn.disabled = !name_ok || !afford
      // Paid mode surfaces the LIVE price ON the confirm button (price prominent pre-confirm); the free
      // path keeps its exact label byte-for-byte. i18n so the paid price line localizes ×6.
      create_btn.innerHTML = paid
        ? i18n.t('characters.create.create_paid', { price: price_sui })
        : 'Create &amp; Play →'
    }
    return name_ok && afford
  }

  const submit = async () => {
    if (flight.busy) return
    if (!validate()) return
    const original = create_btn.innerHTML
    create_btn.disabled = true
    create_btn.setAttribute('aria-busy', 'true')
    cancel_btn.disabled = true
    err.textContent = ''
    create_btn.textContent = 'Creating…'
    // D9 LAW (click-instant prediction): tell the host the mint is IN FLIGHT so it can ghost the new
    // character into the roster/lobby NOW; confirm reconciles (load_roster), failure rolls the ghost back.
    opts.on_submit_start?.({
      name: name.trim(),
      class_id: CLASSES[selected].id,
      male,
      colors: [...colors],
    })
    try {
      await flight.run(async () => {
        const [color_1, color_2, color_3] = colors
        await on_created({
          name: name.trim(),
          class_id: CLASSES[selected].id,
          male, // D212 — the picker's choice; callers stop hardcoding true
          color_1,
          color_2,
          color_3,
        })
      })
      // SUCCESS: flight LATCHED (busy stays true) → the button stays disabled and validate() won't re-enable it,
      // so a repeat click / slow screen-close can NEVER fire a second sponsor/mint. The caller unmounts on success.
    } catch (error) {
      // FAILURE (tx abort → no mint happened): flight re-armed → re-enable so the user can retry.
      opts.on_submit_fail?.() // D9 rollback — the ghost leaves with the honest error
      create_btn.innerHTML = original
      create_btn.removeAttribute('aria-busy')
      cancel_btn.disabled = false
      validate() // re-enable FIRST — validate() writes err.textContent, so the real failure must land AFTER it
      err.textContent = error instanceof Error ? error.message : 'Character creation failed'
    }
  }

  const primary_action = () => {
    void submit()
  }

  name_input.addEventListener('input', () => {
    name = name_input.value.slice(0, NAME_MAX)
    validate()
  })
  create_btn.addEventListener('click', primary_action)
  cancel_btn.addEventListener('click', () => {
    if (!flight.busy) on_cancel()
  })

  const on_key = (e) => {
    if (flight.busy) return
    if (e.key === 'Escape') on_cancel()
    else if (e.key === 'Enter' && document.activeElement === name_input) primary_action()
  }
  window.addEventListener('keydown', on_key)

  if (paid && get_balance_sui)
    void get_balance_sui().then((b) => {
      balance_sui = b
      validate()
    })

  // initial paint (select_class(initial) sets meta + swatches + pedestal for the first allowed class)
  void select_class(initial)
  // The initial rig + thumbnails warm male; start the non-selected sex now so its first toggle joins this cache load.
  preload_character_model(CLASSES[initial].id, { male: !male })
  validate()

  return {
    root,
    destroy() {
      window.removeEventListener('keydown', on_key)
      pedestal.destroy()
      // Detach the imperatively-appended root so a re-run of the React host effect (StrictMode mounts
      // the effect twice in dev) never leaves a second, orphaned `.cc` copy in the host (the live one
      // would sit over a dead one, occluding its swatches). Mirrors mount_scene's destroy contract.
      root.remove()
    },
  }
}
