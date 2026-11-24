// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Link previews for shared posts. A crawler (X, Discord, Telegram) never runs the site and cannot hold the realtime
// socket, so each shared subject gets this one noindex page: its card tags point at the subject's image and its body
// links to the site. It is a thin wrapper over existing reads and owns no state, cache or limit; the HTTP door's
// per-visitor allowance admits every request first. Two subjects share it: an allocation card, by its opaque share
// token, and a hero, by character id. An unknown or malformed subject is a plain 404 for both.
import { readFile, readdir } from 'node:fs/promises'

import type { Redis } from 'ioredis'
import { hero_power } from '@aresrpg/immutable'
import { allocation_locale } from '@aresrpg/immutable/locale'
import { cap_mist, sui_amount, nominal_tokens, share_version } from '@aresrpg/immutable/allocation'

import { HERO_SHARE_PATH, hero_share_path, portrait_poster_url } from '../../frontend/src/components/portrait_share.ts'

import { read_awards } from './allocation/store.ts'
import { shared_address } from './allocation/wallets.ts'
import { render_card } from './allocation/share_image.ts'
import type { Graph } from './graph.ts'
import { get_hero_card } from './reads/get_player_profile.ts'

/** The hero subject's route: the site's origin rewrites its share path here. */
export { HERO_SHARE_PATH }
const CHARACTER_ID = /^0x[0-9a-f]{64}$/
const LOCALES = new URL('../../frontend/src/i18n/locales/', import.meta.url)
const HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
})

const escape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
type Copy = Readonly<{
  allocation_page: Readonly<Record<string, string>>
  portfolio_page: Readonly<Record<string, string>>
}>
/** The page's language: an authored locale, else English. */
const read_copy = async (requested: string | null): Promise<Readonly<{ locale: string; copy: Copy }>> => {
  const files = await readdir(LOCALES)
  const locale = requested && files.includes(`${requested}.yaml`) ? requested : 'en'
  return { locale, copy: Bun.YAML.parse(await readFile(new URL(`${locale}.yaml`, LOCALES), 'utf8')) as Copy }
}
const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : whole))

type Card = Readonly<{
  locale: string
  title: string
  summary: string
  canonical: string
  image: string
  home: Readonly<{ href: string; label: string }>
}>
const page = ({ locale, title, summary, canonical, image, home }: Card): Response => {
  const [t, s, u, i] = [title, summary, canonical, image].map(escape)
  return new Response(
    `<!doctype html><html lang="${escape(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><meta name="robots" content="noindex"><meta property="og:type" content="website"><meta property="og:title" content="${t}"><meta property="og:description" content="${s}"><meta property="og:url" content="${u}"><meta property="og:image" content="${i}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${i}"></head><body style="margin:0;background:#faf8f2;color:#30283c;font-family:system-ui;text-align:center"><main style="max-width:1000px;margin:auto;padding:24px"><img style="width:100%" src="${i}" alt="${s}"><p>${s}</p><a href="${escape(home.href)}">${escape(home.label)}</a></main></body></html>`,
    { headers: { ...HEADERS, 'content-type': 'text/html; charset=utf-8' } }
  )
}
const not_found = (): Response => new Response('not found', { status: 404, headers: HEADERS })

/** An allocation card, by the token its verified owner issued: the page, or with `action=image` its image. */
export const allocation_preview = async (request: Request, redis: Redis, origin: string): Promise<Response> => {
  const params = new URL(request.url).searchParams
  const address = await shared_address(redis, params.get('token')).catch((error: Error) => {
    if (error.message === 'unauthorized') return null
    throw error
  })
  if (!address) return not_found()
  const { locale, copy: document } = await read_copy(params.get('locale'))
  const copy = allocation_locale(document)
  const award = (await read_awards(redis)).find((row) => row.address === address)
  const tier = award?.tier ?? 'no_spot'
  const amount = award
    ? `≈ ${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(nominal_tokens(award.tier))} KARES`
    : ''
  const cap = award ? `${sui_amount(cap_mist(award.tier))} SUI` : ''
  if (params.get('action') === 'image')
    return new Response(
      await render_card({ tier, title: copy[tier]!, amount, cap, before: copy.before!, buy_up_to: copy.buy_up_to! }),
      { headers: { ...HEADERS, 'content-type': 'image/png' } }
    )
  const query = new URLSearchParams({ action: 'preview', token: params.get('token')!, locale, v: share_version(award) })
  const canonical = `${origin}/api/allocation?${query}`
  query.set('action', 'image')
  return page({
    locale,
    title: `${copy[tier]} · KARES · AresRPG`,
    summary: award ? `${amount} · ${copy.before} · ${copy.buy_up_to} ${cap}` : copy[tier]!,
    canonical,
    image: `${origin}/api/allocation?${query}`,
    home: { href: `${origin}/allocation`, label: copy.title! },
  })
}

/** A hero, by character id, from the index the socket reads: its poster is drawn by the site's portrait service. */
export const hero_preview = async (request: Request, graph: Graph, origin: string): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'GET, HEAD' } })
  const params = new URL(request.url).searchParams
  const id = params.get('hero') ?? ''
  if (!CHARACTER_ID.test(id)) return not_found()
  const hero = await get_hero_card(graph, { character_id: id }).catch((error: unknown) => {
    console.warn('Hero preview read failed', error instanceof Error ? error.message : error)
    return undefined
  })
  if (hero === undefined) return new Response('unavailable', { status: 503, headers: HEADERS })
  const power = hero ? hero_power(hero.equipment) : 0
  const poster =
    hero &&
    portrait_poster_url(hero, {
      name: hero.name,
      level: hero.level,
      power,
      gear: hero.equipment.map(({ item_type }) => item_type),
    })
  if (!hero || !poster) return not_found()
  const { locale, copy } = await read_copy(params.get('locale'))
  const classe = hero.classe.charAt(0).toUpperCase() + hero.classe.slice(1)
  return page({
    locale,
    title: `${hero.name} · AresRPG`,
    summary: fill(copy.portfolio_page.share_text!, { classe, level: hero.level, power }),
    canonical: `${origin}${hero_share_path(id, locale)}`,
    image: `${origin}${poster}`,
    home: { href: origin, label: 'AresRPG' },
  })
}
