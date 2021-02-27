import { write_chat_msg } from '../player/chat.js'

export const thug_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'thug',
    children: [],
  },
]

export default function thug({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: " Pense qu'il y a un", color: 'blue' },
        { text: ' Gangster', color: 'red' },
        { text: ' Parmis nous !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
