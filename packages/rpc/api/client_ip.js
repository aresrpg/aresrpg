// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Best-effort client IP for the per-IP rate limiter (rate_limit.js).
//
// This origin is reachable ONLY through the Cloudflare Tunnel (k8s CLAUDE.md: "no ports
// exposed, all traffic is outbound to Cloudflare edge") — Cloudflare stamps `CF-Connecting-IP`
// on every request it proxies and strips/overwrites any client-supplied copy at its edge, so
// it is the one header a client cannot forge. `X-Forwarded-For`'s first hop is NOT that:
// Cloudflare APPENDS the real connecting IP to whatever XFF the client already sent rather than
// replacing it, so a request arriving with `X-Forwarded-For: 1.2.3.4` is forwarded on as
// `1.2.3.4, <real ip>` — `.split(',')[0]` reads the attacker-chosen value. Verified live
// 2026-07-21: a spoofed XFF against rpc.aresrpg.world minted a fresh 120-request budget on every
// request while the real shared office IP sat throttled — the limiter was decorative against
// abuse and squeezed real players instead.
// XFF stays the fallback for local/self-hosted runs (docker-compose, README "self-hostable")
// that sit behind no CDN at all; the socket address is the last resort.
export function client_ip(req, server) {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return server.requestIP(req)?.address ?? 'unknown'
}
