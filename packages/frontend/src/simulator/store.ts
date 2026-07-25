// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/store.ts — the simulator page's store: state + the ONE `input` door, nothing else. All logic
// lives in the pure reducer (simulator/reducer.ts); this file only holds it and lets React subscribe.
//
// Boot is an EDGE, not a store write: `boot_simulator` reads IndexedDB and dispatches the result as the
// `hydrated` input, then arms the debounced persistence subscriber (simulator/persistence.ts). It returns
// the disposer the page's unmount calls — one mount, one boot, one flush.

import { create } from 'zustand'

import { hydrated_input, install_simulator_persistence, load_simulator_state } from './persistence'
import { INITIAL_SIMULATOR_STATE, reduce_simulator, type SimulatorInput, type SimulatorState } from './reducer'

type SimulatorStore = SimulatorState & { input: (message: Readonly<SimulatorInput>) => void }

export const use_simulator = create<SimulatorStore>((set) => ({
  ...INITIAL_SIMULATOR_STATE,
  input: (message) => set((state) => reduce_simulator(state, message)),
}))

const state_of = (): SimulatorState => {
  const { seed, roster, focus_id, anchor_nonce, mob_picks, placements, phase, fight, fight_count } =
    use_simulator.getState()
  return { seed, roster, focus_id, anchor_nonce, mob_picks, placements, phase, fight, fight_count }
}

/**
 * Hydrate from IndexedDB through the reducer door, then keep it flushed. Returns the unmount disposer.
 * A never-seeded page rolls its determinism seed here — randomness is an edge value the reducer receives,
 * never one it invents (a pure reducer that rolls dice is not replayable).
 */
export const boot_simulator = async (): Promise<() => void> => {
  const { input } = use_simulator.getState()
  input(hydrated_input(await load_simulator_state()))
  if (use_simulator.getState().seed === 0) input({ type: 'seed_set', seed: Math.floor(Math.random() * 0xffffffff) })
  return install_simulator_persistence((listener) => use_simulator.subscribe(listener), state_of)
}
