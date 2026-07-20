// HTTP response helper — the single home for how the API renders JSON.
//
// Handlers return a plain descriptor `{ status, data, headers? }`; this turns it
// into a Response with a stable JSON body, and for cacheable 200 GETs attaches a
// weak-ish ETag and honours `If-None-Match` (→ 304). Keeping ETag/caching in one
// place is what makes the RPC CDN-cacheable per SPEC §14.

// CORS — the read-API is consumed by browsers cross-origin (the frontend's SPEC §14
// short-poll reads), so every response carries Access-Control-Allow-Origin when the
// request's Origin is allowed. We ECHO the allowed origin, never `*`, so a future
// credentialed deploy can't silently over-share; `Vary: Origin` keeps CDN/ETag caching
// correct per origin. Allowlist: localhost/127.0.0.1 on any port (dev) always passes;
// deployed origins come from CORS_ORIGINS (comma-separated exact origins, env).
// GET-only API + no custom request headers ⇒ browsers send no preflight, so no OPTIONS
// handling is needed.
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function allowed_origin(req) {
  const origin = req?.headers?.get('origin')
  if (!origin) return null
  return LOCALHOST_ORIGIN.test(origin) || CORS_ORIGINS.includes(origin) ? origin : null
}

export function to_response(desc, req, extra_headers = {}) {
  const status = desc.status ?? 200
  // Compact on purpose: pretty-printing was +34% pure whitespace on the wire
  // (encyclopedia: 2.53 MB → 1.89 MB) and the ETag hashed the bloat too.
  const body = JSON.stringify(desc.data)

  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    ...(desc.headers ?? {}),
    ...extra_headers,
  })

  // Edge-cached public routes pin `access-control-allow-origin: *` at the call site: Cloudflare ignores
  // `Vary`, so ONE cached variant serves every requester — an echoed (or absent) origin header cached from
  // one client would break CORS for the next. `*` is safe here: GET-only, credential-less, public data.
  // Non-pinned (uncached/personal) routes keep the strict echo.
  const origin = allowed_origin(req)
  if (origin && !extra_headers['access-control-allow-origin']) {
    headers.set('access-control-allow-origin', origin)
    headers.set('vary', 'origin')
  }

  // Conditional GET for cacheable 200s: content-hash ETag, 304 on match.
  if (status === 200 && req?.method === 'GET') {
    const etag = `"${Bun.hash(body).toString(16)}"`
    headers.set('etag', etag)
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers })
    }
  }

  return new Response(body, { status, headers })
}
