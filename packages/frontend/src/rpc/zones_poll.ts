// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE /v1/zones poll shared by CompassStrip.jsx, DiscoveryPrompts.jsx, and world_spawns.js (#242
// read-layer census: three independent 6s pollers were each fetching the IDENTICAL discovered-zone list for
// the SAME world — tripling that request for no reason). Built on shared_poll.ts's generic ref-counted
// primitive; see its own tests for the coalescing/teardown proof. This file only wires the /v1/zones fetcher
// + cadence and re-exports the typed surface each consumer needs.

import { get_zones } from './client'
import { create_shared_poll } from './shared_poll'
import type { RpcZones } from './views'

const INTERVAL_MS = 6000 // the CompassStrip/DiscoveryPrompts zone cadence — reused, never a second value

const zones_poll = create_shared_poll<RpcZones>((world_id) => get_zones(world_id), INTERVAL_MS)

/** Non-React callers (world_spawns.js): join the shared poll for `world_id`, returns the release function. */
export const subscribe_zones = zones_poll.subscribe

/** React hook, useRpcView-shaped — `world_id` null/undefined idles. */
export const use_zones_view = zones_poll.useSharedPoll

/** Force an out-of-band re-read now (e.g. a just-confirmed search) — propagates to every subscriber. */
export const refetch_zones = zones_poll.refetch

/** Test isolation for the module-lifetime shared state. */
export const _reset_zones_poll_for_test = zones_poll._reset_for_test
