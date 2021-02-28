import { Position } from '../player/chat.js'

import { write_error } from './commands.js'

export const msg_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'msg',
    children: [
      {
        flags: {
          command_node_type: 2,
        },
        children: [
          {
            flags: {
              command_node_type: 2,
              has_command: true,
            },
            children: [],
            extraNodeData: {
              name: 'text',
              parser: 'brigadier:string',
              properties: 2,
            },
          },
        ],
        extraNodeData: {
          name: 'player',
          parser: 'minecraft:entity',
          properties: 0x02, // 0x02 for only player entity
        },
      },
    ],
  },
]

export default function msg({ world, sender, args }) {
  if (args.length < 2) {
    write_error({ sender })
    return
  }

  const private_message = args.slice(1).join(' ')

  const options = {
    message: JSON.stringify({ text: private_message }),
    position: Position.CHAT,
    sender: sender.uuid,
  }

  world.events.emit('private message', { receiver_username: args[0], options }) // args[0] is the username
}
