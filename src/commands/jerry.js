import { write_chat_msg } from '../player/chat.js'

export const jerry_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'jerry',
    children: [],
  },
]

export default function jerry({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' Harry Golay !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
