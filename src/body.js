export const States = {
  ALIVE: 'ALIVE',
  // when the player lose all his health
  // he dies /shrug
  DEAD: 'DEAD',
  // when the player run out of soul, he become a ghost
  // in ghost mode the player can't regenerate his soul nor interract much with the game
  // the ghost mode will be the state after a respawn with no soul
  GHOST: 'GHOST',
}
