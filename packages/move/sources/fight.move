// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The FIGHT — one module, one trust domain (ruling 2026-08-10: the module boundary is the
/// security boundary, and lifecycle, machine and resolver share every invariant — splitting
/// them only bought an accessor layer).
///
/// CUSTODY: characters LEAVE their kiosk through the protected policy and live as dynamic
/// OBJECT fields on the fight until they settle out; custody makes them IMMUTABLE for the
/// whole fight, so player numbers DERIVE off the character + folded gear (read once per
/// resolution into a Sheet). Mobs have no object: a value snapshot off the frozen template.
/// Fighters are GENERIC — PvM and PvP are the same code.
///
/// SEALED STATE IS STORED (the gas law): `ended`/`winner` flip once in the kill door, the
/// `queue` weaves once at start, the `closed` board bitset computes once at launch — none of
/// them can drift, so none is recomputed per action.
///
/// THE MACHINE rests only on player turns: a pass resolves the whole due mob wave on the
/// spot, each turn adding its 3s animation floor to the next end-turn's gate. The crank only
/// clears stalls. Tackle: every locker contests once per walk, at first contact-leave.
/// Entropy: the crank state seeds at start (entry door); each turn draws its PUBLIC seed —
/// the acting player previews the whole turn; mob, trap and loot draws ride the crank state.
module aresrpg::fight;

use aresrpg_seed::item_rows::{Self, ItemTemplate};
use aresrpg::{
  character::{Self, Character},
  party::{Self, Party},
  equipment,
  item::{Self, Item, PM},
  progression,
  protected_policy::AresRPG_TransferPolicy,
  world,
  zone,
};
use aresrpg_seed::{mob_rows::MobTemplate, spell_rows::SpellTemplate, board_catalog::{Self, BoardCatalog}, world_content::{Self, WorldContent}};
use aresrpg_math::{
  combat_grid::{Self, GridSpec},
  fight_math,
  item_stats,
  mob_data::{Self, LootEntry},
  mob_scaling,
  prng,
  spell_effect::{Self, Effect, SpellLevel},
  weapon,
  world_map,
  zone_math::{Self, MobMember},
};
use std::string::String;
use sui::{
  clock::Clock,
  dynamic_object_field as dof,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator,
  transfer_policy::TransferPolicy,
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EWrongWorld: u64 = 1701; // engage/join: the fight lives in another world
const ENoSuchGroup: u64 = 1702; // engage: no live group at this index
const EWrongMob: u64 = 1703; // add_mob: the template is not the NEXT pending member
const EPendingMobs: u64 = 1704; // launch: members remain unseated
const EBoardTooSmall: u64 = 1705; // the board rolled fewer start cells than fighters needed
const ENotPlacement: u64 = 1706; // join/place/ready after start — also the active-phase guard
const ETeamFull: u64 = 1707; // join: every start cell of the side is seated
const ENotYourFighter: u64 = 1708; // acting on a fighter the sender does not control, or off-turn
const EBadCell: u64 = 1709; // place: not one of the side's start cells, or taken
const ENotEnded: u64 = 1710; // settle/close: the fight is still running
const EAlreadySettled: u64 = 1711; // settle/forfeit: the fighter already left
const ENotSettled: u64 = 1712; // close: a seat has not settled or still holds rolled drops
const EAlreadySeated: u64 = 1714; // join: this character already holds a fighter
const ENoAp: u64 = 1715; // cast: the pool cannot pay
const EOutOfRange: u64 = 1716;
const ENoLineOfSight: u64 = 1717;
const ENotInLine: u64 = 1718; // line_launch: target not on the caster's row/column
const EBadTargetCell: u64 = 1720; // off-shape, obstacle, hole, or an occupied placement anchor
const ECapReached: u64 = 1721; // per-turn cap, per-target cap, or cooldown
const ENotYourSpell: u64 = 1722; // class mismatch, not learned, or not in the mob's kit
const ENotReady: u64 = 1723; // start: players unready and the window still open
const ETooSoon: u64 = 1724; // the 3s animation floor / the 45s player window still open
const ENoPath: u64 = 1725; // move: target unreachable within MP
const EBadTeam: u64 = 1726; // join: not a joinable player side, or a bad team/access value
const EGroupOnly: u64 = 1727; // join: the side is group-gated (party membership arrives with social)
const ENotAMob: u64 = 1728; // internal: a mob accessor called on a player fighter
const ENotLastSettler: u64 = 1729; // atomic settle+close: another seat still owes settlement/loot

const ACCESS_PUBLIC: u8 = 0; // anyone joins the side
const ACCESS_GROUP: u8 = 1; // only the side-opener's party joins (check lands with social)
const ACCESS_INVITED: u8 = 2; // RESERVED: only the character named as this side's opener
const ACCESS_UNSET: u8 = 255; // no player opened the side yet (a duel's empty seat, a mob side)

const BASE_AP: u64 = 6; // the 1.29 base — gear `action` shifts it
const BASE_MP: u64 = 3; // gear `movement` shifts it
const PLACEMENT_FORCE_MS: u64 = 60_000; // anyone may start after this
const TURN_MIN_MS: u64 = 3_000; // every turn stays visible — the client animates
const TURN_MAX_MS: u64 = 45_000; // a player turn dies of old age past this

// The effect kinds — the sealed `spell_effect` kind list, named for the dispatch.
// The collapsed kind list (owner 2026-08-12, "optimize for deletion"): every number change is
// add/remove/steal over a CHANNEL (the row's stat field); `turns` decides instant vs lasting.
// The four damage kinds stay — different formulas, not different directions. Mirrors
// spell_effect.move's sealed list exactly.
const K_DAMAGE: u8 = 0;
const K_PCT_LIFE: u8 = 1;
const K_CASTER_DAMAGE: u8 = 2;
const K_PUNISHMENT: u8 = 3;
const K_ADD: u8 = 4;
const K_REMOVE: u8 = 5;
const K_STEAL: u8 = 6;
const K_CHATIMENT: u8 = 7; // the chatiment stance: a real hit taken feeds its stat gain
const K_PUSH: u8 = 8;
const K_PULL: u8 = 9;
const K_TELEPORT: u8 = 10;
const K_SWAP: u8 = 11;
const K_TRAP: u8 = 12;
const K_GLYPH: u8 = 13;
const K_REDUCE: u8 = 14;
const K_REFLECT: u8 = 15;
const K_DISPEL: u8 = 16;
const K_INVIS: u8 = 17;
const K_RETURN: u8 = 18;
const K_REDIRECT: u8 = 19;
const K_FIXED_REMOVE: u8 = 20;

/// Stat ids for alter/steal/point rows (the authoring contract):
/// 0 strength · 1 intelligence · 2 chance · 3 agility · 4 wisdom · 5 range · 6 AP · 7 MP.
const STAT_STRENGTH: u8 = 0;
const STAT_INTELLIGENCE: u8 = 1;
const STAT_CHANCE: u8 = 2;
const STAT_AGILITY: u8 = 3;
const STAT_WISDOM: u8 = 4;
const STAT_RANGE: u8 = 5;
const STAT_AP: u8 = 6;
const STAT_MP: u8 = 7;
const STAT_POWER: u8 = 8; // a flat addition to ALL four primaries — the house "%damage"
const STAT_RAW_DAMAGE: u8 = 9;
const STAT_CRITICAL: u8 = 10; // the Cri — one name everywhere (owner 2026-08-12)
const STAT_RESIST: u8 = 11; // the row's element field picks which; empty = all four
const STAT_HP: u8 = 12; // add = heal · lasting remove = the dot · steal = life steal
const STAT_ANY: u8 = 255;

/// Ledger sentinel for a cast at an empty cell.
const NO_TARGET: u64 = 0xFFFF_FFFF;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

public struct Fight has key {
  id: UID,
  world: String,
  x: u32,
  z: u32, // the group's spot — fighters stand here when they walk out
  board: GridSpec, // stored, not re-derived: the source zone EXPIRES (TTL redraw)
  closed: vector<u64>, // off-shape ∪ obstacles ∪ holes as a bitset — computed once at launch
  access_a: u8, // set by the FIRST player of each side: public, or group-only
  access_b: u8,
  // the side's OPENER, pinned when its access is set (audit 2026-08-10: deriving it off
  // "first living player" let a forfeit silently hand the group gate to the next member's
  // OTHER parties) — stored because the source expires, like the sealed-state law
  opener_a: Option<ID>,
  opener_b: Option<ID>,
  fighters: vector<Fighter>,
  zones: vector<BoardZone>, // live traps and glyphs
  queue: vector<u64>, // the global turn order — woven once at start, sealed (dead fighters skip)
  turn_ptr: u64, // index into `queue` of the acting fighter
  round: u64, // 0 = placement; `start` flips it to 1
  ended: bool, // flipped once by the kill door — the end law's stored answer
  winner: Option<u8>, // some(team) once ended; none = mutual wipe
  dungeon: Option<u64>, // birth marker: some(room) = a dungeon room fight (the dungeon reads it)
  managed: bool, // an external module owns this fight's join/settle (dungeon or kolizeum) —
  // the raw api doors refuse it, so the manager's wrap is the only way in and out
  wagered: bool, // a kolizeum fight with a pot — the raw `start_fight` refuses it too, so the
  // 10% cut in `kolizeum::start` can never be skipped (dungeon fights are managed but NOT
  // wagered, so they still start through the generic door)
  drops_rolled: bool, // the enemy loot table rolls ONCE (first winner settle), then splits
  turn_seed: u64, // the PUBLIC per-turn stream seed — DRAWN FRESH from &Random at every turn
  // boundary (restores the move-old model): the CURRENT turn is client-predictable, but no future
  // turn / mob action / trap / loot roll is, because there is no stored stream to read (audit 2026-08-11)
  turn_slot: u64, // the acting turn's cast counter — indexes the seed's slot streams
  turn_casts: vector<TurnCast>, // this turn's cast ledger (per-turn / per-target caps)
  placement_ms: u64,
  turn_started_ms: u64,
}

/// A fighter is EITHER a player (a custody character + its controller) OR a mob (a value
/// snapshot) — mutually exclusive, so one tag, never two Options (owner 2026-08-10). A
/// forfeited player stays a `Player` but flips `settled`; readers use `!settled` for "in".
public enum FighterKind has drop, store {
  Player { character: ID, owner: address, level: u16 }, // level survives sequential settlement
  Mob(MobSnapshot),
}

/// One fighter. FIGHT state only — a player's numbers live on its custody character, a mob's
/// in its snapshot; the sheet builder branches once and the machine never knows.
public struct Fighter has drop, store {
  team: u8,
  kind: FighterKind,
  cell: u64,
  ready: bool,
  dead: bool,
  settled: bool, // left the fight (mobs are born settled)
  forfeited: bool, // FLED (not just died) — excluded from the xp roster; a combat-dead winner
  // keeps forfeited=false and still counts + earns. Also blocks any re-join of this character.
  hp: u64,
  ap: u64, // remaining this turn
  mp: u64,
  drops: vector<RolledDrop>, // transient inside the one terminal PvM settlement
  effects: vector<ActiveEffect>,
  cooldowns: vector<Cooldown>,
}

/// One RESOLVED kit spell: the mob's rolled level picked its authored SpellLevel at seating.
/// `ordinal` is WHICH authored level (1-based) — the return-spell law reads it at cast.
public struct KitSpell has copy, drop, store { name: String, ordinal: u8, level: SpellLevel }

/// A mob's numbers, read once off its frozen template through the group's level scalar —
/// a snapshot of SEALED data authored by one seeding can never drift.
public struct MobSnapshot has copy, drop, store {
  mob_type: String,
  level: u64,
  max_hp: u64,
  ap: u64,
  mp: u64,
  agility: u64,
  wisdom: u64,
  // centered at the item-stats shift — below center is a weakness
  earth_res: u64,
  fire_res: u64,
  water_res: u64,
  air_res: u64,
  kit: vector<KitSpell>,
  xp: u64,
  loot: vector<LootEntry>,
}

/// A caster's numbers for one resolution — ONE custody read, rows folded in, passed down
/// (the gas law: never re-borrow per row what one sheet answers).
public struct Sheet has copy, drop {
  strength: u64,
  intelligence: u64,
  chance: u64,
  agility: u64,
  wisdom: u64,
  raw_damage: u64,
  critical: u64, // the Cri — each point lowers the weapon crit quotation X (one name everywhere, 2026-08-12)
  range_bonus: u64,
  level: u64,
}

/// One cast recorded this turn — `target` is the struck fighter, or NO_TARGET for a free cell.
public struct TurnCast has copy, drop, store { spell: String, target: u64 }

/// A timed effect living on a fighter (dot, stat alteration, shield, reflect…).
public struct ActiveEffect has copy, drop, store {
  kind: u8,
  element: String,
  value: u64,
  turns_left: u64,
  source: u64, // the caster's fighter index
  stat: u8,
}

public struct Cooldown has copy, drop, store { spell: String, left: u64 }

/// A trap (hidden trigger) or glyph (visible zone) anchored on the board. Traps live until
/// they fire (`turns_left` 0 = permanent); a glyph fades after its turns.
public struct BoardZone has copy, drop, store {
  owner_fighter: u64,
  trap: bool,
  shape: u8,
  size: u8,
  anchor: u64,
  turns_left: u64,
  effects: vector<Effect>,
}

public struct RolledDrop has copy, drop, store { item_type: String, qty: u32 }

/// The custody key: `FighterKey(i)` → the fighter's Character object.
public struct FighterKey(u64) has copy, drop, store;

/// The engage HOT POTATO: born with the group consumed, it forces the same transaction to
/// fighter every pending member (one frozen template per `add_mob`, exact order) and `launch`.
public struct FightBuild {
  world: String,
  x: u32,
  z: u32,
  board: GridSpec,
  access: u8, // the engager's side-A setting
  fighters: vector<Fighter>,
  chr: Character,
  pending: vector<MobMember>,
  dungeon: Option<u64>, // some(room) → launch tags a dungeon room fight
}

/// Carries `placement_ms` so the realtime layer can run the join-window clock (the sword's
/// sink) off chain truth instead of packet-arrival guesses.
public struct FightCreated has copy, drop { fight: ID, world: String, x: u32, z: u32, placement_ms: u64 }

/// A character took a seat — the ONLY receipt-independent witness of WHO joined (FightCreated
/// names no one); the realtime layer keys its per-character fight watch on it.
public struct FighterJoined has copy, drop { fight: ID, character: ID, team: u8 }

/// A fighter WALKED OUT. The only witness of a forfeit that does not end the fight: the roster
/// keeps the seat (settled + forfeited), no other event fires, and the survivors would
/// otherwise never learn the player left — no death on their screen, no line in their log.
public struct FighterForfeited has copy, drop { fight: ID, fighter: u64 }

/// Carries the anchor so the realtime layer can route the start to the fight's ZONE —
/// bystanders flip their sword marker to spectate-only the moment a fight goes live.
public struct FightStarted has copy, drop { fight: ID, world: String, x: u32, z: u32, queue: vector<u64> }

/// Carries the anchor so the zone channel can despawn the sword marker the moment a fight
/// ends — standing bystanders never re-pull the fights list.
public struct FightEnded has copy, drop { fight: ID, world: String, x: u32, z: u32, winner: Option<u8> }
public struct FightClosable has copy, drop { fight: ID }
public struct FightClosed has copy, drop { fight: ID }
/// One intermediate turn consumed `seed`. The resting player's seed persists on `Fight`; every
/// actor the machine advances past needs this receipt witness, including a player killed by a
/// randomized turn-start effect before control could return to the client.
public struct TurnSeedUsed has copy, drop { fight: ID, seat: u64, seed: u64 }

public struct DropsRolled has copy, drop { fight: ID, fighter: u64, drops: vector<RolledDrop> }

// ╔════════════════ [ Engage — zone group → fight (one transaction) ] ════════ ]

/// Claim a live mob group of zone `(zx, zz)`: the walk to the group's own derived spot is
/// proven, the character leaves its kiosk into fight custody, the group's bit flips, the
/// board derives from the zone seed (the client rendered it before signing). Returns the
/// build potato — `add_mob` × members, then `launch`.
public(package) fun engage(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  w: &mut world::World,
  wc: &WorldContent,
  zx: u32,
  zz: u32,
  group_index: u64,
  access: u8,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
): FightBuild {
  assert!(access <= ACCESS_GROUP, EBadTeam);
  let groups = zone::mob_groups(w, wc, zx, zz);
  let mut pending = vector[];
  let mut x = 0;
  let mut z = 0;
  let mut found = false;
  let mut i = 0;
  while (i < groups.length()) {
    let g = &groups[i];
    if (g.group_index() == group_index) {
      x = g.group_x();
      z = g.group_z();
      pending = g.group_members();
      found = true;
    };
    i = i + 1;
  };
  assert!(found, ENoSuchGroup);

  let mut chr = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  let current = world::prove_move(&mut chr, x, z, clock);
  assert!(current == w.name(), EWrongWorld);

  let board = board_catalog::pick(catalog, prng::mix(zone::seed_of(w, zx, zz), group_index));
  zone::consume_mob_group(w, zx, zz, group_index);
  assert!(pending.length() <= board.start_cells_b().length(), EBoardTooSmall);
  assert!(!board.start_cells_a().is_empty(), EBoardTooSmall);

  let fighter = player_fighter(&mut chr, ctx.sender(), 0, board.start_cells_a()[0], clock);
  FightBuild { world: current, x, z, board, access, fighters: vector[fighter], chr, pending, dungeon: option::none() }
}

/// DUNGEON room birth (owner 2026-08-11): the run's character leaves the kiosk into custody
/// at the portal, the room's authored mobs become the pending list, the board rolls from the
/// caller's `board_seed` (random shapes per room). Returns the build potato — `add_mob` ×
/// the room's mobs (exact order), then `launch` tags `dungeon: some(room)`. The DUNGEON
/// module owns the run-state check; this door only seats the fight.
public(package) fun dungeon_build(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  w: &world::World,
  wc: &WorldContent,
  x: u32,
  z: u32,
  board_seed: u64,
  room: u64,
  access: u8,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
): FightBuild {
  assert!(access <= ACCESS_GROUP, EBadTeam);
  assert!(world_content::name(wc) == w.name(), EWrongWorld);
  let room_mobs = world_map::dungeon_room_at(world_content::data(wc), room);
  let mut pending = vector[];
  let mut i = 0;
  while (i < room_mobs.length()) {
    pending.push_back(zone_math::new_member(
      room_mobs[i].room_mob_type(),
      world_map::dungeon_level_scalar(board_seed, i),
    ));
    i = i + 1;
  };
  // no travel proof: the run's character is already staged at the portal (rooted) — the
  // dungeon module owns the run-state, and a rooted prove_move would refuse.
  let mut chr = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  let board = board_catalog::pick(catalog, board_seed);
  assert!(pending.length() <= board.start_cells_b().length(), EBoardTooSmall);
  assert!(!board.start_cells_a().is_empty(), EBoardTooSmall);
  let fighter = player_fighter(&mut chr, ctx.sender(), 0, board.start_cells_a()[0], clock);
  FightBuild { world: w.name(), x, z, board, access, fighters: vector[fighter], chr, pending, dungeon: option::some(room) }
}

/// Fighter the NEXT pending member off its frozen template (exact order — swaps refused).
public(package) fun add_mob(mut build: FightBuild, template: &MobTemplate): FightBuild {
  assert!(!build.pending.is_empty(), EWrongMob);
  let member = build.pending.remove(0);
  assert!(member.member_type() == mob_data::mob_type(template.data()), EWrongMob);
  let cell = build.board.start_cells_b()[build.fighters.length() - 1];
  build.fighters.push_back(mob_fighter(template, member.member_level_scalar() as u64, cell));
  build
}

/// Every member seated → the Fight goes SHARED, placement opens. The closed-cell bitset
/// computes HERE, once — the board never changes again.
public(package) fun launch(build: FightBuild, clock: &Clock, ctx: &mut TxContext) {
  let FightBuild { world, x, z, board, access, fighters, chr, pending, dungeon } = build;
  assert!(pending.is_empty(), EPendingMobs);
  // side A = the engager's setting; side B is a mob side, ACCESS_UNSET — no player opens it.
  // `dungeon` carries through from the build (some(room) for a dungeon room, none for a zone
  // engage), so the fight is born tagged.
  // a dungeon room is MANAGED (dungeon.is_some()); a zone engage is not.
  let managed = dungeon.is_some();
  let _ = share_new_fight(
    world, x, z, board,
    access, ACCESS_UNSET,
    option::some(character::id(&chr)), option::none(),
    fighters, chr, dungeon, managed, false, clock, ctx,
  );
}

/// The one Fight birth: compute the closed bitset, seat character 0 into custody, share.
/// The three doors (engage, challenge, ambush) differ only in access/openers/fighters — the
/// tail is identical, so it lives here (all fields at their birth defaults).
fun share_new_fight(
  world: String,
  x: u32,
  z: u32,
  board: GridSpec,
  access_a: u8,
  access_b: u8,
  opener_a: Option<ID>,
  opener_b: Option<ID>,
  fighters: vector<Fighter>,
  seat0: Character,
  dungeon: Option<u64>,
  managed: bool,
  wagered: bool,
  clock: &Clock,
  ctx: &mut TxContext,
): ID {
  let closed = combat_grid::closed_mask(&board);
  let mut fight = Fight {
    id: object::new(ctx),
    world,
    x,
    z,
    board,
    closed,
    access_a,
    access_b,
    opener_a,
    opener_b,
    fighters,
    zones: vector[],
    queue: vector[],
    turn_ptr: 0,
    round: 0,
    ended: false,
    winner: option::none(),
    dungeon,
    managed,
    wagered,
    drops_rolled: false,
    turn_seed: 0,
    turn_slot: 0,
    turn_casts: vector[],
    // A Kolizeum clock is armed by its manager only when both sides reach the authored
    // format. Every other fight keeps its creation-time placement window.
    placement_ms: if (wagered) 0 else clock.timestamp_ms(),
    turn_started_ms: 0,
  };
  let id = fight.id.to_inner();
  dof::add(&mut fight.id, FighterKey(0), seat0);
  event::emit(FightCreated { fight: id, world: fight.world, x, z, placement_ms: fight.placement_ms });
  transfer::share_object(fight);
  id
}

// ╔════════════════ [ Challenge — the duel door ] ═════════════════════════════ ]

/// Open a DUEL at your proven spot: the board rolls from fresh entropy, side A seats you
/// under your access setting, and side B is RESERVED for `target` — the challenge IS the
/// invitation, so nobody else can take that seat and the invited player learns of the duel
/// from the fight itself (no off-chain word decides who a fight belongs to).
/// No mobs, no potato; PvP fights never touch persistent hp, xp, or loot.
public(package) fun challenge(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  target: ID,
  x: u32,
  z: u32,
  access: u8,
  catalog: &BoardCatalog,
  gen: &mut RandomGenerator,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  assert!(access <= ACCESS_GROUP, EBadTeam);
  let mut chr = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  let world = world::prove_move(&mut chr, x, z, clock);
  let board = board_catalog::pick(catalog, gen.generate_u32() as u64);
  assert!(!board.start_cells_a().is_empty() && !board.start_cells_b().is_empty(), EBoardTooSmall);
  let fighter = player_fighter(&mut chr, ctx.sender(), 0, board.start_cells_a()[0], clock);
  // side B is RESERVED for the challenged character (ACCESS_INVITED): its join door admits
  // that character and nobody else. A plain duel is NOT managed — it settles through the raw
  // doors (consequence-free); kolizeum has its own.
  let _ = share_new_fight(
    world, x, z, board,
    access, ACCESS_INVITED,
    option::some(character_id), option::some(target),
    vector[fighter], chr, option::none(), false, false, clock, ctx,
  );
}

// ╔════════════════ [ Kolizeum — the wagered arena duel (managed) ] ══════════ ]

/// A KOLIZEUM duel (owner 2026-08-11): a plain duel that is MANAGED — the kolizeum module
/// owns its join/settle so the pot flows outside the fight (it never sees SUI). Arena =
/// LOCATION-AGNOSTIC: no travel proof, the board rolls from `board_seed`, side A opens under
/// `access`, side B waits for challengers (kolizeum joins are travel-free). Returns the fight
/// id so the lobby object can link + guard it.
public(package) fun kolizeum_birth(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  board_seed: u64,
  access: u8,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
): ID {
  assert!(access <= ACCESS_GROUP, EBadTeam);
  let mut chr = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  let board = board_catalog::pick(catalog, board_seed);
  assert!(!board.start_cells_a().is_empty() && !board.start_cells_b().is_empty(), EBoardTooSmall);
  let fighter = player_fighter(&mut chr, ctx.sender(), 0, board.start_cells_a()[0], clock);
  // the arena is world/coord-agnostic (travel-free joins) — a nominal world label, 0,0 coords.
  share_new_fight(
    b"kolizeum".to_string(), 0, 0, board,
    access, ACCESS_UNSET,
    option::some(character_id), option::none(),
    vector[fighter], chr, option::none(), true, true, clock, ctx,
  )
}

// ╔════════════════ [ Ambush — the protector door (gathering's 2% roll) ] ════ ]

/// A SOLO SEALED fight vs one mob at the gatherer's proven spot: both sides keep
/// ACCESS_UNSET, so neither join door ever admits anyone — undodgeable and unhelpable, the
/// legacy protector law. `board_seed` was drawn AT THE GATHER (gas-uniform verdict — this
/// door carries no randomness, so aborting it re-rolls nothing); `hp_cap` is the gatherer's
/// hp at that moment — waiting rooted to regen buys nothing.
public(package) fun ambush(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  x: u32,
  z: u32,
  template: &MobTemplate,
  level_scalar: u64,
  board_seed: u64,
  hp_cap: u64,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let mut chr = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  let world = world::prove_move(&mut chr, x, z, clock);
  let board = board_catalog::pick(catalog, board_seed);
  assert!(!board.start_cells_a().is_empty() && !board.start_cells_b().is_empty(), EBoardTooSmall);
  let mut fighter = player_fighter(&mut chr, ctx.sender(), 0, board.start_cells_a()[0], clock);
  if (fighter.hp > hp_cap) *&mut fighter.hp = hp_cap;
  let mob = mob_fighter(template, level_scalar, board.start_cells_b()[0]);
  // BOTH sides ACCESS_UNSET → sealed: no join door ever admits a helper or a challenger. Not
  // managed — the gatherer settles the solo ambush through the raw door.
  let _ = share_new_fight(
    world, x, z, board,
    ACCESS_UNSET, ACCESS_UNSET,
    option::none(), option::none(),
    vector[fighter, mob], chr, option::none(), false, false, clock, ctx,
  );
}

// ╔════════════════ [ Placement — join, pick a cell, ready ] ═════════════════ ]

/// Walk to the fight and join EITHER side (placement only, one per start cell): any side
/// with no mob on it is a player side. A side with players enforces its opener's access
/// setting; an empty side (a duel's waiting seat) is OPENED — your setting becomes its rule.
/// GROUP gating waits on the party system (unbuilt) — a group side accepts no one today.
/// `travel` is true for an overworld join (prove the walk) and false for a DUNGEON join (the
/// joiner is staged at the portal, rooted — the dungeon verified the world/room itself).
public(package) fun join(
  fight: &mut Fight,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  team: u8,
  access: u8,
  travel: bool,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  join_gate(fight, team);
  assert!(access <= ACCESS_GROUP, EBadTeam);
  if (claims_side(fight, team, character_id)) {
    // the side was unclaimed — this player's setting AND identity become its rule
    if (team == 0) {
      fight.access_a = access;
      fight.opener_a = option::some(character_id);
    } else {
      fight.access_b = access;
      fight.opener_b = option::some(character_id);
    };
  };
  admit(fight, protected, kiosk, cap, character_id, team, travel, clock, ctx);
}

/// THE ONE RULE OF WHO MAY TAKE A SIDE — the side's ACCESS decides, never its population.
/// Returns true when the side is unclaimed and this joiner writes its rule; aborts when the
/// standing rule refuses them. Reading the crowd instead (`pc == 0`) let a bystander take a
/// duel's reserved seat, and let a side whose last player forfeited be re-opened under a
/// stranger's setting.
fun claims_side(fight: &Fight, team: u8, character_id: ID): bool {
  let side_access = if (team == 0) fight.access_a else fight.access_b;
  // a RESERVED seat admits the character it names and nobody else, however full the side is
  if (side_access == ACCESS_INVITED) {
    let opener = if (team == 0) &fight.opener_a else &fight.opener_b;
    assert!(opener.is_some() && *opener.borrow() == character_id, EGroupOnly);
    return false
  };
  // an UNCLAIMED, EMPTY side is the one claimable case. A sealed side (ambush) is UNSET too,
  // but never empty, so it stays shut.
  if (side_access == ACCESS_UNSET && player_count(fight, team) == 0) return true;
  // a public side lets anyone in; a group side needs `join_grouped` with the party proof
  assert!(side_access == ACCESS_PUBLIC, EGroupOnly);
  false
}

/// Join a GROUP-gated side: both the joiner and the side's OPENER (its first player) must
/// belong to the presented party. The opener always sets the side to group before this door
/// is usable (public sides take the plain `join`). `travel` as in `join`.
public(package) fun join_grouped(
  fight: &mut Fight,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  team: u8,
  shared_party: &Party,
  travel: bool,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  join_gate(fight, team);
  assert!(player_count(fight, team) > 0, EBadTeam); // an empty side opens via `join`, not here
  let side_access = if (team == 0) fight.access_a else fight.access_b;
  assert!(side_access == ACCESS_GROUP, EGroupOnly);
  let opener = if (team == 0) &fight.opener_a else &fight.opener_b;
  assert!(opener.is_some(), EBadTeam);
  assert!(party::m(shared_party, *opener.borrow()), EGroupOnly);
  assert!(party::m(shared_party, character_id), EGroupOnly);
  admit(fight, protected, kiosk, cap, character_id, team, travel, clock, ctx);
}

/// The join precondition shared by both doors: placement open, a real player side, room left.
fun join_gate(fight: &Fight, team: u8) {
  assert!(is_placement(fight), ENotPlacement);
  assert!(team <= 1, EBadTeam);
  let mut i = 0;
  while (i < fight.fighters.length()) {
    assert!(!(fight.fighters[i].team == team && is_mob(&fight.fighters[i])), EBadTeam);
    i = i + 1;
  };
  let starts = if (team == 0) fight.board.start_cells_a() else fight.board.start_cells_b();
  assert!(player_count(fight, team) < starts.length(), ETeamFull);
}

/// The shared join tail: custody exit, (optional) walk proof, one fighter per character, the
/// seat. `travel` is false only for a dungeon join — the joiner is already staged at the
/// portal (rooted), and a rooted `prove_move` would refuse; the dungeon verified the world.
fun admit(
  fight: &mut Fight,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  team: u8,
  travel: bool,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let mut chr = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  if (travel) {
    let current = world::prove_move(&mut chr, fight.x, fight.z, clock);
    assert!(current == fight.world, EWrongWorld);
  };
  let chr_id = character::id(&chr);
  let mut i = 0;
  while (i < fight.fighters.length()) {
    let f = &fight.fighters[i];
    // one seat per character, forever — a forfeited (fled) character can NOT re-join this fight
    // (owner 2026-08-11), so ghosts can never pile up and inflate the roster.
    match (&f.kind) {
      FighterKind::Player { character, .. } => assert!(*character != chr_id, EAlreadySeated),
      FighterKind::Mob(_) => (),
    };
    i = i + 1;
  };
  let starts = if (team == 0) fight.board.start_cells_a() else fight.board.start_cells_b();
  let mut occupied = vector[];
  let mut occupied_index = 0;
  while (occupied_index < fight.fighters.length()) {
    if (!fight.fighters[occupied_index].settled) occupied.push_back(fight.fighters[occupied_index].cell);
    occupied_index = occupied_index + 1;
  };
  let free = combat_grid::first_free(&starts, &occupied);
  assert!(free.is_some(), ETeamFull);
  let cell = free.destroy_some();
  let idx = fight.fighters.length();
  fight.fighters.push_back(player_fighter(&mut chr, ctx.sender(), team, cell, clock));
  dof::add(&mut fight.id, FighterKey(idx), chr);
  event::emit(FighterJoined { fight: fight.id.to_inner(), character: chr_id, team });
}

/// The side's PINNED opener — stored when its access was set. A forfeit never re-derives it
/// (audit 2026-08-10: the group gate must answer to the character that opened the side,
/// forever, not to whoever happens to stand first after they leave).
/// Pick another of the side's start cells (players only — mobs keep their assignment).
public(package) fun place(fight: &mut Fight, fighter_idx: u64, cell: u64, ctx: &TxContext) {
  assert!(is_placement(fight), ENotPlacement);
  assert_fighter_control(fight, fighter_idx, ctx);
  let starts = if (fight.fighters[fighter_idx].team == 0) fight.board.start_cells_a()
  else fight.board.start_cells_b();
  assert!(starts.contains(&cell), EBadCell);
  let mut i = 0;
  while (i < fight.fighters.length()) {
    assert!(i == fighter_idx || fight.fighters[i].cell != cell, EBadCell);
    i = i + 1;
  };
  *&mut fight.fighters[fighter_idx].cell = cell;
}

public(package) fun ready(fight: &mut Fight, fighter_idx: u64, ctx: &TxContext): bool {
  assert!(is_placement(fight), ENotPlacement);
  assert_fighter_control(fight, fighter_idx, ctx);
  *&mut fight.fighters[fighter_idx].ready = true;
  all_players_ready(fight)
}

fun all_players_ready(fight: &Fight): bool {
  let mut i = 0;
  while (i < fight.fighters.length()) {
    let fighter = &fight.fighters[i];
    if (!is_mob(fighter) && !fighter.dead && !fighter.ready) return false;
    i = i + 1;
  };
  true
}

// ╔════════════════ [ Start — all ready, or anyone after the deadline ] ══════ ]

fun placement_force_ready(placement_ms: u64, now: u64): bool {
  placement_ms != 0 && now >= placement_ms + PLACEMENT_FORCE_MS
}

public(package) fun start(fight: &mut Fight, gen: &mut RandomGenerator, clock: &Clock) {
  assert!(is_placement(fight), ENotPlacement);
  let now = clock.timestamp_ms();
  assert!(all_players_ready(fight) || placement_force_ready(fight.placement_ms, now), ENotReady);
  // nobody fights an empty side — a challenge nobody accepted exits via placement-forfeit
  assert!(living_count(fight, 0) >= 1 && living_count(fight, 1) >= 1, ENotReady);
  let mut teams = vector[];
  let mut team_index = 0;
  while (team_index < fight.fighters.length()) {
    teams.push_back(fight.fighters[team_index].team);
    team_index = team_index + 1;
  };
  fight.queue = fight_math::weave_teams(teams); // woven once, sealed — dead fighters skip at advance
  fight.round = 1;
  event::emit(FightStarted { fight: fight.id.to_inner(), world: fight.world, x: fight.x, z: fight.z, queue: fight.queue });

  // the leading turn goes to the first LIVING queue slot (placement forfeits skip)
  let mut ptr = 0;
  while (fight.fighters[fight.queue[ptr]].dead) ptr = ptr + 1;
  fight.turn_ptr = ptr;
  run_until_player(fight, gen, now, true); // draws each turn's fresh seed; a leading mob wave resolves here
}


// ╔════════════════ [ The player doors ] ═════════════════════════════════════ ]

/// Cast a learned class spell at `target_cell`. Class and invested level read through
/// custody — nothing snapshotted, nothing to lie.
public(package) fun cast(fight: &mut Fight, fighter_idx: u64, spell: &SpellTemplate, target_cell: u64, ctx: &TxContext) {
  assert_actor(fight, fighter_idx, ctx);
  let chr = character_of(fight, fighter_idx);
  assert!(chr.classe() == spell.classe(), ENotYourSpell);
  let invested = progression::spell_level(chr, spell);
  assert!(invested >= 1, ENotYourSpell);
  let level = spell.level_of(invested);
  resolve(fight, fighter_idx, &level, spell.name(), target_cell, invested);
}

/// Swing the weapon — the strike IS a spell, assembled at swing time off the immutable
/// equipment record.
public(package) fun strike(fight: &mut Fight, fighter_idx: u64, target_cell: u64, ctx: &TxContext) {
  assert_actor(fight, fighter_idx, ctx);
  let level = strike_of(fight, fighter_idx);
  // a weapon strike is NEVER returnable (owner 2026-08-10: it is not a spell) — level 0,
  // the same unreturnable tier as a trap/glyph payload
  resolve(fight, fighter_idx, &level, b"strike".to_string(), target_cell, 0);
}

/// Walk the caller's exact path. Every locker along the way contests ONCE, when its contact is
/// first left — simultaneous fresh lockers contest combined; a failed escape tolls AP/MP and
/// the walk rides whatever survives. Hidden displacement stops the remaining declared route.
public(package) fun move_fighter(fight: &mut Fight, path: &vector<u64>, ctx: &TxContext) {
  let actor = fight.queue[fight.turn_ptr];
  assert_actor(fight, actor, ctx);
  walk_path(fight, actor, path);
}

/// A player passes: their turn closes, the whole due mob wave resolves, the machine rests
/// on the next player turn — gated by the wave's accumulated animation floors.
public(package) fun end_turn(fight: &mut Fight, gen: &mut RandomGenerator, clock: &Clock, ctx: &TxContext) {
  let actor = fight.queue[fight.turn_ptr];
  assert_actor(fight, actor, ctx);
  let now = clock.timestamp_ms();
  assert!(now >= fight.turn_started_ms + TURN_MIN_MS, ETooSoon);
  tick_turn_end(fight, actor);
  tick_cooldowns(fight, actor);
  run_until_player(fight, gen, now, false); // the mob wave draws fresh entropy HERE, atomically
}

/// Anyone clears a stall: a player turn dead for 45s force-passes; a turn whose actor
/// forfeited out of turn advances free. Mob turns resolve on the pass — never here.
public(package) fun crank(fight: &mut Fight, gen: &mut RandomGenerator, clock: &Clock) {
  assert_active(fight);
  let now = clock.timestamp_ms();
  let actor = fight.queue[fight.turn_ptr];
  if (!fight.fighters[actor].dead) {
    assert!(now >= fight.turn_started_ms + TURN_MAX_MS, ETooSoon);
    tick_turn_end(fight, actor);
    tick_cooldowns(fight, actor);
  };
  run_until_player(fight, gen, now, false);
}

// ╔════════════════ [ Forfeit — legal from placement on, reads as a kill ] ═══ ]

/// Leave the fight as a loss: the fighter dies and walks out. A PvM loss lands at 1 hp; a
/// duel is consequence-free (same rule as `settle`). If it was the team's last living
/// fighter, the fight ends exactly as if the blow had landed.
public(package) fun forfeit(
  fight: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  clock: &Clock,
  ctx: &TxContext,
) {
  assert!(!fight.ended, ENotEnded);
  assert_fighter_control(fight, fighter_idx, ctx);
  assert!(!fight.fighters[fighter_idx].settled, EAlreadySettled);
  let pvm = has_mobs(fight);
  drop_owned_zones(fight, fighter_idx); // its traps/glyphs die with it — never orphan a dof read
  // `settled` is the "left the fight" mark — every live-member read gates on it (the enum
  // keeps the Player identity so its character can still be returned + re-join later).
  *&mut fight.fighters[fighter_idx].settled = true;
  *&mut fight.fighters[fighter_idx].forfeited = true; // FLED — out of the xp roster, no re-join
  // emitted BEFORE the kill door so the witness stands on its own: `k1` only emits when the
  // side empties, and a forfeit that leaves the fight running emits nothing else at all.
  event::emit(FighterForfeited { fight: fight.id.to_inner(), fighter: fighter_idx });
  kill(fight, fighter_idx);
  let mut chr: Character = dof::remove(&mut fight.id, FighterKey(fighter_idx));
  if (pvm) progression::set_hp(&mut chr, 1, clock); // duels never touch persistent hp
  character::assert_personal_custody(kiosk); // re-lock only into a personal kiosk (soulbound custody)
  kiosk.lock(cap, policy, chr);
}

/// Purge every board zone a leaving fighter owns — a zone's trigger reads the owner through
/// custody, so an orphaned zone would abort every later `on_enter` and brick the fight.
fun drop_owned_zones(fight: &mut Fight, owner: u64) {
  let mut kept = vector[];
  let mut i = 0;
  while (i < fight.zones.length()) {
    if (fight.zones[i].owner_fighter != owner) kept.push_back(fight.zones[i]);
    i = i + 1;
  };
  fight.zones = kept;
}

// ╔════════════════ [ Settlement — hp write-back, xp, loot, close ] ══════════ ]

/// Walk a fighter out of an ENDED fight: hp writes back (losers and the dead leave at 1),
/// winners take xp (the sweet-spot law) and roll their drops off the crank entropy.
public(package) fun settle(
  fight: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<Item>,
  plan: vector<PM>,
  gen: &mut RandomGenerator,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  assert!(fight.ended, ENotEnded);
  assert_fighter_control(fight, fighter_idx, ctx);

  let team_won = fight.winner == option::some(fight.fighters[fighter_idx].team);
  // Loot rolls ONCE for the whole win (ruling 2026-08-10) — the FIRST winner to settle rolls
  // every enemy mob's table and splits the drops across the winning seats; later winners just
  // carry the share already assigned to them. A mob never pays more than its single roll.
  if (team_won && !fight.drops_rolled) {
    roll_and_split(fight, fighter_idx, gen);
    fight.drops_rolled = true;
  };
  settle_seat(fight, fighter_idx, kiosk, cap, policy, clock);
  claim_all(fight, fighter_idx, plan, kiosk, cap, item_policy, gen, ctx);
  emit_closable(fight);
}

/// The terminal fast path: only the final unsettled player may enter, so settlement and
/// storage reclamation share one consensus transaction and no second RPC must observe it.
public(package) fun settle_last(
  mut fight: Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<Item>,
  plan: vector<PM>,
  gen: &mut RandomGenerator,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  assert_last_settler(&fight, fighter_idx, ctx);
  settle(&mut fight, fighter_idx, kiosk, cap, policy, item_policy, plan, gen, clock, ctx);
  close(fight, ctx);
}

public(package) fun assert_last_settler(fight: &Fight, fighter_idx: u64, ctx: &TxContext) {
  assert!(fight.ended, ENotEnded);
  assert_fighter_control(fight, fighter_idx, ctx);
  let mut i = 0;
  while (i < fight.fighters.length()) {
    if (i != fighter_idx)
      assert!(fight.fighters[i].settled && fight.fighters[i].drops.is_empty(), ENotLastSettler);
    i = i + 1;
  };
}

/// Placement-only twin used by managed exits: the caller is still live, while every other
/// player seat has already left. Historical settled rows do not block the final cleanup.
public(package) fun assert_last_live_player(fight: &Fight, fighter_idx: u64, ctx: &TxContext) {
  assert!(is_placement(fight), ENotPlacement);
  assert_fighter_control(fight, fighter_idx, ctx);
  assert!(!fight.fighters[fighter_idx].settled, EAlreadySettled);
  let mut i = 0;
  while (i < fight.fighters.length()) {
    if (i != fighter_idx && !is_mob(&fight.fighters[i]))
      assert!(fight.fighters[i].settled, ENotLastSettler);
    i = i + 1;
  };
}

fun emit_closable(fight: &Fight) {
  if (!fight.ended) return;
  let mut i = 0;
  while (i < fight.fighters.length()) {
    if (!fight.fighters[i].settled || !fight.fighters[i].drops.is_empty()) return;
    i = i + 1;
  };
  event::emit(FightClosable { fight: fight.id.to_inner() });
}

/// Destroy a fully-settled fight — the closer's gas coin collects the storage rebate. Any
/// RECORDED PARTICIPANT may close, nobody else (an open door would let bots race the SDK and
/// farm player-funded deposits). Managed fights qualify too: dungeon and kolizeum read a
/// fight only inside their own settle doors, never after the roster empties.
public(package) fun close(fight: Fight, ctx: &TxContext) {
  assert!(fight.ended, ENotEnded);
  let sender = ctx.sender();
  let mut participant = false;
  let mut i = 0;
  while (i < fight.fighters.length()) {
    let f = &fight.fighters[i];
    assert!(f.settled && f.drops.is_empty(), ENotSettled);
    match (&f.kind) {
      FighterKind::Player { owner, .. } => if (*owner == sender) participant = true,
      FighterKind::Mob(_) => (),
    };
    i = i + 1;
  };
  assert!(participant, ENotYourFighter);
  event::emit(FightClosed { fight: fight.id.to_inner() });
  let Fight { id, .. } = fight;
  id.delete();
}

/// Arena/duel settlement has no mob tables, item templates, or Random work.
public(package) fun settle_pvp(
  fight: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  clock: &Clock,
  ctx: &TxContext,
) {
  assert!(fight.ended, ENotEnded);
  assert_fighter_control(fight, fighter_idx, ctx);
  settle_seat(fight, fighter_idx, kiosk, cap, policy, clock);
  emit_closable(fight);
}

fun settle_seat(
  fight: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  clock: &Clock,
) {
  let team_won = fight.winner == option::some(fight.fighters[fighter_idx].team);
  let survived = team_won && !fight.fighters[fighter_idx].dead;
  let share = if (team_won) xp_share(fight, fighter_idx) else 0;
  let mut chr: Character = dof::remove(&mut fight.id, FighterKey(fighter_idx));
  if (team_won) character::add_experience(&mut chr, share);
  // a pure-PvP fight leaves persistent hp UNTOUCHED (ruling 2026-08-10: duels are
  // consequence-free — regen banked through the whole fight as if it never happened)
  if (has_mobs(fight)) {
    let hp = if (survived) { let h = fight.fighters[fighter_idx].hp; if (h == 0) 1 else h } else 1;
    progression::set_hp(&mut chr, hp, clock);
  };
  character::assert_personal_custody(kiosk); // re-lock only into a personal kiosk (soulbound custody)
  kiosk.lock(cap, policy, chr);
  *&mut fight.fighters[fighter_idx].settled = true;
}

// claim_all — the plan was authenticated from immutable templates before Random. Consume
// types until the seat is empty; duplicate rows of one type still mint/merge together.
fun claim_all(
  fight: &mut Fight,
  fighter_idx: u64,
  plan: vector<PM>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  gen: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  let mut plan = plan;
  let drops = &mut fight.fighters[fighter_idx].drops;
  while (!drops.is_empty()) {
    let wanted = drops[0].item_type;
    let total = take_matching_drops(drops, &wanted);
    item::deliver_drops(&mut plan, &wanted, total, kiosk, cap, policy, gen, ctx);
  };
}

/// Consume every row of one item type and return its exact total quantity. Stackable settlement
/// mints one combined stack; non-stackable settlement mints that many distinct objects.
fun take_matching_drops(drops: &mut vector<RolledDrop>, wanted: &String): u32 {
  let mut total: u32 = 0;
  let mut i = 0;
  while (i < drops.length()) {
    if (&drops[i].item_type == wanted) {
      let row = drops.remove(i);
      total = total + row.qty;
    }
    else i = i + 1;
  };
  total
}

// ╔════════════════ [ Reads the dungeon composes on ] ════════════════════════ ]

/// The dungeon room this fight is (some) or not (none) — the api guard and the dungeon join
/// gate read it, so a normal join/settle/forfeit door can refuse a dungeon fight.
public(package) fun dungeon_room_of(fight: &Fight): Option<u64> { fight.dungeon }

/// Did fighter `idx`'s team win this ENDED fight? (The dungeon advances or ends the run.)
public(package) fun fighter_won(fight: &Fight, fighter_idx: u64): bool {
  fight.ended && fight.winner == option::some(fight.fighters[fighter_idx].team)
}

/// The custody character seated at `fighter_idx` (aborts on a mob) — the dungeon derives the
/// run to advance FROM the seat, so a settle can never be pointed at another character's run.
public(package) fun fighter_character(fight: &Fight, fighter_idx: u64): ID {
  match (&fight.fighters[fighter_idx].kind) {
    FighterKind::Player { character, .. } => *character,
    FighterKind::Mob(_) => abort ENotAMob,
  }
}

/// Party authority while the Character is held by this Fight. The expected id seals a stale
/// client seat against silently acting as another controlled character in the same fight.
public(package) fun assert_controlled_character(
  fight: &Fight,
  fighter_idx: u64,
  expected_character: ID,
  ctx: &TxContext,
) {
  let character = assert_fighter_owner(fight, fighter_idx, ctx);
  assert!(!fight.fighters[fighter_idx].settled && character == expected_character, ENotYourFighter);
}

/// Is this fight externally managed (dungeon or kolizeum)? The raw api doors refuse it.
public(package) fun is_managed(fight: &Fight): bool { fight.managed }

public(package) fun is_wagered(fight: &Fight): bool { fight.wagered }

/// Live player count on a side — kolizeum caps joins at its format (1/3/6 per side).
public(package) fun side_players(fight: &Fight, team: u8): u64 { player_count(fight, team) }

/// Kolizeum alone controls its deferred placement clock: reaching full capacity arms it;
/// dropping below capacity disarms it until the missing seat is filled again.
public(package) fun set_placement_clock(fight: &mut Fight, placement_ms: u64) {
  fight.placement_ms = placement_ms;
}

#[test_only]
public(package) fun placement_force_ready_for_testing(placement_ms: u64, now: u64): bool {
  placement_force_ready(placement_ms, now)
}

/// Still in placement (not started)? kolizeum `exit` refunds only before the fight begins.
public(package) fun in_placement(fight: &Fight): bool { is_placement(fight) }

/// Winning-side players NOT yet settled — kolizeum splits the pot `pot / this` per settle, so
/// the last winner takes the remainder (no dust). Reads live off the fight.
public(package) fun winners_remaining(fight: &Fight): u64 {
  assert!(fight.winner.is_some(), ENotEnded);
  let team = *fight.winner.borrow();
  let mut n = 0;
  let mut i = 0;
  while (i < fight.fighters.length()) {
    let f = &fight.fighters[i];
    if (f.team == team && !is_mob(f) && !f.settled) n = n + 1;
    i = i + 1;
  };
  n
}

/// The fight's world — the dungeon join gate matches it (the same dungeon) to the run; the
/// portal coords are NOT bound, so any same-room player converges regardless of entrance.
public(package) fun fight_world(fight: &Fight): String { fight.world }

// ╔════════════════ [ Settlement math ] ══════════════════════════════════════ ]

/// Retro settlement reads immutable fighter snapshots, so every sequential settler sees the
/// same party levels, eligible-player coefficient, and monster group.
fun xp_share(fight: &Fight, fighter_idx: u64): u64 {
  let my_team = fight.fighters[fighter_idx].team;
  let sheet = sheet_of(fight, fighter_idx);
  let mut base_xp = 0;
  let mut player_total_level = 0;
  let mut highest_player_level = 0;
  let mut mob_total_level = 0;
  let mut highest_mob_level = 0;
  let mut i = 0;
  while (i < fight.fighters.length()) {
    let fighter = &fight.fighters[i];
    if (fighter.team == my_team && !is_mob(fighter) && !fighter.forfeited) {
      let level = player_level_of(fighter);
      player_total_level = player_total_level + level;
      if (level > highest_player_level) highest_player_level = level;
    } else if (fighter.team != my_team && is_mob(fighter)) {
      let snap = mob_snap(fighter);
      base_xp = base_xp + snap.xp;
      mob_total_level = mob_total_level + snap.level;
      if (snap.level > highest_mob_level) highest_mob_level = snap.level;
    };
    i = i + 1;
  };
  let mut eligible_players = 0;
  i = 0;
  while (i < fight.fighters.length()) {
    let fighter = &fight.fighters[i];
    if (
      fighter.team == my_team && !is_mob(fighter) && !fighter.forfeited &&
      player_level_of(fighter) * 3 >= highest_player_level
    ) eligible_players = eligible_players + 1;
    i = i + 1;
  };
  fight_math::xp_for_player(
    base_xp,
    sheet.wisdom,
    player_level_of(&fight.fighters[fighter_idx]),
    player_total_level,
    mob_total_level,
    highest_mob_level,
    eligible_players,
  )
}

/// The ONE loot roll (ruling 2026-08-10): every enemy mob's table rolls once off FRESH Sui
/// entropy (the RANDOMNESS LAW — value draws come from &Random), and each hit is handed to a
/// winning SEAT round-robin. A mob's whole payout is its single roll, shared by the team;
/// six winners split what one would have won, never six times it. Called once, guarded by
/// `drops_rolled`.
fun roll_and_split(fight: &mut Fight, first_settler: u64, gen: &mut RandomGenerator) {
  let my_team = fight.fighters[first_settler].team;
  // the winning seats that still stand (a forfeiter cleared its character — it gets nothing)
  let mut winners = vector[];
  let mut i = 0;
  while (i < fight.fighters.length()) {
    let s = &fight.fighters[i];
    if (s.team == my_team && !is_mob(s) && !s.settled) winners.push_back(i);
    i = i + 1;
  };
  if (winners.is_empty()) return;

  // chance = loot bonus (owner 2026-08-11): average effective Chance includes active
  // Chance rows but not damage-only Power. At 600 it doubles the team's one shared roll.
  let team_chance = team_chance_of(fight, &winners);

  // gather enemy loot tables (value copies so the borrow ends before we mutate drops)
  let mut tables = vector[];
  let mut j = 0;
  while (j < fight.fighters.length()) {
    let s = &fight.fighters[j];
    if (s.team != my_team && is_mob(s)) tables.push_back(mob_snap(s).loot);
    j = j + 1;
  };

  let mut w = 0; // round-robin cursor over winners
  let mut t = 0;
  while (t < tables.length()) {
    let rows = &tables[t];
    let mut r = 0;
    while (r < rows.length()) {
      let row = &rows[r];
      let scaled_bp = {
        let bp = (mob_data::loot_chance_bp(row) as u64) * (600 + team_chance) / 600;
        if (bp > 10_000) 10_000 else bp
      };
      if (gen.generate_u64_in_range(0, 9_999) < scaled_bp) {
        let lo = mob_data::loot_min_qty(row) as u64;
        let hi = mob_data::loot_max_qty(row) as u64;
        let qty = gen.generate_u64_in_range(lo, hi);
        let drop = RolledDrop { item_type: mob_data::loot_item_type(row), qty: qty as u32 };
        fight.fighters[winners[w]].drops.push_back(drop);
        w = (w + 1) % winners.length();
      };
      r = r + 1;
    };
    t = t + 1;
  };

  // one event per winner so each sees its assigned share
  let mut k = 0;
  while (k < winners.length()) {
    let idx = winners[k];
    event::emit(DropsRolled { fight: fight.id.to_inner(), fighter: idx, drops: fight.fighters[idx].drops });
    k = k + 1;
  };
}

fun team_chance_of(fight: &Fight, winners: &vector<u64>): u64 {
  let shift = item_stats::shift() as u64;
  let mut sum = 0;
  let mut i = 0;
  while (i < winners.length()) {
    let chr = character_of(fight, winners[i]);
    let base = fight_math::apply_centered_shift(chr.chance() as u64, equipment::folded(chr).chance() as u64, shift);
    sum = sum + row_adjusted(fight, winners[i], base, STAT_CHANCE);
    i = i + 1;
  };
  sum / winners.length()
}

// ╔════════════════ [ The end-of-fight law ] ═════════════════════════════════ ]

fun living_count(fight: &Fight, team: u8): u64 {
  let mut n = 0;
  let mut i = 0;
  while (i < fight.fighters.length()) {
    if (fight.fighters[i].team == team && !fight.fighters[i].dead) n = n + 1;
    i = i + 1;
  };
  n
}

/// The one death door: flips the fighter; the wipe that ends the fight STORES the verdict and
/// emits the event here — the single transition point (the gas law: sealed state is stored).
fun kill(fight: &mut Fight, fighter_idx: u64) {
  let fighter = &mut fight.fighters[fighter_idx];
  fighter.dead = true;
  fighter.hp = 0;
  let team = fight.fighters[fighter_idx].team;
  if (!fight.ended && living_count(fight, team) == 0) {
    fight.ended = true;
    let a = living_count(fight, 0) > 0;
    let b = living_count(fight, 1) > 0;
    fight.winner = if (a) option::some(0) else if (b) option::some(1) else option::none();
    event::emit(FightEnded { fight: fight.id.to_inner(), world: fight.world, x: fight.x, z: fight.z, winner: fight.winner });
  };
}

fun is_placement(fight: &Fight): bool { fight.round == 0 && !fight.ended }

fun assert_active(fight: &Fight) {
  assert!(fight.round >= 1 && !fight.ended, ENotPlacement);
}

/// The one acting-fighter gauntlet: fight active, `fighter_idx` IS the actor, the sender controls
/// it, and it lives — every player act (move, cast, strike, pass) walks through here.
fun assert_actor(fight: &Fight, fighter_idx: u64, ctx: &TxContext) {
  assert_active(fight);
  assert!(fight.queue[fight.turn_ptr] == fighter_idx, ENotYourFighter);
  assert_fighter_control(fight, fighter_idx, ctx);
  assert!(!fight.fighters[fighter_idx].dead, ENotYourFighter);
}

fun assert_fighter_control(fight: &Fight, fighter_idx: u64, ctx: &TxContext) {
  let _ = assert_fighter_owner(fight, fighter_idx, ctx);
}

fun assert_fighter_owner(fight: &Fight, fighter_idx: u64, ctx: &TxContext): ID {
  assert!(fighter_idx < fight.fighters.length(), ENotYourFighter);
  match (&fight.fighters[fighter_idx].kind) {
    FighterKind::Player { character, owner, .. } => {
      assert!(*owner == ctx.sender(), ENotYourFighter);
      *character
    },
    FighterKind::Mob(_) => abort ENotYourFighter,
  }
}

fun has_mobs(fight: &Fight): bool {
  let mut i = 0;
  while (i < fight.fighters.length()) {
    if (is_mob(&fight.fighters[i])) return true;
    i = i + 1;
  };
  false
}

/// Living players on a side — a forfeited/settled fighter (character cleared) never counts.
fun player_count(fight: &Fight, team: u8): u64 {
  let mut n = 0;
  let mut i = 0;
  while (i < fight.fighters.length()) {
    let f = &fight.fighters[i];
    if (f.team == team && !is_mob(f) && !f.settled) n = n + 1;
    i = i + 1;
  };
  n
}

// ╔════════════════ [ Fighter-kind accessors — the branch lives here, once ] ══ ]

fun is_mob(f: &Fighter): bool {
  match (&f.kind) { FighterKind::Mob(_) => true, FighterKind::Player { .. } => false }
}

fun mob_snap(f: &Fighter): &MobSnapshot {
  match (&f.kind) { FighterKind::Mob(m) => m, FighterKind::Player { .. } => abort ENotAMob }
}

fun player_level_of(f: &Fighter): u64 {
  match (&f.kind) { FighterKind::Player { level, .. } => *level as u64, FighterKind::Mob(_) => 0 }
}

fun player_fighter(chr: &mut Character, owner: address, team: u8, cell: u64, clock: &Clock): Fighter {
  let hp = progression::touch(chr, clock);
  Fighter {
    team,
    kind: FighterKind::Player { character: character::id(chr), owner, level: chr.level() },
    cell,
    ready: false,
    dead: false,
    settled: false,
    forfeited: false,
    hp,
    ap: 0,
    mp: 0,
    drops: vector[],
    effects: vector[],
    cooldowns: vector[],
  }
}

fun mob_fighter(template: &MobTemplate, scalar: u64, cell: u64): Fighter {
  let data = template.data();
  let lo = mob_data::level_min(data) as u64;
  let hi = mob_data::level_max(data) as u64;
  let level = lo + (hi - lo) * scalar / 100;
  let hp = fight_math::band_scaled(mob_data::hp(data), lo, hi, level);
  // Mob spells author one level; numeric rows scale through the mob's resolved level band.
  let authored = mob_data::spells(data);
  let mut kit = vector[];
  let mut k = 0;
  while (k < authored.length()) {
    let authored_level = mob_data::spell_level(&authored[k]);
    kit.push_back(KitSpell {
      name: mob_data::spell_name(&authored[k]),
      ordinal: 1,
      level: mob_scaling::spell_level(&authored_level, lo, hi, level),
    });
    k = k + 1;
  };
  Fighter {
    team: 1,
    kind: FighterKind::Mob(MobSnapshot {
      mob_type: mob_data::mob_type(data),
      level,
      max_hp: hp,
      ap: fight_math::mob_pool_scaled(mob_data::ap(data) as u64, lo, hi, level),
      mp: fight_math::mob_pool_scaled(mob_data::mp(data) as u64, lo, hi, level),
      agility: fight_math::band_scaled(mob_data::agility(data) as u64, lo, hi, level),
      wisdom: fight_math::band_scaled(mob_data::wisdom(data) as u64, lo, hi, level),
      earth_res: fight_math::centered_band_scaled(mob_data::earth_resistance(data) as u64, item_stats::shift() as u64, lo, hi, level),
      fire_res: fight_math::centered_band_scaled(mob_data::fire_resistance(data) as u64, item_stats::shift() as u64, lo, hi, level),
      water_res: fight_math::centered_band_scaled(mob_data::water_resistance(data) as u64, item_stats::shift() as u64, lo, hi, level),
      air_res: fight_math::centered_band_scaled(mob_data::air_resistance(data) as u64, item_stats::shift() as u64, lo, hi, level),
      kit,
      xp: fight_math::band_scaled(mob_data::xp(data), lo, hi, level),
      loot: mob_scaling::loot(mob_data::loot(data), lo, hi, level),
    }),
    cell,
    ready: true,
    dead: false,
    settled: true, // mobs never settle out — born settled so close() only waits on players
    forfeited: false, // mobs are excluded from seat_count by is_mob anyway
    hp,
    ap: 0,
    mp: 0,
    drops: vector[],
    effects: vector[],
    cooldowns: vector[],
  }
}

// ╔════════════════ [ Derived fighter numbers (custody or snapshot — one branch) ] ]

/// The custody read — every player number and entitlement check flows through here.
fun character_of(fight: &Fight, fighter_idx: u64): &Character {
  dof::borrow(&fight.id, FighterKey(fighter_idx))
}

/// ONE read per resolution: base numbers (custody + folded gear, or the mob snapshot) with
/// the fighter's alter/steal rows already folded in.
fun sheet_of(fight: &Fight, i: u64): Sheet {
  let fighter = &fight.fighters[i];
  let mut sheet = if (is_mob(fighter)) {
    let snap = mob_snap(fighter);
    Sheet {
      strength: 0,
      intelligence: 0,
      chance: 0,
      agility: snap.agility,
      wisdom: snap.wisdom,
      raw_damage: 0,
      critical: 0,
      range_bonus: 0,
      level: snap.level,
    }
  } else {
    let chr = character_of(fight, i);
    let folded = equipment::folded(chr);
    let shift = item_stats::shift() as u64;
    Sheet {
      strength: fight_math::apply_centered_shift(chr.strength() as u64, folded.strength() as u64, shift),
      intelligence: fight_math::apply_centered_shift(chr.intelligence() as u64, folded.intelligence() as u64, shift),
      chance: fight_math::apply_centered_shift(chr.chance() as u64, folded.chance() as u64, shift),
      agility: fight_math::apply_centered_shift(chr.agility() as u64, folded.agility() as u64, shift),
      wisdom: fight_math::apply_centered_shift(chr.wisdom() as u64, folded.wisdom() as u64, shift),
      raw_damage: fight_math::apply_centered_shift(0, folded.raw_damage() as u64, shift),
      critical: fight_math::apply_centered_shift(0, folded.critical() as u64, shift), // the Cri lowers the quotation X
      range_bonus: fight_math::apply_centered_shift(0, folded.range() as u64, shift),
      level: chr.level() as u64,
    }
  };
  sheet.strength = row_adjusted(fight, i, sheet.strength, STAT_STRENGTH);
  sheet.intelligence = row_adjusted(fight, i, sheet.intelligence, STAT_INTELLIGENCE);
  sheet.chance = row_adjusted(fight, i, sheet.chance, STAT_CHANCE);
  sheet.agility = row_adjusted(fight, i, sheet.agility, STAT_AGILITY);
  sheet.wisdom = row_adjusted(fight, i, sheet.wisdom, STAT_WISDOM);
  sheet.range_bonus = row_adjusted(fight, i, sheet.range_bonus, STAT_RANGE);
  sheet.raw_damage = row_adjusted(fight, i, sheet.raw_damage, STAT_RAW_DAMAGE);
  sheet.critical = row_adjusted(fight, i, sheet.critical, STAT_CRITICAL);
  // POWER (2026-08-12): one channel, folded into ALL four primaries — the house form of the
  // legacy "%damage" (the damage formula has no percent slot; a primary point IS the percent).
  let power = row_adjusted(fight, i, 0, STAT_POWER);
  sheet.strength = sheet.strength + power;
  sheet.intelligence = sheet.intelligence + power;
  sheet.chance = sheet.chance + power;
  sheet.agility = sheet.agility + power;
  sheet
}

/// One stat through the fighter's rows: alter adds, steal/weaken subtract, floored at zero.
fun row_adjusted(fight: &Fight, fighter: u64, base: u64, stat: u8): u64 {
  let plus = sum_rows(fight, fighter, K_ADD, stat);
  let minus = sum_rows(fight, fighter, K_REMOVE, stat) + sum_rows(fight, fighter, K_STEAL, stat)
    + sum_rows(fight, fighter, K_FIXED_REMOVE, stat);
  fight_math::sat_sub(base + plus, minus)
}

/// Range removal reaches into a modifiable spell's AUTHORED range after consuming gear bonus.
/// Folding it into the unsigned bonus alone floors at zero and makes base range untouchable.
fun range_max_adjusted(fight: &Fight, fighter: u64, authored_max: u64, base_bonus: u64): u64 {
  let plus = sum_rows(fight, fighter, K_ADD, STAT_RANGE);
  let minus = sum_rows(fight, fighter, K_REMOVE, STAT_RANGE) + sum_rows(fight, fighter, K_STEAL, STAT_RANGE);
  fight_math::sat_sub(authored_max + base_bonus + plus, minus)
}

fun base_range_bonus(fight: &Fight, fighter: u64): u64 {
  if (is_mob(&fight.fighters[fighter])) 0
  else {
    let folded = equipment::folded(character_of(fight, fighter));
    fight_math::apply_centered_shift(0, folded.range() as u64, item_stats::shift() as u64)
  }
}

/// A single effective stat (0 str · 1 int · 2 cha · 3 agi · 4 wis) — the tackle jury and
/// point contests read one number; a full resolution builds the Sheet instead.
fun eff_stat(fight: &Fight, i: u64, which: u8): u64 {
  let sheet = sheet_of(fight, i);
  if (which == STAT_STRENGTH) sheet.strength
  else if (which == STAT_INTELLIGENCE) sheet.intelligence
  else if (which == STAT_CHANCE) sheet.chance
  else if (which == STAT_AGILITY) sheet.agility
  else sheet.wisdom
}

fun max_hp_of(fight: &Fight, i: u64): u64 {
  let s = &fight.fighters[i];
  if (is_mob(s)) return mob_snap(s).max_hp;
  progression::max_hp(character_of(fight, i))
}

fun base_ap_of(fight: &Fight, i: u64): u64 {
  let s = &fight.fighters[i];
  if (is_mob(s)) return mob_snap(s).ap;
  let folded = equipment::folded(character_of(fight, i));
  fight_math::apply_centered_shift(BASE_AP, folded.action() as u64, item_stats::shift() as u64)
}

fun base_mp_of(fight: &Fight, i: u64): u64 {
  let s = &fight.fighters[i];
  if (is_mob(s)) return mob_snap(s).mp;
  let folded = equipment::folded(character_of(fight, i));
  fight_math::apply_centered_shift(BASE_MP, folded.movement() as u64, item_stats::shift() as u64)
}

/// The fighter's centered resistance for `element`, alter-resist rows folded in.
fun resistance_of(fight: &Fight, i: u64, element: &String): u64 {
  let s = &fight.fighters[i];
  let base = if (is_mob(s)) {
    let snap = mob_snap(s);
    if (*element == b"earth".to_string()) snap.earth_res
    else if (*element == b"fire".to_string()) snap.fire_res
    else if (*element == b"water".to_string()) snap.water_res
    else if (*element == b"air".to_string()) snap.air_res
    else item_stats::shift() as u64
  } else {
    let folded = equipment::folded(character_of(fight, i));
    if (*element == b"earth".to_string()) folded.earth_resistance() as u64
    else if (*element == b"fire".to_string()) folded.fire_resistance() as u64
    else if (*element == b"water".to_string()) folded.water_resistance() as u64
    else if (*element == b"air".to_string()) folded.air_resistance() as u64
    else item_stats::shift() as u64
  };
  // resist rows are PER-ELEMENT (audit 2026-08-10): a row moves only its own element; an
  // element-less row moves all four. Remove/steal subtract (below center = weakness).
  let rows = &fight.fighters[i].effects;
  let mut bonus = 0;
  let mut malus = 0;
  let mut k = 0;
  while (k < rows.length()) {
    let row = &rows[k];
    if (row.stat == STAT_RESIST && (row.element.is_empty() || row.element == *element)) {
      if (row.kind == K_ADD) bonus = bonus + row.value;
      if (row.kind == K_REMOVE || row.kind == K_STEAL) malus = malus + row.value;
    };
    k = k + 1;
  };
  fight_math::sat_sub(base + bonus, malus)
}

/// The weapon-is-a-spell assembly (mobs fight bare-handed — their kit is their arsenal).
fun strike_of(fight: &Fight, i: u64): SpellLevel {
  if (is_mob(&fight.fighters[i])) return weapon::unarmed();
  let chr = character_of(fight, i);
  let equipped = equipment::equipped(chr);
  let weapon_slot = b"weapon".to_string();
  if (!equipped.contains(&weapon_slot)) return weapon::unarmed();
  let record = equipped.get(&weapon_slot);
  let category = equipment::record_category(record);
  weapon::strike_of(
    &category,
    &equipment::record_damages(record),
    weapon::affinity_of(&character::classe(chr), &category),
  )
}

// ╔════════════════ [ Fighter writes — the semantic doors ] ═════════════════════ ]

/// Damage lands: hp floors at 0, death routes through the one kill door. An ended fight
/// absorbs nothing further (a reflect after the wipe must not bite). A survivor's CHATIMENT
/// stances fire here — the ONE door every real hp loss walks through, so the Ikari trigger
/// can never be bypassed. Damage feeds its stat up to the sum of same-stat stance caps once per
/// active-fighter turn; that turn's folded bonus then lives for five turns.
fun hit(fight: &mut Fight, i: u64, amount: u64, source: u64) {
  if (fight.fighters[i].dead || fight.ended || amount == 0) return;
  let hp = fight.fighters[i].hp;
  if (amount >= hp) {
    kill(fight, i);
  } else {
    *&mut fight.fighters[i].hp = hp - amount;
    let count = fight.fighters[i].effects.length(); // gains land past `count`; never re-scanned
    let turn_owner = fight.queue[fight.turn_ptr];
    let bonus_turns = spell_effect::chatiment_turns() as u64;
    let from_player = !is_mob(&fight.fighters[source]);
    let fed_damage = if (from_player) amount / 2 else amount;
    let mut k = 0;
    while (k < count) {
      let row = fight.fighters[i].effects[k];
      if (row.kind == K_CHATIMENT) {
        // Process each stat/element group once. Identical stances add their caps, but one hit
        // contributes its landed damage only once (Retro's anti-multiplication rule).
        let mut duplicate = false;
        let mut p = 0;
        while (p < k && !duplicate) {
          let previous = &fight.fighters[i].effects[p];
          duplicate = previous.kind == K_CHATIMENT && previous.stat == row.stat && previous.element == row.element;
          p = p + 1;
        };
        if (!duplicate) {
          let mut cap = 0;
          let mut s = k;
          while (s < count) {
            let stance = &fight.fighters[i].effects[s];
            if (stance.kind == K_CHATIMENT && stance.stat == row.stat && stance.element == row.element)
              cap = cap + stance.value;
            s = s + 1;
          };

          let len = fight.fighters[i].effects.length();
          let mut accrued = 0;
          let mut g = 0;
          while (g < len && accrued == 0) {
            let gain = &fight.fighters[i].effects[g];
            if (
              gain.kind == K_ADD && gain.stat == row.stat && gain.element == row.element
                && gain.source == turn_owner && gain.turns_left == bonus_turns
            ) accrued = gain.value;
            g = g + 1;
          };
          if (from_player) cap = cap / 2;
          let available = fight_math::sat_sub(cap, accrued);
          let gained = if (fed_damage < available) fed_damage else available;
          if (gained > 0) {
            g = 0;
            let mut merged = false;
            while (g < len && !merged) {
              let gain = &mut fight.fighters[i].effects[g];
              if (
                gain.kind == K_ADD && gain.stat == row.stat && gain.element == row.element
                  && gain.source == turn_owner && gain.turns_left == bonus_turns
              ) {
                gain.value = gain.value + gained;
                merged = true;
              };
              g = g + 1;
            };
            if (!merged) {
              fight.fighters[i].effects.push_back(ActiveEffect {
                kind: K_ADD,
                element: row.element,
                value: gained,
                turns_left: bonus_turns,
                source: turn_owner,
                stat: row.stat,
              });
            };
          };
        };
      };
      k = k + 1;
    };
  }
}

fun heal_seat(fight: &mut Fight, i: u64, amount: u64) {
  if (fight.fighters[i].dead) return;
  let max = max_hp_of(fight, i);
  let fighter = &mut fight.fighters[i];
  fighter.hp = fighter.hp + amount;
  if (fighter.hp > max) fighter.hp = max;
}

/// Saturating subtract — the floor-at-zero the whole resolver leans on (pools, shields).
fun spend_ap(fight: &mut Fight, i: u64, n: u64) {
  let fighter = &mut fight.fighters[i];
  fighter.ap = fight_math::sat_sub(fighter.ap, n);
}

fun spend_mp(fight: &mut Fight, i: u64, n: u64) {
  let fighter = &mut fight.fighters[i];
  fighter.mp = fight_math::sat_sub(fighter.mp, n);
}

fun add_ap(fight: &mut Fight, i: u64, n: u64) { let s = &mut fight.fighters[i]; s.ap = s.ap + n; }

fun add_mp(fight: &mut Fight, i: u64, n: u64) { let s = &mut fight.fighters[i]; s.mp = s.mp + n; }

// ╔════════════════ [ The turn machine ] ═════════════════════════════════════ ]

/// Drive until a living PLAYER holds the turn (or the fight ends). Dead fighters skip; a mob
/// turn opens, plays its brain and closes ON THE SPOT; every resolved turn adds its 3s floor
/// to `virtual_ms` — the timestamp the resting turn officially starts at, so the next
/// end-turn waits out the whole animated wave. A fighter its own dot kills passes silently.
fun run_until_player(fight: &mut Fight, gen: &mut RandomGenerator, now: u64, opening: bool) {
  let len = fight.queue.length();
  let mut virtual_ms = now;
  let mut examine_current = opening; // `start` examines its seeked slot before stepping
  let mut hops = 0;
  while (hops <= 2 * len) {
    if (!examine_current) {
      let ptr = (fight.turn_ptr + 1) % len;
      if (ptr == 0) fight.round = fight.round + 1;
      fight.turn_ptr = ptr;
    };
    examine_current = false;
    let actor = fight.queue[fight.turn_ptr];
    if (!fight.fighters[actor].dead) {
      fight.turn_seed = gen.generate_u64(); // FRESH per turn — unpredictable before this turn
      fight.turn_slot = 0;
      fight.turn_casts = vector[];
      let ap = base_ap_of(fight, actor);
      let mp = base_mp_of(fight, actor);
      *&mut fight.fighters[actor].ap = ap;
      *&mut fight.fighters[actor].mp = mp;
      apply_pools(fight, actor);
      tick_turn_start(fight, actor);
      if (fight.ended) {
        event::emit(TurnSeedUsed { fight: fight.id.to_inner(), seat: actor, seed: fight.turn_seed });
        return
      };
      if (!fight.fighters[actor].dead) {
        if (!is_mob(&fight.fighters[actor])) {
          fight.turn_started_ms = virtual_ms;
          return
        };
        event::emit(TurnSeedUsed { fight: fight.id.to_inner(), seat: actor, seed: fight.turn_seed });
        mob_turn(fight, actor);
        if (fight.ended) return;
        tick_turn_end(fight, actor);
        tick_cooldowns(fight, actor);
        virtual_ms = virtual_ms + TURN_MIN_MS;
      } else {
        event::emit(TurnSeedUsed { fight: fight.id.to_inner(), seat: actor, seed: fight.turn_seed });
      };
    };
    hops = hops + 1;
  };
}

/// A fighter's turn opens: its dots fire, a glyph it stands in hurts it (the turn-start law),
/// then its own timed glyphs fade. Fighter-row duration changes only when this turn closes.
fun tick_turn_start(fight: &mut Fight, fighter_idx: u64) {
  let rows = fight.fighters[fighter_idx].effects;
  let mut i = 0;
  while (i < rows.length()) {
    let row = &rows[i];
    // hp rows tick: a lasting remove is the dot, a lasting add is the regen
    if (row.stat == STAT_HP && (row.kind == K_REMOVE || row.kind == K_STEAL))
      hit(fight, fighter_idx, row.value, row.source);
    if (row.stat == STAT_HP && row.kind == K_ADD) heal_seat(fight, fighter_idx, row.value);
    i = i + 1;
  };
  if (!fight.ended) fire_glyphs_under(fight, fighter_idx);
  tick_board_zones(fight, fighter_idx);
}

/// Duration includes the current turn: a row cast at 2 becomes 1 when this turn closes, remains
/// active through the next turn, then expires at that turn's close.
fun tick_turn_end(fight: &mut Fight, fighter_idx: u64) {
  let rows = fight.fighters[fighter_idx].effects;
  let mut kept = vector[];
  let mut i = 0;
  while (i < rows.length()) {
    let mut row = rows[i];
    if (row.turns_left > 0) row.turns_left = row.turns_left - 1;
    if (row.turns_left > 0) kept.push_back(row);
    i = i + 1;
  };
  *&mut fight.fighters[fighter_idx].effects = kept;
}

/// A refilled pool takes its point rows: gifts add, removals and steals subtract.
fun apply_pools(fight: &mut Fight, fighter_idx: u64) {
  let rows = fight.fighters[fighter_idx].effects;
  let mut i = 0;
  while (i < rows.length()) {
    let row = &rows[i];
    if (row.kind == K_ADD) {
      if (row.stat == STAT_AP) add_ap(fight, fighter_idx, row.value)
      else if (row.stat == STAT_MP) add_mp(fight, fighter_idx, row.value);
    } else if (row.kind == K_REMOVE || row.kind == K_STEAL || row.kind == K_FIXED_REMOVE) {
      if (row.stat == STAT_AP) spend_ap(fight, fighter_idx, row.value)
      else if (row.stat == STAT_MP) spend_mp(fight, fighter_idx, row.value);
    };
    i = i + 1;
  };
}

/// A turn closes: every cooldown of the fighter steps down one.
fun tick_cooldowns(fight: &mut Fight, i: u64) {
  let cds = &mut fight.fighters[i].cooldowns;
  let mut k = 0;
  while (k < cds.length()) {
    if (cds[k].left > 0) *&mut cds[k].left = cds[k].left - 1;
    k = k + 1;
  };
}

/// The zone owner's turn opens: its timed glyphs step down and fade (traps never fade).
fun tick_board_zones(fight: &mut Fight, owner_fighter: u64) {
  let mut kept = vector[];
  let mut i = 0;
  while (i < fight.zones.length()) {
    let mut z = fight.zones[i];
    if (z.owner_fighter == owner_fighter && z.turns_left > 0) {
      z.turns_left = z.turns_left - 1;
      if (z.turns_left > 0) kept.push_back(z);
    } else {
      kept.push_back(z);
    };
    i = i + 1;
  };
  fight.zones = kept;
}

// ╔════════════════ [ The walk (players and mobs share it) ] ═════════════════ ]

fun walk_path(fight: &mut Fight, fighter: u64, path: &vector<u64>) {
  let walls = wall_mask(fight, fighter);
  let start = fight.fighters[fighter].cell;
  assert!(combat_grid::path_is_walkable(start, path, &walls, fight.fighters[fighter].mp), ENoPath);

  let mut beaten = vector<u64>[];
  let mut i = 0;
  let mut expected = start;
  while (i < path.length()) {
    if (fight.fighters[fighter].cell != expected || fight.fighters[fighter].mp == 0) return;
    tackle_departure(fight, fighter, expected, &mut beaten);
    if (fight.fighters[fighter].mp == 0) return;

    let next = path[i];
    // Bodies are walls, and the pre-validated mask is stale the moment a trap payload moves
    // someone: a body now standing on the declared next cell stops the remaining route.
    if (fighter_at(fight, next).is_some()) return;
    *&mut fight.fighters[fighter].cell = next;
    spend_mp(fight, fighter, 1);
    on_enter(fight, fighter, expected);
    if (fight.ended || fight.fighters[fighter].dead) return;
    expected = next;
    i = i + 1;
  }
}

/// Mob AI owns its route choice. Players never call this target-based BFS walker. Callers
/// guarantee `target` is reachable within MP (the cast-cell search found it), so the field
/// flood is MP-bounded — never a full-board fill.
fun walk_toward(fight: &mut Fight, fighter: u64, target: u64) {
  let walls = wall_mask(fight, fighter);
  let start_cell = fight.fighters[fighter].cell;
  if (start_cell == target) return;
  let field = combat_grid::bfs_distance_field(target, &walls, fight.fighters[fighter].mp);
  assert!(field[start_cell] <= fight.fighters[fighter].mp, ENoPath);
  walk_down(fight, fighter, field);
}

/// Step DOWN a distance field until it bottoms out (0 = arrived) or the budget ends —
/// tackles, traps, and the staleness law ride every step. Shared by the exact walker
/// (`walk_toward`, destination field) and the rusher (`rush_toward`, approach field).
fun walk_down(fight: &mut Fight, fighter: u64, field: vector<u64>) {
  let mut beaten = vector<u64>[]; // every locker contests once per walk — never twice
  loop {
    let cur = fight.fighters[fighter].cell;
    if (field[cur] == 0 || fight.fighters[fighter].mp == 0) return;

    tackle_departure(fight, fighter, cur, &mut beaten);
    if (fight.fighters[fighter].mp == 0) return;

    let next = combat_grid::best_step(cur, &field);
    if (next.is_none()) return;
    let cell = next.destroy_some();
    // Same staleness law as walk_path: the field predates any mid-walk displacement — a body
    // now standing on the chosen step stops the walk.
    if (fighter_at(fight, cell).is_some()) return;
    *&mut fight.fighters[fighter].cell = cell;
    spend_mp(fight, fighter, 1);
    on_enter(fight, fighter, cur);
    if (fight.ended || fight.fighters[fighter].dead) return;
  }
}

/// Resolve the fresh enemy jury before leaving one cell. Each locker enters `beaten` before
/// the roll, so a failed escape can never charge the same locker twice during one action.
fun tackle_departure(fight: &mut Fight, fighter: u64, cell: u64, beaten: &mut vector<u64>) {
  let (fresh, agilities) = fresh_lockers(fight, fighter, cell, beaten);
  if (fresh.is_empty()) return;
  beaten.append(fresh);
  let agility = eff_stat(fight, fighter, STAT_AGILITY);
  let (num, den) = fight_math::tackle_contest(agility, &agilities);
  if (num >= den) return;
  let mp = fight.fighters[fighter].mp;
  let mut state = fight_math::tackle_seed(fight.turn_seed, mp);
  if (prng::draw(&mut state) % den < num) return;
  let (ap_loss, mp_loss) = fight_math::tackle_losses(fight.fighters[fighter].ap, mp, num, den);
  spend_ap(fight, fighter, ap_loss);
  spend_mp(fight, fighter, mp_loss);
}

/// The stored closed-board bitset ∪ living bodies (self excluded) — the movement wall set.
fun wall_mask(fight: &Fight, fighter: u64): vector<u64> {
  let mut walls = fight.closed;
  combat_grid::mask_add_cells(&mut walls, &living_cells(fight, fighter));
  walls
}

/// Living enemies beside `cell` that have NOT yet contested this walk — the fresh jury:
/// their fighter indices (to mark beaten) and effective agilities (to contest).
fun fresh_lockers(fight: &Fight, fighter: u64, cell: u64, beaten: &vector<u64>): (vector<u64>, vector<u64>) {
  let team = fight.fighters[fighter].team;
  let mut indices = vector[];
  let mut agilities = vector[];
  let n = fight.fighters.length();
  let mut i = 0;
  while (i < n) {
    if (i != fighter && !fight.fighters[i].dead && fight.fighters[i].team != team && !beaten.contains(&i)
      && combat_grid::manhattan(fight.fighters[i].cell, cell) == 1) {
      indices.push_back(i);
      agilities.push_back(eff_stat(fight, i, STAT_AGILITY));
    };
    i = i + 1;
  };
  (indices, agilities)
}

/// The cells living bodies stand on, `exclude` left out — the walkers' body-block set.
fun living_cells(fight: &Fight, exclude: u64): vector<u64> {
  let mut out = vector[];
  let mut i = 0;
  while (i < fight.fighters.length()) {
    if (i != exclude && !fight.fighters[i].dead) out.push_back(fight.fighters[i].cell);
    i = i + 1;
  };
  out
}

/// The living fighter standing on `cell`, if any.
fun fighter_at(fight: &Fight, cell: u64): Option<u64> {
  let mut i = 0;
  while (i < fight.fighters.length()) {
    if (!fight.fighters[i].dead && fight.fighters[i].cell == cell) return option::some(i);
    i = i + 1;
  };
  option::none()
}

// ╔════════════════ [ The mob brain — kit order is priority ] ════════════════ ]

const MOB_STEP_NONE: u8 = 0;
const MOB_STEP_CAST: u8 = 1;
const MOB_STEP_MOVED: u8 = 2;

/// One mob turn: derive each spell's anchor side from its effect filters, walk into the first
/// kit spell's cast band and keep firing while AP and authored cast caps allow; nothing
/// castable → rush the nearest enemy. Zero-cost mob spells are ignored so the loop terminates.
fun mob_turn(fight: &mut Fight, mob: u64) {
  loop {
    if (fight.ended || fight.fighters[mob].dead) return;
    let enemy = nearest_enemy(fight, mob);
    if (enemy.is_none()) {
      let starts = if (fight.fighters[mob].team == 0) fight.board.start_cells_a()
        else fight.board.start_cells_b();
      if (!starts.is_empty()) rush_toward(fight, mob, starts[0]);
      return
    };
    let enemy = enemy.destroy_some();
    let step = mob_step(fight, mob, enemy);
    if (step == MOB_STEP_CAST) continue;
    if (step == MOB_STEP_MOVED) return;
    let enemy_cell = fight.fighters[enemy].cell;
    rush_toward(fight, mob, enemy_cell);
    return
  }
}

fun mob_step(fight: &mut Fight, mob: u64, enemy: u64): u8 {
  let kit = mob_snap(&fight.fighters[mob]).kit;
  let mut k = 0;
  while (k < kit.length()) {
    let name = kit[k].name;
    let level = kit[k].level;
    let heal = level.has_heal();
    let caster_only = level.aims_only_at_caster();
    let ally_only = level.aims_only_at_allies();
    let anchor_seat = if (caster_only) option::some(mob)
      else if (heal) wounded_ally(fight, mob)
      else if (ally_only && level.range_max() == 0) option::some(mob)
      else if (ally_only) nearest_ally(fight, mob)
      else option::some(enemy);
    if (anchor_seat.is_some() && level.ap_cost() > 0
      && fight.fighters[mob].ap >= (level.ap_cost() as u64)
      && cooldown_left(fight, mob, &name) == 0
      && mob_cast_cap_available(fight, &name, &level, *anchor_seat.borrow())) {
      let target_seat = *anchor_seat.borrow();
      let anchor = fight.fighters[target_seat].cell;
      if (!place_level_ok(fight, &level, anchor)) {
        k = k + 1;
        continue
      };
      if (mob_castable(fight, mob, &level, fight.fighters[mob].cell, anchor)) {
        mob_cast(fight, mob, &name, anchor);
        return MOB_STEP_CAST
      };
      if (!heal && !caster_only
        // provably unreachable this turn (triangle inequality) — skip the flood entirely
        && combat_grid::manhattan(fight.fighters[mob].cell, anchor)
          <= fight.fighters[mob].mp + (level.range_max() as u64)) {
        // approach into the band, then re-check — a tackle may have eaten the budget
        let walls = wall_mask(fight, mob);
        let cast_cell = combat_grid::bfs_cast_cell(
          fight.fighters[mob].cell,
          anchor,
          &walls,
          fight.fighters[mob].mp,
          level.range_min() as u64,
          level.range_max() as u64,
          level.line_of_sight(),
          &sight_blockers(fight, mob, anchor),
        );
        if (cast_cell.is_some()) {
          walk_toward(fight, mob, cast_cell.destroy_some());
          if (fight.ended || fight.fighters[mob].dead) return MOB_STEP_MOVED;
          let landed = fight.fighters[mob].cell;
          let aim = fight.fighters[target_seat].cell;
          if (place_level_ok(fight, &level, aim)
            && mob_castable(fight, mob, &level, landed, aim)
            && fight.fighters[mob].ap >= (level.ap_cost() as u64)) {
            mob_cast(fight, mob, &name, aim);
            return MOB_STEP_CAST
          };
          return MOB_STEP_MOVED
        };
      };
    };
    k = k + 1;
  };
  MOB_STEP_NONE
}

fun mob_cast_cap_available(fight: &Fight, name: &String, level: &SpellLevel, target: u64): bool {
  let per_turn = level.casts_per_turn() as u64;
  if (per_turn > 0 && casts_this_turn(fight, name, option::none()) >= per_turn) return false;
  let per_target = level.casts_per_target() as u64;
  per_target == 0 || casts_this_turn(fight, name, option::some(target)) < per_target
}

/// ONE approach flood from the target's open flanks, walked down as far as MP allows — a
/// detour routes by construction (the frog law: straight-line "close" is never a reason to
/// hold). A sealed target leaves the field unreached at the mob's cell — the one legal hold.
fun rush_toward(fight: &mut Fight, mob: u64, target: u64) {
  let walls = wall_mask(fight, mob);
  let field = combat_grid::approach_field(target, &walls, fight.fighters[mob].cell);
  if (field[fight.fighters[mob].cell] == combat_grid::path_unreachable()) return;
  walk_down(fight, mob, field);
}

/// A mob casts from its own resolved kit — wave-driven, entropy off the crank state.
fun mob_cast(fight: &mut Fight, fighter_idx: u64, name: &String, target_cell: u64) {
  let kit = mob_snap(&fight.fighters[fighter_idx]).kit;
  let mut i = 0;
  while (i < kit.length()) {
    if (kit[i].name == *name) {
      let level = kit[i].level;
      resolve(fight, fighter_idx, &level, *name, target_cell, kit[i].ordinal as u64);
      return
    };
    i = i + 1;
  };
  abort ENotYourSpell
}

/// The brain's own pre-check — mirrors the resolver's validation (same sight home) so a
/// wave never aborts.
fun mob_castable(fight: &Fight, mob: u64, level: &SpellLevel, from: u64, anchor: u64): bool {
  let d = combat_grid::manhattan(from, anchor);
  if (d < (level.range_min() as u64) || d > (level.range_max() as u64)) return false;
  if (level.line_launch() && !combat_grid::same_line(from, anchor)) return false;
  if (level.line_of_sight()
    && !combat_grid::line_of_sight(from, anchor, &sight_blockers(fight, mob, anchor))) return false;
  true
}

fun place_level_ok(fight: &Fight, level: &SpellLevel, anchor: u64): bool {
  let rows = level.effects();
  if (!place_rows_ok(fight, &rows, anchor)) return false;
  let crit_rows = level.crit_effects();
  crit_rows.is_empty() || place_rows_ok(fight, &crit_rows, anchor)
}

/// Nearest living visible enemy; no target makes the mob search toward its own starting band.
fun nearest_enemy(fight: &Fight, mob: u64): Option<u64> {
  let team = fight.fighters[mob].team;
  let cell = fight.fighters[mob].cell;
  let mut best = option::none();
  let mut best_d = 0;
  let n = fight.fighters.length();
  let mut i = 0;
  while (i < n) {
    if (!fight.fighters[i].dead && fight.fighters[i].team != team && !is_invisible(fight, i)) {
      let d = combat_grid::manhattan(fight.fighters[i].cell, cell);
      if (best.is_none() || d < best_d) {
        best = option::some(i);
        best_d = d;
      };
    };
    i = i + 1;
  };
  best
}

/// The most wounded living ally (self included) — `none` when nobody bleeds.
fun wounded_ally(fight: &Fight, mob: u64): Option<u64> {
  let team = fight.fighters[mob].team;
  let mut best = option::none();
  let mut best_missing = 0;
  let n = fight.fighters.length();
  let mut i = 0;
  while (i < n) {
    if (!fight.fighters[i].dead && fight.fighters[i].team == team) {
      let missing = max_hp_of(fight, i) - fight.fighters[i].hp;
      if (missing > best_missing) {
        best = option::some(i);
        best_missing = missing;
      };
    };
    i = i + 1;
  };
  best
}

/// The nearest living teammate other than self; a lone mob may still use an ally-valid buff
/// on itself. Stable seat order breaks equal-distance ties exactly like nearest_enemy.
fun nearest_ally(fight: &Fight, mob: u64): Option<u64> {
  let team = fight.fighters[mob].team;
  let cell = fight.fighters[mob].cell;
  let mut best = option::none();
  let mut best_d = 0;
  let mut i = 0;
  while (i < fight.fighters.length()) {
    if (i != mob && !fight.fighters[i].dead && fight.fighters[i].team == team) {
      let d = combat_grid::manhattan(fight.fighters[i].cell, cell);
      if (best.is_none() || d < best_d) {
        best = option::some(i);
        best_d = d;
      };
    };
    i = i + 1;
  };
  if (best.is_none()) option::some(mob) else best
}

// ╔════════════════ [ The resolver — one dispatcher over the 27 kinds ] ══════ ]

fun resolve(fight: &mut Fight, caster: u64, level: &SpellLevel, name: String, target_cell: u64, cast_level: u64) {
  let caster_cell = fight.fighters[caster].cell;
  let ap_cost = level.ap_cost() as u64;
  assert!(fight.fighters[caster].ap >= ap_cost, ENoAp);
  assert!(legal_cell(fight, target_cell), EBadTargetCell);

  let sheet = sheet_of(fight, caster); // ONE custody read for the whole resolution
  let d = combat_grid::manhattan(caster_cell, target_cell);
  let range_max = if (level.modifiable_range()) range_max_adjusted(fight, caster, level.range_max() as u64, base_range_bonus(fight, caster))
    else level.range_max() as u64;
  assert!(d >= (level.range_min() as u64) && d <= range_max, EOutOfRange);
  if (level.line_launch()) assert!(combat_grid::same_line(caster_cell, target_cell), ENotInLine);
  if (level.line_of_sight()) {
    assert!(
      combat_grid::line_of_sight(caster_cell, target_cell, &sight_blockers(fight, caster, target_cell)),
      ENoLineOfSight,
    );
  };

  // Empty cells remain aimable, but a real occupant always owns the per-target accounting.
  // Invisibility is presentation/aiming information, never a cast-cap bypass.
  let occupant = fighter_at(fight, target_cell);

  let per_turn = level.casts_per_turn() as u64;
  if (per_turn > 0) assert!(casts_this_turn(fight, &name, option::none()) < per_turn, ECapReached);
  let ledger_target = if (occupant.is_some()) *occupant.borrow() else NO_TARGET;
  let per_target = level.casts_per_target() as u64;
  if (per_target > 0 && occupant.is_some()) {
    assert!(casts_this_turn(fight, &name, option::some(ledger_target)) < per_target, ECapReached);
  };
  let cooldown = level.cooldown_turns() as u64;
  if (cooldown > 0) assert!(cooldown_left(fight, caster, &name) == 0, ECapReached);

  let slot = fight.turn_slot;
  let crit_roll = fight_math::spell_crit_roll(fight.turn_seed, &name);
  let crit = fight_math::crit_at(crit_roll, level.crit_1_in() as u64, sheet.critical, sheet.agility);
  // a crit with NO authored crit rows falls back to the base rows — never an empty no-op, which
  // resolves cheaper than a normal hit and lets a tight-gas end_turn/crank OOG-filter the mob wave
  // FOR crits (free damage avoidance); base rows keep both outcomes the same work (audit 2026-08-11)
  let crit_rows = level.crit_effects();
  let rows = if (crit && !crit_rows.is_empty()) crit_rows else level.effects();
  let (places, payload) = spell_effect::split_placements(&rows);
  if (!places.is_empty()) {
    assert!(anchor_available(&fight.zones, &places, target_cell, fighter_at(fight, target_cell).is_some()), EBadTargetCell);
  };

  // the cast commits
  spend_ap(fight, caster, ap_cost);
  fight.turn_slot = fight.turn_slot + 1;
  fight.turn_casts.push_back(TurnCast { spell: name, target: ledger_target });
  if (cooldown > 0) set_cooldown(fight, caster, name, cooldown);

  // a placement spell banks its OTHER rows as the zone's payload — nothing fires now
  if (!places.is_empty()) {
    let mut p = 0;
    while (p < places.length()) {
      let row = &places[p];
      fight.zones.push_back(BoardZone {
        owner_fighter: caster,
        trap: row.kind() == K_TRAP,
        shape: row.area_shape(),
        size: row.area_size(),
        anchor: target_cell,
        turns_left: if (row.kind() == K_GLYPH) (row.turns() as u64) else 0,
        effects: payload,
      });
      p = p + 1;
    };
    return
  };

  // Only an immediate direct-damage cast reveals. A zone stores its payload for a separate
  // resolution and never reveals its owner.
  if (spell_effect::has_direct_damage(&rows)) drop_kind(fight, caster, K_INVIS);
  let mut estate = fight_math::effect_seed(fight.turn_seed, slot);
  resolve_rows(fight, caster, &sheet, &rows, target_cell, caster_cell, &mut estate, cast_level);
}

/// Walk effect rows — shared by casts and zone triggers.
fun resolve_rows(fight: &mut Fight, caster: u64, sheet: &Sheet, rows: &vector<Effect>, anchor: u64, origin: u64, estate: &mut u64, cast_level: u64) {
  let mut i = 0;
  while (i < rows.length()) {
    if (fight.ended) return;
    let row = &rows[i];
    let chance = row.chance_bp() as u64;
    if (chance >= 10_000 || prng::draw(estate) % 10_000 < chance) {
      apply_row(fight, caster, sheet, row, anchor, origin, estate, cast_level);
    };
    i = i + 1;
  };
}

fun apply_row(fight: &mut Fight, caster: u64, sheet: &Sheet, row: &Effect, anchor: u64, origin: u64, estate: &mut u64, cast_level: u64) {
  let kind = row.kind();

  // caster-only mechanics — no target collection
  if (kind == K_TELEPORT) {
    if (fighter_at(fight, anchor).is_none() && legal_cell(fight, anchor)) {
      let from = fight.fighters[caster].cell;
      *&mut fight.fighters[caster].cell = anchor;
      on_enter(fight, caster, from);
    };
    return
  };
  if (kind == K_SWAP) {
    let other = visible_at(fight, caster, anchor);
    if (other.is_some() && *other.borrow() != caster && spell_effect::target_allowed(
      row.target_filter(),
      fight.fighters[caster].team,
      fight.fighters[*other.borrow()].team,
      *other.borrow() == caster,
    )) {
      let o = *other.borrow();
      let a = fight.fighters[caster].cell;
      let b = fight.fighters[o].cell;
      *&mut fight.fighters[caster].cell = b;
      *&mut fight.fighters[o].cell = a;
      on_enter(fight, caster, a);
      on_enter(fight, o, b);
    };
    return
  };
  let mut targets = zone_targets(fight, caster, row, anchor, origin);
  // the DISPLACEMENT ORDER LAW: travel-direction order — push farthest-first, pull
  // closest-first, ties by lowest cell — nobody blocks the fighter behind them
  if (kind == K_PUSH || kind == K_PULL) {
    let mut cells = vector[];
    let mut i = 0;
    while (i < fight.fighters.length()) {
      cells.push_back(fight.fighters[i].cell);
      i = i + 1;
    };
    targets = combat_grid::travel_order(targets, &cells, origin, kind == K_PUSH);
  };

  let mut t = 0;
  while (t < targets.length()) {
    if (fight.ended) return;
    let target = targets[t];
    apply_to(fight, caster, sheet, row, target, origin, estate, cast_level);
    t = t + 1;
  };
}

fun apply_to(fight: &mut Fight, caster: u64, sheet: &Sheet, row: &Effect, target: u64, origin: u64, estate: &mut u64, cast_level: u64) {
  let kind = row.kind();
  let element = row.element();
  let value = row.value() as u64;
  let turns = row.turns() as u64;

  if (kind == K_DAMAGE) {
    deal(fight, caster, sheet, target, &element, fight_math::roll_effect_value(row, estate), cast_level);
  } else if (kind == K_PCT_LIFE) {
    let base = max_hp_of(fight, target) * fight_math::roll_effect_value(row, estate) / 100;
    let damage = fight_math::resist(base, resistance_of(fight, target, &element), item_stats::shift() as u64);
    hit(fight, target, damage, caster);
  } else if (kind == K_CASTER_DAMAGE) {
    let damage = fight_math::resist(
      fight_math::roll_effect_value(row, estate),
      resistance_of(fight, caster, &element),
      item_stats::shift() as u64,
    );
    hit(fight, caster, damage, caster);
  } else if (kind == K_PUNISHMENT) {
    let base = fight_math::punishment_base(
      fight_math::roll_effect_value(row, estate),
      fight.fighters[caster].hp,
      max_hp_of(fight, caster),
    );
    deal(fight, caster, sheet, target, &element, base, cast_level);
  } else if (kind == K_REDUCE) {
    let primary = fight_math::primary_stat(
      &element,
      sheet.strength,
      sheet.intelligence,
      sheet.chance,
      sheet.agility,
    );
    push_row(fight, target, row, caster, fight_math::amplify_damage(value, primary, 0));
  } else if (kind == K_ADD || kind == K_REMOVE || kind == K_STEAL || kind == K_FIXED_REMOVE) {
    // ── the number algebra: one dispatch, the CHANNEL decides the door ──
    let channel = row.stat();
    if (channel == STAT_HP) {
      if (kind == K_ADD && turns == 0) {
        // instant heal — amplified by intelligence (1.29)
        heal_seat(fight, target, fight_math::heal_amount(fight_math::roll_effect_value(row, estate), sheet.intelligence));
      } else if (kind == K_ADD) {
        // regen row — the per-tick number fixed at application, like the dot
        let per_tick = fight_math::heal_amount(fight_math::roll_effect_value(row, estate), sheet.intelligence);
        push_row(fight, target, row, caster, per_tick);
      } else if (kind == K_STEAL && turns == 0) {
        // life steal — deal, then drink HALF of what actually landed (Dofus law)
        let dealt = deal(fight, caster, sheet, target, &element, fight_math::roll_effect_value(row, estate), cast_level);
        heal_seat(fight, caster, dealt / 2);
      } else {
        // the dot (remove asserts turns ≥ 1 at construction; a lasting steal ticks the same)
        let per_tick = fight_math::resolved_damage(
          fight_math::roll_effect_value(row, estate),
          fight_math::primary_stat(&element, sheet.strength, sheet.intelligence, sheet.chance, sheet.agility),
          sheet.raw_damage,
          resistance_of(fight, target, &element),
          item_stats::shift() as u64,
        );
        push_row(fight, target, row, caster, per_tick);
      };
    } else if (channel == STAT_AP || channel == STAT_MP) {
      if (kind == K_ADD) {
        if (fight.queue[fight.turn_ptr] == target) {
          if (channel == STAT_AP) add_ap(fight, target, value) else add_mp(fight, target, value);
        };
        if (turns > 0) push_row(fight, target, row, caster, value);
      } else if (kind == K_FIXED_REMOVE) {
        if (fight.queue[fight.turn_ptr] == target) {
          if (channel == STAT_AP) spend_ap(fight, target, value) else spend_mp(fight, target, value);
        };
        if (fight.queue[fight.turn_ptr] != target || turns > 0) push_row(fight, target, row, caster, value);
      } else {
        // removal contests dodge on LIVE points (owner law), instant and lasting alike
        let removed = contest_points(fight, sheet, target, row, estate);
        if (removed > 0) {
          if (fight.queue[fight.turn_ptr] == target) {
            if (channel == STAT_AP) spend_ap(fight, target, removed) else spend_mp(fight, target, removed);
          };
          if (fight.queue[fight.turn_ptr] != target || turns > 0) push_row(fight, target, row, caster, removed);
          if (kind == K_STEAL) {
            if (channel == STAT_AP) add_ap(fight, caster, removed) else add_mp(fight, caster, removed);
          };
        };
      };
    } else {
      // stat / resist / power / raw_damage / critical — a lasting row; the Sheet folds it
      push_row(fight, target, row, caster, value);
      if (kind == K_STEAL) {
        // the caster's + side of the steal
        fight.fighters[caster].effects.push_back(ActiveEffect {
          kind: K_ADD,
          element,
          value,
          turns_left: fight_math::max_1(turns),
          source: caster,
          stat: row.stat(),
        });
      };
    };
  } else if (kind == K_CHATIMENT) {
    // the stance row — value/channel carried verbatim; hit() is the trigger
    push_row(fight, target, row, caster, value);
  } else if (kind == K_PUSH || kind == K_PULL) {
    displace(fight, sheet, caster, target, value, kind == K_PUSH, origin, estate);
  } else if (kind == K_RETURN) {
    // the return THRESHOLD is the level this return spell was cast at — it bounces only
    // incoming casts of level in [1, threshold]; level 0 (strike/trap) and level 6 never return
    fight.fighters[target].effects.push_back(ActiveEffect {
      kind: K_RETURN,
      element,
      value: cast_level,
      turns_left: fight_math::max_1(turns),
      source: caster,
      stat: 0,
    });
  } else if (kind == K_DISPEL) {
    *&mut fight.fighters[target].effects = vector[];
  } else {
    // K_REDUCE / K_REFLECT / K_INVIS / K_REDIRECT — pure timed rows
    push_row(fight, target, row, caster, value);
  };
}

// ╔════════════════ [ The damage core ] ══════════════════════════════════════ ]

/// Deal elemental damage with the reactive rows honored: shields shave it, a redirect row
/// reroutes it to its source, a return row bounces it to the caster, reflect rows bite back.
/// Returns what actually landed.
fun deal(fight: &mut Fight, caster: u64, sheet: &Sheet, target: u64, element: &String, base: u64, cast_level: u64): u64 {
  // `hit` is a no-op on a dead target or an ended fight — nothing to steal off of then
  if (fight.ended || fight.fighters[target].dead) return 0;
  let mut damage = fight_math::resolved_damage(
    base,
    fight_math::primary_stat(element, sheet.strength, sheet.intelligence, sheet.chance, sheet.agility),
    sheet.raw_damage,
    resistance_of(fight, target, element),
    item_stats::shift() as u64,
  );
  let shield_rows = &fight.fighters[target].effects;
  let mut shield = 0;
  let mut shield_index = 0;
  while (shield_index < shield_rows.length()) {
    let row = &shield_rows[shield_index];
    if (row.kind == K_REDUCE && (row.element.is_empty() || row.element == *element)) shield = shield + row.value;
    shield_index = shield_index + 1;
  };
  damage = fight_math::sat_sub(damage, shield);
  if (damage == 0) return 0;

  let mut final_target = target;
  let effect_rows = &fight.fighters[target].effects;
  let mut redirect = option::none();
  let mut redirect_index = 0;
  while (redirect_index < effect_rows.length() && redirect.is_none()) {
    let row = &effect_rows[redirect_index];
    if (row.kind == K_REDIRECT && !fight.fighters[row.source].dead) redirect = option::some(row.source);
    redirect_index = redirect_index + 1;
  };
  if (redirect.is_some()) final_target = *redirect.borrow()
  else if (caster != target && cast_level > 0 && cast_level < 6) {
    let mut return_index = 0;
    while (return_index < effect_rows.length()) {
      let row = &effect_rows[return_index];
      if (row.kind == K_RETURN && row.value >= cast_level) final_target = caster;
      return_index = return_index + 1;
    };
  };

  let pre_hit_hp = fight.fighters[final_target].hp;
  hit(fight, final_target, damage, caster);
  if (final_target == target) {
    let reflect = sum_rows(fight, target, K_REFLECT, STAT_ANY);
    if (reflect > 0 && caster != target) hit(fight, caster, reflect, target);
  };
  // life steal heals only off hp the ORIGINAL target actually LOST — overkill is not food
  // (audit 2026-08-10: returning the computed damage let a 100-damage hit on a 1-hp target
  // heal the caster by 100)
  if (final_target == target) { if (damage > pre_hit_hp) pre_hit_hp else damage } else 0
}

/// The per-point removal contest (wisdom vs wisdom) — the guaranteed class skips the draws.
fun contest_points(fight: &Fight, sheet: &Sheet, target: u64, row: &Effect, estate: &mut u64): u64 {
  let is_ap = row.stat() == STAT_AP;
  // CURRENT = the target's LIVE remaining points (spend_ap/spend_mp already drop it on each prior
  // removal this turn), MAX = the untouched base pool — so successive removals get HARDER as points
  // go, instead of all rolling at full-pool odds. LIVE is NOT clamped to base: a buffed fighter
  // (live > base) stays at least as strippable — clamping the bonus away handed buffed AP/MP
  // artificial removal resistance, incl. in wagered fights (audit 2026-08-11).
  let max = if (is_ap) base_ap_of(fight, target) else base_mp_of(fight, target);
  let active = fight.queue[fight.turn_ptr] == target;
  let live = if (is_ap) fight.fighters[target].ap else fight.fighters[target].mp;
  let current = if (active) live else row_adjusted(
    fight,
    target,
    max,
    if (is_ap) STAT_AP else STAT_MP,
  );
  let (next, removed) = fight_math::remove_points(
    prng::draw(estate),
    row.value() as u64,
    true,
    sheet.wisdom,
    eff_stat(fight, target, STAT_WISDOM),
    current,
    max,
  );
  *estate = next;
  removed
}

// ╔════════════════ [ Displacement ] ═════════════════════════════════════════ ]

/// Push (away from `origin`) or pull (toward it), cell by cell. A wall, hole, body or edge
/// stops it; a BLOCKED push charges collision damage for every undone cell. A pull never
/// lands on the pivot.
fun displace(
  fight: &mut Fight,
  sheet: &Sheet,
  source: u64,
  target: u64,
  cells: u64,
  push: bool,
  origin: u64,
  estate: &mut u64,
) {
  let pivot = origin;
  let started_at = fight.fighters[target].cell;
  let dir = if (push) combat_grid::away_dir(pivot, started_at)
  else combat_grid::toward_dir(pivot, started_at);
  let mut remaining = cells;
  let mut blocked = false; // hit a wall/body/edge — a real slam (collision), vs a soft trap-stop
  while (remaining > 0) {
    let cur = fight.fighters[target].cell;
    if (!push && combat_grid::manhattan(cur, pivot) <= 1) break; // a pull reached the pivot
    let next = combat_grid::step_cell(cur, dir);
    if (next.is_none()) { blocked = cur != pivot; break };
    let cell = next.destroy_some();
    if (!legal_cell(fight, cell) || fighter_at(fight, cell).is_some()) { blocked = true; break };
    *&mut fight.fighters[target].cell = cell;
    remaining = remaining - 1;
    // fire traps touched by this movement; a trap that fires STOPS the push (owner 2026-08-11),
    // and so does dying to it — a soft stop, so no collision damage below.
    if (on_enter(fight, target, cur)) break;
    if (fight.fighters[target].dead) break;
  };
  // a push that SLAMMED into an obstacle with cells to spare takes collision damage for the undone
  // cells; a trap-stop or a completed slide does not.
  if (push && blocked && remaining > 0) {
    hit(fight, target, fight_math::push_collision_damage(sheet.level, remaining, prng::draw(estate)), source);
  };
}

// ╔════════════════ [ Traps and glyphs ] ═════════════════════════════════════ ]

/// Any movement touching a trap area fires and consumes it. This includes the first movement
/// made while already covered by a multi-cell trap; one-shot consumption prevents re-firing.
/// Glyphs still hurt only at turn start. Returns whether displacement must stop.
fun on_enter(fight: &mut Fight, fighter_idx: u64, _from: u64): bool {
  if (fight.fighters[fighter_idx].dead) return false;
  let cell = fight.fighters[fighter_idx].cell;
  // SPLIT the fired traps out of the live list FIRST (audit 2026-08-10: resolving a payload
  // that pushes/teleports re-enters on_enter, and a still-listed trap fired twice). Traps are
  // consumed here; glyphs are always kept; both resolve only after the list is committed.
  let zones = fight.zones;
  let mut kept = vector[];
  let mut fired = vector[];
  let mut moving = vector[];
  let mut i = 0;
  while (i < zones.length()) {
    let z = zones[i];
    // A trap fires only on ENTERING one of its cells. Every mover calls on_enter per step, so
    // crossing the zone always touches it; stepping OFF the edge touches nothing and stays silent.
    let touches = z.trap && combat_grid::in_zone(z.shape, z.size as u64, z.anchor, cell);
    if (touches) {
      if (spell_effect::has_displacement(&z.effects)) moving.push_back(z) else fired.push_back(z);
    } else kept.push_back(z); // a spent trap is dropped
    i = i + 1;
  };
  fired.append(moving);
  fight.zones = kept;

  let fired_any = !fired.is_empty();
  let mut f = 0;
  while (f < fired.length()) {
    if (fight.ended) break;
    let z = &fired[f];
    let owner_sheet = sheet_of(fight, z.owner_fighter);
    let mut estate = prng::mix(fight.turn_seed, z.anchor); // fresh turn seed, per-zone anchor
    // The zone IS the payload's area: every row resolves over the trap's own shape/size.
    let base = spell_effect::displacement_last(&z.effects);
    let mut rows = vector[];
    let mut r = 0;
    while (r < base.length()) {
      rows.push_back(spell_effect::with_area(&base[r], z.shape, z.size));
      r = r + 1;
    };
    resolve_rows(fight, z.owner_fighter, &owner_sheet, &rows, z.anchor, z.anchor, &mut estate, 0);
    f = f + 1;
  };
  fired_any
}

/// GLYPHS hurt whoever STARTS their turn standing in them (ruling 2026-08-10) — classic
/// Dofus. The payload resolves centered on the STANDING fighter (single target: them), and
/// the glyph stays (it fades by its own turns at the owner's turn, `tick_board_zones`).
fun fire_glyphs_under(fight: &mut Fight, fighter_idx: u64) {
  if (fight.fighters[fighter_idx].dead) return;
  let cell = fight.fighters[fighter_idx].cell;
  let zones = fight.zones;
  let mut fired = vector[];
  let mut i = 0;
  while (i < zones.length()) {
    let z = zones[i];
    if (!z.trap && combat_grid::in_zone(z.shape, z.size as u64, z.anchor, cell)) fired.push_back(z);
    i = i + 1;
  };
  let mut f = 0;
  while (f < fired.length()) {
    if (fight.ended) return;
    let z = &fired[f];
    let owner_sheet = sheet_of(fight, z.owner_fighter);
    let mut estate = prng::mix(fight.turn_seed, z.anchor); // fresh turn seed, per-zone anchor
    resolve_rows(fight, z.owner_fighter, &owner_sheet, &z.effects, cell, cell, &mut estate, 0);
    f = f + 1;
  };
}

// ╔════════════════ [ Row plumbing over fighter effects ] ═══════════════════════ ]

fun sum_rows(fight: &Fight, fighter: u64, kind: u8, stat: u8): u64 {
  let rows = &fight.fighters[fighter].effects;
  let mut total = 0;
  let mut i = 0;
  while (i < rows.length()) {
    let row = &rows[i];
    if (row.kind == kind && (stat == STAT_ANY || row.stat == stat)) total = total + row.value;
    i = i + 1;
  };
  total
}

fun push_row(fight: &mut Fight, fighter: u64, row: &Effect, source: u64, value: u64) {
  fight.fighters[fighter].effects.push_back(ActiveEffect {
    kind: row.kind(),
    element: row.element(),
    value,
    turns_left: fight_math::max_1(row.turns() as u64),
    source,
    stat: row.stat(),
  });
}

fun drop_kind(fight: &mut Fight, fighter: u64, kind: u8) {
  let rows = fight.fighters[fighter].effects;
  let mut kept = vector[];
  let mut i = 0;
  while (i < rows.length()) {
    if (rows[i].kind != kind) kept.push_back(rows[i]);
    i = i + 1;
  };
  *&mut fight.fighters[fighter].effects = kept;
}

fun is_invisible(fight: &Fight, fighter: u64): bool {
  let rows = &fight.fighters[fighter].effects;
  let mut i = 0;
  while (i < rows.length()) {
    if (rows[i].kind == K_INVIS) return true;
    i = i + 1;
  };
  false
}

fun cooldown_left(fight: &Fight, i: u64, spell: &String): u64 {
  let cds = &fight.fighters[i].cooldowns;
  let mut k = 0;
  while (k < cds.length()) {
    if (cds[k].spell == *spell) return cds[k].left;
    k = k + 1;
  };
  0
}

fun set_cooldown(fight: &mut Fight, i: u64, spell: String, left: u64) {
  let cds = &mut fight.fighters[i].cooldowns;
  let mut k = 0;
  while (k < cds.length()) {
    if (cds[k].spell == spell) { *&mut cds[k].left = left; return };
    k = k + 1;
  };
  cds.push_back(Cooldown { spell, left });
}

fun casts_this_turn(fight: &Fight, spell: &String, target: Option<u64>): u64 {
  let mut n = 0;
  let mut i = 0;
  while (i < fight.turn_casts.length()) {
    let row = &fight.turn_casts[i];
    if (row.spell == *spell && (target.is_none() || *target.borrow() == row.target)) n = n + 1;
    i = i + 1;
  };
  n
}

// ╔════════════════ [ Targeting ] ════════════════════════════════════════════ ]

/// Living fighters inside the row's zone, passing its filter
/// (0 none · 1 not_team · 2 not_self · 3 not_enemy · 4 only_caster).
fun zone_targets(fight: &Fight, caster: u64, row: &Effect, anchor: u64, origin: u64): vector<u64> {
  let filter = row.target_filter();
  if (filter == 4) {
    return if (fight.fighters[caster].dead) vector[] else vector[caster]
  };
  let cells = combat_grid::zone_cells(row.area_shape(), row.area_size() as u64, anchor, origin);
  let mut out = vector[];
  let mut i = 0;
  while (i < cells.length()) {
    let fighter = fighter_at(fight, cells[i]);
    if (fighter.is_some()) {
      let s = *fighter.borrow();
      let keep = spell_effect::target_allowed(
        filter,
        fight.fighters[caster].team,
        fight.fighters[s].team,
        s == caster,
      );
      if (keep) out.push_back(s);
    };
    i = i + 1;
  };
  out
}

fun visible_at(fight: &Fight, caster: u64, cell: u64): Option<u64> {
  let occupant = fighter_at(fight, cell);
  if (occupant.is_none()) return occupant;
  let s = *occupant.borrow();
  if (is_invisible(fight, s) && fight.fighters[s].team != fight.fighters[caster].team) return option::none();
  occupant
}

/// In the grid and open on the stored closed-board bitset — the one walkability fact.
fun legal_cell(fight: &Fight, cell: u64): bool {
  combat_grid::in_grid(cell) && !combat_grid::mask_get(&fight.closed, cell)
}

/// Sight is cut by obstacles and by living bodies — never by holes, the looker or the aim.
/// ONE home: the resolver's gate and the mob brain's pre-check both read this.
fun sight_blockers(fight: &Fight, looker_seat: u64, target_cell: u64): vector<u64> {
  let mut out = fight.board.obstacles();
  let bodies = living_cells(fight, looker_seat);
  let mut i = 0;
  while (i < bodies.length()) {
    if (bodies[i] != target_cell) out.push_back(bodies[i]);
    i = i + 1;
  };
  out
}

/// A cast creates exactly one board zone. Its anchor cannot share another zone's anchor;
/// area overlap is irrelevant. Traps additionally require no living fighter at the anchor.
fun anchor_available(
  zones: &vector<BoardZone>,
  places: &vector<Effect>,
  target_cell: u64,
  occupied: bool,
): bool {
  if (places.length() != 1) return false;
  if (places[0].kind() == K_TRAP && occupied) return false;
  let mut i = 0;
  while (i < zones.length()) {
    if (zones[i].anchor == target_cell) return false;
    i = i + 1;
  };
  true
}

/// The mob brain checks every row variant before choosing a cast. Being conservative across
/// base and critical rows is cheaper than letting any deterministic roll abort the turn wave.
fun place_rows_ok(fight: &Fight, rows: &vector<Effect>, target_cell: u64): bool {
  let mut places = vector[];
  let mut i = 0;
  while (i < rows.length()) {
    if (spell_effect::is_zone_placement(&rows[i])) places.push_back(rows[i]);
    i = i + 1;
  };
  places.is_empty()
    || anchor_available(&fight.zones, &places, target_cell, fighter_at(fight, target_cell).is_some())
}

#[test_only]
public(package) fun mob_effect_scaling_for_testing(): vector<u32> {
  let damage = spell_effect::new_effect(
    K_DAMAGE, b"earth".to_string(), 100, 120, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
  );
  let push = spell_effect::new_effect(
    K_PUSH, b"".to_string(), 3, 3, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
  );
  let low = mob_scaling::effect(&damage, 10, 20, 10);
  let high = mob_scaling::effect(&damage, 10, 20, 20);
  let geometric = mob_scaling::effect(&push, 10, 20, 20);
  vector[low.value(), low.value_max(), high.value(), high.value_max(), geometric.value()]
}

#[test_only]
public(package) fun final_turn_buff_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let mut fighter = fighter_for_placement_test(0, board.start_cells_a()[0], 6);
  fighter.effects = vector[
    ActiveEffect { kind: K_ADD, element: b"".to_string(), value: 2, turns_left: 1, source: 1, stat: STAT_AP },
    ActiveEffect { kind: K_ADD, element: b"".to_string(), value: 50, turns_left: 1, source: 1, stat: STAT_POWER },
  ];
  let mut fight = Fight {
    id: object::new(ctx), world: b"final_turn_buff_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[fighter], zones: vector[], queue: vector[0], turn_ptr: 0, round: 1,
    ended: false, winner: option::none(), dungeon: option::none(), managed: false,
    wagered: false, drops_rolled: false, turn_seed: 1, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  apply_pools(&mut fight, 0);
  tick_turn_start(&mut fight, 0);
  let mut answer = vector[
    fight.fighters[0].ap,
    sheet_of(&fight, 0).strength,
    fight.fighters[0].effects.length(),
    fight.fighters[0].effects[0].turns_left,
  ];
  tick_turn_end(&mut fight, 0);
  answer.push_back(fight.fighters[0].effects.length());
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

#[test_only]
fun fighter_for_placement_test(team: u8, cell: u64, ap: u64): Fighter {
  Fighter {
    team,
    kind: FighterKind::Mob(MobSnapshot {
      mob_type: b"placement_test".to_string(),
      level: 1,
      max_hp: 100,
      ap,
      mp: 3,
      agility: 0,
      wisdom: 0,
      earth_res: item_stats::shift() as u64,
      fire_res: item_stats::shift() as u64,
      water_res: item_stats::shift() as u64,
      air_res: item_stats::shift() as u64,
      kit: vector[],
      xp: 0,
      loot: vector[],
    }),
    cell,
    ready: true,
    dead: false,
    settled: true,
    forfeited: false,
    hp: 100,
    ap,
    mp: 3,
    drops: vector[],
    effects: vector[],
    cooldowns: vector[],
  }
}

/// Test seam over the real resolver. `existing_kind` is 0 for no zone or 12/13; a distinct
/// existing anchor carries a map-wide circle so the tests prove area overlap stays legal.
#[test_only]
public(package) fun resolve_placement_for_testing(
  existing_kind: u8,
  same_center: bool,
  target_occupied: bool,
  incoming_kinds: vector<u8>,
  ctx: &mut TxContext,
): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let target_cell = board.start_cells_b()[0];
  let mut fighters = vector[fighter_for_placement_test(0, caster_cell, 6)];
  if (target_occupied) fighters.push_back(fighter_for_placement_test(1, target_cell, 0));
  let mut zones = vector[];
  if (existing_kind != 0) {
    zones.push_back(BoardZone {
      owner_fighter: 0,
      trap: existing_kind == K_TRAP,
      shape: spell_effect::shape_circle(),
      size: 255,
      anchor: if (same_center) target_cell else caster_cell,
      turns_left: if (existing_kind == K_GLYPH) 3 else 0,
      effects: vector[],
    });
  };
  let mut rows = vector[];
  let mut i = 0;
  while (i < incoming_kinds.length()) {
    let kind = incoming_kinds[i];
    rows.push_back(spell_effect::new_effect(
      kind,
      b"".to_string(),
      0,
      0,
      spell_effect::shape_circle(),
      2,
      0,
      10_000,
      if (kind == K_GLYPH) 3 else 0,
      0,
    ));
    i = i + 1;
  };
  // Deliberately retains the legacy false flag: empty anchors are legal for every spell.
  let level = spell_effect::new_spell_level(
    2, 0, 40, false, false, false, false, 0, 0, 0, 0, rows, vector[],
  );
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"placement_test".to_string(),
    x: 0,
    z: 0,
    closed: combat_grid::closed_mask(&board),
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters,
    zones,
    queue: vector[0],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  resolve(&mut fight, 0, &level, b"placement_test".to_string(), target_cell, 1);
  let answer = vector[
    fight.zones.length(),
    fight.fighters[0].ap,
    fight.turn_slot,
    fight.turn_casts.length(),
  ];
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

/// Test seam over the real cast resolver. A trap carries the same damage row as a direct
/// strike, proving that placement stores it without consuming invisibility.
#[test_only]
public(package) fun invisible_after_damage_cast_for_testing(
  placement: bool,
  target_invisible: bool,
  ctx: &mut TxContext,
): bool {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let target_cell = board.start_cells_b()[0];
  let mut caster = fighter_for_placement_test(0, caster_cell, 6);
  caster.effects.push_back(ActiveEffect {
    kind: K_INVIS,
    element: b"".to_string(),
    value: 0,
    turns_left: 3,
    source: 0,
    stat: 0,
  });
  let mut fighters = vector[caster];
  if (!placement) {
    let mut target = fighter_for_placement_test(1, target_cell, 0);
    if (target_invisible) target.effects.push_back(ActiveEffect {
      kind: K_INVIS,
      element: b"".to_string(),
      value: 0,
      turns_left: 2,
      source: 1,
      stat: 0,
    });
    fighters.push_back(target);
  };
  let damage = spell_effect::new_effect(
    K_DAMAGE,
    b"earth".to_string(),
    10,
    10,
    spell_effect::shape_point(),
    0,
    0,
    10_000,
    0,
    0,
  );
  let mut rows = vector[];
  if (placement) rows.push_back(spell_effect::new_effect(
    K_TRAP,
    b"".to_string(),
    0,
    0,
    spell_effect::shape_point(),
    0,
    0,
    10_000,
    0,
    0,
  ));
  rows.push_back(damage);
  let level = spell_effect::new_spell_level(
    2, 0, 40, false, false, false, false, 0, if (target_invisible) 1 else 0, 0, 0, rows, vector[],
  );
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"invisibility_test".to_string(),
    x: 0,
    z: 0,
    closed: combat_grid::closed_mask(&board),
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters,
    zones: vector[],
    queue: vector[0],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  resolve(&mut fight, 0, &level, b"invisibility_test".to_string(), target_cell, 1);
  if (target_invisible) resolve(&mut fight, 0, &level, b"invisibility_test".to_string(), target_cell, 1);
  let hidden = is_invisible(&fight, 0);
  let Fight { id, .. } = fight;
  id.delete();
  hidden
}

#[test_only]
public(package) fun mob_searches_for_invisible_enemy_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let hidden_cell = board.start_cells_a()[1];
  let mob_cell = board.start_cells_a()[0];
  let mut hidden = fighter_for_placement_test(0, hidden_cell, 0);
  hidden.effects.push_back(ActiveEffect {
    kind: K_INVIS,
    element: b"".to_string(),
    value: 0,
    turns_left: 2,
    source: 0,
    stat: 0,
  });
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"invisibility_search_test".to_string(),
    x: 0,
    z: 0,
    closed: combat_grid::closed_mask(&board),
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters: vector[hidden, fighter_for_placement_test(1, mob_cell, 0)],
    zones: vector[],
    queue: vector[1],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  mob_turn(&mut fight, 1);
  let after = fight.fighters[1].cell;
  let Fight { id, .. } = fight;
  id.delete();
  vector[mob_cell, after]
}

#[test_only]
public(package) fun covered_trap_fires_on_move_for_testing(ctx: &mut TxContext): bool {
  let board = combat_grid::generate(1, 0);
  let anchor = combat_grid::encode(5, 5);
  let from = anchor + 1;
  let to = anchor + 2;
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"covered_trap_test".to_string(),
    x: 0,
    z: 0,
    closed: combat_grid::closed_mask(&board),
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, to, 6),
      fighter_for_placement_test(1, combat_grid::encode(10, 15), 0),
    ],
    zones: vector[BoardZone {
      owner_fighter: 1,
      trap: true,
      shape: spell_effect::shape_circle(),
      size: 2,
      anchor,
      turns_left: 0,
      effects: vector[],
    }],
    queue: vector[0],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  let fired = on_enter(&mut fight, 0, from);
  let consumed = fight.zones.is_empty();
  let Fight { id, .. } = fight;
  id.delete();
  fired && consumed
}

#[test_only]
public(package) fun layered_traps_damage_before_push_for_testing(on_anchor: bool, ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let start = combat_grid::encode(5, 5);
  let target = if (on_anchor) start else start + 1;
  let mut zones = vector[BoardZone {
    owner_fighter: 1,
    trap: true,
    shape: spell_effect::shape_circle(),
    size: 1,
    anchor: start,
    turns_left: 0,
    effects: vector[spell_effect::new_effect(
      K_PUSH, b"".to_string(), 1, 1, spell_effect::shape_circle(), 1, 1, 10_000, 0, 0,
    )],
  }];
  if (!on_anchor) zones.push_back(BoardZone {
    owner_fighter: 1,
    trap: true,
    shape: spell_effect::shape_point(),
    size: 0,
    anchor: target,
    turns_left: 0,
    effects: vector[spell_effect::new_effect(
      K_DAMAGE, b"earth".to_string(), 5, 5, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
    )],
  });
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"layered_trap_test".to_string(),
    x: 0,
    z: 0,
    closed: vector[0, 0, 0, 0, 0, 0],
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, target, 6),
      fighter_for_placement_test(1, combat_grid::encode(10, 15), 0),
    ],
    zones,
    queue: vector[0],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  on_enter(&mut fight, 0, start - 1);
  let answer = vector[fight.fighters[0].hp, fight.fighters[0].cell, if (on_anchor) start else start + 2];
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

#[test_only]
public(package) fun elemental_shield_scaling_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = combat_grid::encode(4, 5);
  let target_cell = caster_cell + 1;
  let attacker_cell = combat_grid::encode(10, 15);
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"shield_test".to_string(),
    x: 0,
    z: 0,
    closed: vector[0, 0, 0, 0, 0, 0],
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, caster_cell, 6),
      fighter_for_placement_test(0, target_cell, 6),
      fighter_for_placement_test(1, attacker_cell, 6),
    ],
    zones: vector[],
    queue: vector[0, 2],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  let shield = spell_effect::new_effect(
    K_REDUCE, b"air".to_string(), 12, 12, spell_effect::shape_point(), 0, 0, 10_000, 1, 0,
  );
  let shield_sheet = Sheet {
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 400,
    wisdom: 0,
    raw_damage: 400,
    critical: 0,
    range_bonus: 0,
    level: 1,
  };
  let mut estate = 1;
  resolve_rows(
    &mut fight, 0, &shield_sheet, &vector[shield], target_cell, caster_cell, &mut estate, 1,
  );
  let scaled = fight.fighters[1].effects[0].value;
  fight.fighters[1].effects.push_back(ActiveEffect {
    kind: K_REDUCE,
    element: b"earth".to_string(),
    value: 100,
    turns_left: 1,
    source: 0,
    stat: 0,
  });
  fight.fighters[1].effects.push_back(ActiveEffect {
    kind: K_REDUCE,
    element: b"".to_string(),
    value: 3,
    turns_left: 1,
    source: 0,
    stat: 0,
  });
  let attacker_sheet = sheet_of(&fight, 2);
  let landed = deal(
    &mut fight, 2, &attacker_sheet, 1, &b"air".to_string(), 100, 1,
  );
  let Fight { id, .. } = fight;
  id.delete();
  vector[scaled, landed]
}

/// Word of Sacrifice's self-cost must not depend on the aimed ally sharing the caster's point area.
#[test_only]
public(package) fun caster_only_cost_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let ally_cell = board.start_cells_a()[1];
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"caster_only_test".to_string(),
    x: 0,
    z: 0,
    closed: combat_grid::closed_mask(&board),
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, caster_cell, 6),
      fighter_for_placement_test(0, ally_cell, 6),
    ],
    zones: vector[],
    queue: vector[0],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  let rows = vector[
    spell_effect::new_effect(
      K_CASTER_DAMAGE, b"water".to_string(), 18, 18,
      spell_effect::shape_point(), 0, 4, 10_000, 0, 0,
    ),
    spell_effect::new_effect(
      K_ADD, b"".to_string(), 18, 18,
      spell_effect::shape_point(), 0, 3, 10_000, 0, STAT_HP,
    ),
  ];
  let sheet = sheet_of(&fight, 0);
  let mut estate = 1;
  resolve_rows(&mut fight, 0, &sheet, &rows, ally_cell, caster_cell, &mut estate, 1);
  let answer = vector[fight.fighters[0].hp, fight.fighters[1].hp];
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

#[test_only]
public(package) fun percent_life_roll_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let target_cell = board.start_cells_b()[0];
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"percent_life_test".to_string(),
    x: 0,
    z: 0,
    closed: combat_grid::closed_mask(&board),
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, caster_cell, 6),
      fighter_for_placement_test(1, target_cell, 6),
    ],
    zones: vector[],
    queue: vector[0, 1],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  let row = spell_effect::new_effect(
    K_PCT_LIFE, b"earth".to_string(), 8, 11,
    spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
  );
  let mut expected_state = 1;
  let expected = fight_math::roll_effect_value(&row, &mut expected_state);
  let sheet = sheet_of(&fight, 0);
  let mut estate = 1;
  resolve_rows(&mut fight, 0, &sheet, &vector[row], target_cell, caster_cell, &mut estate, 1);
  let answer = vector[fight.fighters[1].hp, 100 - expected];
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

#[test_only]
public(package) fun pool_removal_semantics_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let target_cell = board.start_cells_b()[0];
  let mut fight = Fight {
    id: object::new(ctx), world: b"pool_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, caster_cell, 6),
      fighter_for_placement_test(1, target_cell, 6),
    ],
    zones: vector[], queue: vector[0, 1], turn_ptr: 0, round: 1, ended: false,
    winner: option::none(), dungeon: option::none(), managed: false, wagered: false,
    drops_rolled: false, turn_seed: 1, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  let sheet = Sheet {
    strength: 0, intelligence: 0, chance: 0, agility: 0, wisdom: 1_000,
    raw_damage: 0, critical: 0, range_bonus: 0, level: 1,
  };
  let lasting = spell_effect::new_effect(
    K_REMOVE, b"".to_string(), 2, 2, spell_effect::shape_point(), 0, 1, 10_000, 1, STAT_AP,
  );
  let mut estate = 1;
  resolve_rows(&mut fight, 0, &sheet, &vector[lasting], target_cell, caster_cell, &mut estate, 1);
  let inactive_rows = fight.fighters[1].effects.length();
  let inactive_value = if (inactive_rows == 0) 0 else fight.fighters[1].effects[0].value;

  fight.fighters[1].effects = vector[];
  fight.fighters[1].ap = 6;
  fight.queue = vector[1, 0];
  fight.turn_ptr = 0;
  let instant = spell_effect::new_effect(
    K_REMOVE, b"".to_string(), 2, 2, spell_effect::shape_point(), 0, 1, 10_000, 0, STAT_AP,
  );
  estate = 1;
  resolve_rows(&mut fight, 0, &sheet, &vector[instant], target_cell, caster_cell, &mut estate, 1);
  let instant_ap = fight.fighters[1].ap;
  let instant_rows = fight.fighters[1].effects.length();

  fight.fighters[1].effects = vector[];
  fight.fighters[1].ap = 6;
  let fixed = spell_effect::new_effect(
    K_FIXED_REMOVE, b"".to_string(), 100, 100, spell_effect::shape_point(), 0, 1, 10_000, 3, STAT_AP,
  );
  estate = 1;
  resolve_rows(&mut fight, 0, &sheet, &vector[fixed], target_cell, caster_cell, &mut estate, 1);
  let fixed_now = fight.fighters[1].ap;
  let fixed_value = fight.fighters[1].effects[0].value;
  tick_turn_end(&mut fight, 1);
  fight.fighters[1].ap = BASE_AP;
  apply_pools(&mut fight, 1);
  let fixed_next = fight.fighters[1].ap;
  tick_turn_end(&mut fight, 1);
  tick_turn_end(&mut fight, 1);
  fight.fighters[1].ap = BASE_AP;
  apply_pools(&mut fight, 1);
  let answer = vector[
    inactive_rows, inactive_value, instant_ap, instant_rows,
    fixed_now, fixed_value, fixed_next, fight.fighters[1].ap,
  ];
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

/// Test seam over the ONE side-admission rule (`cs`): builds a fight whose side B carries
/// `side_access`/`opener`, optionally already holding a live player, and answers whether the
/// joiner CLAIMS the side. A refusal aborts, so the refusal cases assert the abort code.
#[test_only]
public(package) fun side_admission_for_testing(
  side_access: u8,
  opener: Option<ID>,
  occupied: bool,
  joiner: ID,
  ctx: &mut TxContext,
): bool {
  let board = combat_grid::generate(1, 0);
  let mut fighters = vector[];
  if (occupied) fighters.push_back(Fighter {
    team: 1,
    kind: FighterKind::Player { character: opener.get_with_default(joiner), owner: @0x1, level: 1 },
    cell: board.start_cells_b()[0],
    ready: false, dead: false, settled: false, forfeited: false,
    hp: 100, ap: 6, mp: 3, drops: vector[], effects: vector[], cooldowns: vector[],
  });
  let fight = Fight {
    id: object::new(ctx), world: b"access_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: side_access,
    opener_a: option::none(), opener_b: opener,
    fighters,
    zones: vector[], queue: vector[], turn_ptr: 0, round: 0, ended: false,
    winner: option::none(), dungeon: option::none(), managed: false, wagered: false,
    drops_rolled: false, turn_seed: 0, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  let claims = claims_side(&fight, 1, joiner);
  let Fight { id, .. } = fight;
  id.delete();
  claims
}

#[test_only]
public(package) fun party_authority_fight_for_testing(
  chr: Character,
  owner: address,
  settled: bool,
  ctx: &mut TxContext,
): Fight {
  let board = combat_grid::generate(1, 0);
  let character_id = character::id(&chr);
  let mut fighter = fighter_for_placement_test(0, board.start_cells_a()[0], 6);
  fighter.kind = FighterKind::Player { character: character_id, owner, level: 1 };
  fighter.settled = settled;
  let mut fight = Fight {
    id: object::new(ctx), world: b"party_authority_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[fighter], zones: vector[], queue: vector[0], turn_ptr: 0, round: 1,
    ended: false, winner: option::none(), dungeon: option::none(), managed: false,
    wagered: false, drops_rolled: false, turn_seed: 1, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  dof::add(&mut fight.id, FighterKey(0), chr);
  fight
}

#[test_only]
public(package) fun mob_party_authority_fight_for_testing(ctx: &mut TxContext): Fight {
  let board = combat_grid::generate(1, 0);
  let mut fighter = fighter_for_placement_test(0, board.start_cells_a()[0], 6);
  fighter.settled = false;
  Fight {
    id: object::new(ctx), world: b"party_authority_mob_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[fighter], zones: vector[], queue: vector[0], turn_ptr: 0, round: 1,
    ended: false, winner: option::none(), dungeon: option::none(), managed: false,
    wagered: false, drops_rolled: false, turn_seed: 1, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  }
}

#[test_only]
public(package) fun take_party_authority_character_for_testing(mut fight: Fight): Character {
  let chr: Character = dof::remove(&mut fight.id, FighterKey(0));
  let Fight { id, .. } = fight;
  id.delete();
  chr
}

#[test_only]
public(package) fun destroy_party_authority_mob_fight_for_testing(fight: Fight) {
  let Fight { id, .. } = fight;
  id.delete();
}

#[test_only]
public(package) fun matching_drops_for_testing(): vector<u32> {
  let mut drops = vector[
    RolledDrop { item_type: b"silk".to_string(), qty: 2 },
    RolledDrop { item_type: b"fang".to_string(), qty: 1 },
    RolledDrop { item_type: b"silk".to_string(), qty: 3 },
  ];
  let total = take_matching_drops(&mut drops, &b"silk".to_string());
  assert!(drops.length() == 1 && drops[0].item_type == b"fang".to_string(), 0);
  vector[total]
}

#[test_only]
public(package) fun three_mob_non_stackable_split_for_testing(): vector<u32> {
  let mut first = vector[
    RolledDrop { item_type: b"hat".to_string(), qty: 3 },
    RolledDrop { item_type: b"hat".to_string(), qty: 3 },
  ];
  let mut second = vector[RolledDrop { item_type: b"hat".to_string(), qty: 3 }];
  let first_total = take_matching_drops(&mut first, &b"hat".to_string());
  let second_total = take_matching_drops(&mut second, &b"hat".to_string());
  vector[first_total, second_total, first_total + second_total]
}

#[test_only]
public(package) fun mob_loot_scaling_for_testing(): vector<u64> {
  let authored = vector[mob_data::new_loot_entry(b"fang".to_string(), 5_000, 1, 2)];
  let low = mob_scaling::loot(authored, 10, 20, 10);
  let high = mob_scaling::loot(authored, 10, 20, 20);
  vector[
    mob_data::loot_chance_bp(&low[0]) as u64,
    mob_data::loot_chance_bp(&high[0]) as u64,
    mob_data::loot_min_qty(&high[0]) as u64,
    mob_data::loot_max_qty(&high[0]) as u64,
  ]
}

#[test_only]
public(package) fun active_chance_for_loot_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let chr = character::test_character(b"shugo".to_string(), 1, 0, ctx);
  let mut player = fighter_for_placement_test(0, board.start_cells_a()[0], 6);
  player.kind = FighterKind::Player { character: character::id(&chr), owner: ctx.sender(), level: 1 };
  player.settled = false;
  player.effects = vector[
    ActiveEffect { kind: K_ADD, element: b"".to_string(), value: 600, turns_left: 1, source: 0, stat: STAT_CHANCE },
    ActiveEffect { kind: K_ADD, element: b"".to_string(), value: 999, turns_left: 1, source: 0, stat: STAT_POWER },
  ];
  let mut fight = Fight {
    id: object::new(ctx), world: b"loot_chance_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[player], zones: vector[], queue: vector[0], turn_ptr: 0, round: 1,
    ended: true, winner: option::some(0), dungeon: option::none(), managed: false,
    wagered: false, drops_rolled: false, turn_seed: 1, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  dof::add(&mut fight.id, FighterKey(0), chr);
  let winners = vector[0];
  let boosted = team_chance_of(&fight, &winners);
  fight.fighters[0].effects.push_back(ActiveEffect {
    kind: K_REMOVE, element: b"".to_string(), value: 120, turns_left: 1, source: 0, stat: STAT_CHANCE,
  });
  let reduced = team_chance_of(&fight, &winners);
  fight.fighters[0].effects.push_back(ActiveEffect {
    kind: K_STEAL, element: b"".to_string(), value: 60, turns_left: 1, source: 0, stat: STAT_CHANCE,
  });
  let stolen = team_chance_of(&fight, &winners);
  let chr: Character = dof::remove(&mut fight.id, FighterKey(0));
  character::destroy(chr);
  let Fight { id, .. } = fight;
  id.delete();
  vector[boosted, reduced, stolen]
}

#[test_only]
public(package) fun trap_edge_exit_for_testing(ctx: &mut TxContext): bool {
  let board = combat_grid::generate(1, 0);
  let anchor = combat_grid::encode(5, 5);
  // the mover stands on the zone's EDGE (distance 2) and steps OUT (distance 3)
  let from = anchor + 2;
  let to = anchor + 3;
  let mut fight = Fight {
    id: object::new(ctx), world: b"trap_edge_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, to, 6),
      fighter_for_placement_test(1, combat_grid::encode(10, 15), 0),
    ],
    zones: vector[BoardZone {
      owner_fighter: 1,
      trap: true,
      shape: spell_effect::shape_circle(),
      size: 2,
      anchor,
      turns_left: 0,
      effects: vector[],
    }],
    queue: vector[0], turn_ptr: 0, round: 1, ended: false,
    winner: option::none(), dungeon: option::none(), managed: false, wagered: false,
    drops_rolled: false, turn_seed: 1, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  let fired = on_enter(&mut fight, 0, from);
  let kept = fight.zones.length() == 1;
  let Fight { id, .. } = fight;
  id.delete();
  !fired && kept
}

#[test_only]
public(package) fun life_steal_half_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let target_cell = board.start_cells_b()[0];
  let mut fight = Fight {
    id: object::new(ctx), world: b"life_steal_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, caster_cell, 6),
      fighter_for_placement_test(1, target_cell, 6),
    ],
    zones: vector[], queue: vector[0, 1], turn_ptr: 0, round: 1, ended: false,
    winner: option::none(), dungeon: option::none(), managed: false, wagered: false,
    drops_rolled: false, turn_seed: 1, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  *&mut fight.fighters[0].hp = 40;
  let sheet = Sheet {
    strength: 0, intelligence: 0, chance: 0, agility: 0, wisdom: 0,
    raw_damage: 0, critical: 0, range_bonus: 0, level: 1,
  };
  let row = spell_effect::new_effect(
    K_STEAL, b"earth".to_string(), 15, 15, spell_effect::shape_point(), 0, 1, 10_000, 0, STAT_HP,
  );
  let mut estate = 1;
  resolve_rows(&mut fight, 0, &sheet, &vector[row], target_cell, caster_cell, &mut estate, 1);
  let answer = vector[fight.fighters[1].hp, fight.fighters[0].hp];
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

#[test_only]
public(package) fun range_removal_reaches_authored_max_for_testing(ctx: &mut TxContext): u64 {
  let board = combat_grid::generate(1, 0);
  let mut fighter = fighter_for_placement_test(0, board.start_cells_a()[0], 6);
  fighter.effects.push_back(ActiveEffect {
    kind: K_STEAL, element: b"".to_string(), value: 1, turns_left: 2, source: 1, stat: STAT_RANGE,
  });
  let fight = Fight {
    id: object::new(ctx), world: b"range_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[fighter], zones: vector[], queue: vector[0], turn_ptr: 0, round: 1, ended: false,
    winner: option::none(), dungeon: option::none(), managed: false, wagered: false,
    drops_rolled: false, turn_seed: 1, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  let answer = range_max_adjusted(&fight, 0, 3, 0);
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

#[test_only]
public(package) fun chatiment_caps_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let mut fight = Fight {
    id: object::new(ctx), world: b"chatiment_fold_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, combat_grid::encode(5, 5), 6),
      fighter_for_placement_test(1, combat_grid::encode(10, 15), 6),
    ],
    zones: vector[], queue: vector[0, 1], turn_ptr: 0, round: 1, ended: false,
    winner: option::none(), dungeon: option::none(), managed: false, wagered: false,
    drops_rolled: false, turn_seed: 1, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  fight.fighters[1].hp = 300;
  fight.fighters[1].effects.push_back(ActiveEffect {
    kind: K_CHATIMENT, element: b"".to_string(), value: 60, turns_left: 5, source: 1, stat: STAT_STRENGTH,
  });
  hit(&mut fight, 1, 40, 0);
  hit(&mut fight, 1, 40, 0);
  fight.fighters[0].kind = FighterKind::Player {
    character: object::id_from_address(@0xC0FFEE), owner: @0xA11CE, level: 1,
  };
  fight.turn_ptr = 1;
  hit(&mut fight, 1, 40, 0);
  hit(&mut fight, 1, 40, 0);
  let rows = &fight.fighters[1].effects;
  let mut gains = 0;
  let mut gain_value = 0;
  let mut i = 0;
  while (i < rows.length()) {
    if (rows[i].kind == K_ADD && rows[i].stat == STAT_STRENGTH) {
      gains = gains + 1;
      gain_value = gain_value + rows[i].value;
    };
    i = i + 1;
  };
  let mut turns = 0u64;
  while (turns < 4) {
    tick_turn_end(&mut fight, 1);
    turns = turns + 1;
  };
  let mut after_four = 0;
  i = 0;
  while (i < fight.fighters[1].effects.length()) {
    if (fight.fighters[1].effects[i].kind == K_ADD) after_four = after_four + 1;
    i = i + 1;
  };
  tick_turn_end(&mut fight, 1);
  let mut after_five = 0;
  i = 0;
  while (i < fight.fighters[1].effects.length()) {
    if (fight.fighters[1].effects[i].kind == K_ADD) after_five = after_five + 1;
    i = i + 1;
  };
  let answer = vector[gains, gain_value, fight.fighters[1].hp, after_four, after_five];
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

#[test_only]
public(package) fun swap_filter_for_testing(ctx: &mut TxContext): bool {
  let board = combat_grid::generate(1, 0);
  let caster_cell = combat_grid::encode(5, 5);
  let ally_cell = caster_cell + 1;
  let enemy_cell = caster_cell + 2;
  let mut enemy = fighter_for_placement_test(1, enemy_cell, 6);
  enemy.effects.push_back(ActiveEffect {
    kind: K_INVIS, element: b"".to_string(), value: 0, turns_left: 2, source: 2, stat: 0,
  });
  let mut fight = Fight {
    id: object::new(ctx), world: b"swap_filter_test".to_string(), x: 0, z: 0,
    closed: vector[0, 0, 0, 0, 0, 0], board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, caster_cell, 6),
      fighter_for_placement_test(0, ally_cell, 6),
      enemy,
    ],
    zones: vector[], queue: vector[0, 2, 1], turn_ptr: 0, round: 1, ended: false,
    winner: option::none(), dungeon: option::none(), managed: false, wagered: false,
    drops_rolled: false, turn_seed: 1, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  let row = spell_effect::new_effect(
    K_SWAP, b"".to_string(), 0, 0, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
  );
  let sheet = sheet_of(&fight, 0);
  let mut estate = 1;
  resolve_rows(&mut fight, 0, &sheet, &vector[row], ally_cell, caster_cell, &mut estate, 1);
  resolve_rows(&mut fight, 0, &sheet, &vector[row], enemy_cell, caster_cell, &mut estate, 1);
  let unchanged = fight.fighters[0].cell == caster_cell
    && fight.fighters[1].cell == ally_cell
    && fight.fighters[2].cell == enemy_cell;
  let Fight { id, .. } = fight;
  id.delete();
  unchanged
}

/// Test seam over the shared walker: a point trap on the walker's FIRST declared step pulls a
/// same-team bystander onto the SECOND declared step. Bodies are walls, so the walk must stop
/// when a declared cell becomes occupied mid-walk. Returns [walker_cell, bystander_cell].
#[test_only]
public(package) fun walk_into_pulled_body_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let start = combat_grid::encode(0, 5);
  let step_1 = start + 1;
  let step_2 = start + 2;
  let fighters = vector[
    fighter_for_placement_test(0, start, 6), // the walker
    fighter_for_placement_test(0, step_2 + 1, 0), // the bystander the trap will pull onto step_2
    fighter_for_placement_test(1, combat_grid::encode(10, 15), 0), // the far-away trap owner
  ];
  // A circle-2 trap on step_1 — the ZONE is the payload's area: the walker entering the
  // anchor triggers it and the pull drags the in-zone bystander 1 cell toward the anchor,
  // landing it exactly on the walker's still-declared step_2 (the walker itself is spared by
  // the pull's ≤1-distance floor).
  let zones = vector[BoardZone {
    owner_fighter: 2,
    trap: true,
    shape: spell_effect::shape_circle(),
    size: 2,
    anchor: step_1,
    turns_left: 0,
    effects: vector[
      spell_effect::new_effect(K_PULL, b"".to_string(), 1, 1, spell_effect::shape_point(), 0, 0, 10_000, 0, 0),
    ],
  }];
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"walk_test".to_string(),
    x: 0,
    z: 0,
    closed: vector[0, 0, 0, 0, 0, 0], // wall-free — only bodies block
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters,
    zones,
    queue: vector[0],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  walk_path(&mut fight, 0, &vector[step_1, step_2]);
  let answer = vector[fight.fighters[0].cell, fight.fighters[1].cell];
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

#[test_only]
/// Gas probe seam — the CI ratchet's subject (`fight_gas_tests`). Two full ROUNDS of an
/// all-mob fight on `generate(1, 0)`'s board with fixed entropy: one caster (circle-2 earth
/// bolt behind LOS rules), two bare rushers, one tanky opponent — every turn runs the real
/// brain (`mob_turn`: band search, BFS walks, cast resolution). The assertions are liveness only;
/// the number this seam guards is GAS, bounded by `--gas-limit` in the gate.
public(package) fun three_mob_wave_gas_for_testing(ctx: &mut TxContext): u64 {
  let board = combat_grid::generate(1, 0);
  let a = board.start_cells_a();
  let b = board.start_cells_b();
  let bolt = spell_effect::new_spell_level(
    3, 1, 8, false, true, false, false, 1, 1, 0, 0,
    vector[spell_effect::new_effect(0, b"earth".to_string(), 1, 2, 1, 2, 0, 10_000, 0, 0)],
    vector[],
  );
  let mut caster = fighter_for_placement_test(1, b[0], 6);
  caster.kind = FighterKind::Mob(MobSnapshot {
    mob_type: b"gas_probe_caster".to_string(),
    level: 1,
    max_hp: 100,
    ap: 6,
    mp: 3,
    agility: 0,
    wisdom: 0,
    earth_res: item_stats::shift() as u64,
    fire_res: item_stats::shift() as u64,
    water_res: item_stats::shift() as u64,
    air_res: item_stats::shift() as u64,
    kit: vector[KitSpell { name: b"probe_bolt".to_string(), ordinal: 1, level: bolt }],
    xp: 0,
    loot: vector[],
  });
  let fighters = vector[fighter_for_placement_test(0, a[0], 6), caster, fighter_for_placement_test(1, b[1], 6), fighter_for_placement_test(1, b[2], 6)];
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"gas_probe".to_string(),
    x: 0,
    z: 0,
    closed: combat_grid::closed_mask(&board),
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters,
    zones: vector[],
    queue: vector[0, 1, 2, 3],
    turn_ptr: 0,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  let mut gen = sui::random::new_generator_from_seed_for_testing(b"aresrpg_gas_probe");
  run_until_player(&mut fight, &mut gen, 0, false);
  assert!(!fight.ended, 0);
  assert!(!fight.fighters[0].dead, 1);
  let rounds = fight.round;
  let Fight { id, .. } = fight;
  id.delete();
  rounds
}

#[test_only]
/// AI seam — one bare-kit mob brain turn: the mob at `mob_cell` (with `mp` movement) faces an
/// enemy at `enemy_cell` across `wall_cells` on an open 12×12 board, `mob_turn` runs once, and the
/// mob's final cell comes back. The frog law's test bench: blocked-but-reachable must WALK.
public(package) fun rush_for_testing(
  mob_cell: u64,
  enemy_cell: u64,
  wall_cells: vector<u64>,
  mp: u64,
  ctx: &mut TxContext,
): u64 {
  let mut mask = combat_grid::empty_mask();
  let mut y = 0;
  while (y < 12) {
    let mut x = 0;
    while (x < 12) {
      combat_grid::mask_set(&mut mask, combat_grid::encode(x, y));
      x = x + 1;
    };
    y = y + 1;
  };
  let board = combat_grid::grid_spec(
    12, 12, mask, vector[], vector[],
    vector[
      combat_grid::encode(0, 0), combat_grid::encode(1, 0), combat_grid::encode(2, 0),
      combat_grid::encode(3, 0), combat_grid::encode(4, 0), combat_grid::encode(5, 0),
    ],
    vector[
      combat_grid::encode(6, 11), combat_grid::encode(7, 11), combat_grid::encode(8, 11),
      combat_grid::encode(9, 11), combat_grid::encode(10, 11), combat_grid::encode(11, 11),
    ],
  );
  let mut closed = combat_grid::closed_mask(&board);
  combat_grid::mask_add_cells(&mut closed, &wall_cells);
  let mut enemy = fighter_for_placement_test(0, enemy_cell, 6);
  *&mut enemy.mp = 3;
  let mut mob = fighter_for_placement_test(1, mob_cell, 6);
  *&mut mob.mp = mp;
  let mut fight = Fight {
    id: object::new(ctx),
    world: b"ai_probe".to_string(),
    x: 0,
    z: 0,
    closed,
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters: vector[enemy, mob],
    zones: vector[],
    queue: vector[0, 1],
    turn_ptr: 1,
    round: 1,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: false,
    turn_seed: 7,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  mob_turn(&mut fight, 1);
  let landed = fight.fighters[1].cell;
  let Fight { id, .. } = fight;
  id.delete();
  landed
}

#[test_only]
public(package) fun ally_buff_for_testing(ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let player_cell = board.start_cells_a()[0];
  let caster_cell = board.start_cells_b()[0];
  let ally_cell = board.start_cells_b()[1];
  let buff = spell_effect::new_spell_level(
    2, 0, 40, false, false, false, false, 0, 0, 5, 0,
    vector[spell_effect::new_effect(
      K_ADD, b"".to_string(), 4, 10, spell_effect::shape_point(), 0, 3, 10_000, 2, STAT_RAW_DAMAGE,
    )],
    vector[],
  );
  let mut caster = fighter_for_placement_test(1, caster_cell, 6);
  caster.kind = FighterKind::Mob(MobSnapshot {
    mob_type: b"nifuwa".to_string(),
    level: 1,
    max_hp: 100,
    ap: 6,
    mp: 3,
    agility: 0,
    wisdom: 0,
    earth_res: item_stats::shift() as u64,
    fire_res: item_stats::shift() as u64,
    water_res: item_stats::shift() as u64,
    air_res: item_stats::shift() as u64,
    kit: vector[KitSpell { name: b"Nifuwoost".to_string(), ordinal: 1, level: buff }],
    xp: 0,
    loot: vector[],
  });
  let mut fight = Fight {
    id: object::new(ctx), world: b"ally_buff_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[
      fighter_for_placement_test(0, player_cell, 6),
      caster,
      fighter_for_placement_test(1, ally_cell, 6),
    ],
    zones: vector[], queue: vector[0, 1, 2], turn_ptr: 1, round: 1, ended: false,
    winner: option::none(), dungeon: option::none(), managed: false, wagered: false,
    drops_rolled: false, turn_seed: 7, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  mob_turn(&mut fight, 1);
  let answer = vector[fight.fighters[0].effects.length(), fight.fighters[2].effects.length()];
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

#[test_only]
public(package) fun mob_multi_cast_for_testing(casts_per_turn: u8, ctx: &mut TxContext): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let player_cell = board.start_cells_a()[0];
  let mob_cell = board.start_cells_b()[0];
  let attack = spell_effect::new_spell_level(
    4, 1, 40, false, false, false, false, casts_per_turn, 0, 0, 0,
    vector[spell_effect::new_effect(
      K_DAMAGE, b"earth".to_string(), 10, 10, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
    )],
    vector[],
  );
  let mut mob = fighter_for_placement_test(1, mob_cell, 8);
  mob.kind = FighterKind::Mob(MobSnapshot {
    mob_type: b"repeat_bite".to_string(),
    level: 1,
    max_hp: 100,
    ap: 8,
    mp: 0,
    agility: 0,
    wisdom: 0,
    earth_res: item_stats::shift() as u64,
    fire_res: item_stats::shift() as u64,
    water_res: item_stats::shift() as u64,
    air_res: item_stats::shift() as u64,
    kit: vector[KitSpell { name: b"Repeat Bite".to_string(), ordinal: 1, level: attack }],
    xp: 0,
    loot: vector[],
  });
  *&mut mob.mp = 0;
  let mut fight = Fight {
    id: object::new(ctx), world: b"mob_multi_cast_test".to_string(), x: 0, z: 0,
    closed: combat_grid::closed_mask(&board), board,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    fighters: vector[fighter_for_placement_test(0, player_cell, 6), mob],
    zones: vector[], queue: vector[0, 1], turn_ptr: 1, round: 1, ended: false,
    winner: option::none(), dungeon: option::none(), managed: false, wagered: false,
    drops_rolled: false, turn_seed: 7, turn_slot: 0, turn_casts: vector[],
    placement_ms: 0, turn_started_ms: 0,
  };
  mob_turn(&mut fight, 1);
  let answer = vector[fight.fighters[1].ap, fight.fighters[0].hp, fight.turn_casts.length()];
  let Fight { id, .. } = fight;
  id.delete();
  answer
}

#[test_only]
/// Close seam: a two-seat ended fight (one player owned by `owner`, one mob) with the player
/// seat settled or not — `close` runs under the CALLING context's sender, so tests prove the
/// participant law and the everyone-settled law.
public(package) fun close_for_testing(owner: address, settled: bool, ctx: &mut TxContext) {
  let board = combat_grid::generate(1, 0);
  let mut player = fighter_for_placement_test(0, board.start_cells_a()[0], 6);
  player.kind = FighterKind::Player { character: object::id_from_address(@0xC0FFEE), owner, level: 1 };
  *&mut player.settled = settled;
  let mob = fighter_for_placement_test(1, board.start_cells_b()[0], 6);
  let fight = Fight {
    id: object::new(ctx),
    world: b"close_probe".to_string(),
    x: 0,
    z: 0,
    closed: combat_grid::closed_mask(&board),
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters: vector[player, mob],
    zones: vector[],
    queue: vector[0, 1],
    turn_ptr: 0,
    round: 1,
    ended: true,
    winner: option::some(0),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: true,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  close(fight, ctx);
}

#[test_only]
public(package) fun assert_last_settler_for_testing(
  owner: address,
  other_settled: bool,
  ctx: &mut TxContext,
) {
  let board = combat_grid::generate(1, 0);
  let mut current = fighter_for_placement_test(0, board.start_cells_a()[0], 6);
  current.kind = FighterKind::Player { character: object::id_from_address(@0xC0FFEE), owner, level: 1 };
  current.settled = false;
  let mut other = fighter_for_placement_test(1, board.start_cells_b()[0], 6);
  other.kind = FighterKind::Player { character: object::id_from_address(@0xBAD), owner: @0xBEEF, level: 1 };
  *&mut other.settled = other_settled;
  let fight = Fight {
    id: object::new(ctx),
    world: b"last_settler_probe".to_string(),
    x: 0,
    z: 0,
    closed: combat_grid::closed_mask(&board),
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters: vector[current, other],
    zones: vector[],
    queue: vector[0, 1],
    turn_ptr: 0,
    round: 1,
    ended: true,
    winner: option::some(0),
    dungeon: option::none(),
    managed: false,
    wagered: false,
    drops_rolled: true,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  assert_last_settler(&fight, 0, ctx);
  let Fight { id, .. } = fight;
  id.delete();
}

#[test_only]
public(package) fun assert_last_live_player_for_testing(
  owner: address,
  other_settled: bool,
  ctx: &mut TxContext,
) {
  let board = combat_grid::generate(1, 0);
  let mut current = fighter_for_placement_test(0, board.start_cells_a()[0], 6);
  current.kind = FighterKind::Player { character: object::id_from_address(@0xC0FFEE), owner, level: 1 };
  current.settled = false;
  let mut other = fighter_for_placement_test(1, board.start_cells_b()[0], 6);
  other.kind = FighterKind::Player { character: object::id_from_address(@0xBAD), owner: @0xBEEF, level: 1 };
  *&mut other.settled = other_settled;
  let fight = Fight {
    id: object::new(ctx),
    world: b"last_exit_probe".to_string(),
    x: 0,
    z: 0,
    closed: combat_grid::closed_mask(&board),
    board,
    access_a: ACCESS_UNSET,
    access_b: ACCESS_UNSET,
    opener_a: option::none(),
    opener_b: option::none(),
    fighters: vector[current, other],
    zones: vector[],
    queue: vector[],
    turn_ptr: 0,
    round: 0,
    ended: false,
    winner: option::none(),
    dungeon: option::none(),
    managed: true,
    wagered: true,
    drops_rolled: true,
    turn_seed: 1,
    turn_slot: 0,
    turn_casts: vector[],
    placement_ms: 0,
    turn_started_ms: 0,
  };
  assert_last_live_player(&fight, 0, ctx);
  let Fight { id, .. } = fight;
  id.delete();
}
