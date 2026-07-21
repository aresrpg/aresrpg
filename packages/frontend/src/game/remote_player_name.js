// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const clean_name = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * Prefer the chain-resolved character name for a remote player's UI. The peer-declared label keeps
 * logged-out/unresolved spectate useful; the shortened address is only the final identity fallback.
 * @param {{ resolved_name?: string | null, peer_name?: string | null, address?: string | null }} names
 */
export const peer_display_name = ({ resolved_name, peer_name, address }) =>
  clean_name(resolved_name) || clean_name(peer_name) || String(address ?? '').slice(0, 6)
