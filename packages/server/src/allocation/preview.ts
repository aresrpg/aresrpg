// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFile, readdir } from 'node:fs/promises'

import type { Redis } from 'ioredis'
import { parse } from 'yaml'
import { cap_mist, sui_amount, nominal_tokens, share_version, campaign } from '@aresrpg/immutable/allocation'

import { read_campaign } from './store.ts'
import { shared_address } from './wallets.ts'
import { render_card } from './share_image.ts'

const escape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
export const share_preview = async (request: Request, redis: Redis, origin: string): Promise<Response> => {
  const params = new URL(request.url).searchParams
  const address = await shared_address(redis, params.get('token'))
  const files = await readdir(new URL('../../../frontend/src/i18n/locales/', import.meta.url))
  const requested = params.get('locale') ?? 'en'
  const locale = files.includes(`${requested}.yaml`) ? requested : 'en'
  const { allocation_page: copy } = parse(
    await readFile(new URL(`../../../frontend/src/i18n/locales/${locale}.yaml`, import.meta.url), 'utf8')
  ) as { allocation_page: Record<string, string> }
  const current = await read_campaign(redis)
  const award = current.awards.find((row) => row.address === address)
  const tier = award?.tier ?? (current.phase === 'final' ? 'no_spot' : 'pending')
  const review: Readonly<Partial<Record<string, string>>> = {
    pending: `${copy.entries_close} · ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(campaign.submissions_close_at))}`,
  }
  const title = `${copy[tier]} · KARES · AresRPG`
  const amount = award
    ? `≈ ${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(nominal_tokens(award.tier))} KARES`
    : copy.pending
  const cap = award ? `${sui_amount(cap_mist(award.tier))} SUI` : ''
  const summary = award ? `${amount} · ${copy.before} · ${copy.buy_up_to} ${cap}` : copy[tier]
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
  if (params.get('action') === 'image')
    return new Response(
      await render_card({
        tier,
        title: copy[tier],
        amount: award ? amount : '',
        cap,
        before: copy.before,
        buy_up_to: copy.buy_up_to,
        review: review[tier],
      }),
      { headers: { ...headers, 'content-type': 'image/png' } }
    )
  const query = new URLSearchParams({
    action: 'preview',
    token: params.get('token')!,
    locale,
    v: share_version(current.phase, award),
  })
  const canonical = `${origin}/api/allocation?${query}`
  query.set('action', 'image')
  const image = `${origin}/api/allocation?${query}`
  return new Response(
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><meta name="robots" content="noindex"><meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(summary)}"><meta property="og:url" content="${escape(canonical)}"><meta property="og:image" content="${escape(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escape(image)}"></head><body style="margin:0;background:#faf8f2;color:#30283c;font-family:system-ui;text-align:center"><main style="max-width:1000px;margin:auto;padding:24px"><img style="width:100%" src="${escape(image)}" alt="${escape(summary)}"><p>${escape(summary)}</p><a href="${origin}/allocation">${escape(copy.title)}</a></main></body></html>`,
    { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } }
  )
}
