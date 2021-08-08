import { gamemode_nodes } from './gamemode.js'
import { dislike_nodes } from './dislike.js'
import { fragile_nodes } from './fragile.js'
import { jerry_nodes } from './jerry.js'
import { like_nodes } from './like.js'
import { osef_nodes } from './osef.js'
import { ragequit_nodes } from './ragequit.js'
import { respect_nodes } from './respect.js'
import { rt_nodes } from './rt.js'
import { tg_nodes } from './tg.js'
import { thug_nodes } from './thug.js'
import { msg_nodes } from './msg.js'
import { CommandNodeTypes } from './declare_options.js'

function flatten(node, index = 0) {
  const { children, list } = node.children.reduce(
    ({ children, list }, child) => ({
      children: [...children, index + 1 + list.length],
      list: [...list, ...flatten(child, index + 1 + list.length)],
    }),
    { children: [], list: [] }
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
  ], // add the nodes of all the commands. exemple : [...command_1,...comand_2,...comand_3]
})

export default {
  observe({ client, events }) {
    events.once('state', () => {
      client.write('declare_commands', {
        nodes,
        rootIndex: 0,
      })
    })
  },
}
