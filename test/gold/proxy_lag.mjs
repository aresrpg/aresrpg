#!/usr/bin/env bun
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// test/gold/proxy_lag.mjs — LANE LAG (lane_reports/CLI_TEST_AUDIT.md #5/TONIGHT-1). Pure passthrough HTTP proxy
// that adds artificial latency in front of the gold /v1 read-api, so playwright.anchor.config.ts's `lagged`
// project can point a REAL Vite dev server at it and replay existing anchor specs under prod-shaped timing
// (prod /v1 TTFB ~0.66-0.79s per tmp_lane_PRODQA_report.md:9) — deterministically, on localnet, zero mocking.
// Every request forwards byte-for-byte to LAG_UPSTREAM after a delay; the payload itself is never touched.
//
//   LAG_UPSTREAM=http://127.0.0.1:3100 LAG_PORT=3101 LAG_DELAY_MS=700 LAG_JITTER_MS=300 bun test/gold/proxy_lag.mjs

const upstream = (process.env.LAG_UPSTREAM ?? 'http://127.0.0.1:3100').replace(/\/+$/, '')
const port = Number(process.env.LAG_PORT ?? 3101)
const base_delay_ms = Number(process.env.LAG_DELAY_MS ?? 700)
const jitter_ms = Number(process.env.LAG_JITTER_MS ?? 300)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// fetch() transparently decompresses the upstream body, so a forwarded content-encoding/content-length would
// describe bytes this process no longer has; host/connection are per-hop and must never cross the proxy either.
const drop_request_headers = new Set(['host', 'content-length', 'connection'])
const drop_response_headers = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection'])

function filtered_headers(source, drop) {
  const headers = new Headers()
  for (const [key, value] of source) if (!drop.has(key.toLowerCase())) headers.append(key, value)
  return headers
}

const server = Bun.serve({
  port,
  async fetch(request) {
    await sleep(base_delay_ms + Math.random() * jitter_ms)
    const target = new URL(request.url)
    const has_body = !['GET', 'HEAD'].includes(request.method)
    const response = await fetch(`${upstream}${target.pathname}${target.search}`, {
      method: request.method,
      headers: filtered_headers(request.headers, drop_request_headers),
      body: has_body ? await request.arrayBuffer() : undefined,
    })
    return new Response(response.body, {
      status: response.status,
      headers: filtered_headers(response.headers, drop_response_headers),
    })
  },
})

console.log(`[lag-proxy] :${server.port} → ${upstream} (delay=${base_delay_ms}ms +jitter≤${jitter_ms}ms)`)
