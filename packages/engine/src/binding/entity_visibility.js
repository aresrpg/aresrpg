// SEAM 4 — PHASE-OUT VISIBILITY (SPEC §7: "a fight phases its participants out of the open world").
//
// "fighters stop seeing all players and mobs not in the fight, and everyone else stops seeing the fight's
// players and mobs. Both sides get a clean scene; the world never renders half a fight." Remote players
// and overworld mob groups are rendered APP-SIDE (frontend remote_players.js / ambient_mobs.js add their
// avatar Object3Ds through engine.add_to_scene — the engine has no id→object map of its own). This seam is
// the missing engine-side registry: the app registers each world entity's Object3D under its id, and a
// single visibility FILTER toggles `.visible` across the set — hide/show WITHOUT despawn (state, animation,
// position all preserved; the mechanic mirrors mount_rig.js's `set_visible`). No chain awareness — pure
// id→object bookkeeping over a boolean.

/** @typedef {{ visible: boolean }} Visible a three Object3D (only `.visible` is touched). */

/**
 * Create the world-entity visibility registry. Framework-free — it only reads/writes `.visible`, so it is
 * headless-testable and independent of the render backend.
 * @returns {{
 *   register: (id: string, object3d: Visible) => void,
 *   unregister: (id: string) => void,
 *   has: (id: string) => boolean,
 *   size: () => number,
 *   ids: () => string[],
 *   set_visibility_filter: (filter: ((id: string, object3d: Visible) => boolean) | Iterable<string> | null | undefined) => void,
 *   clear_filter: () => void,
 *   dispose: () => void,
 * }}
 */
export function create_entity_visibility() {
  /** @type {Map<string, Visible>} id → the app-owned render object (added to the scene by the app). */
  const entities = new Map()
  /** Current filter: null = everything visible; else a predicate `(id, obj) => visible`. An id
   *  allowlist is normalised into a predicate on set. @type {((id: string, object3d: Visible) => boolean) | null} */
  let filter = null

  /** Apply the current filter to one entity (visible unless the filter says otherwise). */
  const apply_one = (/** @type {string} */ id, /** @type {Visible} */ obj) => {
    if (!obj) return
    obj.visible = filter ? !!filter(id, obj) : true
  }

  const apply_all = () => {
    for (const [id, obj] of entities) apply_one(id, obj)
  }

  return {
    /** Track `object3d` under `id` and immediately reconcile it with the active filter (so an entity the
     *  app spawns DURING a phase-out starts correctly hidden). Re-registering an id replaces the object. */
    register(id, object3d) {
      entities.set(id, object3d)
      apply_one(id, object3d)
    },

    /** Stop tracking `id` and restore its object to visible (it leaves this registry's control). */
    unregister(id) {
      const obj = entities.get(id)
      if (obj) obj.visible = true
      entities.delete(id)
    },

    has: (id) => entities.has(id),
    size: () => entities.size,
    ids: () => [...entities.keys()],

    /**
     * Set the visibility filter over every registered entity (and every future registration).
     *   • a predicate `(id, object3d) => boolean` — the entity is VISIBLE when it returns true;
     *   • an iterable of ids — the VISIBLE allowlist (only those ids shown, all others hidden);
     *   • null / undefined — clear (everything visible).
     * PHASE-OUT the fight's participants from the world view: `set_visibility_filter(id => !fight.has(id))`.
     * SPECTATE only the fight: `set_visibility_filter(fight_ids)`. Toggling never despawns — an entity's
     * Object3D (and its animation/position state) is untouched but for `.visible`.
     */
    set_visibility_filter(filter_arg) {
      if (filter_arg == null) {
        filter = null
      } else if (typeof filter_arg === 'function') {
        filter = filter_arg
      } else {
        const allow = new Set(filter_arg)
        filter = (id) => allow.has(id)
      }
      apply_all()
    },

    /** Clear the filter — every registered entity becomes visible. */
    clear_filter() {
      filter = null
      apply_all()
    },

    /** Drop all tracking and restore every object to visible. */
    dispose() {
      for (const [, obj] of entities) if (obj) obj.visible = true
      entities.clear()
      filter = null
    },
  }
}
