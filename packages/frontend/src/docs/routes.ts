// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The docs are guides plus the encyclopedia's reference views, all addressed under `/docs`.

export const DOCS_ROOT = '/docs'

/** The game's rules, one page each. Their text is the encyclopedia copy's `gameplay` block. */
export const DOCS_MECHANICS = ['combat', 'stats', 'leveling', 'loot', 'groups', 'dungeons', 'forgemagie'] as const
export type DocsMechanic = (typeof DOCS_MECHANICS)[number]

export const DOCS_GUIDES = [
  'overview',
  'ways',
  'first-hour',
  ...DOCS_MECHANICS,
  'bots',
  'agents',
  'market',
  'kares',
  'build',
] as const
export type DocsGuide = (typeof DOCS_GUIDES)[number]

/** Reference sections are the encyclopedia's views. KARES is a written guide: the token's live figures are the
 * Staking page's. */
export const DOCS_REFERENCES = ['classes', 'jobs', 'worlds', 'items', 'bestiary'] as const
export type DocsReference = (typeof DOCS_REFERENCES)[number]
export type DocsSection = DocsGuide | DocsReference

export type DocsGroup = 'start' | 'mechanics' | 'automated' | 'reference' | 'economy' | 'build'

/** The category rail, in reading order. */
export const DOCS_NAV: readonly Readonly<{ group: DocsGroup; sections: readonly DocsSection[] }>[] = Object.freeze([
  { group: 'start', sections: ['overview', 'ways', 'first-hour'] },
  { group: 'mechanics', sections: [...DOCS_MECHANICS] },
  { group: 'automated', sections: ['bots', 'agents'] },
  { group: 'reference', sections: ['classes', 'jobs', 'worlds', 'items', 'bestiary'] },
  { group: 'economy', sections: ['market', 'kares'] },
  { group: 'build', sections: ['build'] },
])

export const DOCS_ORDER: readonly DocsSection[] = Object.freeze(DOCS_NAV.flatMap(({ sections }) => sections))

const is_guide = (value: string): value is DocsGuide => (DOCS_GUIDES as readonly string[]).includes(value)
export const is_mechanic = (value: string): value is DocsMechanic =>
  (DOCS_MECHANICS as readonly string[]).includes(value)
const is_reference = (value: string): value is DocsReference => (DOCS_REFERENCES as readonly string[]).includes(value)

/** A reference view names its object by id; a world view may also name a place as `kind:name`. */
export type ReferenceView = Readonly<{ section: DocsReference; id: string | null; place: string | null }>

export type DocsView =
  Readonly<{ kind: 'guide'; section: DocsGuide }> | (ReferenceView & Readonly<{ kind: 'reference' }>)

const OVERVIEW: DocsView = Object.freeze({ kind: 'guide', section: 'overview' })

const reference_view = (section: DocsReference, [id, place_kind, place]: readonly string[]): DocsView => {
  const view = (id: string | null, place: string | null): DocsView =>
    Object.freeze({ kind: 'reference', section, id, place })
  if (!id) return view(null, null)
  try {
    return view(decodeURIComponent(id), place ? `${place_kind}:${decodeURIComponent(place)}` : null)
  } catch (error) {
    console.warn('Ignoring a malformed docs reference.', error)
    return view(null, null)
  }
}

export const docs_view = (pathname: string): DocsView => {
  const [root, section = 'overview', ...rest] = pathname.split('/').filter(Boolean)
  if (`/${root}` !== DOCS_ROOT) return OVERVIEW
  if (is_guide(section)) return Object.freeze({ kind: 'guide', section })
  if (!is_reference(section)) return OVERVIEW
  return reference_view(section, rest)
}

/** A place is written as `kind:name` and lives under its world's path. */
export const docs_path = (section: DocsSection, id?: string | null, place?: string | null): string => {
  if (section === 'overview') return DOCS_ROOT
  const object = id ? [id, ...(place ? place.split(':') : [])] : []
  return [DOCS_ROOT, section, ...object.map(encodeURIComponent)].join('/')
}

export const is_docs_path = (pathname: string): boolean => {
  const path = pathname.replace(/\/+$/, '')
  return path === DOCS_ROOT || path.startsWith(`${DOCS_ROOT}/`)
}
