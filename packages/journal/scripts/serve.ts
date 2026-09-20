// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { resolve, sep } from 'node:path'

const output_dir = resolve(import.meta.dirname, '../dist')
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 4175,
  fetch: async (request) => {
    const path = decodeURIComponent(new URL(request.url).pathname)
    const candidate = resolve(output_dir, `.${path === '/' ? '/index.html' : path}`)
    if (!candidate.startsWith(`${output_dir}${sep}`)) return new Response('Not found', { status: 404 })
    const file = Bun.file(candidate)
    if (await file.exists()) return new Response(file)
    const html = Bun.file(`${candidate}.html`)
    if (await html.exists()) return new Response(html)
    return new Response(Bun.file(resolve(output_dir, '404.html')), { status: 404 })
  },
})
console.log(`Journal preview: ${server.url}`)
