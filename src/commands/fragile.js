import { write_chat_msg } from '../chat.js'

export const fragile_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'f',
    children: [],
  },
]

export default function fragile({ server, sender }) {
  write_chat_msg(
    { server },
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
