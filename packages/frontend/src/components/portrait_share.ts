// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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

export const parse_portrait_style = (query: Readonly<URLSearchParams>): PortraitStyle | null => {
  const allowed = ['revision', 'classe', 'sex', 'color_1', 'color_2', 'color_3', 'bg', 'export_revision']
  if ([...query.keys()].some((key) => !allowed.includes(key) || query.getAll(key).length !== 1)) return null
  const background = query.get('bg')
  const revision = query.get('export_revision')
  if (background === null && revision === null) return TRANSPARENT_PORTRAIT
  if (revision !== PORTRAIT_EXPORT_REVISION || background === null) return null
  if (!Object.hasOwn(art.backgrounds, background)) return null
  return { background: background as PortraitBackground | null }
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
