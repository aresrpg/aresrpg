// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — observed characters come from the canonical coop-visible projection.
export const read = (coop_visible_view, address) => coop_visible_view.presence.characters_by_address.get(address)
