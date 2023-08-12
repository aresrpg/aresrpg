import { gamemode_nodes } from '../commands/gamemode.js'
import { dislike_nodes } from '../commands/dislike.js'
import { fragile_nodes } from '../commands/fragile.js'
import { jerry_nodes } from '../commands/jerry.js'
import { like_nodes } from '../commands/like.js'
import { osef_nodes } from '../commands/osef.js'
import { ragequit_nodes } from '../commands/ragequit.js'
import { respect_nodes } from '../commands/respect.js'
import { rt_nodes } from '../commands/rt.js'
import { tg_nodes } from '../commands/tg.js'
import { thug_nodes } from '../commands/thug.js'
import { msg_nodes } from '../commands/msg.js'
import { CommandNodeTypes } from '../commands/declare_options.js'
import { health_nodes } from '../commands/health.js'
import { xp_nodes } from '../commands/experience.js'
import { atk_nodes } from '../commands/attack_speed.js'
import { help_nodes } from '../commands/help.js'
import { speed_nodes } from '../commands/speed.js'
import { settings_nodes } from '../commands/settings.js'
import { soul_nodes } from '../commands/soul.js'
import { switch_game_state_nodes } from '../commands/switch_game_state.js'

function flatten(node, index = 0) {
  const { children, list } = node.children.reduce(
    ({ children, list }, child) => ({
      children: [...children, index + 1 + list.length],
      list: [...list, ...flatten(child, index + 1 + list.length)],
    }),
    { children: [], list: [] },
  )

  return [{ ...node, children }, ...list]
}

const nodes = flatten({
  flags: {
    command_node_type: CommandNodeTypes.ROOT,
  },
  children: [
    ...gamemode_nodes,
    ...dislike_nodes,
    ...fragile_nodes,
    ...jerry_nodes,
    ...like_nodes,
    ...osef_nodes,
    ...ragequit_nodes,
    ...respect_nodes,
    ...rt_nodes,
    ...tg_nodes,
    ...thug_nodes,
    ...msg_nodes,
    ...health_nodes,
    ...xp_nodes,
    ...atk_nodes,
    ...help_nodes,
    ...speed_nodes,
    ...settings_nodes,
    ...soul_nodes,
    ...switch_game_state_nodes,
  ], // add the nodes of all the commands. exemple : [...command_1,...comand_2,...comand_3]
})

/** @type {import('../server').Module} */
export default {
  name: 'player_commands',
  observe({ client, events }) {
    events.once('STATE_UPDATED', () => {
      client.write('declare_commands', {
        nodes,
        rootIndex: 0,
      })
    })
  },
}
