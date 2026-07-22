// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BALANCE REPORT (§1c "balance findings") — the fight/dungeon executors
// AUTO-RECORD every fight (win/loss, deaths, turns, my level vs mob level). At run end we aggregate into
// balance_report.json: win-rate by LEVEL BRACKET, so "bots keep dying at the intended level" or a win-rate
// outside the authored band is a DATA finding, not a feeling. Only meaningful under the seed-parity law (§4):
// the bots fight the REAL corpus. Reuses the balance ledger's finding shape (one home for the numeric verdict).
import fs from 'node:fs'
import path from 'node:path'

const BRACKET = (lvl) => `L${Math.max(1, Math.floor((lvl - 1) / 10) * 10 + 1)}-${Math.floor((lvl - 1) / 10) * 10 + 10}`

export function make_balance() {
  const fights = []
  return {
    fights,
    record(entry) {
      fights.push({ ts: Date.now(), ...entry })
    },
    /**
     * Aggregate + write balance_report.json. `band` = the authored acceptable win-rate window per bracket
     * (default [0.4, 0.95] — a bracket outside it is a balance finding). Returns the report object.
     */
    report(out_dir, band = [0.4, 0.95]) {
      const by = new Map()
      for (const f of fights) {
        const key = BRACKET(f.my_level ?? 1)
        const b = by.get(key) ?? { bracket: key, fights: 0, wins: 0, deaths: 0, turns: 0, xp: 0 }
        b.fights += 1
        b.wins += f.won ? 1 : 0
        b.deaths += f.deaths ?? 0
        b.turns += f.turns ?? 0
        b.xp += f.xp_share ?? 0
        by.set(key, b)
      }
      const brackets = [...by.values()].map((b) => {
        const win_rate = b.fights ? b.wins / b.fights : 0
        const in_band = b.fights === 0 || (win_rate >= band[0] && win_rate <= band[1])
        return {
          bracket: b.bracket,
          fights: b.fights,
          wins: b.wins,
          deaths: b.deaths,
          win_rate: Number(win_rate.toFixed(3)),
          avg_turns: b.fights ? Number((b.turns / b.fights).toFixed(1)) : 0,
          total_xp: b.xp,
          band,
          in_band, // false = a BALANCE FINDING (win-rate outside the authored window)
        }
      })
      const report = {
        total_fights: fights.length,
        total_wins: fights.filter((f) => f.won).length,
        total_deaths: fights.reduce((s, f) => s + (f.deaths ?? 0), 0),
        overall_win_rate: fights.length
          ? Number((fights.filter((f) => f.won).length / fights.length).toFixed(3))
          : null,
        brackets,
        findings: brackets
          .filter((b) => !b.in_band)
          .map((b) => ({
            class: 'balance',
            bracket: b.bracket,
            win_rate: b.win_rate,
            band,
            note: `win-rate ${b.win_rate} outside authored band [${band}] over ${b.fights} fights`,
          })),
        fights,
      }
      if (out_dir) fs.writeFileSync(path.join(out_dir, 'balance_report.json'), JSON.stringify(report, null, 2))
      return report
    },
  }
}
