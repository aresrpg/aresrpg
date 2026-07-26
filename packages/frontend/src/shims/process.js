// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// The shipped graph only calls process.emit (React's uncaught-error bridge). Build-graph polyfills remain
// owned by vite-plugin-node-polyfills in vite.config.ts; this boot shim deliberately exposes nothing else.
const noop = () => undefined

const process_shim = { emit: noop }

export default process_shim
