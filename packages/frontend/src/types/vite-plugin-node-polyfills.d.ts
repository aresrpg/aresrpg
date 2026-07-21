// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// The package exports this runtime shim without exposing the adjacent source declaration through `exports`.
declare module 'vite-plugin-node-polyfills/shims/process' {
  const process_shim: unknown
  export default process_shim
}
