import { write_chat_msg } from '../chat.js'

export const ragequit_nodes = [
  {
    flags: {
      command_node_type: 1,
    },
    extraNodeData: 'ragequit',
    children: [],
  },
]

export default function ragequit({ server, sender }) {
  write_chat_msg(
    { server },
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
