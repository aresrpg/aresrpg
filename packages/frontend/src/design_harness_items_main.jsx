// THROWAWAY items&economy design-pass harness — NOT part of the app, NOT imported by main.tsx, NOT built
// into the production bundle (a separate Vite HTML entry: design-harness-items.html). Per the
// PICK#2 ruling: pet feeding = right-click the EXISTING inventory item → Feed →
// confirm modal (no dedicated pet UI); rune scribing = the Retro interface exactly (inventory right, item
// stats left, center fusion card); marketplace stackables/characters = the EXISTING marketplace page, a
// Characters tab + the pools COMING-SOON stub filled in, zero new layout. Reuses the REAL <ItemCard>/
// <ItemIcon> components + `.inv__cell`/`.inv__grid`/`.item-card`/`.gw-panel`/`.admin-tab` classes wherever
// the surface already has an approved visual language. Wrapped in `.gw-tab` so the real gold-token
// bridge applies (the same mechanism the shipped Inventory/marketplace already ride) — never a hand-picked
// palette, satisfying the "gold terminal, no glassmorphism" ruling by construction.
//   ?surface=pet    &opt=1|2   pet feed context-menu + confirm modal
//   ?surface=scribe &opt=1|2   rune scribing 3-column interface
//   ?surface=market            marketplace: pools-live row + Characters tab (one treatment — see rationale)
// Delete this file + design-harness-items.html + design_harness_items.css once the picks land.
import './boot_shim'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Cat, Utensils, ArrowRight } from 'lucide-react'

import './index.css'
import './game-tab.css'
// hud-panels.css BEFORE item-card.css: both declare a bare `.item-icon` / `.item-card__icon` rule at equal
// specificity (0,0,1,0) on the SAME element (ItemIcon renders `class="item-icon <extra>"`) — whichever file
// loads LAST wins the tie. item-card.css's 96px icon must win over hud-panels.css's generic 100%-fill
// default, so it has to load second (found via a real overflow: the icon rendered at the CARD's own 300px
// width instead of 96px, pushing the stat column out of the card entirely).
import './game/screens/hud/hud-panels.css'
import './game/screens/hud/item-card.css'
import './game/screens/hud/world/game-world-hud.css'
import './design_harness_items.css'

import { ItemCard } from './game/screens/hud/ItemCard.jsx'
import { ItemIcon } from './game/screens/hud/ItemIcon.jsx'

// ── placeholder content (illustrative only — never shipped copy) ─────────────────────────────────────────
const PET = { id: 'pet1', name: 'Ember Fox', category: 'Pet', quality: 'rare', level: 12, icon: 'pet_ember_fox' }
const FOOD = { id: 'food1', name: 'Fire Crystal', category: 'Resource', quality: 'common', icon: 'fire_crystal' }
const SWORD = {
  id: 'sword1',
  name: "Templar's Edge",
  category: 'Weapon',
  quality: 'epic',
  level: 45,
  icon: 'templars_edge',
  stats: { raw_damage: [12, 18], strength: [5, 5] },
}
const RUNE = { id: 'rune1', name: 'Rune of Vitality', category: 'Rune', quality: 'rare', icon: 'rune_vitality' }
const BAG = [PET, FOOD, RUNE, SWORD, { id: 'x1', name: 'Oak Log', category: 'Resource', icon: 'oak_log' }]

// ═══════════════════════════════════ PET FEED ═══════════════════════════════════════════════════════════
function PetOption1() {
  return (
    <div className="mmi-petscene">
      <div>
        <div className="mmi-bagpreview">
          {BAG.map((it) => (
            <div key={it.id} className={`inv__cell inv__cell--filled${it.id === 'pet1' ? ' mmi-cell--pet' : ''}`}>
              <ItemIcon item={{ icon: it.icon, category: it.category }} alt={it.name} className="inv__cell-art" />
            </div>
          ))}
        </div>
        <p className="mmi-teach" style={{ maxWidth: 260, marginTop: 12 }}>
          Right-click a pet in your bag — no new screen, the existing inventory grid is the whole surface.
        </p>
      </div>
      <div className="mmi-ctxmenu">
        <div className="mmi-ctxmenu__head">
          <ItemIcon item={{ icon: PET.icon, category: PET.category }} alt={PET.name} />
          <span className="mmi-ctxmenu__name">{PET.name}</span>
        </div>
        <div className="mmi-ctxmenu__row">
          <Utensils size={14} strokeWidth={2} />
          Feed
        </div>
        <div className="mmi-ctxmenu__row">
          <Cat size={14} strokeWidth={2} />
          Feed All Similar Pets
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({ rich }) {
  return (
    <div className="mmi-modal-backdrop">
      <div className={`mmi-modal${rich ? ' mmi-modal--rich' : ''}`}>
        <div className="mmi-modal__title">Feed {PET.name}</div>
        {rich ? (
          <>
            <div className="mmi-modal__side">
              <div className="mmi-modal__pet-portrait">
                <ItemIcon item={{ icon: PET.icon, category: PET.category }} alt={PET.name} />
              </div>
              <ArrowRight size={16} color="var(--color-muted)" />
              <ItemCard item={FOOD} size="md" />
            </div>
          </>
        ) : (
          <div className="mmi-modal__row">
            <ItemIcon item={{ icon: FOOD.icon, category: FOOD.category }} alt={FOOD.name} />
            <div className="mmi-modal__copy">
              Use <b>1× {FOOD.name}</b> to feed <b>{PET.name}</b>?
            </div>
          </div>
        )}
        <div className="mmi-modal__actions">
          <button type="button" className="btn-outline px-5 py-2.5 text-[11px]">
            Cancel
          </button>
          <button type="button" className="btn-gold px-5 py-2.5 text-[11px]">
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

function PetOption2() {
  return (
    <div className="mmi-petscene">
      <div className="mmi-bagpreview">
        {BAG.map((it) => (
          <div key={it.id} className={`inv__cell inv__cell--filled${it.id === 'pet1' ? ' mmi-cell--pet' : ''}`}>
            <ItemIcon item={{ icon: it.icon, category: it.category }} alt={it.name} className="inv__cell-art" />
          </div>
        ))}
      </div>
      <ConfirmModal rich />
    </div>
  )
}

// ═══════════════════════════════════ RUNE SCRIBE ═══════════════════════════════════════════════════════
function StatRow({ icon, name, before, after }) {
  return (
    <div className="mmi-stat-row">
      <span className="mmi-stat-row__name">{name}</span>
      <span className="mmi-stat-row__before">{before}</span>
      <span className="mmi-stat-row__arrow">→</span>
      <span className="mmi-stat-row__after">{after}</span>
    </div>
  )
}

function ScribeContent() {
  return (
    <>
      <div className="mmi-scribe__col">
        <div className="mmi-scribe__label">Item Stats</div>
        <StatRow name="Raw Damage" before="12–18" after="12–18" />
        <StatRow name="Strength" before="+5" after="+5" />
        <StatRow name="Vitality" before="—" after="+15" />

        {/* AMENDMENT — PUITS (Retro forgemagie stat-pool budget): the item's remaining rune capacity. A
            plain used/total readout + bar — no formula asserted, a mechanics pass owns the real numbers. */}
        <div className="mmi-puits">
          <div className="mmi-puits__head">
            <span>Puits</span>
            <span className="mmi-puits__n">42 / 68</span>
          </div>
          <div className="mmi-puits__bar">
            <span style={{ width: '62%' }} />
          </div>
        </div>
      </div>
      <div className="mmi-scribe__col mmi-scribe__center">
        <div className="mmi-scribe__label" style={{ marginBottom: 0 }}>
          Fusion
        </div>
        <div className="mmi-dropslot mmi-dropslot--filled">
          <ItemIcon item={{ icon: SWORD.icon, category: SWORD.category }} alt={SWORD.name} />
          <span className="mmi-dropslot__name">{SWORD.name}</span>
        </div>
        <span className="mmi-plus">+</span>
        <div className="mmi-dropslot mmi-dropslot--filled">
          <ItemIcon item={{ icon: RUNE.icon, category: RUNE.category }} alt={RUNE.name} />
          <span className="mmi-dropslot__name">{RUNE.name}</span>
        </div>
        {/* AMENDMENT — no deterministic "Success 82%" preview (the outcome is genuinely random); a plain
            risk caption instead, and the result only ever shows up AFTER applying, via the toast below. */}
        <div className="mmi-chance mmi-chance--random">Outcome is random — never guaranteed</div>
        <button type="button" className="btn-gold px-8 py-3 text-[12px]">
          Apply Rune
        </button>
        <span className="mmi-scribe__note">One rune per transaction — no batch apply</span>
      </div>
      <div className="mmi-scribe__col mmi-scribe__right">
        <div className="mmi-scribe__label">Inventory</div>
        <div className="inv__grid">
          {BAG.map((it) => (
            <div key={it.id} className={`inv__cell inv__cell--filled${it.id === 'rune1' ? ' mmi-rune-cell' : ''}`}>
              <ItemIcon item={{ icon: it.icon, category: it.category }} alt={it.name} className="inv__cell-art" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function ScribeOption1() {
  return (
    <>
      <div className="mmi-scribe">
        <ScribeContent />
      </div>
      {/* AMENDMENT — outcome toast: since nothing is previewable, the result reveals itself here, after
          Apply Rune fires. Real .gw-toast (top-right stack) — a success case shown; a failure toast would
          use the same shape with the red/muted tone the house error toasts already carry. */}
      <div className="gw-toasts" aria-hidden="true">
        <div className="gw-toast">
          <span className="gw-toast__dot" />
          <span>
            Rune Applied — <b>Vitality +15</b>
          </span>
        </div>
      </div>
    </>
  )
}

function ScribeOption2() {
  return (
    <div className="mmi-drawer">
      <div className="mmi-drawer__head">Rune Scribe</div>
      <div className="mmi-scribe" style={{ border: 'none', flex: 1, background: 'transparent' }}>
        <ScribeContent />
      </div>
    </div>
  )
}

// ═══════════════════════════════════ MARKETPLACE — REDO (the 3rd tab was rejected) ═════════════════════
// NO Characters tab. BUY: "Character" is a CATEGORY in the existing list (beside Equipment/
// Pets/Runes/...) with LEVEL + CLASS filter chips — same filter language the tab already uses (the
// QTY_STEPS chip pattern from StackableLine, reused verbatim). SELL: characters are a SUB-CATEGORY inside
// the EXISTING inventory grid (InventoryPanel) — visible among your things, never a separate view; the
// listing flow is identical to items. Stackables keep the pool-row treatment (survives unchanged).
const CATEGORIES = ['Equipment', 'Pets', 'Runes', 'Consumable', 'Resources', 'Characters']
const LEVEL_BANDS = ['1–20', '21–40', '41–60+']
const CLASSES = ['Templar', 'Ranger', 'Warlock']

function ChipRow({ options, active }) {
  return (
    <div className="flex items-center border border-border" style={{ width: 'fit-content' }}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className="px-2 py-0.5 text-[9px] tracking-[0.1em] uppercase cursor-pointer transition-colors"
          style={
            o === active
              ? { color: '#c8963c', background: 'rgba(200,150,60,0.1)' }
              : { color: '#6b7280', background: 'transparent' }
          }
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function BuySide() {
  return (
    <div style={{ flex: 1 }}>
      <div className="mmi-mkt-title" style={{ alignItems: 'flex-start', padding: '0 0 10px' }}>
        <span className="text-[10px] tracking-[0.3em] uppercase font-semibold text-gold">Buy</span>
      </div>
      <div className="mmi-mkt-tabs" style={{ justifyContent: 'flex-start', padding: '0 0 8px' }}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`admin-tab${c === 'Characters' ? ' active' : ''}`}
            style={{ fontSize: 9 }}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-6 py-2 border-b border-border mb-1">
        <div className="flex flex-col gap-1.5">
          <span className="text-[8px] tracking-[0.16em] uppercase text-muted">Level</span>
          <ChipRow options={LEVEL_BANDS} active="41–60+" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[8px] tracking-[0.16em] uppercase text-muted">Class</span>
          <ChipRow options={CLASSES} active="Templar" />
        </div>
      </div>
      <div className="mmi-char-row">
        <div className="mmi-char-portrait" />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[11px] text-text font-semibold">Nyx the Warden</span>
          <span className="text-[9px] tracking-[0.1em] uppercase text-muted">Lv. 62 &middot; Templar</span>
        </div>
        <button type="button" className="btn-gold px-4 py-2 text-[10px]">
          18.5 SUI
        </button>
      </div>
      <div className="mmi-char-row" style={{ borderBottom: 'none' }}>
        <div className="mmi-char-portrait" />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[11px] text-text font-semibold">Ironhold Vane</span>
          <span className="text-[9px] tracking-[0.1em] uppercase text-muted">Lv. 58 &middot; Templar</span>
        </div>
        <button type="button" className="btn-gold px-4 py-2 text-[10px]">
          15.0 SUI
        </button>
      </div>
    </div>
  )
}

function SellSide() {
  return (
    <div style={{ flex: 1 }}>
      <div className="mmi-mkt-title" style={{ alignItems: 'flex-start', padding: '0 0 10px' }}>
        <span className="text-[10px] tracking-[0.3em] uppercase font-semibold text-gold">Sell — Inventory</span>
      </div>
      <div className="text-[8px] tracking-[0.16em] uppercase text-muted mb-1.5">Characters</div>
      <div className="mmi-bagpreview" style={{ gridTemplateColumns: 'repeat(5, 48px)', marginBottom: 14 }}>
        <div className="mmi-char-portrait" style={{ width: 48, height: 48 }} />
        <div className="mmi-char-portrait" style={{ width: 48, height: 48 }} />
      </div>
      <div className="text-[8px] tracking-[0.16em] uppercase text-muted mb-1.5">Items</div>
      <div className="mmi-bagpreview" style={{ gridTemplateColumns: 'repeat(5, 48px)', marginBottom: 14 }}>
        {BAG.map((it) => (
          <div key={it.id} className="inv__cell inv__cell--filled" style={{ width: 48, height: 48 }}>
            <ItemIcon item={{ icon: it.icon, category: it.category }} alt={it.name} className="inv__cell-art" />
          </div>
        ))}
      </div>
      <div className="mmi-mkt-row" style={{ borderTop: '1px solid var(--color-border)', borderBottom: 'none' }}>
        <ItemIcon item={{ icon: FOOD.icon, category: FOOD.category }} alt={FOOD.name} />
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] tracking-[0.1em] uppercase text-text">{FOOD.name} (stackable)</span>
          <span className="mmi-pool-live">
            <span className="mmi-pool-live__dot" />
            routes to the pool row — unchanged
          </span>
        </div>
      </div>
    </div>
  )
}

function MarketOption() {
  return (
    <div className="mmi-mkt-shell" style={{ width: 900, padding: 16 }}>
      <div className="mmi-mkt-title">
        <span className="text-[11px] tracking-[0.4em] uppercase font-semibold text-gold">Marketplace</span>
        <span className="text-[8px] tracking-[0.25em] uppercase text-muted mt-0.5">
          player-to-player trade — no Characters tab
        </span>
      </div>
      <div className="mmi-mkt-tabs">
        <button type="button" className="admin-tab admin-tab--primary active">
          Buy
        </button>
        <button type="button" className="admin-tab admin-tab--primary">
          Sell
        </button>
      </div>
      <div style={{ display: 'flex', gap: 24, padding: 16 }}>
        <BuySide />
        <div style={{ width: 1, background: 'var(--color-border)' }} />
        <SellSide />
      </div>
    </div>
  )
}

function Harness() {
  const params = new URLSearchParams(window.location.search)
  const surface = params.get('surface') ?? 'pet'
  const opt = params.get('opt') ?? '1'

  let content = null
  if (surface === 'pet') content = opt === '2' ? <PetOption2 /> : <PetOption1 />
  else if (surface === 'scribe') content = opt === '2' ? <ScribeOption2 /> : <ScribeOption1 />
  else content = <MarketOption />

  return (
    <div className="mmi-stage gw-tab">
      <span className="mmi-tag">
        {surface} — option {opt}
      </span>
      <div style={{ display: 'flex', justifyContent: 'center' }}>{content}</div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Harness />
  </StrictMode>
)
