// BOOT SHIM (D146) — MUST be main.tsx's FIRST import. ES imports are hoisted: an inline assignment in
// main.tsx runs only AFTER every static import's module body has evaluated — too late for a module deep in
// the graph that touches `process` at module scope. As a standalone module imported first, THIS body runs
// before any later import evaluates.
//
// Why it exists: vite-plugin-node-polyfills' global injection silently stopped working in BUILD (its own
// deprecation warning — "esbuild option… use oxc"); the built entry carried bare `process.emit` refs
// (stream/events polyfill internals via the protocol wire codec) with no shim ⇒ ReferenceError at boot ⇒
// BLANK APP in prod/preview while dev kept working. Independent of plugin mechanics by design.
import process_shim from 'vite-plugin-node-polyfills/shims/process'

;(globalThis as { process?: unknown }).process ??= process_shim
