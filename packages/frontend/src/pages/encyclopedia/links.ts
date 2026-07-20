// THE ONE encyclopedia entity-link idiom. Any entity reference anywhere in the app — a dungeon
// key name, a world-picker's mob/resource counts — routes to its encyclopedia page through here, so there is a
// SINGLE link system, never two. The URLs mirror exactly what EncyclopediaPage routes on (index.tsx:
// /encyclopedia/<tab>/:id, where :id resolves against the on-chain TEMPLATE id — items/worlds/bestiary alike).

export type EncyclopediaEntity = 'item' | 'mob' | 'world' | 'class' | 'job'

/** entity kind → the encyclopedia tab path segment it lives under. */
const TAB: Record<EncyclopediaEntity, string> = {
  item: 'items',
  mob: 'bestiary',
  world: 'worlds',
  class: 'classes',
  job: 'jobs',
}

/**
 * Deep-link path to a specific encyclopedia entity page, or the tab root when `id` is absent (an honest link
 * to the browser, never a dead `/.../undefined`). Pure — the single home the link idiom builds from.
 */
export function encyclopedia_path(kind: EncyclopediaEntity, id?: string | null): string {
  const base = `/encyclopedia/${TAB[kind]}`
  return id ? `${base}/${id}` : base
}
