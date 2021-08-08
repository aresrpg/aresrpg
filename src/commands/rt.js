import { write_chat_msg } from '../player/chat.js'

import { CommandNodeTypes } from './declare_options.js'

export const rt_nodes = [
  {
    flags: {
      command_node_type: CommandNodeTypes.LITERAL,
    },
    extraNodeData: 'rt',
    children: [],
  },
]

export default function rt({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' a', color: 'blue' },
        { text: ' Retweet', color: 'aqua' },
        { text: ' !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
