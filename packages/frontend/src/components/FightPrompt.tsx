// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.
// The fight sword's surface voice: public marker nametags and the close-range join/spectate
// modal both live here. Opening the modal ARMS the server-side
// watch (packet/spectate) so the roster hydrates and updates live; joining or spectating is
// then only a frontend commit over a stream that is already flowing.

/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- React refs and lifecycle events are mutable platform boundaries. */
import { Lock, Swords, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { content_catalog } from '../content/catalog.ts'
import { mob_icon } from '../content/assets.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useFightPrompt } from '../game/core/fight_prompt_feed.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { selected_character } from '../modules/session.ts'
import type { FightSessionState } from '../modules/fight.ts'
import { selected_party } from '../modules/party.ts'

import { ModalFrame } from './ModalFrame.tsx'
import { NametagCard } from './NametagCard.tsx'
import { PromptKey, split_key_template } from './PromptChip.tsx'

const ACCESS_GROUP = 1
const ACCESS_INVITED = 2
const ACCESS_UNSET = 255
const PLACEMENT_WINDOW_MS = 60_000

type FightAccess = Readonly<{
  phase: string
  access_a: bigint | number
  access_b: bigint | number
  opener_a: string | null
  opener_b: string | null
}>

export const fight_prompt_action = (phase: string): 'join' | 'spectate' => (phase === 'placement' ? 'join' : 'spectate')

export const fight_prompt_checkpoint = (session: Pick<FightSessionState, 'checkpoint' | 'cached'>, fight_id: string) =>
  session.checkpoint?.contract.id === fight_id ? session.checkpoint : (session.cached[fight_id] ?? null)

export const fight_joinable_teams = (
  fight: FightAccess,
  character_id: string | null,
  party_members: readonly string[] = []
): readonly number[] => {
  if (fight.phase !== 'placement') return Object.freeze([])
  const eligible = (access: bigint | number, opener: string | null): boolean => {
    const normalized_access = Number(access)
    return (
      normalized_access === 0 ||
      normalized_access === ACCESS_UNSET ||
      (normalized_access === ACCESS_GROUP &&
        opener !== null &&
        character_id !== null &&
        party_members.includes(opener) &&
        party_members.includes(character_id)) ||
      (normalized_access === ACCESS_INVITED && opener === character_id)
    )
  }
  return Object.freeze(
    [
      [fight.access_a, fight.opener_a],
      [fight.access_b, fight.opener_b],
    ].flatMap(([access, opener], team) => (eligible(access as bigint | number, opener as string | null) ? [team] : []))
  )
}

const elapsed_label = (from_ms: number): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - from_ms) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const FightPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const prompt = useFightPrompt()
  const fights = useAppStore((state) => state.world.fights)
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const fight = prompt.focused_id ? (fights[prompt.focused_id] ?? null) : null
  const [open_id, set_open_id] = useState<string | null>(null)

  // The sword is public world discovery. Access decides which buttons work inside the modal;
  // it never suppresses the nametag or the interaction that explains the fight.
  useEffect(() => {
    const on_key = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyF' || event.repeat || !prompt.focused_id || open_id || !fight) return
      event.preventDefault()
      set_open_id(prompt.focused_id)
    }
    globalThis.addEventListener('keydown', on_key)
    return () => globalThis.removeEventListener('keydown', on_key)
  }, [fight, open_id, prompt.focused_id])

  return (
    <>
      {Object.entries(prompt.roots).map(([fight_id, root]) => {
        const row = fights[fight_id]
        if (!row) return null
        const action = fight_prompt_action(row.phase)
        const interactive = prompt.focused_id === fight_id
        const template = action === 'spectate' ? copy.world_hud.fight_press_spectate : copy.world_hud.fight_press_join
        const [before, after] = split_key_template(template)
        return createPortal(
          <NametagCard
            lines={
              interactive
                ? [
                    {
                      key: 'press',
                      text: (
                        <span className="inline-flex items-center gap-1.5">
                          {before?.trim()}
                          <PromptKey label="F" />
                          {after?.trim()}
                        </span>
                      ),
                    },
                  ]
                : []
            }
            name={action === 'spectate' ? copy.world_hud.fight_spectate_title : copy.world_hud.fight_join_title}
          />,
          root,
          fight_id
        )
      })}
      {open_id ? (
        <FightModal
          key={`${selected_character_id ?? 'none'}:${open_id}`}
          close={() => set_open_id(null)}
          copy={copy}
          fight_id={open_id}
        />
      ) : null}
    </>
  )
}

type FightRosterFighter = Readonly<{
  kind: Readonly<{
    type: string
    character?: string
    owner?: string
    snapshot?: Readonly<{ mob_type?: string; level?: bigint | number }>
  }>
  team: bigint | number
}>
type FightPlayers = Readonly<Record<string, Readonly<{ name?: string; level?: bigint | number }>>>

/** One roster side's seats — players resolve names off the checkpoint's source map, mobs off
 *  the seed catalog; a raw id never reaches the screen. */
const TeamColumn = ({
  action,
  empty_label,
  fighters,
  label,
  players,
  unknown_name,
}: Readonly<{
  action: ReactNode
  empty_label: string
  fighters: readonly FightRosterFighter[]
  label: string
  players: FightPlayers
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
      const portrait = mob?.mob_type ? mob_icon(mob.mob_type) : null
      return (
        <div
          className="flex min-h-12 items-center gap-2 border border-white/8 bg-black/25 p-1.5"
          data-fight-fighter={fighter.kind.type}
          key={`${name}-${index}`}
        >
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden border border-white/10 bg-surface-high text-[#777b86]">
            {portrait ? (
              <img alt="" className="size-full object-contain" src={portrait} />
            ) : (
              <UserRound aria-hidden="true" size={19} strokeWidth={1.3} />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#d8d3ca]">{name}</span>
          <span className="shrink-0 font-mono text-[8px] tracking-[0.1em] text-[#777b86] uppercase">
            LV {String(level)}
          </span>
        </div>
      )
    })}
    {fighters.length === 0 && (
      <p className="py-2 text-center font-mono text-[9px] text-[#555b66] uppercase">{empty_label}</p>
    )}
    {action}
  </div>
)

export const FightTeams = ({
  action_a,
  action_b,
  empty_label,
  label_a,
  label_b,
  players,
  team_a,
  team_b,
  unknown_name,
}: Readonly<{
  action_a: ReactNode
  action_b: ReactNode
  empty_label: string
  label_a: string
  label_b: string
  players: FightPlayers
  team_a: readonly FightRosterFighter[]
  team_b: readonly FightRosterFighter[]
  unknown_name: string
}>) => (
  <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3" data-fight-roster="">
    <TeamColumn
      action={action_a}
      empty_label={empty_label}
      fighters={team_a}
      label={label_a}
      players={players}
      unknown_name={unknown_name}
    />
    <div className="grid place-items-center font-mono text-xs tracking-[0.2em] text-[#c8963c]/70">VS</div>
    <TeamColumn
      action={action_b}
      empty_label={empty_label}
      fighters={team_b}
      label={label_b}
      players={players}
      unknown_name={unknown_name}
    />
  </div>
)

const JoinButton = ({
  enabled,
  locked,
  on_join,
  text,
  team,
}: Readonly<{
  enabled: boolean
  locked: boolean
  on_join: () => void
  text: AppCopy['world_hud']
  team: 0 | 1
}>) => (
  <button
    className={`mt-auto flex h-10 items-center justify-center gap-2 border font-mono text-[10px] tracking-[0.16em] uppercase transition ${
      team === 0
        ? 'border-[#c8963c]/40 bg-[#c8963c]/8 text-[#e0b86b] enabled:hover:border-[#c8963c] enabled:hover:bg-[#c8963c]/14'
        : 'border-[#4a9eff]/40 bg-[#4a9eff]/8 text-[#67adff] enabled:hover:border-[#4a9eff] enabled:hover:bg-[#4a9eff]/14'
    } enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-35`}
    disabled={!enabled}
    onClick={on_join}
    title={locked ? text.fight_locked : undefined}
    type="button"
  >
    {locked && <Lock size={12} />}
    {text.fight_join_button}
  </button>
)

/** The join/spectate modal — renders the LIVE roster off the armed watch's hydration. */
const FightModal = ({ close, copy, fight_id }: Readonly<{ close: () => void; copy: AppCopy; fight_id: string }>) => {
  const session = useAppStore((state) => state.fight)
  const row = useAppStore((state) => state.world.fights[fight_id])
  const wallet = useAppStore((state) => state.session.wallet)
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const own_row = useAppStore((state) => selected_character(state.session))
  const party = useAppStore(selected_party)
  const [, force_tick] = useState(0)
  // a COMMIT (join/spectate) hands the session over to the board — the teardown below must not
  // then disarm the very stream the committed surface lives on
  const committed = useRef(false)

  // arm on open, disarm on close — the stream IS the data
  useEffect(() => {
    if (selected_character_id)
      dispatch_app({ type: 'fight/watch', character_id: selected_character_id, fight: fight_id })
    return () => {
      if (!selected_character_id) return
      dispatch_app(
        committed.current
          ? { type: 'fight/watch', character_id: selected_character_id, fight: null }
          : { type: 'fight/preview_closed', character_id: selected_character_id, fight: fight_id }
      )
    }
  }, [fight_id, selected_character_id])

  // the elapsed clock ticks even when no packet lands
  useEffect(() => {
    const timer = setInterval(() => force_tick((tick) => tick + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!row) return null
  const checkpoint = fight_prompt_checkpoint(session, fight_id)
  const phase = checkpoint
    ? checkpoint.contract.ended
      ? 'ended'
      : checkpoint.contract.round === 0n
        ? 'placement'
        : 'active'
    : row.phase
  const fighters = (checkpoint?.contract.fighters ?? []) as unknown as readonly FightRosterFighter[]
  const players = (checkpoint?.sources.players ?? {}) as FightPlayers
  // exact when this socket witnessed the start; otherwise the window's expiry is the estimate
  const started_ms = session.started_at_ms ?? Number(row.placement_ms) + PLACEMENT_WINDOW_MS
  const text = copy.world_hud

  const team_a = fighters.filter((fighter) => Number(fighter.team) === 0)
  const team_b = fighters.filter((fighter) => Number(fighter.team) === 1)
  // the armed stream's contract carries the REAL access — the fight_created row invents UNSET
  // until a snapshot corrects it, so chain truth wins the moment it exists
  const access_a = checkpoint?.contract.access_a ?? row.access_a
  const access_b = checkpoint?.contract.access_b ?? row.access_b
  const admitted_teams = fight_joinable_teams(
    { ...row, access_a, access_b },
    selected_character_id,
    party?.members.map(({ character_id }) => character_id) ?? []
  )
  const already_seated = fighters.some(
    (fighter) => fighter.kind.type === 'player' && fighter.kind.character === selected_character_id
  )
  const team_has_room = (team: 0 | 1): boolean => {
    if (!checkpoint) return false
    const side = team === 0 ? team_a : team_b
    const starts = team === 0 ? checkpoint.contract.board.start_cells_a : checkpoint.contract.board.start_cells_b
    return !side.some((fighter) => fighter.kind.type === 'mob') && side.length < starts.length
  }
  const joinable_teams = admitted_teams.filter(
    (team): team is 0 | 1 => !already_seated && (team === 0 || team === 1) && team_has_room(team)
  )
  const can_submit = !!wallet && !!selected_character_id && !!checkpoint

  const join = (team: number): void => {
    if (!wallet || !selected_character_id) return
    const custody = own_row ? { kiosk: own_row.kiosk, kiosk_cap: own_row.kiosk_cap } : undefined
    const grouped = Number(team === 0 ? access_a : access_b) === ACCESS_GROUP
    void wallet.fight
      .join({
        fight: fight_id,
        character_id: selected_character_id,
        custody,
        team,
        access: 0,
        ...(grouped && party ? { party: party.id } : {}),
      })
      .then(() => {
        // no mount dispatch: the seat we just took mounts the board on its own checkpoint
        // (fight.ts derives it). This click only hands the armed stream over to the board.
        committed.current = true
        close()
      })
      .catch((error: unknown) => console.error('The fight join failed.', error))
  }

  const spectate = (): void => {
    if (!selected_character_id || !checkpoint) return
    committed.current = true
    dispatch_app({ type: 'fight/spectating', character_id: selected_character_id, fight: fight_id })
    close()
  }

  return (
    <ModalFrame
      close={close}
      close_label={text.fight_close}
      label={phase === 'placement' ? text.fight_join_title : text.fight_spectate_title}
      max_width="max-w-2xl"
    >
      <div className="grid gap-4 p-6">
        <header className="flex items-center gap-3">
          <Swords className="text-[#c8963c]" size={18} />
          <div>
            <h2 className="font-mono text-sm tracking-[0.16em] text-[#e8e4dc] uppercase">
              {phase === 'placement' ? text.fight_join_title : text.fight_spectate_title}
            </h2>
            <p className="mt-1 font-mono text-[9px] tracking-[0.14em] text-[#777b86] uppercase">
              {phase === 'active'
                ? `${text.fight_started_ago} ${elapsed_label(started_ms)}`
                : `${text.fight_placement} · ${Math.max(0, Math.ceil((Number(row.placement_ms) + PLACEMENT_WINDOW_MS - Date.now()) / 1000))}s`}
            </p>
          </div>
        </header>

        {checkpoint ? (
          <FightTeams
            action_a={
              phase === 'placement' ? (
                <JoinButton
                  enabled={can_submit && joinable_teams.includes(0)}
                  locked={!joinable_teams.includes(0)}
                  on_join={() => join(0)}
                  team={0}
                  text={text}
                />
              ) : null
            }
            action_b={
              phase === 'placement' ? (
                <JoinButton
                  enabled={can_submit && joinable_teams.includes(1)}
                  locked={!joinable_teams.includes(1)}
                  on_join={() => join(1)}
                  team={1}
                  text={text}
                />
              ) : null
            }
            empty_label={text.fight_empty_side}
            label_a={text.fight_side_a}
            label_b={text.fight_side_b}
            players={players}
            team_a={team_a}
            team_b={team_b}
            unknown_name={text.fight_unknown}
          />
        ) : (
          <div
            className="grid min-h-32 place-items-center border border-white/8 bg-black/20 font-mono text-[9px] tracking-[0.16em] text-[#777b86] uppercase"
            data-fight-roster-loading=""
          >
            {copy.loading_universe}
          </div>
        )}

        <footer className="grid gap-2">
          {phase !== 'placement' ? (
            <button
              className="h-10 cursor-pointer border border-[#4a9eff]/40 bg-[#4a9eff]/8 font-mono text-[10px] tracking-[0.16em] text-[#67adff] uppercase transition hover:border-[#4a9eff] hover:bg-[#4a9eff]/14 disabled:cursor-wait disabled:opacity-35"
              disabled={!checkpoint}
              onClick={spectate}
              type="button"
            >
              {text.fight_spectate_button}
            </button>
          ) : null}
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
