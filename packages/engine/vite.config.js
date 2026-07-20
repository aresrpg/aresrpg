import { defineConfig } from 'vite'

// §3.3 — COOP/COEP enable `crossOriginIsolated` so `workers/shared_memory.js` can allocate
// real SharedArrayBuffers on this demo/bench page. The dapp (packages/frontend) never sets
// these headers — SAB stays opt-in there via the transferable fallback path.
const cross_origin_isolation_headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// [P0 balloon 2026-07-11] DEV-ONLY: replace every transformed module's inline source map with an empty
// one. Vite dev appends maps as base64 `data:` URIs inside the served JS, and V8 retains that string in
// EVERY realm that loads the module — heap-snapshot-measured at ~34 MB per gen-graph worker realm
// (~600 MB across the worker pools on a 16-core machine), a big slice of the renderer-RSS OOM that was
// killing tabs. Serve-mode only — `vite build` output is untouched, so prod bundles keep their (external)
// maps. Opt back in for a debugging session with ARES_DEV_SOURCEMAPS=1. The empty-map shape (sources: [])
// stops vite back-filling sourcesContent; stack traces then reference served code, whose line numbers stay
// close to source (esbuild transforms are line-preserving).
const strip_dev_sourcemaps = {
  name: 'ares:strip-dev-sourcemaps',
  apply: /** @type {const} */ ('serve'),
  enforce: /** @type {const} */ ('post'),
  /** @param {string} code */
  transform(code) {
    return { code, map: { version: 3, sources: [], sourcesContent: [], names: [], mappings: '' } }
  },
}

export default defineConfig({
  plugins: process.env.ARES_DEV_SOURCEMAPS ? [] : [strip_dev_sourcemaps],
  // Treat GLBs as static assets (the ENG-8 character avatar loads its rig via `import url from
  // '.../senshi_male.glb?url'`). Vite handles the explicit `?url` suffix, but listing the extension
  // keeps any bare import an emitted asset too rather than a parse attempt.
  assetsInclude: ['**/*.glb'],
  server: {
    port: 5199,
    headers: cross_origin_isolation_headers,
  },
  preview: {
    port: 5199,
    headers: cross_origin_isolation_headers,
  },
  worker: {
    format: 'es',
  },
})
