import { write_chat_msg } from '../player/chat.js'

import { CommandNodeTypes } from './declare_options.js'

export const fragile_nodes = [
  {
    flags: {
      command_node_type: CommandNodeTypes.COMMAND,
    },
    extraNodeData: 'f',
    children: [],
  },
]

export default function fragile({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: " trouve qu'il y a trop de", color: 'yellow' },
        { text: ' fragile', color: 'blue', bold: 'true' },
        { text: ' ici', color: 'yellow' },
        { text: ' !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
