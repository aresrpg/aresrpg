// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow } from '@aresrpg/protocol'

import type { BehaviorRun } from './behavior_script.ts'

/** What one run paid and finished since its tree was accepted. The run record owns it and stores it,
 * so it survives a process restart and a stop; a start or a replacement begins a new one. It is
 * written only from certified receipts and from observed game state, never from a script or a client. */
export type RunTally = Readonly<{
  /** Net network fees of the settled transactions this run signed, in MIST. */
  fees_mist: string
  /** Dungeon runs this run saw end. */
  dungeon_runs: number
  /** Whether the hero stood inside a dungeon run when this run last looked. */
  in_dungeon: boolean
}>
type Tallied = Pick<BehaviorRun, 'tally'>
const EMPTY: RunTally = { fees_mist: '0', dungeon_runs: 0, in_dungeon: false }
export const run_tally = (run: Tallied): RunTally => run.tally ?? EMPTY
/** Add the net gas of one certified receipt. A rebate larger than the cost makes it negative. */
export const charge_run = <Run extends Tallied>(run: Run, gas_mist: bigint): Run => {
  const tally = run_tally(run)
  return { ...run, tally: { ...tally, fees_mist: String(BigInt(tally.fees_mist) + gas_mist) } }
}
/** A dungeon run ended when the hero stood inside one at the last look and stands outside now.
 * The hero's own row is the one slice folded; a hero that is not observed changes nothing. */
export const observe_dungeon = <Run extends Tallied>(run: Run, hero?: Pick<CharacterRow, 'dungeon_run'>): Run => {
  const tally = run_tally(run)
  const inside = Boolean(hero?.dungeon_run)
  if (!hero || inside === tally.in_dungeon) return run
  return { ...run, tally: { ...tally, in_dungeon: inside, dungeon_runs: tally.dungeon_runs + Number(!inside) } }
}
