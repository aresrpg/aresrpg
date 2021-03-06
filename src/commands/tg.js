import { write_chat_msg } from '../player/chat.js'

import { CommandNodeTypes } from './declare_options.js'

export const tg_nodes = [
  {
    flags: {
      command_node_type: CommandNodeTypes.COMMAND,
    },
    extraNodeData: 'tg',
    children: [],
  },
]

export default function tg({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' Demande le', color: 'gold' },
        { text: ' silence', color: 'red', bold: 'true' },
        { text: ' !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
