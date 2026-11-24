// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { max_level } from '../../../immutable/src/experience.ts'
import { portrait_url, type PortraitAppearance } from '../../../immutable/src/portrait.ts'
import art from '../../public/portrait-share/manifest.json' with { type: 'json' }

export type PortraitBackground = keyof typeof art.backgrounds
export type PortraitStyle = Readonly<{ background: PortraitBackground | null }>
export const PORTRAIT_BACKGROUNDS = Object.keys(art.backgrounds) as PortraitBackground[]
export const PORTRAIT_EXPORT_REVISION = art.revision
export const TRANSPARENT_PORTRAIT: PortraitStyle = { background: null }

export const portrait_export_url = (appearance: PortraitAppearance, style: PortraitStyle): string | null => {
  const base = portrait_url(appearance)
  if (!base || !style.background) return base
  const query = new URLSearchParams(base.split('?')[1])
  query.set('export_revision', PORTRAIT_EXPORT_REVISION)
  query.set('bg', style.background)
  return `${base.split('?')[0]}?${query}`
}

/** A hero's poster, the card a shared post shows. Every fact arrives in the address, so each one is bounded:
 *  the name follows the chain's rule (`character.move`: 4 to 19 printable ASCII characters). */
export type PortraitPoster = Readonly<{ name: string; level: number; power: number; gear: readonly string[] }>
/** The worn items one row of the poster holds. */
export const POSTER_GEAR = 9
const POSTER_POWER = 99_999_999
const POSTER_NAME = /^[\x20-\x7e]{4,19}$/
const ITEM_TYPE = /^[a-z0-9_]{1,64}$/
const valid_poster = ({ name, level, power, gear }: PortraitPoster): boolean =>
  POSTER_NAME.test(name) &&
  Number.isInteger(level) &&
  level >= 1 &&
  level <= max_level &&
  Number.isInteger(power) &&
  Math.abs(power) <= POSTER_POWER &&
  gear.length <= POSTER_GEAR &&
  gear.every((item_type) => ITEM_TYPE.test(item_type))

/** The poster's address: the portrait's own query, then the hero's facts. Gear past one row is left out. */
export const portrait_poster_url = (appearance: PortraitAppearance, poster: PortraitPoster): string | null => {
  const base = portrait_url(appearance)
  const shown = { ...poster, gear: poster.gear.slice(0, POSTER_GEAR) }
  if (!base || !valid_poster(shown)) return null
  const query = new URLSearchParams(base.split('?')[1])
  query.set('export_revision', PORTRAIT_EXPORT_REVISION)
  query.set('card', 'poster')
  query.set('name', shown.name)
  query.set('level', String(shown.level))
  query.set('power', String(shown.power))
  query.set('gear', shown.gear.join(','))
  return `${base.split('?')[0]}?${query}`
}

/** A hero's share page, served by the game server for crawlers: its card is the hero's poster. The site's origin
 *  reaches it through a rewrite, so a post links to the site's own domain. */
export const HERO_SHARE_PATH = '/api/share'
export const hero_share_path = (hero_id: string, locale: string): string =>
  `${HERO_SHARE_PATH}?${new URLSearchParams({ hero: hero_id, locale })}`

/** What one image request draws: the portrait in a style, or a hero's poster. */
export type PortraitLayout =
  Readonly<{ kind: 'portrait'; style: PortraitStyle }> | Readonly<{ kind: 'poster'; poster: PortraitPoster }>
const APPEARANCE_KEYS = ['revision', 'classe', 'sex', 'color_1', 'color_2', 'color_3', 'export_revision']
const LAYOUT_KEYS = Object.freeze({ portrait: ['bg'], poster: ['card', 'name', 'level', 'power', 'gear'] })

const parse_style = (query: Readonly<URLSearchParams>): PortraitStyle | null => {
  const background = query.get('bg')
  const revision = query.get('export_revision')
  if (background === null && revision === null) return TRANSPARENT_PORTRAIT
  if (revision !== PORTRAIT_EXPORT_REVISION || background === null) return null
  if (!Object.hasOwn(art.backgrounds, background)) return null
  return { background: background as PortraitBackground | null }
}
const parse_poster = (query: Readonly<URLSearchParams>): PortraitPoster | null => {
  const [level, power, gear] = [query.get('level') ?? '', query.get('power') ?? '', query.get('gear') ?? '']
  if (query.get('card') !== 'poster' || query.get('export_revision') !== PORTRAIT_EXPORT_REVISION) return null
  if (!/^\d{1,3}$/.test(level) || !/^-?\d{1,8}$/.test(power)) return null
  const poster = { name: query.get('name') ?? '', level: Number(level), power: Number(power), gear: gear.split(',') }
  const shown = gear ? poster : { ...poster, gear: [] }
  return valid_poster(shown) ? shown : null
}

/** Reads the layout half of an image request; the appearance half is `parse_portrait_query`'s. Each key once. */
export const parse_portrait_layout = (query: Readonly<URLSearchParams>): PortraitLayout | null => {
  const kind = query.has('card') ? 'poster' : 'portrait'
  const allowed = [...APPEARANCE_KEYS, ...LAYOUT_KEYS[kind]]
  if ([...query.keys()].some((key) => !allowed.includes(key) || query.getAll(key).length !== 1)) return null
  if (kind === 'portrait') {
    const style = parse_style(query)
    return style && { kind, style }
  }
  const poster = parse_poster(query)
  return poster && { kind, poster }
}

export const portrait_export_filename = (appearance: PortraitAppearance, style: PortraitStyle): string =>
  [appearance.classe, appearance.sex, style.background].filter(Boolean).join('_') + '.png'

export type PortraitShareState = PortraitStyle &
  Readonly<{ generation: number; loaded: boolean; status: 'ready' | 'copied' | 'failed' }>
export const initial_portrait_share: PortraitShareState = {
  ...TRANSPARENT_PORTRAIT,
  generation: 0,
  loaded: false,
  status: 'ready',
}
export type PortraitShareInput =
  | Readonly<{ type: 'style'; style: PortraitStyle }>
  | Readonly<{ type: 'loaded' | 'image_failed' | 'copied' | 'copy_failed'; generation: number }>

export const reduce_portrait_share = (state: PortraitShareState, input: PortraitShareInput): PortraitShareState => {
  if (input.type === 'style') {
    if (state.background === input.style.background) return state
    return { ...input.style, generation: state.generation + 1, loaded: false, status: 'ready' }
  }
  if (input.generation !== state.generation) return state
  switch (input.type) {
    case 'loaded':
      return { ...state, loaded: true, status: 'ready' }
    case 'image_failed':
      return { ...state, loaded: false, status: 'failed' }
    case 'copied':
      return { ...state, status: 'copied' }
    case 'copy_failed':
      return { ...state, status: 'failed' }
  }
}
