// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.
// The fight sword's surface voice: the chip floating over the focused marker (lock / press-F
// tag) and the join/spectate modal both live here. Opening the modal ARMS the server-side
// watch (packet/spectate) so the roster hydrates and updates live; joining or spectating is
// then only a frontend commit over a stream that is already flowing.

/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- React refs and lifecycle events are mutable platform boundaries. */
import { Lock, Swords } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { content_catalog } from '../content/catalog.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useFightPrompt } from '../game/core/fight_prompt_feed.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { selected_character } from '../modules/session.ts'

import { ModalFrame } from './ModalFrame.tsx'
import { PromptChip, PromptKey, split_key_template } from './PromptChip.tsx'

const ACCESS_GROUP = 1
const PLACEMENT_WINDOW_MS = 60_000

/** both sides group-sealed: bystanders can never take a seat — the lock's own rule */
const locked_fight = (access_a: number, access_b: number): boolean =>
  access_a === ACCESS_GROUP && access_b === ACCESS_GROUP

const elapsed_label = (from_ms: number): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - from_ms) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const FightPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const prompt = useFightPrompt()
  const fight = useAppStore((state) => (prompt.focused_id ? (state.world.fights[prompt.focused_id] ?? null) : null))
  const [open_id, set_open_id] = useState<string | null>(null)

  // KeyF commits on the focused sword: placement opens the join modal, active the spectate one.
  // A group-sealed fight has no seat for you — the lock means it.
  useEffect(() => {
    const on_key = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyF' || event.repeat || !prompt.focused_id || open_id || !fight) return
      if (locked_fight(fight.access_a, fight.access_b)) return
      event.preventDefault()
      set_open_id(prompt.focused_id)
    }
    globalThis.addEventListener('keydown', on_key)
    return () => globalThis.removeEventListener('keydown', on_key)
  }, [fight, open_id, prompt.focused_id])

  if (!prompt.root) return null
  const locked = !fight || locked_fight(fight.access_a, fight.access_b)
  const spectate_only = !fight || fight.phase !== 'placement'
  const template = locked
    ? copy.world_hud.fight_locked
    : spectate_only
      ? copy.world_hud.fight_press_spectate
      : copy.world_hud.fight_press_join
  const [before, after] = split_key_template(template)
  return (
    <>
      {createPortal(
        <PromptChip>
          {locked ? (
            <Lock className="text-[#ffca57]" size={13} />
          ) : (
            <>
              {before?.trim()}
              <PromptKey label="F" />
              {after?.trim()}
            </>
          )}
        </PromptChip>,
        prompt.root
      )}
      {open_id ? <FightModal close={() => set_open_id(null)} copy={copy} fight_id={open_id} /> : null}
    </>
  )
}

/** One roster side's seats — players resolve names off the checkpoint's source map, mobs off
 *  the seed catalog; a raw id never reaches the screen. */
const TeamColumn = ({
  empty_label,
  fighters,
  label,
  players,
  unknown_name,
}: Readonly<{
  empty_label: string
  fighters: readonly {
    kind: {
      type: string
      character?: string
      owner?: string
      snapshot?: { mob_type?: string; level?: bigint | number }
    }
    team: bigint | number
  }[]
  label: string
  players: Readonly<Record<string, Readonly<{ name?: string; level?: bigint | number }>>>
  unknown_name: string
}>) => (
  <div className="grid content-start gap-2">
    <p className="border-b border-white/8 pb-1.5 font-mono text-[8px] tracking-[0.16em] text-[#c8963c] uppercase">
      {label}
    </p>
    {fighters.map((fighter, index) => {
      const player = fighter.kind.type === 'player' && fighter.kind.character ? players[fighter.kind.character] : null
      const mob = fighter.kind.type === 'mob' ? fighter.kind.snapshot : null
      const name = player?.name ?? (mob?.mob_type ? content_catalog.mob(mob.mob_type)?.mob.name : null) ?? unknown_name
      const level = player?.level ?? mob?.level ?? 0
      return (
        <div
          className="flex items-center justify-between gap-2 border border-white/8 bg-black/25 px-2 py-1.5"
          key={`${name}-${index}`}
        >
          <span className="truncate font-mono text-[10px] text-[#d8d3ca]">{name}</span>
          <span className="shrink-0 font-mono text-[8px] tracking-[0.1em] text-[#777b86] uppercase">
            LV {String(level)}
          </span>
        </div>
      )
    })}
    {fighters.length === 0 && (
      <p className="py-2 text-center font-mono text-[9px] text-[#555b66] uppercase">{empty_label}</p>
    )}
  </div>
)

/** The join/spectate modal — renders the LIVE roster off the armed watch's hydration. */
const FightModal = ({ close, copy, fight_id }: Readonly<{ close: () => void; copy: AppCopy; fight_id: string }>) => {
  const session = useAppStore((state) => state.fight)
  const row = useAppStore((state) => state.world.fights[fight_id])
  const wallet = useAppStore((state) => state.session.wallet)
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const own_row = useAppStore((state) => selected_character(state.session))
  const [, force_tick] = useState(0)
  // a COMMIT (join/spectate) hands the session over to the board — the teardown below must not
  // then disarm the very stream the committed surface lives on
  const committed = useRef(false)

  // arm on open, disarm on close — the stream IS the data
  useEffect(() => {
    dispatch_app({ type: 'fight/watch', fight: fight_id })
    return () => {
      if (!committed.current) {
        dispatch_app({ type: 'fight/watch', fight: null })
        dispatch_app({ type: 'fight/mounted', mounted: false })
        dispatch_app({ type: 'fight/closed' })
      }
    }
  }, [fight_id])

  // the elapsed clock ticks even when no packet lands
  useEffect(() => {
    const timer = setInterval(() => force_tick((tick) => tick + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!row) return null
  const checkpoint = session.checkpoint?.contract.id === fight_id ? session.checkpoint : null
  const fighters = (checkpoint?.contract.fighters ?? []) as unknown as readonly {
    kind: {
      type: string
      character?: string
      owner?: string
      snapshot?: { mob_type?: string; level?: bigint | number }
    }
    team: bigint | number
  }[]
  const players = (checkpoint?.sources.players ?? {}) as Readonly<
    Record<string, Readonly<{ name?: string; level?: bigint | number }>>
  >
  // exact when this socket witnessed the start; otherwise the window's expiry is the estimate
  const started_ms = session.started_at_ms ?? Number(row.placement_ms) + PLACEMENT_WINDOW_MS
  const text = copy.world_hud

  const team_a = fighters.filter((fighter) => fighter.team === 0)
  const team_b = fighters.filter((fighter) => fighter.team === 1)
  const pvm = team_a.length > 0 && team_b.every((fighter) => fighter.kind.type === 'mob')
  // the armed stream's contract carries the REAL access — the fight_created row invents UNSET
  // until a snapshot corrects it, so chain truth wins the moment it exists
  const contract_access = checkpoint?.contract as { access_a?: number; access_b?: number } | undefined
  const access_a = contract_access?.access_a ?? row.access_a
  const access_b = contract_access?.access_b ?? row.access_b
  const can_join = row.phase === 'placement' && !!wallet && !!selected_character_id && !locked_fight(access_a, access_b)

  const join = (team: number): void => {
    if (!wallet || !selected_character_id) return
    const custody = own_row ? { kiosk: own_row.kiosk, kiosk_cap: own_row.kiosk_cap } : undefined
    void wallet.fight
      .join({ fight: fight_id, character_id: selected_character_id, custody, team, access: 1 })
      .then(() => {
        // no mount dispatch: the seat we just took mounts the board on its own checkpoint
        // (fight.ts derives it). This click only hands the armed stream over to the board.
        committed.current = true
        close()
      })
      .catch((error: unknown) => console.error('The fight join failed.', error))
  }

  const spectate = (): void => {
    committed.current = true
    dispatch_app({ type: 'fight/mounted', mounted: true })
    close()
  }

  return (
    <ModalFrame
      close={close}
      close_label={text.fight_close}
      label={row.phase === 'placement' ? text.fight_join_title : text.fight_spectate_title}
    >
      <div className="grid gap-4 p-6">
        <header className="flex items-center gap-3">
          <Swords className="text-[#c8963c]" size={18} />
          <div>
            <h2 className="font-mono text-sm tracking-[0.16em] text-[#e8e4dc] uppercase">
              {row.phase === 'placement' ? text.fight_join_title : text.fight_spectate_title}
            </h2>
            <p className="mt-1 font-mono text-[9px] tracking-[0.14em] text-[#777b86] uppercase">
              {row.phase === 'active'
                ? `${text.fight_started_ago} ${elapsed_label(started_ms)}`
                : `${text.fight_placement} · ${Math.max(0, Math.ceil((Number(row.placement_ms) + PLACEMENT_WINDOW_MS - Date.now()) / 1000))}s`}
            </p>
          </div>
        </header>

        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
          <TeamColumn
            empty_label={text.fight_empty_side}
            fighters={team_a}
            label={text.fight_side_a}
            players={players}
            unknown_name={text.fight_unknown}
          />
          <div className="grid place-items-center font-mono text-xs tracking-[0.2em] text-[#c8963c]/70">VS</div>
          <TeamColumn
            empty_label={text.fight_empty_side}
            fighters={team_b}
            label={text.fight_side_b}
            players={players}
            unknown_name={text.fight_unknown}
          />
        </div>

        <footer className="grid gap-2">
          {row.phase === 'placement' ? (
            can_join && (
              <div className={`grid ${!pvm ? 'grid-cols-2' : ''} gap-2`}>
                <button
                  className="h-10 cursor-pointer border border-[#c8963c]/40 bg-[#c8963c]/8 font-mono text-[10px] tracking-[0.16em] text-[#e0b86b] uppercase transition hover:border-[#c8963c] hover:bg-[#c8963c]/14"
                  onClick={() => join(0)}
                  type="button"
                >
                  {text.fight_join_button}
                </button>
                {!pvm && (
                  <button
                    className="h-10 cursor-pointer border border-[#4a9eff]/40 bg-[#4a9eff]/8 font-mono text-[10px] tracking-[0.16em] text-[#67adff] uppercase transition hover:border-[#4a9eff] hover:bg-[#4a9eff]/14"
                    onClick={() => join(1)}
                    type="button"
                  >
                    {text.fight_join_button}
                  </button>
                )}
              </div>
            )
          ) : (
            <button
              className="h-10 cursor-pointer border border-[#4a9eff]/40 bg-[#4a9eff]/8 font-mono text-[10px] tracking-[0.16em] text-[#67adff] uppercase transition hover:border-[#4a9eff] hover:bg-[#4a9eff]/14"
              onClick={spectate}
              type="button"
            >
              {text.fight_spectate_button}
            </button>
          )}
          {!wallet && (
            <p className="text-center font-mono text-[8px] tracking-[0.12em] text-[#777b86] uppercase">
              {text.fight_wallet_hint}
            </p>
          )}
        </footer>
      </div>
    </ModalFrame>
  )
}
