// Active-character selection orchestration shared by CharacterSwitcher and its store-level proof. This leaf
// accepts the concrete stores/actions as dependencies so the state transition has one explicit order and the
// test can exercise it without process-global module mocks.

/**
 * Select + persist a lobby character, leave any follow-only view, then re-key the resident world session.
 * Selection happens first so every HUD/store consumer moves to the clicked id; persistence completes before
 * the host rebind so embed.select_active_character cannot revive the previous last-played preference.
 * @param {{ id?: string, world_id?: string | null }} character
 * @param {{
 *   select_character: (id: string) => void,
 *   persist_character: (id: string) => Promise<any>,
 *   stop_follow: () => void,
 *   rebind_session: (id: string, world_id: string | null | undefined) => void | Promise<void>,
 *   rebind_fight?: (id: string) => void | Promise<void>,
 * }} deps
 * @returns {Promise<string>}
 */
export async function select_character_session(character, deps) {
  const character_id = character?.id
  if (!character_id) throw new Error('cannot select a character without an id')
  deps.select_character(character_id)
  await deps.persist_character(character_id)
  // Keep the old scene stable while IndexedDB settles, then flip follow + binding together. This avoids an
  // intermediate remount of the previous character when repairing a tab left in the old follow-mode path.
  deps.stop_follow()
  await deps.rebind_session(character_id, character.world_id)
  // FIGHT half: the world scene re-keyed above (rebind_session); now rebind the FIGHT so char A's
  // board is torn down and char B's own live fight is resumed — the fight mounts off use_dungeon, not the
  // active character, so without this the switch stays "forced to remain on the first character fight".
  await deps.rebind_fight?.(character_id)
  return character_id
}

/**
 * The CharacterSwitcher click boundary. Failures are converted into one caller-owned visible toast/report,
 * never an unhandled fire-and-forget rejection or a dead click.
 * @param {{ id?: string, world_id?: string | null }} character
 * @param {Parameters<typeof select_character_session>[1]} deps
 * @param {(error: unknown) => void} on_failure
 * @returns {Promise<boolean>}
 */
export async function handle_character_click(character, deps, on_failure) {
  try {
    await select_character_session(character, deps)
    return true
  } catch (error) {
    on_failure(error)
    return false
  }
}
