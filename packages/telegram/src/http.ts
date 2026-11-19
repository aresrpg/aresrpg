// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { timingSafeEqual } from 'node:crypto'

import { decode_update, type Input } from './wire.ts'

/** An unset secret matches nothing, so a listener without one refuses every request. */
export const secret_matches = (actual: string | null, expected: string) => {
  const bytes = Buffer.from(actual ?? '')
  const target = Buffer.from(expected)
  return target.length > 0 && bytes.length === target.length && timingSafeEqual(bytes, target)
}
/** The webhook boundary. Telegram redelivers every update that is not answered 2xx, so an authentic
 * update this bot never acts on (group, edited, forwarded, media, membership) is acknowledged and
 * dropped. Only a body that is not JSON is refused. */
export const read_update = async (request: Request, secret: string, maximum: number): Promise<Input | Response> => {
  if (new URL(request.url).pathname !== '/telegram' || request.method !== 'POST')
    return new Response(null, { status: 404 })
  if (!secret_matches(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), secret))
    return new Response(null, { status: 403 })
  const raw = await read_body(request, maximum)
  if (raw === null) return new Response(null, { status: 413 })
  let value: unknown
  try {
    value = JSON.parse(raw)
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- Malformed external JSON is returned as an explicit HTTP failure.
  } catch {
    return new Response(null, { status: 400 })
  }
  return decode_update(value) ?? new Response(null, { status: 200 })
}
export const read_body = async (request: Request, maximum: number): Promise<string | null> => {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.length
    if (size > maximum) {
      await reader.cancel()
      return null
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
