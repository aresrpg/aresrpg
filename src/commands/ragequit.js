import { write_chat_msg } from '../player/chat.js'

import { CommandNodeTypes } from './declare_options.js'

export const ragequit_nodes = [
  {
    flags: {
      command_node_type: CommandNodeTypes.COMMAND,
    },
    extraNodeData: 'ragequit',
    children: [],
  },
]

export default function ragequit({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' a RageQuit !', color: 'red' },
      ]),
      client: sender,
    }
  )

  sender.end(
    'Ragequit',
    JSON.stringify({ text: 'ert si c trist', color: 'yellow' })
  )
}
