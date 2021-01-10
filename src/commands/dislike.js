import { write_chat_msg } from '../chat.js'

export const dislike_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'dislike',
    children: [],
  },
]

export default function dislike({ server, sender }) {
  write_chat_msg(
    { server },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' a', color: 'blue' },
        { text: ' Dislike', color: 'red' },
        { text: ' !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
