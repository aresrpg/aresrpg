// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Party read view. The Rust event projector owns the mirrored Redis contract:
//   rpc:char_party:<character> -> "<party id>"
//   rpc:party:<party> -> { id, leader_character, members:[{character,owner,order}] }
// AresRPG parties are character-keyed; repeated owner addresses are intentional.

import { get_json, mget_json } from './redis.js'

const CACHE = { 'cache-control': 'public, max-age=5' }
const ok = (data) => ({ status: 200, headers: CACHE, data })
const bad = (message) => ({ status: 400, data: { error: 'bad_request', message } })

const K = {
  character: (character) => `rpc:character:${character}`,
  character_party: (character) => `rpc:char_party:${character}`,
  kiosk: (kiosk) => `rpc:kiosk:${kiosk}`,
  party: (party) => `rpc:party:${party}`,
}

const default_reads = { get_json, mget_json }

function shape_party(party, fallback_id) {
  if (!party || !Array.isArray(party.members)) return null
  const members = party.members
    .filter(
      (member) =>
        typeof member?.character === 'string' &&
        typeof member?.owner === 'string' &&
        Number.isInteger(member?.order) &&
        member.order >= 0
    )
    .map(({ character, owner, order }) => ({ character, owner, order }))
    .sort((left, right) => left.order - right.order || left.character.localeCompare(right.character))

  if (typeof party.leader_character !== 'string' || members.length === 0) return null
  return {
    id: typeof party.id === 'string' ? party.id : fallback_id,
    leader_character: party.leader_character,
    members,
  }
}

// GET /v1/parties?character=<id> returns the one projected Party document or
// null when the character is not currently a member. The membership check also
// makes a stale/corrupt pointer fail closed instead of exposing the wrong party.
export async function handle_parties(params, reads = default_reads) {
  const character = params.get('character')?.trim()
  if (!character) return bad('provide ?character=<character id>')

  const party_id = await reads.get_json(K.character_party(character))
  if (typeof party_id !== 'string' || party_id.length === 0) return ok(null)

  const party = shape_party(await reads.get_json(K.party(party_id)), party_id)
  if (!party?.members.some((member) => member.character === character)) return ok(null)

  // Event owners are the ownership proof observed when a member joined. Characters
  // can subsequently move between personal kiosks, so the public view resolves each
  // member through the current character -> kiosk -> owner projection. A lagging
  // snapshot falls back to the event owner without changing membership or order.
  const characters = await reads.mget_json(party.members.map((member) => K.character(member.character)))
  const kiosk_ids = [...new Set(characters.map((snapshot) => snapshot?.kiosk_id).filter(Boolean))]
  const kiosks = await reads.mget_json(kiosk_ids.map(K.kiosk))
  const kiosk_owner = new Map(kiosk_ids.map((id, index) => [id, kiosks[index]?.owner ?? null]))
  const members = party.members.map((member, index) => ({
    ...member,
    owner: kiosk_owner.get(characters[index]?.kiosk_id) ?? member.owner,
  }))

  return ok({ ...party, members })
}
