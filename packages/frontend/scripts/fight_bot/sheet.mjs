// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_bot/sheet.mjs — the BAR SHEET's human face. One line per assertion; a FAIL is a FAIL, never a warning
// and never a row the table quietly drops. The machine-readable twin is fight_bot_sheet.json beside it.

import { cell_str } from './drive.mjs'

const WIDTHS = [6, 8, 22, 8, 42, 14, 14, 4]
const HEAD = ['TURN', 'SEAT', 'ACTION', 'AT', 'CHECK', 'EXPECTED', 'ACTUAL', '']
const line = (cells) =>
  '  ' +
  cells
    .map((value, index) =>
      String(value)
        .slice(0, WIDTHS[index] - 1)
        .padEnd(WIDTHS[index])
    )
    .join('')

export const print_sheet = (sheet, log) => {
  log('')
  log(
    `  BAR SHEET — ${sheet.scenario.name}  (${sheet.surface}, seed ${sheet.scenario.seed}, policy seed ${sheet.scenario.policy_seed})`
  )
  log('  ' + '─'.repeat(118))
  log(line(HEAD))
  log('  ' + '─'.repeat(118))
  for (const turn of sheet.turns)
    for (const row of turn.rows)
      log(
        line([
          turn.turn,
          row.observer ? `→${row.observer}` : (turn.seat ?? '—'),
          row.kind,
          cell_str(row.at),
          row.check,
          row.expected,
          row.actual,
          row.pass ? 'PASS' : 'FAIL',
        ])
      )
  for (const row of sheet.run_rows ?? [])
    log(line(['run', '—', row.kind, cell_str(row.at), row.check, row.expected, row.actual, row.pass ? 'PASS' : 'FAIL']))
  log('  ' + '─'.repeat(118))
  const { checks, passed, failed, verdict } = sheet.summary
  log(
    `  ${verdict} — ${passed}/${checks} checks passed, ${failed} failed · outcome: ${sheet.outcome} · ${sheet.turns.length} bot turns` +
      (sheet.cross
        ? ` · ${sheet.cross.rows.length} cross-client checks, ${sheet.cross.status_proofs} status proofs`
        : '')
  )
  log('')
}
