// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The docs are guides plus the encyclopedia's reference views under one `/docs` path space.

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

/** Reference sections are the encyclopedia's own views; their ids are its route segments. Its live KARES view is
 * left out on purpose: the token is not launched, so the docs state that instead of showing chain figures. */
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

export type DocsView =
  | Readonly<{ kind: 'guide'; section: DocsGuide }>
  /** `encyclopedia_path` is the same location in the encyclopedia's own route space. */
  | Readonly<{ kind: 'reference'; section: DocsReference; encyclopedia_path: string }>

const OVERVIEW: DocsView = Object.freeze({ kind: 'guide', section: 'overview' })

export const docs_view = (pathname: string): DocsView => {
  const [root, section = 'overview', ...rest] = pathname.split('/').filter(Boolean)
  if (`/${root}` !== DOCS_ROOT) return OVERVIEW
  if (is_guide(section)) return Object.freeze({ kind: 'guide', section })
  if (!is_reference(section)) return OVERVIEW
  return Object.freeze({
    kind: 'reference',
    section,
    encyclopedia_path: ['/encyclopedia', section, ...rest].join('/'),
  })
}

export const docs_path = (section: DocsSection, id?: string): string =>
  section === 'overview' ? DOCS_ROOT : `${DOCS_ROOT}/${section}${id ? `/${encodeURIComponent(id)}` : ''}`

/** Encyclopedia views navigate in their own route space; the docs keep them under `/docs`. */
export const docs_path_of_encyclopedia = (encyclopedia_path: string): string =>
  encyclopedia_path.replace(/^\/encyclopedia/, DOCS_ROOT)

export const is_docs_path = (pathname: string): boolean => {
  const path = pathname.replace(/\/+$/, '')
  return path === DOCS_ROOT || path.startsWith(`${DOCS_ROOT}/`)
}
