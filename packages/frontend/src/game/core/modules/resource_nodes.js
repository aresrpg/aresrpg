// Resource nodes — folds the server's spawn/despawn packets into state.visible_resource_nodes so the
// imperative roam scene renders each node as a placeholder gather-node prop. Mirrors mob_groups.js for
// the live entity Map (the scene reconciles Three props against it each frame — spawn on first sighting,
// despawn when the node leaves the Map / is depleted) and mirrors craft.js for the gather ACTION state:
// it folds the server-authoritative `gatherProgress` into state.gather (the roam scene's 3D progress ring + the
// JobsDrawer read it). state.gather_target is the world node the player selected (set by the roam click /
// the JobsDrawer Gather button), cleared when that node despawns.
//
// Truth is the server (client.md): the wire ResourceNodeSpawn carries the deterministic node id + its
// FIXED anchor (position) + the resource/job/tier driving art + the gather gate. The client NEVER spawns
// or computes a node, never rolls a yield — it only renders this stream. The mint rides the server's
// client-signed PTB (sui_requests server-initiated sign path); no signing logic lives here.
//
// S-71 janitor: the `packet/gatherDone` listener (+ its action/gather_done job-XP fold + reward toast)
// was DELETED here — that WS-backend packet has zero emitters tree-wide (retired with the WS/FalkorDB
// backend, CLAUDE.md). The live on-chain gather flow's success feedback is
// world-shell/gather_actions.js's resolve_progress_toast + play_gather_sfx() (S-71 §2.3).

/** @type {import('../game.js').Module} */
export default function resource_nodes() {
  return {
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      if (type === 'action/gather')
        // payload null/inactive clears the slice (the ring + drawer status hide); else the live state.
        return { ...state, gather: payload?.active ? payload : null }
      if (type === 'action/gather_target')
        return { ...state, gather_target: payload ?? null }
      return state
    },
    /** @param {import('../game.js').Context} context */
    observe({ events, get_state, dispatch }) {
      const nodes = () => get_state().visible_resource_nodes
      // React readers can't observe in-place Map mutations — nudge them to re-derive (mirrors mob_groups).
      const notify = () => events.emit('STATE_UPDATED', get_state())

      events.on(
        'packet/resourceNodeSpawn',
        (
          /** @type {{ id: string, position: import('@koshi/protocol/types').Position, resource_id: string, job_id: string, tier: number }} */ {
            id,
            position,
            resource_id,
            job_id,
            tier,
          },
        ) => {
          const map = nodes()
          // IDEMPOTENT: our OWN chunk subscription loops the spawn back to us — a re-delivery for a known
          // node is a no-op (keyed on identity, distributed-safe).
          if (map.has(id)) return
          map.set(id, { id, position, resource_id, job_id, tier })
          notify()
        },
      )

      events.on(
        'packet/resourceNodesDespawn',
        (/** @type {{ ids: string[] }} */ { ids }) => {
          const map = nodes()
          let changed = false
          ids.forEach(id => {
            changed = map.delete(id) || changed
          })
          // a depleted / out-of-range node can't stay selected or actively gathering — reset both.
          const { gather_target, gather } = get_state()
          if (gather_target && ids.includes(gather_target.node_id))
            dispatch('action/gather_target', null)
          if (gather?.active && ids.includes(gather.node_id))
            dispatch('action/gather', { active: false })
          if (changed) notify()
        },
      )

      // The server's authoritative gather state (server-owned, read-only here). Drives the roam progress ring + drawer.
      events.on('packet/gatherProgress', payload => {
        dispatch('action/gather', payload)
      })
    },
  }
}
