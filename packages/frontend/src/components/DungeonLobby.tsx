// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, DoorOpen, LockKeyhole, Swords, UsersRound } from 'lucide-react'
import type { DungeonLobbyPlayerRow } from '@aresrpg/protocol'
import { useState } from 'react'

import { mob_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { dungeon_lobby_key, selected_dungeon_pending, selected_dungeon_run } from '../modules/dungeon.ts'
import { selected_party } from '../modules/party.ts'
import { selected_character } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { Chat } from './Chat.tsx'

type RoomState = 'cleared' | 'current' | 'mysterious'
export const dungeon_room_state = (room: number, current: number): RoomState =>
  room < current ? 'cleared' : room === current ? 'current' : 'mysterious'

export const dungeon_fight_joinable = (
  fight: Readonly<{ phase: string; access: number; opener: string | null }>,
  party_members: readonly string[]
): boolean =>
  fight.phase === 'placement' && (fight.access === 0 || (fight.opener !== null && party_members.includes(fight.opener)))

export const current_dungeon_room_players = (
  players: readonly DungeonLobbyPlayerRow[],
  room: number,
  current_room: number
): readonly DungeonLobbyPlayerRow[] => (room === current_room ? players.filter((player) => player.room === room) : [])

export const DungeonLobby = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const state = useAppStore((value) => value)
  const character = selected_character(state.session)
  const run = selected_dungeon_run(state)
  const authored = run ? content_catalog.world(run.world)?.dungeon : null
  const lobby = run ? state.dungeon.lobbies[dungeon_lobby_key(run)] : null
  const party = selected_party(state)
  const party_members = party?.members.map(({ character_id }) => character_id) ?? []
  const [access, set_access] = useState<0 | 1>(0)
  const [abandon_armed_for, set_abandon_armed_for] = useState<string | null>(null)
  const text = copy_text(copy.world_hud)
  if (!character || !run || !authored) return null
  const room_fights = lobby?.fights.filter(({ room }) => room === run.room) ?? []
  const room_players = (room: number) => current_dungeon_room_players(lobby?.players ?? [], room, run.room)
  const current_players = room_players(run.room)
  const pending = selected_dungeon_pending(state)

  return (
    <section
      className="pointer-events-auto absolute inset-[clamp(12px,3vw,42px)] flex flex-col overflow-hidden rounded-xl border border-[#466070]/50 border-t-[#67b8dc] bg-[linear-gradient(145deg,rgba(8,13,18,0.97),rgba(12,20,25,0.94))] shadow-[0_28px_100px_rgba(0,0,0,0.72),0_0_70px_rgba(43,145,190,0.10)]"
      data-dungeon-expedition
    >
      <header className="flex shrink-0 items-center gap-4 border-b border-white/8 px-6 py-4">
        <div className="grid size-12 place-items-center border border-[#67b8dc]/35 bg-[#67b8dc]/8">
          <DoorOpen className="text-[#67b8dc]" size={25} strokeWidth={1.3} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[8px] tracking-[0.26em] text-[#67b8dc] uppercase">{text('dungeon_instance')}</p>
          <h2 className="mt-1 truncate text-lg tracking-[0.1em] text-[#e7e3da] uppercase">
            {run.world} · {text('dungeon_room').replace('{{room}}', String(run.room))}
          </h2>
        </div>
        <div className="hidden items-center gap-2 border border-white/8 bg-black/25 px-3 py-2 text-[8px] tracking-[0.16em] text-[#8b949e] uppercase sm:flex">
          <UsersRound size={13} /> {Math.max(1, current_players.length)} {text('dungeon_explorers')}
        </div>
        <button
          className={`h-9 cursor-pointer border px-4 text-[8px] tracking-[0.16em] uppercase ${
            abandon_armed_for === character.id
              ? 'border-[#ff5a72]/55 bg-[#ff5a72]/10 text-[#ff8292]'
              : 'border-white/10 text-[#777f89] hover:border-[#ff5a72]/35 hover:text-[#ff8292]'
          }`}
          disabled={pending !== null}
          onClick={() => {
            if (abandon_armed_for !== character.id) set_abandon_armed_for(character.id)
            else dispatch_app({ type: 'dungeon/abandon' })
          }}
          type="button"
        >
          {abandon_armed_for === character.id ? text('dungeon_confirm_abandon') : text('dungeon_abandon')}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(250px,0.8fr)_minmax(360px,1.35fr)] gap-5 overflow-hidden p-5 max-[850px]:grid-cols-1 max-[850px]:overflow-y-auto">
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden pr-1">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="mb-3 text-[8px] tracking-[0.22em] text-[#7c8790] uppercase">{text('dungeon_route')}</p>
            <div className="grid gap-2">
              {authored.rooms.map((mobs, index) => {
                const room = index + 1
                const status = dungeon_room_state(room, run.room)
                const players = room_players(room)
                return (
                  <article
                    className={`relative overflow-hidden rounded-md border p-3 ${
                      status === 'current'
                        ? 'border-[#67b8dc]/45 bg-[#67b8dc]/8'
                        : status === 'cleared'
                          ? 'border-[#4e9a72]/28 bg-[#4e9a72]/5'
                          : 'border-white/7 bg-black/20'
                    }`}
                    key={room}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`grid size-8 shrink-0 place-items-center border text-[10px] ${status === 'current' ? 'border-[#67b8dc]/50 text-[#8bd5f7]' : 'border-white/10 text-[#69717b]'}`}
                      >
                        {status === 'cleared' ? <Check size={14} /> : room}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] tracking-[0.16em] text-[#c9cbd0] uppercase">
                          {status === 'mysterious'
                            ? text('dungeon_mysterious_room')
                            : text('dungeon_room').replace('{{room}}', String(room))}
                        </p>
                        <p className="mt-1 text-[8px] text-[#626b74]">
                          {status === 'mysterious'
                            ? text('dungeon_undiscovered')
                            : text('dungeon_creatures').replace('{{count}}', String(mobs.length))}
                        </p>
                      </div>
                      {players.length > 0 && (
                        <span className="flex items-center gap-1 text-[8px] text-[#8fa2ad]">
                          <UsersRound size={11} /> {players.length}
                        </span>
                      )}
                    </div>
                    {status === 'current' && players.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {players.map((player) => (
                          <span
                            className="border border-white/8 bg-black/25 px-2 py-1 text-[7px] text-[#9ca4ab]"
                            key={player.character_id}
                          >
                            {player.name} · LV {player.level}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </div>
          <div className="h-56 shrink-0 [&_.chat]:h-full [&_.chat]:overflow-hidden [&_.chat]:rounded-lg">
            <Chat text={{ ...copy.simulator_page, ...copy.fight_hud }} />
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/8 bg-black/18">
          <div className="shrink-0 border-b border-white/8 p-4">
            <p className="text-[8px] tracking-[0.22em] text-[#67b8dc] uppercase">{text('dungeon_current_room')}</p>
            <div className="mt-3 flex min-h-20 gap-2 overflow-x-auto">
              {authored.rooms[run.room - 1]?.map(({ mob_type }, index) => {
                const mob = content_catalog.mob(mob_type)?.mob
                return (
                  <div
                    className="flex w-24 shrink-0 flex-col items-center border border-white/8 bg-black/25 p-2 text-center"
                    key={`${mob_type}:${index}`}
                  >
                    {mob_icon(mob_type) ? (
                      <img alt="" className="h-12 w-full object-contain" src={mob_icon(mob_type)!} />
                    ) : (
                      <span className="h-12" />
                    )}
                    <span className="mt-1 line-clamp-2 text-[7px] leading-3 text-[#b9bbc0]">
                      {mob?.name ?? mob_type}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[8px] tracking-[0.2em] text-[#8b949e] uppercase">{text('dungeon_open_fights')}</p>
              <span className="text-[8px] text-[#59636d]">{room_fights.length}</span>
            </div>
            <div className="grid gap-2">
              {room_fights.map((fight) => {
                const joinable = dungeon_fight_joinable(fight, party_members)
                return (
                  <article
                    className="grid grid-cols-[1fr_auto] items-center gap-3 border border-white/8 bg-surface-low p-3"
                    key={fight.id}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[8px] tracking-[0.14em] text-[#c4c6ca] uppercase">
                        <Swords size={13} className="text-[#c8963c]" />
                        {fight.phase === 'placement' ? text('dungeon_forming_party') : text('dungeon_in_progress')}
                        {fight.access === 1 && <LockKeyhole className="text-[#b58a45]" size={11} />}
                      </div>
                      <p className="mt-2 truncate text-[8px] text-[#717983]">
                        {fight.players.length > 0
                          ? fight.players.map(({ name, level }) => `${name} · LV ${level}`).join('  /  ')
                          : text('dungeon_waiting_players')}
                      </p>
                    </div>
                    <button
                      className="h-9 min-w-24 cursor-pointer border border-[#67b8dc]/40 bg-[#67b8dc]/8 px-3 text-[8px] tracking-[0.14em] text-[#80cdf0] uppercase disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-transparent disabled:text-[#59616a]"
                      disabled={!joinable || pending !== null}
                      onClick={() => dispatch_app({ type: 'dungeon/join_fight', fight: fight.id })}
                      type="button"
                    >
                      {pending === `join:${fight.id}`
                        ? text('dungeon_joining')
                        : joinable
                          ? text('dungeon_join')
                          : text('dungeon_locked')}
                    </button>
                  </article>
                )
              })}
              {room_fights.length === 0 && (
                <div className="grid min-h-24 place-items-center border border-dashed border-white/8 text-[8px] tracking-[0.16em] text-[#565f68] uppercase">
                  {text('dungeon_no_fights')}
                </div>
              )}
            </div>
          </div>

          <footer className="shrink-0 border-t border-white/8 p-4">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div className="grid grid-cols-2 border border-white/8 bg-black/20 p-1">
                <button
                  className={`h-9 cursor-pointer text-[8px] tracking-[0.14em] uppercase ${access === 0 ? 'bg-[#67b8dc]/12 text-[#80cdf0]' : 'text-[#616a73]'}`}
                  onClick={() => set_access(0)}
                  type="button"
                >
                  {text('dungeon_public')}
                </button>
                <button
                  className={`h-9 cursor-pointer text-[8px] tracking-[0.14em] uppercase disabled:cursor-not-allowed disabled:opacity-30 ${access === 1 ? 'bg-[#c8963c]/12 text-[#d4aa5b]' : 'text-[#616a73]'}`}
                  disabled={!party}
                  onClick={() => set_access(1)}
                  type="button"
                >
                  {text('dungeon_group')}
                </button>
              </div>
              <button
                className="h-11 cursor-pointer border border-[#c8963c]/45 bg-[#c8963c]/9 px-6 text-[8px] tracking-[0.17em] text-[#d6ac5e] uppercase disabled:cursor-not-allowed disabled:opacity-40"
                disabled={pending !== null}
                onClick={() => dispatch_app({ type: 'dungeon/start_fight', access })}
                type="button"
              >
                {pending === 'start' ? text('dungeon_starting') : text('dungeon_start_fight')}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </section>
  )
}
