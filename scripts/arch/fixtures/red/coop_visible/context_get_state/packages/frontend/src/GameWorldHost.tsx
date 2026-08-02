// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — context.get_state() bypasses the canonical coop-visible projection.
export const read = () => context.get_state()
