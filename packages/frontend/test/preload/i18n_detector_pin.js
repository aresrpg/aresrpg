// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1564 — PIN THE i18next DETECTOR'S STORAGE PROBE COLD, ONCE, BEFORE ANY TEST FILE LOADS.
//
// `i18next-browser-languagedetector` memoises its storage probes PROCESS-GLOBALLY and exposes no
// invalidation API: `localStorageAvailable()` computes `hasLocalStorageSupport` on its FIRST call and
// returns the cached verdict forever after (dist/esm/i18nextBrowserLanguageDetector.js:203-218;
// `sessionStorageAvailable()` is the same shape at :242-257). The verdict is derived from `window`.
//
// Test files install and remove a `globalThis.window` stub (src/test_helpers/browser_globals.js), so
// under `bun test` — one process for the whole suite — whichever file probes FIRST decides the memo for
// every file after it. A file holding a window stub when it first touches src/i18n warms the memo to
// TRUE; its teardown then deletes `globalThis.window`, and the memo keeps claiming localStorage is
// available. Every later `i18n.changeLanguage()` in a window-less file therefore reaches
// `window.localStorage.setItem(...)` and dies with `ReferenceError: window is not defined` — a failure
// that depends purely on file order, so it passed in isolation, reddened in a directory run, and
// differed between macOS and Linux readdir order (green on CI, red locally).
//
// Probing HERE — before any test file has run, when `window` is guaranteed absent — pins both memos
// FALSE for the process. i18next then never reaches for a `window` the harness may have taken away.
// This is a TEST-ONLY preload; the browser build never loads it, so production language persistence is
// untouched. It weakens no assertion: no test asserts the `ares_language` localStorage write (that key
// appears only in src/i18n/index.ts).
import LanguageDetector from 'i18next-browser-languagedetector'

// `detect(order)` runs each named detector's `lookup`, which is the public path to the storage probes.
new LanguageDetector().detect(['localStorage', 'sessionStorage'])
