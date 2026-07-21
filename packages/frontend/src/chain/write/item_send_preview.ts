// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { sim_gas } from '../../game/core/gas_guard.js'

export type item_send_simulate<transaction_type> = (input: {
  readonly transaction: transaction_type
  readonly include: Readonly<{ effects: true }>
}) => Promise<any>

export type item_send_dry_run =
  { ok: true; gas_estimate_mist: bigint } | { ok: false; kind: 'request' | 'effects'; error: unknown }

/** Simulate the exact prepared transaction and reduce the response to the preview facts the dialog needs. */
export async function dry_run_item_send<transaction_type>(
  transaction: transaction_type,
  simulate: item_send_simulate<transaction_type>
): Promise<item_send_dry_run> {
  let simulation
  try {
    simulation = await simulate({ transaction, include: { effects: true } })
  } catch (error) {
    return { ok: false, kind: 'request', error }
  }

  const executed = simulation?.Transaction ?? simulation?.FailedTransaction
  if (!executed?.effects || simulation?.$kind === 'FailedTransaction' || executed.effects.status?.success === false)
    return { ok: false, kind: 'effects', error: executed?.effects?.status?.error ?? simulation }

  return { ok: true, gas_estimate_mist: sim_gas(simulation).net }
}
