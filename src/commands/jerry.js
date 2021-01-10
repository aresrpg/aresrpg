import { write_chat_msg } from '../chat.js'

export const jerry_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'jerry',
    children: [],
  },
]

export default function jerry({ server, sender }) {
  write_chat_msg(
    { server },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' Harry Golay !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
