// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Every explicit Move target in src/sui/write is represented once here. Captured fixtures come from the
// deployed normalized module service; TODO fixtures are skipped until the capture command replaces them.

import { describe, expect, test } from 'bun:test'
import {
  readFileSync as read_file_sync,
  readdirSync as read_directory_sync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import {
  MOVE_SIGNATURE_DOORS,
  MOVE_SIGNATURE_FIXTURE_PATHS,
} from '../scripts/move_signature_doors.mjs'

import { composed_transactions } from './_composed_transactions.js'

const here = path.dirname(file_url_to_path(import.meta.url))
const fixture_directory = path.join(here, 'fixtures')
const fixtures = new Map(
  MOVE_SIGNATURE_DOORS.map(door => [
    door.id,
    JSON.parse(
      read_file_sync(path.join(fixture_directory, door.fixture), 'utf8'),
    ),
  ]),
)

function move_calls(transaction) {
  return transaction
    .getData()
    .commands.filter(command => command.$kind === 'MoveCall')
    .map(command => ({
      transaction,
      call: command.MoveCall,
      target: `${command.MoveCall.module}::${command.MoveCall.function}`,
    }))
}

let cached_calls
const all_composed_calls = () =>
  (cached_calls ??= composed_transactions().flatMap(move_calls))

function source_door_ids() {
  const write_directory = path.join(here, '../src/sui/write')
  const found = new Set()
  let sites = 0
  for (const file of read_directory_sync(write_directory).filter(name =>
    name.endsWith('.js'),
  )) {
    const source = read_file_sync(path.join(write_directory, file), 'utf8')
    for (const match of source.matchAll(/target:\s*(?:'([^']+)'|`([^`]+)`)/g)) {
      sites += 1
      const expression = match[1] ?? match[2]
      if (expression.includes('listing_rule_module')) {
        found.add('item::prove_listing_amount')
        found.add('character_listing_rule::prove_level')
        continue
      }
      const tail = expression.match(/::([a-z0-9_]+)::([a-z0-9_]+)$/)
      if (!tail)
        throw new Error(
          `[write signature census] cannot resolve ${file} target ${expression}`,
        )
      found.add(`${tail[1]}::${tail[2]}`)
    }
  }
  return { sites, doors: [...found].sort() }
}

function composed_arg_kind(transaction, argument) {
  if (argument?.$kind === 'Result' || argument?.$kind === 'NestedResult')
    return 'result'
  if (argument?.$kind !== 'Input') return String(argument?.$kind)
  return transaction.getData().inputs[argument.Input]?.Pure ? 'pure' : 'object'
}

describe('deployed Move signatures — every SDK write door', () => {
  test('census is 71 call sites / 65 distinct doors, with a real composed sample and fixture for each', () => {
    const census = source_door_ids()
    const declared = MOVE_SIGNATURE_DOORS.map(
      ({ id: door_id }) => door_id,
    ).sort()
    expect(census.sites).toBe(71)
    expect(census.doors).toEqual(declared)
    expect(new Set(MOVE_SIGNATURE_FIXTURE_PATHS).size).toBe(65)

    const composed = new Set(all_composed_calls().map(({ target }) => target))
    expect(declared.filter(door_id => !composed.has(door_id))).toEqual([])
  })

  for (const door of MOVE_SIGNATURE_DOORS) {
    const fixture = fixtures.get(door.id)
    // The original craft capture predates the sweep's explicit status/target/package fields; provenance makes it
    // captured. Keeping that evidence byte-for-byte also preserves the fixture-adjudication boundary.
    const is_captured = fixture.status === 'captured' || fixture.provenance
    test.skipIf(!is_captured)(
      `[${door.id}] composed PTB matches deployed argument shape`,
      () => {
        if (fixture.target) expect(fixture.target).toBe(door.id)
        if (fixture.package) expect(fixture.package).toBe(door.package)
        const sample = all_composed_calls().find(
          ({ target }) => target === door.id,
        )
        if (!sample) throw new Error(`[${door.id}] has no composed SDK sample`)

        const expected = fixture.ptb_arg_kinds
        const actual = sample.call.arguments.map(argument =>
          composed_arg_kind(sample.transaction, argument),
        )
        if (actual.length !== expected.length)
          throw new Error(
            `[${door.id}] divergent arg count: deployed=${expected.length}, composed=${actual.length}`,
          )
        for (let index = 0; index < expected.length; index += 1) {
          // A prior Move-call result is statically typed by that call, and a generic parameter admits either kind.
          if (
            actual[index] !== 'result' &&
            expected[index] !== 'generic' &&
            actual[index] !== expected[index]
          )
            throw new Error(
              `[${door.id}] divergent arg ${index}: deployed=${expected[index]}, composed=${actual[index]}`,
            )
        }
      },
    )
  }
})
