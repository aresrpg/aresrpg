import { write_chat_msg } from '../player/chat.js'

import { CommandNodeTypes } from './declare_options.js'

export const like_nodes = [
  {
    flags: {
      command_node_type: CommandNodeTypes.COMMAND,
    },
    extraNodeData: 'like',
    children: [],
  },
]

export default function like({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' Aime ça', color: 'dark_aqua' },
        { text: ' !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
