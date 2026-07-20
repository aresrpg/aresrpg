// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import merge_import from 'fast-merge-async-iterators'

// fast-merge-async-iterators is CJS (`exports.default = fn`, `__esModule:true`). Under Bun the
// default IS the fn; Vite double-wraps the interop so the callable is `mod.default.default`. One
// import, two opposite runtime interops (the cjs-interop seam) — unwrap runtime-agnostically
// so the vendored game bundle works under Vite AND the harness under Bun.
const merge =
  typeof merge_import === 'function'
    ? merge_import
    : typeof merge_import.default === 'function'
      ? merge_import.default
      : merge_import.default.default

/**
 * Merge several async iterables into one, closing only when all are done.
 * (Extracted from the AresRPG dapp's core/utils/iterator.js, minus the Vue context dep.)
 * @param {...AsyncIterable<any>} iterables
 * @returns {AsyncIterableIterator<any>}
 */
export function combine(...iterables) {
  return merge('iters-close-wait', ...iterables)
}
