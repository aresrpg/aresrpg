// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The generator IS the SDK's correctness story: these tests pin the projection.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import {
  parse_doors,
  generate_game_doors,
  generate_character_price,
  API_MOVE_PATH,
  DOORS_OUT_PATH,
  CHARACTER_MOVE_PATH,
  CHARACTER_PRICE_OUT_PATH,
} from '../scripts/generate_doors.mjs'

const api_source = readFileSync(API_MOVE_PATH, 'utf8')
const party_source = readFileSync(new URL('../../move/sources/party.move', import.meta.url), 'utf8')
const trade_source = readFileSync(new URL('../../move/sources/trade.move', import.meta.url), 'utf8')
const trade_state_source = readFileSync(new URL('../../move-math/sources/trade_state.move', import.meta.url), 'utf8')

type ParsedDoor = ReturnType<typeof parse_doors>[number]

describe('door parsing (positive controls against the real api.move)', () => {
  const doors = parse_doors(api_source)

  test('every public/entry door of api.move is parsed', () => {
    const declared = [...api_source.matchAll(/^(?:public entry fun|public fun|entry fun) (\w+)/gm)].map((m) => m[1])
    expect(doors.map((d: ParsedDoor) => d.name).sort()).toEqual(declared.sort())
    expect(doors.length).toBeGreaterThanOrEqual(60) // the instrument reads, never returns empty
  })

  test('no public claim door releases the counterparty transferable PurchaseCap', () => {
    expect(api_source).not.toMatch(/public fun trade_get_[ic]\s*\([^)]*\)\s*:\s*PurchaseCap</)
  })

  test('generic fight cleanup explicitly checks its lifecycle door policy', () => {
    const body = /entry fun close_fight[\s\S]*?\n}/.exec(api_source)?.[0] ?? ''
    expect(body).toContain('fight::assert_close_door_open(&fight_object)')
  })

  test('fight settlement exposes batch doors only, plus explicit close recovery', () => {
    const names = doors.map(({ name }: ParsedDoor) => name)
    expect(names.filter((name) => /^(?:settle.*fight|close_fight)/u.test(name)).toSorted()).toEqual([
      'close_fight',
      'settle_fight',
      'settle_last_fight',
    ])
    expect(names.filter((name) => /settle.*dungeon_room/u.test(name)).toSorted()).toEqual([
      'settle_dungeon_room',
      'settle_last_dungeon_room',
    ])
  })

  test('attacker-controlled social manifests have explicit chain bounds', () => {
    expect(party_source).toContain('party.pending.length() < MAX_MEMBERS')
    expect(trade_state_source).toContain('MAX_CAPS_PER_SIDE')
    expect(trade_state_source).toContain('length < MAX_CAPS_PER_SIDE')
  })

  test('&Random doors are flagged terminal, others are not', () => {
    const by_name = Object.fromEntries(doors.map((d: ParsedDoor) => [d.name, d]))
    const terminal = (name: string) => by_name[name].params.some((p) => p.type === '&Random')
    expect(terminal('start_fight')).toBe(true)
    expect(terminal('crush_gear')).toBe(true)
    expect(terminal('open_loot_box')).toBe(true)
    expect(terminal('raise_stat')).toBe(false)
    expect(terminal('redeem_rune')).toBe(false)
  })

  test('pins and system objects are recognized, caller objects fall through, scalars are pure', () => {
    const by_name = Object.fromEntries(doors.map((d: ParsedDoor) => [d.name, d]))
    const strategies = Object.fromEntries(by_name.create_character.params.map((p) => [p.name, p.strategy.kind]))
    expect(strategies.registry).toBe('pin')
    expect(strategies.kiosk).toBe('object')
    expect(strategies.payment).toBe('object')
    expect(strategies.raw_name).toBe('pure')
    expect(strategies.ctx).toBe('skip')
    expect(by_name.delete_character.params.find(({ name }) => name === 'registry')?.strategy.kind).toBe('pin')
    expect(
      Object.fromEntries(by_name.move_fighter.params.map((parameter) => [parameter.name, parameter.strategy.kind])).path
    ).toBe('pure_vector')
  })

  test('an unknown scalar type is a hard throw, never a guess', () => {
    expect(() => parse_doors('public fun bad(x: u256, ctx: &mut TxContext) {}')).toThrow(/unknown Move parameter type/)
  })

  test('zero parsed doors is a broken instrument, not an empty surface', () => {
    expect(() => parse_doors('module aresrpg::api;')).toThrow(/ZERO doors/)
  })
})

describe('the regen-clean tooth (same-commit law)', () => {
  test('committed doors.gen.ts is byte-identical to a fresh generation over api.move', async () => {
    expect(readFileSync(DOORS_OUT_PATH, 'utf8')).toBe(await generate_game_doors(api_source, trade_source))
  })

  test('the character price export is byte-identical to character.move', async () => {
    expect(readFileSync(CHARACTER_PRICE_OUT_PATH, 'utf8')).toBe(
      await generate_character_price(readFileSync(CHARACTER_MOVE_PATH, 'utf8'))
    )
  })
})
