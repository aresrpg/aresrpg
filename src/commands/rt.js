import { write_chat_msg } from '../chat.js'

export const rt_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'rt',
    children: [],
  },
]

export default function rt({ server, sender }) {
  write_chat_msg(
    { server },
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
