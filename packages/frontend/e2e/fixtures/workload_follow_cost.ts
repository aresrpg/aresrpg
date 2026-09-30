// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { client_to_chain_coordinate } from '@aresrpg/immutable'

import type { load_crowd } from '../../src/demo/CharacterCrowdLab.tsx'
import type { create_world } from '../../src/game/core/world.ts'
import { update_party_follow, reset_party_follow_for_testing } from '../../src/game/core/party_follow_feed.ts'
import { reset_owned_character_positions_for_testing } from '../../src/game/core/owned_character_feed.ts'

/** Replay 60 seconds at the production feed's 100 ms cadence against resident world collision. */
export const workload_follow_cost = async (
  world: ReturnType<typeof create_world>,
  actors: Awaited<ReturnType<typeof load_crowd>>
) => {
  const leader = actors[0]!
  const followers = actors.slice(1).map((actor) => ({
    character_id: actor.id,
    checkpoint: 'benchmark',
    x: client_to_chain_coordinate(actor.x),
    y: actor.y,
    z: client_to_chain_coordinate(actor.z),
  }))
  const samples: number[] = []
  reset_party_follow_for_testing()
  reset_owned_character_positions_for_testing()
  world.set_active(false)
  await window.workload_gpu_done!()
  try {
    for (let tick = 0; tick < 600; tick += 1) {
      const travel = Math.sin((tick * 0.1) / 4) * 24
      const x = leader.x + travel
      const { z } = leader
      const target = {
        x: client_to_chain_coordinate(x),
        y: world.ground_height(x, z),
        z: client_to_chain_coordinate(z),
      }
      const started = performance.now()
      update_party_follow(
        { party_id: 'benchmark', leader_id: leader.id, world: 'nauvis', target, followers },
        1000 + tick * 100,
        world.walking_world
      )
      samples.push(performance.now() - started)
      if (tick % 30 === 0) await new Promise(requestAnimationFrame)
    }
    const ordered = samples.toSorted((a, b) => a - b)
    return {
      followers: followers.length,
      ticks: samples.length,
      simulated_seconds: 60,
      mean_ms: samples.reduce((sum, value) => sum + value, 0) / samples.length,
      p95_ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
      p99_ms: ordered[Math.ceil(ordered.length * 0.99) - 1],
      max_ms: ordered.at(-1),
      samples_ms: samples,
    }
  } finally {
    reset_party_follow_for_testing()
    reset_owned_character_positions_for_testing()
  }
}
