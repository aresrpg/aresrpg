import { Position } from '../player/chat.js'

import { write_error } from './commands.js'
import { CommandNodeTypes, ParserProperties } from './declare_options.js'

export const msg_nodes = [
  {
    flags: {
      command_node_type: CommandNodeTypes.LITERAL,
    },
    extraNodeData: 'msg',
    children: [
      {
        flags: {
          command_node_type: CommandNodeTypes.ARGUMENT,
        },
        children: [
          {
            flags: {
              command_node_type: CommandNodeTypes.ARGUMENT,
              has_command: true,
            },
            children: [],
            extraNodeData: {
              name: 'text',
              parser: 'brigadier:string',
              properties: ParserProperties.string.GREEDY_PHRASE,
            },
          },
        ],
        extraNodeData: {
          name: 'player',
          parser: 'minecraft:entity',
          properties: ParserProperties.entity.PLAYER,
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

  const [username, ...message_words] = args

  const private_message = message_words.join(' ')

  const options = {
    message: JSON.stringify({ text: private_message }),
    position: Position.CHAT,
    sender: sender.uuid,
  }

  world.events.emit('private_message', { receiver_username: username, options })
}
