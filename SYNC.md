## Flow of events

AresRPG is pretty simple in its event management but when it comes to synchronization between players
it gets a bit more complex as the server is distributed out of the box with a strict concern separated state machine allowing us to scale to millions of players, this knowledge base should provide some support to understand better the internal interactions.

## Synchronizing players presence

- Starts in `src/player/tablist.js` where `once(PlayerEvent.STATE_UPDATED)`
  - we listen for any incomming `WorldRequest.NOTIFY_PRESENCE_TO(my_uuid)` in order to fill the tab list
  - we listen for any incomming `WorldRequest.ADD_PLAYER_TO_WORLD` to trigger the initialization of a player
  - we triggers the emition of a `WorldRequest.ADD_PLAYER_TO_WORLD`
- this means each time a player join the world, he emits that `ADD_PLAYER_TO_WORLD` to say "hey I'm here, I have x health, and x equipment"
- as this player has no idea of the players already present in the server
  - and also as we don't even know on the server (because AresRPG is built to be distributed)
- all players on the same serveur instance (defined by us cf: dofus) will receive this event
  - and thus start the initialization of the player
  - this initialization starts by emiting a `WorldRequest.NOTIFY_PRESENCE_TO(my_uuid)` to notify ourselves of this new player and add him to our tablist
  - then we `WorldRequest.NOTIFY_PRESENCE_TO(player.uuid)` to notify him of ourselve so he can add us to his tablist
- now that the tablist part is handled, we catch any `WorldRequest.NOTIFY_PRESENCE_TO(my_uuid)` in `src/player/sync.js` to call the `handle_presence()` function
- there we also catch any `WorldRequest.CHUNK_POSITION_UPDATE` to also call `handle_presence()`
- this function is storing in a reducer physical infos of any player that is close enough to us (`inside_view`)
  - so we now have some kind of limited state of players we can currently see in the world, and this is how we synchronise without central multiplayer state
- any futher events or packets forwarded to the `sync.js` player stream will be able to read the limited state to create interactions between players
  - like showing a life update, an equipment change, a fight, etc..

## Damaging players

> The packet `use_entity` is sent and handled in `src/mobs/damage.js` but as
> a mob won't be found for the `entity_id` of a player, it will be skipped

- Starts in `src/player/sync.js` where the `use_entity` packet is listened to
- the `entity_id` will be matched with the known stream of players currently visible by us (inside_view)
  - if the target is not visible then we won't know its info and it will stop here
- a `PlayerEvent.PLAYER_INTERRACTED` is emitted with nescessary infos
- the observer inside `src/mobs/damage.js` catches that event and handles it exactly like for a mob
  - with the exception of emiting a `WorldRequest.PLAYER_RECEIVE_DAMAGE` in case of a player
- the observer inside `src/player/damage.js` catches the event and
  - if the uuid is ours => dispatch `PlayerEvent.RECEIVE_DAMAGE`
    - it will be caught by the reducer and remove the life accordingly (unless GM)
    - in case the life falls to `0` it will handle the death and emit a `WorldRequest.PLAYER_DIED`
    - which will be caught in `src/player/sync.js` and other players will be able to destroy the entity
    - as the respawn observer caught our death, once respawning it will send a `WorldRequest.PLAYER_RESPAWNED` which should act in the same way as the `WorldRequest.NOTIFY_PRESENCE_TO`
  - otherwise send a hit animation packet (`entity_status`), or a death animation packet
    - and also show a damage indicator hologram + blood particles
