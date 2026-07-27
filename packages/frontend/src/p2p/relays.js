// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE rendezvous relay list — ONE home, read by the lobby transport (lobby-room.js) and by the boot-smoke
// gate (#1361), which exempts browser-native WebSocket failures aimed at these hosts. A LEAF module on
// purpose: zero imports, so a plain `node` script reads it without evaluating the frontend's module graph.
// Adding or removing a relay here moves both consumers in the same commit; a second copy would not.
//
// EXPLICIT nostr rendezvous relays (2026-07-15): trystero's baked-in default list included a dead relay
// (chorus.pjv.me → 502 on every handshake, visible console noise + degraded discovery). Peers are
// browser-to-browser WebRTC — relays only broker the handshake, so a diverse public list + redundancy is
// the whole fix; self-hosting one stays a ticketed option if these ever rot too.
export const RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.mom',
  'wss://relay.snort.social',
]
