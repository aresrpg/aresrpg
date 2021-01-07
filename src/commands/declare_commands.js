import { gamemode_nodes } from './gamemode.js'
import { dislike_nodes } from './dislike.js'
import { f_nodes } from './f.js'
import { jerry_nodes } from './jerry.js'
import { like_nodes } from './like.js'
import { osef_nodes } from './osef.js'
import { ragequit_nodes } from './ragequit.js'
import { respect_nodes } from './respect.js'
import { rt_nodes } from './rt.js'
import { tg_nodes } from './tg.js'
import { thug_nodes } from './thug.js'

export default function declare_commands({ client }) {
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

  const root = {
    flags: {
      command_node_type: 0,
    },
    children: [
      ...gamemode_nodes,
      ...dislike_nodes,
      ...f_nodes,
      ...jerry_nodes,
      ...like_nodes,
      ...osef_nodes,
      ...ragequit_nodes,
      ...respect_nodes,
      ...rt_nodes,
      ...tg_nodes,
      ...thug_nodes,
    ], // add the nodes of all the commands. exemple : [...command_1,...comand_2,...comand_3]
  }

  client.write('declare_commands', { nodes: flatten(root), rootIndex: 0 })
}
