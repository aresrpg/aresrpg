import { write_chat_msg } from '../player/chat.js'

export const respect_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'respect',
    children: [],
  },
]

export default function respect({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' cherche encore le', color: 'yellow' },
        { text: ' respect', color: 'green', bold: 'true' },
      ]),
      client: sender,
    }
  )
}
