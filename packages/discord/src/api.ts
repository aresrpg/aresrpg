// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Card } from './card.ts'

export const create_discord_api = (token: string, channel: string, fetcher: typeof fetch = fetch) => {
  const request = (path: string, options: RequestInit = {}) =>
    fetcher(`https://discord.com/api/v10${path}`, {
      ...options,
      headers: { Authorization: `Bot ${token}`, ...options.headers },
      signal: AbortSignal.timeout(15_000),
    })
  const identity = async (): Promise<{ id: string }> => {
    const response = await request('/users/@me')
    if (!response.ok) throw new Error(`Discord authentication failed: HTTP ${response.status}`)
    return (await response.json()) as { id: string }
  }
  const send = async (card: Card, png: Uint8Array, marker: string): Promise<string> => {
    const body = new FormData()
    body.set('payload_json', JSON.stringify(card))
    body.set('files[0]', new Blob([Buffer.from(png)], { type: 'image/png' }), `ares-${marker}.png`)
    // Only Discord's explicit rate-limit refusal retries this received event.
    for (;;) {
      const response = await request(`/channels/${channel}/messages`, { method: 'POST', body })
      if (response.status === 429) {
        const limit = (await response.json()) as { retry_after: number }
        if (!Number.isFinite(limit.retry_after) || limit.retry_after <= 0) throw new Error('Invalid Discord rate limit')
        await Bun.sleep(Math.ceil(limit.retry_after * 1000))
        continue
      }
      if (!response.ok) throw new Error(`Discord send failed: HTTP ${response.status}`)
      const result = (await response.json()) as { id?: string }
      if (!result.id || !/^\d+$/.test(result.id)) throw new Error('Discord returned no message ID')
      return result.id
    }
  }
  return { identity, send }
}
