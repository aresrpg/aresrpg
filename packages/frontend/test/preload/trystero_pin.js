// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PRELOADED, and it has to be. bun's module registry is process-global and ESM binds imports at LINK time, so
// the first suite to pull in src/p2p/lobby-room.js fixes that module's `joinRoom` for the whole run — a
// `mock.module` registered later in any single test file can never take it back. Preloading the double is the
// only place early enough, and it is also a hard safety rail: without it, a suite that touches the transport
// dials a REAL MQTT broker from a unit test (bun's ws stack throws "Not supported yet in Bun" on the way).
// The double's state (sent frames, room configs, the relay socket) is imported from that one home by whoever
// asserts on it.
import '../../src/test_helpers/trystero_mock.js'
