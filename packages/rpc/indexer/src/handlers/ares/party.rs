// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Party event projection + the pending-invite object snapshot.
//!
//! The Move events intentionally carry only `{ party, character, owner }`. The
//! accepted order and a leader transfer therefore have to be derived from the
//! preceding Party document. [`LUA_REDUCE`] performs that read/modify/write as
//! one Redis operation, preserving event order and making every mutation safe to
//! replay after a partial committer retry.
//!
//! ## Pending invitations are OBJECT truth, never event truth (#2008)
//!
//! `party::invite` records `Invite { character, owner }` in `Party.pending` and emits
//! NOTHING — verified on chain (digest `B4m8vYhVPD5BVp1apg2XfCFeMiEJY5aerMiEkNvSCyB2`:
//! a successful `party::invite` with zero events), and `decline` is equally silent. So
//! the accepted-membership event projection above structurally cannot see an invitation,
//! and an invited wallet had no way to learn it was invited at all. The pending vector
//! lives in the shared Party object's own bytes, and every mutation re-outputs that
//! object in its checkpoint — exactly the case the `ares_snapshot` object pipeline
//! already exists for (see `snapshot.rs`'s header: "NO event carries this state").
//!
//! [`LUA_PENDING`] reconciles one party's whole pending vector against the previous
//! projection: the per-party document is the truth, `rpc:idx:char_invites:<character>`
//! is the reverse index the read view looks a character up in, and an accepted or
//! declined invitation is REMOVED from that index in the same atomic step. Latest-wins
//! on the full vector, so a replay converges and a missed checkpoint self-heals on the
//! party's next mutation.

use serde::{Deserialize, Serialize};
use sui_indexer_alt_framework::types::base_types::{ObjectID, SuiAddress};

use super::decode::decode_bcs;
use super::project::RedisWrite;

/// BCS layout shared by PartyCreated, PartyJoined and PartyLeft.
/// Field order mirrors `social::party` and is therefore load-bearing.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PartyEvent {
    party: ObjectID,
    character: ObjectID,
    owner: SuiAddress,
}

pub(super) fn map(name: &str, contents: &[u8]) -> Option<RedisWrite> {
    // Name FIRST: the three projected events share one layout, so decoding before the match
    // would report a foreign/future `party` event as a mirror bug. A recognised name that
    // fails to decode IS a mirror bug and says so loudly (see `super::decode`).
    if !matches!(name, "PartyCreated" | "PartyJoined" | "PartyLeft") {
        return None;
    }
    let event: PartyEvent = super::decode::decode_bcs("party", name, contents)?;
    let party = event.party.to_canonical_string(true);
    let character = event.character.to_canonical_string(true);
    let owner = event.owner.to_string();

    match name {
        "PartyCreated" => Some(RedisWrite::PartyCreate {
            party,
            character,
            owner,
        }),
        "PartyJoined" => Some(RedisWrite::PartyJoin {
            party,
            character,
            owner,
        }),
        "PartyLeft" => Some(RedisWrite::PartyLeave {
            party,
            character,
            owner,
        }),
        _ => None,
    }
}

/// `social::party::Party`'s full BCS body. `members` must be decoded even though only
/// `pending` is projected here: it PRECEDES the pending vector on the wire, so the layout
/// is load-bearing field for field (`packages/move/social/sources/party.move`).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PartyObject {
    id: ObjectID,
    leader: ObjectID,
    members: Vec<PartyMemberBcs>,
    pending: Vec<PartyInviteBcs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PartyMemberBcs {
    character: ObjectID,
    owner: SuiAddress,
    order: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PartyInviteBcs {
    character: ObjectID,
    owner: SuiAddress,
}

/// One projected pending invitation — the chain row, mirrored field for field.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PendingInvite {
    pub character: String,
    pub owner: String,
}

/// Project a Party object's whole pending vector. The decoded id must BE this object's
/// id, so a foreign body typed as a Party can never claim another party's document.
pub(super) fn map_party_object(id: &str, contents: &[u8]) -> Option<Vec<RedisWrite>> {
    let party: PartyObject = decode_bcs("object", "Party", contents)?;
    if party.id.to_canonical_string(true) != id {
        return None;
    }
    Some(vec![RedisWrite::PartyPending {
        party: id.to_string(),
        invites: party
            .pending
            .into_iter()
            .map(|invite| PendingInvite {
                character: invite.character.to_canonical_string(true),
                owner: invite.owner.to_string(),
            })
            .collect(),
    }])
}

/// A disbanded party holds nobody's invitation. The same reconcile with an empty vector
/// reaps the document and every reverse-index entry it owned — one code path, no second
/// deletion rule to keep in sync.
pub(super) fn remove_party_invites(party: &str) -> Vec<RedisWrite> {
    vec![RedisWrite::PartyPending {
        party: party.to_string(),
        invites: Vec::new(),
    }]
}

pub(super) fn party_key(party: &str) -> String {
    format!("rpc:party:{party}")
}
pub(super) fn character_party_key(character: &str) -> String {
    format!("rpc:char_party:{character}")
}
pub(super) fn party_invites_key(party: &str) -> String {
    format!("rpc:party_invites:{party}")
}

/// Atomic event reducer for the AresRPG Party read-model.
///
/// KEYS: party document, character-to-party pointer.
/// ARGV: action, party id, character id, owner.
///
/// `create` seeds leader/order zero; `join` appends only an absent character;
/// `leave` removes by character, promotes the lowest-order survivor when the
/// leader leaves, then compacts orders. Pointer deletion is conditional so a
/// retry of an old leave can never erase a newer pointer to another party.
pub(super) const LUA_REDUCE: &str = r#"
local action = ARGV[1]
local party_id = ARGV[2]
local character = ARGV[3]
local owner = ARGV[4]

local function get_json(key)
  local raw = redis.call('JSON.GET', key)
  if not raw then return nil end
  return cjson.decode(raw)
end

local function set_json(key, value)
  redis.call('JSON.SET', key, '$', cjson.encode(value))
end

local function clear_character_pointer()
  local pointed_party = get_json(KEYS[2])
  if pointed_party == party_id then redis.call('DEL', KEYS[2]) end
end

local party = get_json(KEYS[1])

if action == 'create' then
  if not party then
    party = {
      id = party_id,
      leader_character = character,
      members = {{ character = character, owner = owner, order = 0 }}
    }
    set_json(KEYS[1], party)
  end
  set_json(KEYS[2], party_id)
  return 1
end

if not party then
  if action == 'leave' then clear_character_pointer() end
  return 0
end

local members = party.members or {}

if action == 'join' then
  for _, member in ipairs(members) do
    if member.character == character then
      set_json(KEYS[2], party_id)
      return 0
    end
  end
  members[#members + 1] = { character = character, owner = owner, order = #members }
  party.members = members
  set_json(KEYS[1], party)
  set_json(KEYS[2], party_id)
  return 1
end

local removed = false
for index, member in ipairs(members) do
  if member.character == character then
    table.remove(members, index)
    removed = true
    break
  end
end
clear_character_pointer()
if not removed then return 0 end

if #members == 0 then
  redis.call('DEL', KEYS[1])
  return 1
end

table.sort(members, function(left, right)
  if left.order == right.order then return left.character < right.character end
  return left.order < right.order
end)
if party.leader_character == character then party.leader_character = members[1].character end
for index, member in ipairs(members) do member.order = index - 1 end
party.members = members
set_json(KEYS[1], party)
return 1
"#;

/// Atomic reconcile of ONE party's pending-invite vector (#2008).
///
/// KEYS: the party's pending document.
/// ARGV: party id, the whole pending vector as a JSON array of `{character, owner}`.
///
/// The reverse-index keys are derived inside the script because their number and names
/// are data, not schema — the same reason [`LUA_REDUCE`] derives leadership in Redis. The
/// read model is a single Redis instance (no cluster slot to honour), and the whole
/// read/diff/write is one operation so a committer retry can never leave a character
/// indexed against an invitation the document no longer lists. An empty vector deletes
/// the document rather than storing `[]`, which keeps "absent" the ONE way to say
/// "nothing pending" for every reader.
pub(super) const LUA_PENDING: &str = r#"
local party_id = ARGV[1]
local invites = cjson.decode(ARGV[2])

local function index_key(character)
  return 'rpc:idx:char_invites:' .. character
end

local previous = {}
local raw = redis.call('JSON.GET', KEYS[1])
if raw then
  local document = cjson.decode(raw)
  for _, invite in ipairs(document.invites or {}) do previous[invite.character] = true end
end

for _, invite in ipairs(invites) do
  previous[invite.character] = nil
  redis.call('SADD', index_key(invite.character), party_id)
end
for character, _ in pairs(previous) do
  redis.call('SREM', index_key(character), party_id)
end

if #invites == 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
redis.call('JSON.SET', KEYS[1], '$', cjson.encode({ party = party_id, invites = invites }))
return #invites
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, PartialEq)]
    struct Member {
        character: String,
        owner: String,
        order: u8,
    }

    #[derive(Debug, Clone, PartialEq)]
    struct Party {
        id: String,
        leader_character: String,
        members: Vec<Member>,
    }

    fn oid(fill: u8) -> ObjectID {
        ObjectID::from_bytes([fill; 32]).unwrap()
    }
    fn owner(fill: u8) -> SuiAddress {
        SuiAddress::from_bytes([fill; 32]).unwrap()
    }
    fn encode(party: u8, character: u8, owner_byte: u8) -> Vec<u8> {
        bcs::to_bytes(&PartyEvent {
            party: oid(party),
            character: oid(character),
            owner: owner(owner_byte),
        })
        .unwrap()
    }

    fn reduce(state: Option<Party>, write: &RedisWrite) -> Option<Party> {
        let (action, id, character, owner) = match write {
            RedisWrite::PartyCreate {
                party,
                character,
                owner,
            } => ("create", party, character, owner),
            RedisWrite::PartyJoin {
                party,
                character,
                owner,
            } => ("join", party, character, owner),
            RedisWrite::PartyLeave {
                party,
                character,
                owner,
            } => ("leave", party, character, owner),
            _ => panic!("not a Party mutation"),
        };
        let Some(mut party) = state else {
            return (action == "create").then(|| Party {
                id: id.clone(),
                leader_character: character.clone(),
                members: vec![Member {
                    character: character.clone(),
                    owner: owner.clone(),
                    order: 0,
                }],
            });
        };
        if action == "create" || id != &party.id {
            return Some(party);
        }
        if action == "join" {
            if !party
                .members
                .iter()
                .any(|member| &member.character == character)
            {
                party.members.push(Member {
                    character: character.clone(),
                    owner: owner.clone(),
                    order: party.members.len() as u8,
                });
            }
            return Some(party);
        }
        party
            .members
            .retain(|member| &member.character != character);
        if party.members.is_empty() {
            return None;
        }
        party.members.sort_by(|left, right| {
            left.order
                .cmp(&right.order)
                .then(left.character.cmp(&right.character))
        });
        if &party.leader_character == character {
            party.leader_character = party.members[0].character.clone();
        }
        for (order, member) in party.members.iter_mut().enumerate() {
            member.order = order as u8;
        }
        Some(party)
    }

    #[test]
    fn exact_bcs_shape_maps_all_three_event_names() {
        let body = encode(0x11, 0x22, 0x33);
        let party = oid(0x11).to_canonical_string(true);
        let character = oid(0x22).to_canonical_string(true);
        let owner = owner(0x33).to_string();
        assert_eq!(
            map("PartyCreated", &body),
            Some(RedisWrite::PartyCreate {
                party: party.clone(),
                character: character.clone(),
                owner: owner.clone(),
            })
        );
        assert_eq!(
            map("PartyJoined", &body),
            Some(RedisWrite::PartyJoin {
                party: party.clone(),
                character: character.clone(),
                owner: owner.clone(),
            })
        );
        assert_eq!(
            map("PartyLeft", &body),
            Some(RedisWrite::PartyLeave {
                party,
                character,
                owner
            })
        );
    }

    #[test]
    fn same_owner_characters_append_with_deterministic_orders() {
        let created = map("PartyCreated", &encode(0x11, 0x21, 0x31)).unwrap();
        let joined_a = map("PartyJoined", &encode(0x11, 0x22, 0x31)).unwrap();
        let joined_b = map("PartyJoined", &encode(0x11, 0x23, 0x31)).unwrap();
        let party = reduce(reduce(reduce(None, &created), &joined_a), &joined_b).unwrap();
        assert_eq!(
            party
                .members
                .iter()
                .map(|member| member.order)
                .collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert!(party
            .members
            .iter()
            .all(|member| member.owner == owner(0x31).to_string()));
    }

    #[test]
    fn leader_leave_promotes_oldest_survivor_and_compacts_orders() {
        let created = map("PartyCreated", &encode(0x11, 0x21, 0x31)).unwrap();
        let joined_a = map("PartyJoined", &encode(0x11, 0x22, 0x32)).unwrap();
        let joined_b = map("PartyJoined", &encode(0x11, 0x23, 0x33)).unwrap();
        let left = map("PartyLeft", &encode(0x11, 0x21, 0x31)).unwrap();
        let party = reduce(
            reduce(reduce(reduce(None, &created), &joined_a), &joined_b),
            &left,
        )
        .unwrap();
        assert_eq!(party.leader_character, oid(0x22).to_canonical_string(true));
        assert_eq!(
            party
                .members
                .iter()
                .map(|member| member.order)
                .collect::<Vec<_>>(),
            vec![0, 1]
        );
    }

    #[test]
    fn solo_disband_left_event_deletes_party_projection() {
        let created = map("PartyCreated", &encode(0x11, 0x21, 0x31)).unwrap();
        let left = map("PartyLeft", &encode(0x11, 0x21, 0x31)).unwrap();
        assert_eq!(reduce(reduce(None, &created), &left), None);
    }

    fn encode_party(id: u8, leader: u8, members: &[(u8, u8, u8)], pending: &[(u8, u8)]) -> Vec<u8> {
        bcs::to_bytes(&PartyObject {
            id: oid(id),
            leader: oid(leader),
            members: members
                .iter()
                .map(|(character, owner_byte, order)| PartyMemberBcs {
                    character: oid(*character),
                    owner: owner(*owner_byte),
                    order: *order,
                })
                .collect(),
            pending: pending
                .iter()
                .map(|(character, owner_byte)| PartyInviteBcs {
                    character: oid(*character),
                    owner: owner(*owner_byte),
                })
                .collect(),
        })
        .unwrap()
    }

    /// ROW #2008 RED anchor: the invitation the accepted-membership events cannot carry.
    #[test]
    fn pending_invites_project_from_the_party_object_body() {
        let id = oid(0x11).to_canonical_string(true);
        let body = encode_party(
            0x11,
            0x21,
            &[(0x21, 0x31, 0)],
            &[(0x22, 0x32), (0x23, 0x33)],
        );
        assert_eq!(
            map_party_object(&id, &body),
            Some(vec![RedisWrite::PartyPending {
                party: id.clone(),
                invites: vec![
                    PendingInvite {
                        character: oid(0x22).to_canonical_string(true),
                        owner: owner(0x32).to_string(),
                    },
                    PendingInvite {
                        character: oid(0x23).to_canonical_string(true),
                        owner: owner(0x33).to_string(),
                    },
                ],
            }])
        );
    }

    /// An accepted or declined invitation leaves an EMPTY vector, which is the deletion —
    /// the same write a disbanded party's reap produces, so both drain the reverse index.
    #[test]
    fn an_emptied_pending_vector_is_the_same_write_as_a_disband_reap() {
        let id = oid(0x11).to_canonical_string(true);
        let body = encode_party(0x11, 0x21, &[(0x21, 0x31, 0), (0x22, 0x32, 1)], &[]);
        let emptied = map_party_object(&id, &body).unwrap();
        assert_eq!(
            emptied,
            vec![RedisWrite::PartyPending {
                party: id.clone(),
                invites: vec![],
            }]
        );
        assert_eq!(emptied, remove_party_invites(&id));
    }

    /// A body typed as a Party whose decoded UID is someone else's id cannot claim that
    /// document — the same self-ownership check the wrapped-World shell arm runs.
    #[test]
    fn a_party_body_can_never_claim_another_partys_document() {
        let body = encode_party(0x11, 0x21, &[(0x21, 0x31, 0)], &[(0x22, 0x32)]);
        assert_eq!(
            map_party_object(&oid(0x99).to_canonical_string(true), &body),
            None
        );
    }

    #[test]
    fn duplicate_join_and_replayed_sequence_converge() {
        let writes = [
            map("PartyCreated", &encode(0x11, 0x21, 0x31)).unwrap(),
            map("PartyJoined", &encode(0x11, 0x22, 0x32)).unwrap(),
            map("PartyLeft", &encode(0x11, 0x21, 0x31)).unwrap(),
        ];
        let once = writes.iter().fold(None, reduce);
        let twice = writes.iter().fold(once.clone(), reduce);
        assert_eq!(once, twice);
    }
}
