// Pure friend-input orchestration. The rendered inputs live in game/** (a fenced lane), but both already pass
// their raw text through the shared world-shell action. Keeping prefix detection + name resolution here lets
// every current/future friend surface share the same behavior without UI-local fetches or transaction forks.

const address_prefix = /^0x/i

/**
 * Resolve a player name or address-shaped input into the address the add-friend flow consumes.
 *
 * Resolution order (character name FIRST, SuiNS handle as fallback):
 *   1. `0x…`              → the address path (even when malformed; the address validator owns its error).
 *   2. exact character name → `/v1/names` (globally unique on-chain; the array contract fails closed on any
 *                             duplicate/corrupt projection rows rather than auto-picking a wallet).
 *   3. SuiNS handle        → tried ONLY when no character matched AND the input looks like a SuiNS display
 *                             form ("@alice", "alice.sui", "treasury@aresrpg").
 *
 * A miss carries `via` ('name' | 'suins') — the single home for the distinction that lets the toast name
 * WHICH lookup failed ("no character named X" vs "no SuiNS handle X").
 *
 * @param {unknown} target
 * @param {{
 *   find_by_name: (name:string) => Promise<Array<{owner?:string}>>,
 *   find_by_suins?: (name:string) => Promise<string|null>,
 *   looks_like_suins?: (value:string) => boolean,
 * }} deps
 */
export async function resolve_friend_target(target, { find_by_name, find_by_suins, looks_like_suins }) {
  const input = String(target ?? '').trim()
  if (!input) return { kind: 'invalid' }
  if (address_prefix.test(input)) return { kind: 'resolved', source: 'address', address: input.toLowerCase() }

  const matches = await find_by_name(input)
  if (!Array.isArray(matches)) throw new Error('name lookup returned a malformed matches payload')
  if (matches.length > 1) return { kind: 'ambiguous', matches }
  if (matches.length === 1) {
    const owner = String(matches[0]?.owner ?? '')
      .trim()
      .toLowerCase()
    if (!owner) throw new Error('name lookup returned a match without an owner')
    return { kind: 'resolved', source: 'name', address: owner, match: matches[0] }
  }

  // No character by that name — fall back to SuiNS, but only for inputs that ARE a SuiNS display form, so a
  // plain-name miss stays a character miss (via:'name') and the toast blames the right lookup.
  if (find_by_suins && looks_like_suins?.(input)) {
    const address = await find_by_suins(input)
    if (address)
      return {
        kind: 'resolved',
        source: 'suins',
        address: String(address).trim().toLowerCase(),
      }
    return { kind: 'not_found', via: 'suins', matches }
  }
  return { kind: 'not_found', via: 'name', matches }
}

/** Resolve `target` and, only for one resolved address, enter the unchanged address add flow. */
export async function submit_friend_target(target, { find_by_name, find_by_suins, looks_like_suins, add_address }) {
  const resolution = await resolve_friend_target(target, { find_by_name, find_by_suins, looks_like_suins })
  if (resolution.kind === 'resolved') await add_address(resolution.address)
  return resolution
}
