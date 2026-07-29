// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Party event projection.
//!
//! The Move events intentionally carry only `{ party, character, owner }`. The
//! accepted order and a leader transfer therefore have to be derived from the
//! preceding Party document. [`LUA_REDUCE`] performs that read/modify/write as
//! one Redis operation, preserving event order and making every mutation safe to
//! replay after a partial committer retry.

use serde::{Deserialize, Serialize};
use sui_indexer_alt_framework::types::base_types::{ObjectID, SuiAddress};

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

pub(super) fn party_key(party: &str) -> String {
    format!("rpc:party:{party}")
}
pub(super) fn character_party_key(character: &str) -> String {
    format!("rpc:char_party:{character}")
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
