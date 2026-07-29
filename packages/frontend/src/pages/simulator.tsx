// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// /simulator — the LOCAL fight simulator's setup surface (docs/design/simulator_rebuild_spec.md).
//
// This page replaced the legacy build calculator wholesale: that one computed its own STAMINA/COOLDOWN
// balance math, which predates the live AP/MP model entirely. Nothing here computes balance — the page is a
// thin editor over the ONE page reducer (simulator/reducer.ts), whose budgets mirror the chain's, and every
// edit persists to IndexedDB through the store's persistence edge (reload-proof by construction).
//
// LAYOUT: your roster on the LEFT (six character slots), the board in the MIDDLE, the enemy line-up on the
// RIGHT (the six enemy start cells). WHO STANDS WHERE IS THE BOARD'S QUESTION (#883): a start cell opens its
// own picker at the cell and empties on a second click, so neither side panel places anything. The left one
// is the roster — a slot opens that character's EDITOR (simulator/CharacterModal.tsx) — and the right one is
// a read-out of the mob composition the red band currently holds, with no click handler at all.
//
// The right panel is a MIRROR of the red band, not a second store: each row IS an enemy start cell, read
// back out of the same `mob_picks`, so it cannot drift from what the board shows.
//
// CHROME: ONE level of containment, nowhere more. A region is a micro-label plus whitespace plus at most a
// single hairline — never a bordered box holding bordered boxes holding bordered rows. The nesting this page
// used to carry (framed pane → framed seat → framed row) spent its width three times on padding and borders;
// the rhythm below spends it on content instead, and the board keeps the space it wins.

import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dices, Play, Plus, Square, Swords } from 'lucide-react'
import { slugs } from 'virtual:item_catalog'

import { EncyclopediaMobImage } from '../pages/encyclopedia/mob_image'
import { board_of } from '../simulator/board'
import { SimulatorBoardPane } from '../simulator/BoardPane'
import { CharacterModal } from '../simulator/CharacterModal'
import { CharacterRow } from '../simulator/CharacterRow'
import { build_mob } from '../simulator/content.js'
import { use_mob_of } from '../simulator/MobModal'
import { MAX_MOBS, MAX_ROSTER, type SimCharacter } from '../simulator/reducer'
import { boot_simulator, use_simulator } from '../simulator/store'
import { use_sim_fight } from '../simulator/use_sim_fight.js'

const GOLD = '#c8963c'
const HAIRLINE = '1px solid rgba(255,255,255,0.06)'

// The production fight surface, LAZY: it is the heaviest module tree the app has (the fight core, the
// tactical board, the wallet-aware world shell) and a setup session never enters it. Mounted only once the
// page is in its fight phase — which is also what keeps this page renderable outside a browser.
const SimulatorFightHud = lazy(() =>
  import('../simulator/FightHud.jsx').then((m) => ({ default: m.SimulatorFightHud }))
)

const micro = 'text-[9px] tracking-[0.22em] uppercase'

function Label({ text }: Readonly<{ text: string }>) {
  return <span className={`${micro} font-semibold text-muted`}>{text}</span>
}

/** A region: a micro-label, a hairline under it, and content. No frame, no fill, no inner padding pyramid. */
function Pane({
  title,
  children,
  className = '',
}: Readonly<{ title: string; children: ReactNode; className?: string }>) {
  return (
    <section className={`flex flex-col min-h-0 ${className}`}>
      <header className="pb-2 mb-3" style={{ borderBottom: HAIRLINE }}>
        <Label text={title} />
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5">{children}</div>
    </section>
  )
}

/**
 * One ROSTER slot, filled or empty. A ROW, not a card: the only rules it draws are the hairline that separates
 * it from the next slot and, when it is the focused one, a gold spine on its leading edge. It opens the
 * character EDITOR — placement is the board's, so this is the only thing a slot still does.
 */
function Seat({ active, on_open, children }: Readonly<{ active: boolean; on_open: () => void; children: ReactNode }>) {
  return (
    <button
      type="button"
      className="py-2.5 pr-1 text-left cursor-pointer transition-colors flex items-center gap-2.5 min-h-[52px] hover:bg-white/[0.03]"
      style={{
        borderBottom: HAIRLINE,
        borderLeft: `2px solid ${active ? GOLD : 'transparent'}`,
        paddingLeft: '10px',
      }}
      onClick={on_open}
    >
      {children}
    </button>
  )
}

function EmptySeat({ text }: Readonly<{ text: string }>) {
  return (
    <span className="flex items-center gap-1 text-muted">
      <Plus size={12} />
      <span className={micro}>{text}</span>
    </span>
  )
}

function RosterSeat({
  character,
  active,
  on_open,
}: Readonly<{ character: SimCharacter | null; active: boolean; on_open: () => void }>) {
  const { t } = useTranslation()
  return (
    <Seat active={active} on_open={on_open}>
      {character ? (
        // THE row — the same one the board's picker offers (simulator/CharacterRow.tsx). Two surfaces asking
        // "which character?" must not answer in two visual languages.
        <CharacterRow
          character={character}
          active={active}
          t={t as unknown as (key: string, params?: object) => string}
        />
      ) : (
        <EmptySeat text={t('simulator.new_character')} />
      )}
    </Seat>
  )
}

/**
 * One enemy start cell, READ-ONLY (#883 ③): the board's red band shown as a list. It carries no handler on
 * purpose — a mob is picked, levelled and removed on its own cell, and a second door onto the same seat is
 * exactly the two-panel dance this page stopped asking for.
 */
function MobRow({ cell }: Readonly<{ cell: number }>) {
  const { t } = useTranslation()
  const pick = use_simulator((state) => state.mob_picks[cell])
  const mob = use_mob_of(pick?.template_id)
  const built = mob && pick ? build_mob(mob, pick.level) : null

  return (
    <div
      className="py-2.5 pr-1 flex items-center gap-2.5 min-h-[52px]"
      style={{ borderBottom: HAIRLINE, paddingLeft: '10px' }}
    >
      {pick && mob ? (
        <>
          <EncyclopediaMobImage mob={mob} className="w-7 h-7 shrink-0" style={{ imageRendering: 'pixelated' }} />
          <span className="flex flex-col min-w-0 flex-1">
            <span className="text-[11px] truncate" style={{ color: '#e8e4dc' }}>
              {mob.name}
            </span>
            <span className={micro} style={{ color: '#ff8b6b', opacity: 0.8 }}>
              {t('simulator.level')} {pick.level} · {t('simulator.mob_hp', { hp: built?.hp ?? 0 })}
            </span>
          </span>
          {/* S2 — a mob whose combat block was never published is BADGED, never silently completed. */}
          {built && !built.combat_block_published && (
            <span className={micro} style={{ color: GOLD }} title={t('simulator.combat_block_hint')}>
              {t('simulator.combat_block_unpublished')}
            </span>
          )}
        </>
      ) : pick ? (
        // A stored seat whose corpus row is gone — named, never silently blank.
        <span className={`${micro}`} style={{ color: '#ff9f43' }}>
          {t('simulator.mob_unpublished', { id: pick.template_id })}
        </span>
      ) : (
        <span className={`${micro} text-muted`} style={{ opacity: 0.45 }}>
          {t('simulator.seat_empty')}
        </span>
      )}
    </div>
  )
}

/**
 * START / STOP (#883 ⑤ · spec §4.7) — the page's one fight control, in the top bar where the spec's own
 * chrome sketch puts it. It is a full gold button the moment a character stands on the board: starting a
 * fight is the point of the page, and it had no door at all until now.
 */
function FightControls() {
  const { t } = useTranslation()
  const { phase, can_start, blocked, start, stop } = use_sim_fight()

  return (
    <div className="flex items-center gap-3 ml-auto">
      {blocked && (
        <span className={micro} style={{ color: '#ff9f43' }} role="status">
          {t(`simulator.fight_blocked_${blocked}`, { defaultValue: t('simulator.fight_blocked_empty_roster') })}
        </span>
      )}
      {phase === 'fight' ? (
        <button
          type="button"
          className={`${micro} flex items-center gap-2 px-4 py-2 cursor-pointer`}
          style={{ border: '1px solid rgba(255,95,95,0.5)', color: '#ff5f5f' }}
          onClick={stop}
        >
          <Square size={11} />
          {t('simulator.stop_fight')}
        </button>
      ) : (
        <button
          type="button"
          className={`${micro} flex items-center gap-2 px-4 py-2 cursor-pointer disabled:cursor-not-allowed`}
          style={
            can_start
              ? { border: `1px solid ${GOLD}`, color: GOLD, background: 'rgba(200,150,60,0.12)' }
              : { border: HAIRLINE, color: '#6b7280' }
          }
          disabled={!can_start}
          title={can_start ? undefined : t('simulator.fight_blocked_empty_roster')}
          onClick={start}
        >
          <Play size={11} />
          {t('simulator.start_fight')}
        </button>
      )}
    </div>
  )
}

export function SimulatorPage() {
  const { t } = useTranslation()
  const roster = use_simulator((state) => state.roster)
  const focus_id = use_simulator((state) => state.focus_id)
  const seed = use_simulator((state) => state.seed)
  const anchor_nonce = use_simulator((state) => state.anchor_nonce)
  const mob_picks = use_simulator((state) => state.mob_picks)
  const phase = use_simulator((state) => state.phase)
  const input = use_simulator((state) => state.input)
  /** null = closed · 'new' = an empty roster seat · an id = that character's editor. */
  const [editing, set_editing] = useState<string | null>(null)

  // ONE boot per mount: IndexedDB is read at the edge and re-enters as the `hydrated` input; the disposer
  // flushes whatever is still debounced when the page unmounts.
  useEffect(() => {
    const booted = boot_simulator()
    return () => void booted.then((dispose) => dispose())
  }, [])

  const slots = Array.from({ length: MAX_ROSTER }, (_, index) => roster[index] ?? null)
  // The enemy band IS the right panel's seat list — derived, never stored. Memoised because the board is a
  // full generation and this page re-renders on every keystroke in an open editor.
  const enemy_cells = useMemo(() => board_of(seed, anchor_nonce).start_cells_b.slice(0, MAX_MOBS), [seed, anchor_nonce])
  const editing_character = editing === 'new' ? null : (roster.find(({ id }) => id === editing) ?? null)
  const setup = phase === 'setup'

  return (
    <div className="flex flex-col gap-5 p-4 lg:px-6 lg:pt-16 lg:pb-5 h-full min-h-0">
      {/* TOP BAR */}
      <div className="flex flex-wrap items-center gap-6 pb-3" style={{ borderBottom: HAIRLINE }}>
        <span className="text-[11px] tracking-[0.3em] uppercase" style={{ color: GOLD }}>
          {t('simulator.title')}
        </span>
        <div className="flex items-center gap-2">
          <Label text={t('simulator.seed')} />
          <span className="text-[11px]" style={{ color: '#e8e4dc' }}>
            {seed.toString(16).padStart(8, '0')}
          </span>
          <button
            type="button"
            className="cursor-pointer text-muted hover:text-white"
            title={t('simulator.reroll')}
            onClick={() => input({ type: 'seed_set', seed: Math.floor(Math.random() * 0xffffffff) })}
          >
            <Dices size={13} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Label text={t('simulator.roster')} />
          <span className="text-[11px]" style={{ color: '#e8e4dc' }}>
            {roster.length}/{MAX_ROSTER}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Swords size={11} className="text-muted" />
          <Label text={t('simulator.mob_team')} />
          <span className="text-[11px]" style={{ color: '#e8e4dc' }}>
            {Object.keys(mob_picks).length}/{MAX_MOBS}
          </span>
        </div>
        <FightControls />
      </div>

      {/* THREE PANES in setup — your team · the board · the enemy team; separated by gutters and single
          hairlines, not by three nested frames.

          THE FIGHT OWNS THE SCREEN (#927). Both side panels are SETUP surfaces: a roster whose slots open an
          editor, and a read-out of a line-up the sim has already snapshotted. Left standing mid-fight they
          offer edits that cannot land and duplicate the fighters the board is already showing — so they
          unmount with the phase and the board takes the width they were spending. STOP restores all three. */}
      <div
        className={`flex-1 min-h-0 grid gap-6 lg:gap-8 grid-cols-1 ${
          setup ? 'lg:grid-cols-[230px_1fr_230px] lg:divide-x lg:divide-white/[0.06]' : 'lg:grid-cols-1'
        }`}
      >
        {setup && (
          <Pane title={t('simulator.roster')} className="lg:pr-8">
            <div className="grid grid-cols-2 lg:grid-cols-1">
              {slots.map((character, index) => (
                <RosterSeat
                  key={character?.id ?? `empty_${index}`}
                  character={character}
                  active={character !== null && character.id === focus_id}
                  on_open={() => {
                    if (character) input({ type: 'focus_set', id: character.id })
                    set_editing(character ? character.id : 'new')
                  }}
                />
              ))}
            </div>
          </Pane>
        )}

        <Pane title={t('simulator.board')} className={`min-h-[220px] ${setup ? 'lg:px-8' : ''}`}>
          <SimulatorBoardPane />
        </Pane>

        {/* READ-ONLY (#883 ③): what the red band currently holds. Every verb lives on the cell itself. */}
        {setup && (
          <Pane title={t('simulator.mob_team')} className="lg:pl-8">
            <div className="grid grid-cols-2 lg:grid-cols-1">
              {enemy_cells.map((cell) => (
                <MobRow key={cell} cell={cell} />
              ))}
            </div>
            {enemy_cells.length === 0 && <span className={`${micro} text-muted`}>{t('simulator.no_mobs')}</span>}
          </Pane>
        )}
      </div>

      {editing !== null && (
        <CharacterModal
          key={editing}
          character={editing_character}
          on_close={() => set_editing(null)}
          on_created={(id) => set_editing(id)}
        />
      )}
      {/* The production fight surface. It self-gates on the fight core's own phase machine; the page gate
          here is the LOAD gate — a setup session must not pay for the module tree at all. */}
      {phase === 'fight' && (
        <Suspense fallback={null}>
          <SimulatorFightHud slug_by_name={slugs} />
        </Suspense>
      )}
    </div>
  )
}
