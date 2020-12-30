import { gamemode_nodes } from './gamemode.js'

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
    children: [...gamemode_nodes], // add the nodes of all the commands. exemple : [...command_1,...comand_2,...comand_3]
  }

  client.write('declare_commands', { nodes: flatten(root), rootIndex: 0 })
}
