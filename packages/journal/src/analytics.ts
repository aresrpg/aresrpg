// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { inject } from '@vercel/analytics'

export const public_url = (url: string) => url.split(/[?#]/u, 1)[0]!

export const init_analytics = (hostname: string) => {
  if (hostname !== 'journal.aresrpg.world') return
  inject({ mode: 'production', beforeSend: (event) => ({ ...event, url: public_url(event.url) }) })
}
