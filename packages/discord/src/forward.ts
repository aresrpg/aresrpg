// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { notification_card, notification_marker, type Card } from './card.ts'
import { actors, announcement, type VisualCard } from './model.ts'
import { parse_notification } from './notification.ts'
import type { Copy } from './copy.ts'

export const create_forwarder =
  (
    ports: Readonly<{
      copy: Copy
      scope: string
      network: string
      resolve_name: (address: string) => Promise<string | null>
      render: (card: VisualCard) => Promise<Uint8Array>
      send: (card: Card, png: Uint8Array, marker: string) => Promise<string>
    }>
  ) =>
  async (raw: string): Promise<string | null> => {
    const notification = parse_notification(JSON.parse(raw))
    if (!announcement(ports.copy, {}, notification)) return null
    const names = Object.fromEntries(
      await Promise.all(actors(notification).map(async (address) => [address, await ports.resolve_name(address)]))
    )
    const model = announcement(ports.copy, names, notification)!
    const marker = notification_marker(ports.scope, notification.id)
    return ports.send(
      notification_card(model.content, marker, notification.digest, ports.network),
      await ports.render(model.visual),
      marker
    )
  }
