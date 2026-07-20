// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Mob groups — folds the server's per-group spawn/despawn packets into state.visible_mobs_group so the
// imperative roam scene can render each group's members as sprites AROUND the group's FIXED anchor.
//
// Mirrors presence.js exactly: this module owns ONLY the data Map (the group anchor + members). roam.js
// reads the Map each frame and reconciles Three sprites against it — spawn on first sighting, despawn when
// the group leaves the Map. It mutates the Map IN PLACE (never dispatches): the Map reference is stable so
// React selectors keyed on it stay referentially equal, and the scene polls it every frame. A lightweight
// STATE_UPDATED is emitted on spawn/despawn so any React reader re-derives from the live Map.
//
// Truth is the server (client.md): the wire EntityGroupSpawn carries the group id + the single FIXED
// anchor (position) + the member entities. The client NEVER computes a group — it only renders this stream.
// The anchor never moves (idle only; wander is deferred). Walking into a group's range OR clicking it sends
// `characterAttackMobGroup` with the REAL group id (roam.js); the server starts the fight + despawns it.

/** @type {import('../game.js').Module} */
export default function mob_groups() {
  return {
    /** @param {import('../game.js').Context} context */
    observe({ events, get_state }) {
      const groups = () => get_state().visible_mobs_group
      // React readers can't observe in-place Map mutations — nudge them to re-derive.
      const notify = () => events.emit('STATE_UPDATED', get_state())

      events.on(
        'packet/entityGroupSpawn',
        (
          /** @type {{ id: string, position: import('@koshi/protocol/types').Position, entities: import('@koshi/protocol/types').Entity[] }} */ {
            id,
            position,
            entities,
          },
        ) => {
          const map = groups()
          // IDEMPOTENT: our OWN chunk subscription loops the spawn back to us — a re-delivery for a known
          // group is a no-op (keyed on identity, distributed-safe).
          if (map.has(id)) return
          map.set(id, { id, position, entities })
          notify()
        },
      )

      events.on(
        'packet/entityGroupsDespawn',
        (/** @type {{ ids: string[] }} */ { ids }) => {
          const map = groups()
          let changed = false
          ids.forEach(id => {
            changed = map.delete(id) || changed
          })
          if (changed) notify()
        },
      )
    },
  }
}
