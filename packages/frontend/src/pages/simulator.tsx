// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// /simulator — the LOCAL fight simulator's setup surface (docs/design/simulator_rebuild_spec.md).
//
// This page replaced the legacy build calculator wholesale: that one computed its own STAMINA/COOLDOWN
// balance math, which predates the live AP/MP model entirely. Nothing here computes balance — the page is a
// thin editor over the ONE page reducer (simulator/reducer.ts), whose budgets mirror the chain's, and every
// edit persists to IndexedDB through the store's persistence edge (reload-proof by construction).
//
// LAYOUT: your team on the LEFT (six roster seats), the board in the MIDDLE, the enemy team on the RIGHT
// (the six enemy start cells). Both teams are edited the same way — a seat opens a modal — because they are
// the same act: "who stands here". The editors themselves live in simulator/CharacterModal.tsx and
// simulator/MobModal.tsx; the board viewport is SimulatorBoardPane's.
//
// The right panel is a MIRROR of the red band, not a second store: each seat IS an enemy start cell, so
// clicking a red cell on the board and clicking its seat here open the same modal over the same cell.
//
// CHROME: ONE level of containment, nowhere more. A region is a micro-label plus whitespace plus at most a
// single hairline — never a bordered box holding bordered boxes holding bordered rows. The nesting this page
// used to carry (framed pane → framed seat → framed row) spent its width three times on padding and borders;
// the rhythm below spends it on content instead, and the board keeps the space it wins.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dices, Plus, Swords } from 'lucide-react'
import sdk_classes from '@aresrpg/sdk/classes'

import { EncyclopediaMobImage } from '../pages/encyclopedia/mob_image'
import { board_of } from '../simulator/board'
import { SimulatorBoardPane } from '../simulator/BoardPane'
import { CharacterModal } from '../simulator/CharacterModal'
import { MobModal, use_mob_of } from '../simulator/MobModal'
import { MAX_MOBS, MAX_ROSTER, type SimCharacter } from '../simulator/reducer'
import { boot_simulator, use_simulator } from '../simulator/store'

const GOLD = '#c8963c'
const HAIRLINE = '1px solid rgba(255,255,255,0.06)'

const CLASS_ROWS = Object.entries(sdk_classes as Record<string, { name: string }>).map(([id, row]) => ({
  id,
  name: row.name,
}))

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
 * One seat — ally or enemy, filled or empty. A ROW, not a card: the only rules it draws are the hairline that
 * separates it from the next seat and, when it is the focused one, a gold spine on its leading edge.
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
  const row = character ? CLASS_ROWS.find(({ id }) => id === character.class_id) : null
  return (
    <Seat active={active} on_open={on_open}>
      {character ? (
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[11px] truncate" style={{ color: active ? GOLD : '#e8e4dc' }}>
            {character.name}
          </span>
          <span className={`${micro} text-muted truncate`}>
            {t(`simulator.classes.${character.class_id.toUpperCase()}.display`, { defaultValue: row?.name ?? '—' })}
          </span>
          <span className={micro} style={{ color: GOLD, opacity: 0.7 }}>
            {t('simulator.level')} {character.level}
          </span>
        </span>
      ) : (
        <EmptySeat text={t('simulator.new_character')} />
      )}
    </Seat>
  )
}

/** One enemy start cell as a roster row — the board's red band, read back as a list. */
function MobSeat({ cell, on_open }: Readonly<{ cell: number; on_open: () => void }>) {
  const { t } = useTranslation()
  const pick = use_simulator((state) => state.mob_picks[cell])
  const mob = use_mob_of(pick?.template_id)

  return (
    <Seat active={false} on_open={on_open}>
      {pick && mob ? (
        <>
          <EncyclopediaMobImage mob={mob} className="w-7 h-7 shrink-0" style={{ imageRendering: 'pixelated' }} />
          <span className="flex flex-col min-w-0 flex-1">
            <span className="text-[11px] truncate" style={{ color: '#e8e4dc' }}>
              {mob.name}
            </span>
            <span className={micro} style={{ color: '#ff8b6b', opacity: 0.8 }}>
              {t('simulator.level')} {pick.level}
            </span>
          </span>
        </>
      ) : pick ? (
        // A stored seat whose corpus row is gone — named, never silently blank.
        <span className={`${micro}`} style={{ color: '#ff9f43' }}>
          {t('simulator.mob_unpublished', { id: pick.template_id })}
        </span>
      ) : (
        <EmptySeat text={t('simulator.pick_mob')} />
      )}
    </Seat>
  )
}

export function SimulatorPage() {
  const { t } = useTranslation()
  const roster = use_simulator((state) => state.roster)
  const focus_id = use_simulator((state) => state.focus_id)
  const seed = use_simulator((state) => state.seed)
  const anchor_nonce = use_simulator((state) => state.anchor_nonce)
  const mob_picks = use_simulator((state) => state.mob_picks)
  const input = use_simulator((state) => state.input)
  /** null = closed · 'new' = an empty roster seat · an id = that character's editor. */
  const [editing, set_editing] = useState<string | null>(null)
  const [mob_cell, set_mob_cell] = useState<number | null>(null)

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
      </div>

      {/* THREE PANES — your team · the board · the enemy team */}
      {/* THREE REGIONS — separated by gutters and single hairlines, not by three nested frames. */}
      <div className="flex-1 min-h-0 grid gap-6 lg:gap-8 grid-cols-1 lg:grid-cols-[230px_1fr_230px] lg:divide-x lg:divide-white/[0.06]">
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

        <Pane title={t('simulator.board')} className="min-h-[220px] lg:px-8">
          <SimulatorBoardPane />
        </Pane>

        <Pane title={t('simulator.mob_team')} className="lg:pl-8">
          <div className="grid grid-cols-2 lg:grid-cols-1">
            {enemy_cells.map((cell) => (
              <MobSeat key={cell} cell={cell} on_open={() => set_mob_cell(cell)} />
            ))}
          </div>
          {enemy_cells.length === 0 && <span className={`${micro} text-muted`}>{t('simulator.no_mobs')}</span>}
        </Pane>
      </div>

      {editing !== null && (
        <CharacterModal
          key={editing}
          character={editing_character}
          on_close={() => set_editing(null)}
          on_created={(id) => set_editing(id)}
        />
      )}
      {mob_cell !== null && (
        <MobModal
          key={mob_cell}
          cell={mob_cell}
          pick={mob_picks[mob_cell] ?? null}
          on_close={() => set_mob_cell(null)}
        />
      )}
    </div>
  )
}
