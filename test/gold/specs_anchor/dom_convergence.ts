// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Page } from '@playwright/test'

// DOM LIVE-BINDING CONVERGENCE ORACLE (LANE HPDOM) — the HP-integer-in-a-div class where
// a store mutation lands (chain → /v1 → the pipeline's reducer) but never repaints because of a
// torn subscription, a stale-identity `Object.is` skip, or a slice only a DIFFERENT selector reads. Zero specs
// touched the rendered DOM before world_hp_live.spec.ts (FM3) hand-rolled mount+dispatch+read once; this pulls
// out the one genuinely reusable half — MOUNTING the real component through the REAL Vite module graph — so a
// future row is two lines: mount once, then assert convergence with Playwright's OWN auto-retrying matchers
// (`toHaveText` / `toHaveClass` with `{ timeout: LIVE_BIND_BUDGET_MS }`) — a real bounded poll, never a fixed
// sleep-then-read: a binding that needs 5.9s still passes, one that never converges fails loud at the budget
// instead of silently passing on a coincidental read.
//
// Two-line usage:
//   await mount_bound(page, '/src/game/screens/hud/world/SelfPlate.jsx', 'SelfPlate')
//   await expect(page.locator('.gw-selfplate__hp-t')).toHaveText('60/70', { timeout: LIVE_BIND_BUDGET_MS })

/** Bounded-flush budget for a store→DOM convergence assertion (audit spec: "≤6s" — the anchor suite's live-lag
 * beat). Long enough for one ~4s poll tick, short enough to fail fast on a torn subscription. */
export const LIVE_BIND_BUDGET_MS = 6000

/**
 * Mount `export_name` from `module_path` into a fresh root and wait one settled paint. Runs entirely IN-PAGE
 * (React, the component, and the store all resolve through Vite's dev-server module graph — `import()` of
 * `/src/...` only works inside the browser), so this is the REAL production component/store graph, never a
 * test double. The target must be a zero-prop, store-bound reader (SelfPlate, FightTimeline, … — GameWorldHud
 * .jsx's own description: "pure `s.fight`/`s.sui` readers" — genuinely reusable as-is).
 */
export async function mount_bound(page: Page, module_path: string, export_name: string) {
  await page.evaluate(
    async ({ module_path, export_name }) => {
      const [{ React, createRoot }, mod] = await Promise.all([
        import('/src/dom_convergence_deps.ts'),
        import(module_path),
      ])
      const root_node = document.createElement('div')
      root_node.id = 'dom-convergence-root'
      document.body.append(root_node)
      const Component = (mod as Record<string, any>)[export_name]
      createRoot(root_node).render(React.createElement(Component))
      // two rAFs: the first commits React's render, the second guarantees the browser painted it.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    },
    { module_path, export_name }
  )
}

/** In-page store dispatch through the REAL reducer pipeline (never a raw store `set()`), for JSON-safe payloads.
 * A payload needing browser-only shapes (a `Map`, `Date.now()`-derived fields) is out of scope for this generic
 * wrapper — build it inline via its own `page.evaluate` (still importing the same `/src/game/store.js`), exactly
 * like a Map-shaped fight spawn does; both forms dispatch the same `context.dispatch(action, payload)`. */
export async function dispatch(page: Page, action: string, payload: unknown) {
  await page.evaluate(
    async ({ action, payload }) => {
      const { context } = await import('/src/game/store.js')
      context.dispatch(action, payload)
    },
    { action, payload }
  )
}
