// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ChevronDown, ChevronUp } from 'lucide-react'

import { encyclopedia_catalog } from '../content/catalog.ts'

import { ItemReferencePicker } from './ItemReferencePicker.tsx'
import { MobReferencePicker } from './MobReferencePicker.tsx'
import type { MobFilterRow } from './content_list.ts'
import type { JsonPath, JsonValue } from './seed_editor.ts'

const KEY_CATEGORIES = new Set(['key'])
const DUNGEON_MOB_ROLES = new Set(['normal', 'archi', 'boss'])
const MAX_ROOM_MOBS = 6

const as_record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

const room_members = (value: JsonValue): readonly JsonValue[] => (Array.isArray(value) ? value : [])

const replace_at = (rows: readonly JsonValue[], index: number, value: JsonValue): readonly JsonValue[] =>
  rows.map((row, row_index) => (row_index === index ? value : row))

const remove_at = (rows: readonly JsonValue[], index: number): readonly JsonValue[] =>
  rows.filter((_, row_index) => row_index !== index)

const swap = (rows: readonly JsonValue[], left: number, right: number): readonly JsonValue[] =>
  rows.map((row, index) => (index === left ? rows[right]! : index === right ? rows[left]! : row))

const RoomMobBand = ({ mob_type }: Readonly<{ mob_type: string }>) => {
  const mob = encyclopedia_catalog.mobs.find((row) => row.mob_type === mob_type)
  if (!mob) return <span className="px-2 text-[7px] text-[#6b5360]">Unknown level</span>
  return (
    <span className="px-2 text-[7px] tabular-nums whitespace-nowrap text-[#858c97]">
      Random Lv. {mob.level_min}–{mob.level_max}
    </span>
  )
}

export const DungeonEditor = ({
  world,
  change,
  mob_filters,
}: Readonly<{
  world: Readonly<Record<string, JsonValue>>
  change: (path: JsonPath, value: JsonValue) => void
  mob_filters?: readonly MobFilterRow[]
}>) => {
  const dungeon = as_record(world.dungeon)
  const key = typeof dungeon?.key === 'string' ? dungeon.key : ''
  const rooms = Array.isArray(dungeon?.rooms) ? dungeon.rooms : []
  const change_rooms = (next: readonly JsonValue[]): void => change(['dungeon', 'rooms'], next)

  return (
    <div className="space-y-5" data-dungeon-editor="">
      <section>
        <header className="flex items-end justify-between border-b border-white/8 pb-2">
          <div>
            <h3 className="text-[9px] tracking-[0.15em] text-[#b584e8] uppercase">Dungeon</h3>
            <p className="mt-1 text-[7px] text-[#626670]">Ordered rooms become consecutive managed fights.</p>
          </div>
          <span className="text-[7px] tabular-nums text-[#555b66]">{rooms.length} rooms</span>
        </header>
        <div className="flex items-center gap-1 border-b border-white/7 py-1">
          <ItemReferencePicker
            categories={KEY_CATEGORIES}
            class_name="min-w-0 flex-1 !h-11 !border-0 !bg-transparent !px-1 hover:!border-0"
            empty_sublabel="Required before players can enter"
            label="dungeon key"
            placeholder="Choose dungeon key"
            select={(item_type) => change(['dungeon', 'key'], item_type)}
            value={key}
          />
          {key && (
            <button
              aria-label="Clear dungeon key"
              className="grid size-8 shrink-0 place-items-center text-[#873f55] hover:text-[#ff5a8b]"
              onClick={() => change(['dungeon', 'key'], '')}
              type="button"
            >
              ×
            </button>
          )}
        </div>
      </section>

      <section>
        <header className="flex items-end justify-between border-b border-white/8 pb-2">
          <div>
            <h3 className="text-[9px] tracking-[0.15em] text-[#c8963c] uppercase">Rooms</h3>
            <p className="mt-1 text-[7px] text-[#626670]">One to six enemies per room; order determines seats.</p>
          </div>
        </header>
        {rooms.map((room_value, room_index) => {
          const members = room_members(room_value)
          const change_members = (next: readonly JsonValue[]): void => change_rooms(replace_at(rooms, room_index, next))
          return (
            <div className="border-b border-white/8 py-1" data-dungeon-room={room_index + 1} key={room_index}>
              <div className="flex h-8 items-center gap-1 px-1">
                <strong className="min-w-0 flex-1 text-[8px] tracking-[0.12em] text-[#d6b46f] uppercase">
                  Room {room_index + 1} · {members.length} {members.length === 1 ? 'enemy' : 'enemies'}
                </strong>
                <button
                  aria-label={`Move room ${room_index + 1} up`}
                  className="grid size-7 place-items-center text-[#626873] hover:text-[#d8d3ca] disabled:opacity-20"
                  disabled={room_index === 0}
                  onClick={() => change_rooms(swap(rooms, room_index, room_index - 1))}
                  type="button"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  aria-label={`Move room ${room_index + 1} down`}
                  className="grid size-7 place-items-center text-[#626873] hover:text-[#d8d3ca] disabled:opacity-20"
                  disabled={room_index === rooms.length - 1}
                  onClick={() => change_rooms(swap(rooms, room_index, room_index + 1))}
                  type="button"
                >
                  <ChevronDown size={12} />
                </button>
                <button
                  aria-label={`Remove room ${room_index + 1}`}
                  className="grid size-7 place-items-center text-[#873f55] hover:text-[#ff5a8b]"
                  onClick={() => change_rooms(remove_at(rooms, room_index))}
                  type="button"
                >
                  ×
                </button>
              </div>
              {members.map((member_value, member_index) => {
                const member = as_record(member_value)
                if (!member) return null
                const mob_type = typeof member.mob_type === 'string' ? member.mob_type : ''
                return (
                  <div className="flex min-w-0 items-center pl-2" data-dungeon-member="" key={member_index}>
                    <span className="w-5 shrink-0 text-center text-[7px] text-[#414751]">{member_index + 1}</span>
                    <MobReferencePicker
                      class_name="min-w-0 flex-1 !h-10 !border-0 !bg-transparent !px-1 hover:!border-0"
                      filter_rows={mob_filters}
                      label="room mob"
                      roles={DUNGEON_MOB_ROLES}
                      select={(next) => change(['dungeon', 'rooms', room_index, member_index, 'mob_type'], next)}
                      value={mob_type}
                    />
                    <RoomMobBand mob_type={mob_type} />
                    <button
                      aria-label={`Remove room ${room_index + 1} enemy ${member_index + 1}`}
                      className="grid size-8 shrink-0 place-items-center text-[#873f55] hover:text-[#ff5a8b]"
                      onClick={() => {
                        const next = remove_at(members, member_index)
                        if (next.length > 0) change_members(next)
                        else change_rooms(remove_at(rooms, room_index))
                      }}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
              {members.length < MAX_ROOM_MOBS && (
                <div
                  className="flex items-center border-t border-dashed border-white/6 pl-2"
                  data-dungeon-placeholder="member"
                >
                  <span className="w-5 shrink-0 text-center text-[7px] text-[#414751]">{members.length + 1}</span>
                  <MobReferencePicker
                    class_name="min-w-0 flex-1 !h-10 !border-0 !bg-transparent !px-1 hover:!border-0"
                    filter_rows={mob_filters}
                    empty_sublabel="Choose once to append"
                    label="add room member"
                    placeholder="Add enemy"
                    roles={DUNGEON_MOB_ROLES}
                    select={(mob_type) => change_members([...members, { mob_type }])}
                    value=""
                  />
                </div>
              )}
            </div>
          )
        })}
        <div className="flex items-center border-b border-dashed border-white/8" data-dungeon-placeholder="room">
          <span className="w-7 shrink-0 text-center text-[7px] text-[#414751]">{rooms.length + 1}</span>
          <MobReferencePicker
            class_name="min-w-0 flex-1 !h-11 !border-0 !bg-transparent !px-1 hover:!border-0"
            filter_rows={mob_filters}
            empty_sublabel="Choose the first enemy to create a valid room"
            label="add dungeon room"
            placeholder="Add room"
            roles={DUNGEON_MOB_ROLES}
            select={(mob_type) => change_rooms([...rooms, [{ mob_type }]])}
            value=""
          />
        </div>
      </section>
    </div>
  )
}
