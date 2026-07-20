/// EVENTS — the single home for dungeon run lifecycle events (§9 observability — the RPC indexer + the client
/// feed). One module so the indexer watches one file for the run contract. This module owns every edge of the
/// RUN's own timeline: activation (a key became a run), NEXT-FIGHT/join (the pass entered a room fight),
/// victory-advance (progressed a room), and exit (the run ended — abandon, defeat, or completion). Every edge
/// carries the activation character. The fight's own lifecycle rides `aresrpg_fight` events. All emit functions
/// are `public(package)` and fired by `dungeon`.
module aresrpg_dungeon::dungeon_events;

use sui::event;

/// A key unit was consumed and a character-bound RunPass minted.
public struct RunActivated has copy, drop { pass: ID, world: ID, player: address, character: ID }

/// The pass entered a room fight — NEXT FIGHT (creator) or party join.
public struct PassEnteredFight has copy, drop {
  pass: ID, fight: ID, world: ID, player: address, room: u16, character: ID,
}

/// Victory advanced the run to a new room (non-terminal — the pass lives on). `room` is the new room counter.
public struct RunAdvanced has copy, drop { pass: ID, world: ID, player: address, room: u16, character: ID }

/// A run ended and its pass was consumed. `reason`: 0 abandon, 1 defeat, 2 completion.
public struct RunEnded has copy, drop {
  pass: ID, world: ID, player: address, reason: u8, return_x: u32, return_z: u32, character: ID,
}

public(package) fun emit_activated(pass: ID, world: ID, player: address, character: ID) {
  event::emit(RunActivated { pass, world, player, character });
}

public(package) fun emit_entered_fight(
  pass: ID, fight: ID, world: ID, player: address, room: u16, character: ID,
) {
  event::emit(PassEnteredFight { pass, fight, world, player, room, character });
}

public(package) fun emit_advanced(pass: ID, world: ID, player: address, room: u16, character: ID) {
  event::emit(RunAdvanced { pass, world, player, room, character });
}

public(package) fun emit_ended(
  pass: ID,
  world: ID,
  player: address,
  reason: u8,
  return_x: u32,
  return_z: u32,
  character: ID,
) {
  event::emit(RunEnded { pass, world, player, reason, return_x, return_z, character });
}
