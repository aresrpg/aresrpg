import { write_chat_msg } from '../player/chat.js'

import { CommandNodeTypes } from './declare_options.js'

export const osef_nodes = [
  {
    flags: {
      command_node_type: CommandNodeTypes.LITERAL,
    },
    extraNodeData: 'osef',
    children: [],
  },
]

export default function osef({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: " S'en fout", color: 'dark_aqua' },
        { text: ' !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
