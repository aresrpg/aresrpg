// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'

export const format_sui = (mist: string): string => {
  const value = BigInt(mist)
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return `${value / 1_000_000_000n}${fraction ? `.${fraction}` : ''}`
}
export const notification_marker = (scope: string, id: string): string =>
  createHash('sha256').update(`${scope}:${id}`).digest('hex').slice(0, 24)
export const notification_card = (content: string, marker: string, digest: string, network: string) => ({
  content: `${content} [↗](https://suiscan.xyz/${network}/tx/${digest})`,
  allowed_mentions: { parse: [] },
  nonce: marker,
  enforce_nonce: true,
  embeds: [{ image: { url: `attachment://ares-${marker}.png` } }],
})
export type Card = ReturnType<typeof notification_card>
