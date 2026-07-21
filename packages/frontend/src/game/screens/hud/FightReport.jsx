// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// End-of-fight summary card (canon: dark dramatic modal — spec_fightend_cards.md). ONE shared shell for
// both outcomes: FightResult.jsx (verdict="Victory", spoils present) and FightSummary.jsx (verdict="Defeat",
// spoils=null). Near-black card + vignette + grain over a heavily-dimmed scrim; restrained accent (gold on a
// win, desaturated red on a loss). Party + enemy rows share ONE format ([glyph] NAME [YOU] · Lv · HP · STATE)
// and the local player's row is ALWAYS present (the empty-"YOUR PARTY" bug is fixed upstream in the data
// producers, which guarantee the self row). Fight-end auto-settles same-tx (#33): this card only DISPLAYS the
// outcome + inline receipt — NO claim/mint/burn buttons, just CONTINUE.
//
// Pure view: every value rides props (party/enemies/spoils/items/t), resolved by FightResult/FightSummary.
// hp_pct is binary (100 alive / 0 fallen) — the summary roster carries no partial HP. React only renders.
// The ONE local exception is the loot receipt: the tiles resolve the SAME chain-direct item template map
// (get_template_by_item_type_map) + tt inventory/findables use, so a hover shows the shared ItemDetailView.
//
// NAMES (a party row showed the raw "0xDEE0…AD38"): packages/fight/src/project.js:321 bakes an
// address slice into a fighter's `name` whenever the live mid-fight roster resolve hasn't landed by fight-end.
// This shell re-resolves every non-local PLAYER row against a fresh /v1 read (fight_report_names.js over the
// character_name_resolve.js ONE HOME — no turn-clock pressure post-fight) so that slice never survives to
// render; mobs/content rows and the local player's own row (already synchronous) are left untouched.
//
// DURATION renders the recorded recap timeline span as total mm:ss, including the valid zero-length case.
//
// SPOILS render PER PARTY ROW: everyone must see xp and items per player row, so everyone can see what
// everyone rolled. The local player's row carries the real receipt (xp + loot tiles, unchanged data). Every
// OTHER member's row states honestly what the chain does NOT split — `/v1/fight-results` indexes results
// per-OWNER only (packages/rpc/api/views.js handle_fight_results, `?owner=` — no cross-owner `?fight=` query),
// so this client has no read path to a teammate's own xp_share/loot. Their row says so; it never fabricates a
// number or renders a second silent empty box.

import { useEffect, useMemo, useState } from 'react'

import { ItemIcon } from './ItemIcon.jsx'
import { Tooltip } from './Tooltip.jsx'
import { resolve_loot_tile } from './loot-tile-resolve.js'
import { resolvable_row_ids, apply_resolved_names } from './fight_report_names.js'
import { format_mmss } from './world/compass_math.js'
import { ItemDetailView } from '../../../components/item_detail_view'
import { use_template_t } from '../../../i18n/template_t'
import { get_template_by_item_type_map, get_template_detail_map } from '../../../chain/read_findables.js'
import { resolve_character_docs } from '../../../world-shell/character_name_resolve.js'
import { seed_manifest } from '../../../content/seed_manifest'
import { export_fight_trace, has_dumpable_trace } from './fight_trace_export.js'
import './result.css'

// the single-realm MVP world label (mirrors Minimap.jsx / MapDrawer.jsx — one named realm for now).
const ZONE = 'Whisperwood'
// the receipt fits a single tidy row of loot tiles; beyond this we'd wrap (rare — a fight drops few types).
const MAX_TILES = 8
// The deployment receipt publishes slug → ItemTemplate id; invert it once so a rolled template can recover
// its real render even when its on-chain item_type is only the generic class word (for example "resource").
const icon_slug_by_template_id = Object.fromEntries(
  Object.entries(seed_manifest.items).map(([slug, template_id]) => [template_id, slug]),
)

/** First letter of a name, for the glyph tile. @param {string | null | undefined} name */
const initial = (name) => (String(name ?? '').trim()[0] ?? '?').toUpperCase()

/**
 * A muted PULSING skeleton block — the house "value still hydrating from chain" stand-in: show a
 * loading skeleton instead of 0, never a literal 0/empty. No spinner, no number. Purely presentational.
 * @param {{ w?: string }} props the block width (em, so it tracks the surrounding font size)
 */
function Skel({ w = '3.5em' }) {
  return <span className="fe-skel" style={{ width: w }} aria-hidden="true" />
}

/**
 * One looted item as a catalog-icon tile with a ×N count badge + the SHARED inventory item tooltip on hover
 * (the victory card loot needs the SAME ItemDetailView inventory/findables show, not a bare name). The icon
 * KEY routes through `inventory_item_icon` inside resolve_loot_tile — the SAME shared resolver used by
 * InventoryBag/Inventory/EquipmentSlot — never the raw `entry.item_type` alone. item_icon_url keys CDN art
 * by that resolved slug, NEVER the on-chain object id (keying off the resolved item's `id` 404'd every loot
 * icon), and NEVER the raw item_type
 * for the class of items where that field is a coarse category word instead of a unique art slug (a shop
 * cosmetic's on-chain item_type is the generic slot word "hat"/"cloak" — cosmetic_icons.js's `cosmetic_icon_of`
 * is the ONE fix for that divergence; bypassing it here reproduced the exact "cosmetics don't show" bug class
 * on the victory card after it was already fixed everywhere else — the reported placeholder-box regression).
 * `inventory_item_icon` degrades to `item.item_type` when no cosmetic alias/published slug exists, so an
 * ordinary drop's icon is unchanged. Separately, the tooltip resolves against the exact chain `template_map`
 * into onchain_template_to_detail_props → the ItemDetailView the bag renders. The house <Tooltip> body-portals it
 * (escapes the animated card's transform) with the solid near-black `tt-card--solid` recipe (FIGHT-HUD
 * OPACITY LAW — the card floats over the bright stage). resolve_loot_tile.js owns the enrichment decision; an
 * orphaned drop (missing from BOTH the bag snapshot and the encyclopedia — e.g. a QA test mob's ad hoc loot
 * template) renders the D53 bold-letter fallback instead of <ItemIcon> — a loot slot must never read as an
 * empty un-hoverable box.
 * @param {{ entry: { template_id?: string, item_type: string, name: string, amount: number }, items: any[], template_map: Map<string, any>, tt: ReturnType<typeof use_template_t>, t: (key: string, opts?: any) => string }} props
 */
function LootTile({ entry, items, template_map, tt, t }) {
  const { resolved, name, tint, category, icon, detail } = resolve_loot_tile(
    entry,
    items,
    template_map,
    tt,
    t,
    icon_slug_by_template_id,
  )
  return (
    <Tooltip content={<ItemDetailView item={detail} />} className="tt-card--solid">
      <div
        className="fe-tile"
        style={/** @type {import('react').CSSProperties} */ ({ '--rq': tint })}
        aria-label={name}
      >
        {resolved ? (
          <ItemIcon item={{ icon, category }} alt={name} />
        ) : (
          <span className="fe-tile__letter" aria-hidden="true">
            {initial(name)}
          </span>
        )}
        <span className="fe-tile__qty hud-num">×{entry.amount}</span>
      </div>
    </Tooltip>
  )
}

/** A loot tile still rolling in — a pulsing placeholder the card shows for each ResultOpened `loot_units` until
 *  the real items delta lands (the same treatment as the loot list). No count, no tooltip. */
function LootSkelTile() {
  return <div className="fe-tile fe-tile--skel" aria-hidden="true" />
}

/**
 * One fighter row — the SHARED format for party AND enemies. Alive → emerald ALIVE + remaining HP bar; a
 * fallen ally → red DEAD ✝ (bar emptied, row dimmed); a beaten enemy → red DEFEATED (bar emptied, dimmed).
 * The self row carries the [YOU] chip + a subtle accent frame. `spoils_slot`, when given, renders as a full-
 * width strip UNDER the name/hp/state line (grid-column 1/-1 — see .fe-row__spoils in result.css), so the
 * row stays the single direct child of .fe-rows (the entrance stagger keys off `.fe-rows .fe-row:nth-child`).
 * @param {{ f: { id: string, name: string, level: number, is_me?: boolean, is_player?: boolean, alive: boolean, hp_pct: number, class_name?: string | null }, is_enemy: boolean, settled_dead?: boolean, spoils_slot?: import('react').ReactNode | null, t: (k: string) => string }} props
 */
function Row({ f, is_enemy, settled_dead = false, spoils_slot = null, t }) {
  const alive = f.alive && !settled_dead
  const state = alive ? 'alive' : is_enemy ? 'defeated' : 'dead'
  const label = alive
    ? t('fight_end.alive')
    : is_enemy
      ? t('fight_end.defeated')
      : t('fight_end.dead')
  return (
    <div className={`fe-row fe-row--${state}${f.is_me ? ' is-you' : ''}`}>
      <div className="fe-row__glyph" aria-hidden="true">
        {initial(f.name)}
      </div>
      <div className="fe-row__id">
        <div className="fe-row__name">
          {f.name || 'Fighter'}
          {f.is_me && <span className="fe-you">{t('fight_end.you')}</span>}
        </div>
        <div className="fe-row__sub">
          {f.class_name ? `${f.class_name} · ` : ''}Lv {f.level}
        </div>
      </div>
      <div className="fe-hp" aria-hidden="true">
        <span className="fe-hp__fill" style={{ width: `${alive ? f.hp_pct : 0}%` }} />
      </div>
      <div className={`fe-state fe-state--${state}`}>
        {!alive && (
          <span className="fe-state__glyph" aria-hidden="true">
            {is_enemy ? '✕' : '✝'}
          </span>
        )}
        {label}
      </div>
      {spoils_slot}
    </div>
  )
}

/**
 * ONE party member's spoils strip (xp and items PER PLAYER ROW). `mine` is the only row this client
 * can back with a real receipt (the local wallet's own settle/open — see FightReport.jsx header note); every
 * other row states honestly that the chain doesn't split rewards per player, instead of faking a number or
 * silently rendering nothing (the exact "empty grey square" complaint this ticket also fixes).
 * @param {{ mine: boolean, spoils: { xp: number, tokens: number, loot: Array<{ template_id?: string, item_type: string, name: string, amount: number }> }, items: any[], template_map: Map<string, any>, tt: ReturnType<typeof use_template_t>, pending: boolean, loot_units: number | null, t: (key: string, opts?: any) => string }} props
 */
function RowSpoils({ mine, spoils, items, template_map, tt, pending, loot_units, t }) {
  if (!mine) return <div className="fe-row__spoils fe-row__spoils--hidden">{t('fight_end.spoils_hidden')}</div>
  return (
    <div className="fe-row__spoils">
      <span className="fe-gain hud-num">
        {/* design ruling 2026-07-11: never render a literal +0 while the chain xp resolves — a skeleton until it truly loads */}
        {pending ? <Skel w="4.5em" /> : <>+{spoils.xp} {t('fight_end.xp')}</>}
      </span>
      {spoils.tokens > 0 && (
        <span className="fe-gain hud-num">
          +{spoils.tokens} {t('fight_end.tokens')}
        </span>
      )}
      {/* real loot once the items delta lands; else a skeleton tile per rolled unit while it hydrates */}
      {spoils.loot.length > 0 ? (
        <div className="fe-tiles">
          {spoils.loot.slice(0, MAX_TILES).map((e, i) => (
            <LootTile
              key={e.template_id ?? e.item_type ?? i}
              entry={e}
              items={items}
              template_map={template_map}
              tt={tt}
              t={t}
            />
          ))}
        </div>
      ) : loot_units && loot_units > 0 ? (
        <div className="fe-tiles">
          {Array.from({ length: Math.min(loot_units, MAX_TILES) }, (_, i) => (
            <LootSkelTile key={`skel-${i}`} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The end-of-fight card (dark dramatic shell + shared party/enemy rows + inline receipt).
 * @param {{
 *   verdict: 'Victory' | 'Defeat',
 *   party: Array<{ id: string, name: string, level: number, is_me?: boolean, is_player?: boolean, alive: boolean, hp_pct: number, class_name?: string | null }>,
 *   enemies: Array<{ id: string, name: string, level: number, is_player?: boolean, alive: boolean, hp_pct: number }>,
 *   spoils: { xp: number, tokens: number, loot: Array<{ template_id?: string, item_type: string, name: string, amount: number }> } | null,
 *   items: any[],
 *   cost: { sui: string, is_refund: boolean } | null,
 *   pending?: boolean,      // true while the xp/level is still resolving on-chain → render a skeleton, not a 0
 *   loot_units?: number | null,  // ResultOpened rolled count → this many loot skeletons until the items delta lands
 *   duration_ms?: number,   // recorded recap timeline span; a zero-length recording renders 0:00
 *   duration_partial?: boolean, // true → this client only OBSERVED an already-live fight (resume/poll-adopt);
 *     duration_ms is a floor, not the true length — rendered with a "~" prefix instead of false precision.
 *   t: (key: string, opts?: any) => string,
 *   on_close: () => void,
 * }} props
 * @returns {import('react').JSX.Element}
 */
export function FightReport({
  verdict,
  party,
  enemies,
  spoils,
  items,
  cost,
  cause = null,
  pending = false,
  loot_units = null,
  duration_ms = 0,
  duration_partial = false,
  t,
  on_close,
}) {
  const won = verdict !== 'Defeat'
  // EXPORT REPLAY (issue #209) — is the fight that just ended still in the in-memory trace ring buffer? Fixed
  // at mount (this card mounts once per concluded fight; dumpability doesn't change while it's up). Hidden
  // entirely rather than a disabled/dead button when nothing was captured.
  const trace_available = useMemo(() => has_dumpable_trace(), [])
  // Loot tooltips reuse the inventory/findables map for legacy slug-only rows, then overlay exact receipt IDs
  // with the canonical chain ItemTemplate reader (including decoded stat DFs). A defeat has no tiles to read.
  const tt = use_template_t()
  const [template_map, set_template_map] = useState(/** @type {Map<string, any>} */ (() => new Map()))
  const has_spoils = !!spoils
  const loot_template_ids_key = [...new Set((spoils?.loot ?? []).map((entry) => entry.template_id).filter(Boolean))]
    .sort()
    .join(',')
  useEffect(() => {
    if (!has_spoils) return
    let alive = true
    const template_ids = loot_template_ids_key ? loot_template_ids_key.split(',') : []
    Promise.all([get_template_by_item_type_map(), get_template_detail_map(template_ids)]).then(([by_type, by_id]) => {
      if (!alive) return
      const next = new Map(by_type)
      for (const [id, row] of by_id) next.set(id, row)
      set_template_map(next)
    })
    return () => {
      alive = false
    }
  }, [has_spoils, loot_template_ids_key])

  // NAME RESOLUTION — every non-local PLAYER row (party or enemy) gets a fresh batched /v1 character-doc read
  // off the ONE name-resolve home (fight_report_names.js → character_name_resolve.js), so whatever shape the
  // upstream fight core baked into `name` (including a raw address slice) never survives to render. Keyed on a
  // STABLE STRING (not the array) — `party`/`enemies` are fresh array refs every parent render, and re-keying
  // on the array would re-fire the fetch on every unrelated store tick (get_characters' own LRU makes a repeat
  // call cheap, but there is no reason to churn state for a no-op).
  const [character_docs, set_character_docs] = useState(/** @type {Map<string, any>} */ (() => new Map()))
  const roster_ids_key = useMemo(() => resolvable_row_ids([...(party ?? []), ...(enemies ?? [])]).join(','), [party, enemies])
  useEffect(() => {
    if (!roster_ids_key) return
    let alive = true
    void resolve_character_docs(roster_ids_key.split(',')).then((docs) => {
      if (alive) set_character_docs(docs)
    })
    return () => {
      alive = false
    }
  }, [roster_ids_key])
  const named_party = useMemo(() => apply_resolved_names(party, character_docs), [party, character_docs])
  const named_enemies = useMemo(() => apply_resolved_names(enemies, character_docs), [enemies, character_docs])

  return (
    <div className="hud-middle result-stage fe-stage">
      <div
        className={`result result--wide result--fe ${won ? 'fe--win' : 'fe--loss'}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${verdict}: encounter ${won ? 'cleared' : 'lost'}`}
      >
        <div className="fe-head">
          <div className="fe-title">
            {won ? t('fight_end.victory') : t('fight_end.defeat')}
          </div>
          <div className="fe-sub">
            {ZONE} · {won ? t('fight_end.encounter_cleared') : t('fight_end.encounter_lost')}
          </div>
          {/* [defeat-cause] the killing blow — WHO struck the fatal hit and for how much (the
              defeat card must state the cause). Pre-composed + localized by the caller; shown only when known. */}
          {!won && cause && <div className="fe-cause">{cause}</div>}
        </div>

        <div className="fe-divider" aria-hidden="true">
          ◇
        </div>

        <div className="fe-lbl fe-duration">
          <span>{t('fight_end.duration')}</span>
          <span className="hud-num">{`${duration_partial ? '~' : ''}${format_mmss(duration_ms)}`}</span>
        </div>

        <div className="fe-sec">
          <div className="fe-lbl">
            <span>{t('fight_end.your_party')}</span>
            <span className="hud-num">{named_party.length}</span>
          </div>
          <div className="fe-rows">
            {named_party.map((f) => (
              <Row
                key={f.id}
                f={f}
                is_enemy={false}
                t={t}
                spoils_slot={
                  spoils && (
                    <RowSpoils
                      mine={!!f.is_me}
                      spoils={spoils}
                      items={items}
                      template_map={template_map}
                      tt={tt}
                      pending={pending}
                      loot_units={loot_units}
                      t={t}
                    />
                  )
                }
              />
            ))}
          </div>
        </div>

        {named_enemies.length > 0 && (
          <div className="fe-sec">
            <div className="fe-lbl">
              <span>{t('fight_end.enemies')}</span>
              <span className="hud-num">{named_enemies.length}</span>
            </div>
            <div className="fe-rows">
              {named_enemies.map((f) => (
                <Row key={f.id} f={f} is_enemy={true} settled_dead={won} t={t} />
              ))}
            </div>
          </div>
        )}

        {/* the receipt now rides INSIDE each party row (RowSpoils above) — a defeat (spoils=null) keeps the
            single dashed plate; a win renders no aggregate strip anymore (xp/items render PER PLAYER ROW). */}
        {!spoils && <div className="fe-nospoils">{t('fight_end.no_spoils')}</div>}

        {cost && (
          <div className={`fe-cost${!pending && cost.is_refund ? ' fe-cost--refund' : ''}`}>
            {/* the cost keeps folding as settle + OPEN + mint + burn land (minting IS in the total) —
                skeleton until they have ALL folded (status resolved) so the number shown always INCLUDES minting,
                never a mid-settle partial. */}
            {pending ? (
              <Skel w="9em" />
            ) : cost.is_refund ? (
              t('fight_end.cost_refund', { sui: cost.sui })
            ) : (
              t('fight_end.cost', { sui: cost.sui })
            )}
          </div>
        )}

        <div className="cta">
          {trace_available && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => export_fight_trace()}
              title={t('fight_end.export_replay_hint')}
            >
              {t('fight_end.export_replay')}
            </button>
          )}
          <button
            type="button"
            className={`btn ${won ? 'btn--primary' : 'btn--muted'}`}
            onClick={on_close}
          >
            {t('fight_end.continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
