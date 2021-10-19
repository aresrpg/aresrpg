import { Position } from '../chat.js'
import { World } from '../events.js'

import { write_error } from './commands.js'
import { ParserProperties, literal, string, entity } from './declare_options.js'

export const msg_nodes = [
  literal({
    value: 'msg',
    children: [
      entity({
        name: 'player',
        properties: ParserProperties.entity.PLAYER,
        children: [
          string({
            name: 'text',
            properties: ParserProperties.string.GREEDY_PHRASE,
            flags: {
              has_command: true,
            },
          }),
        ],
      }),
    ],
  }),
]

export default function msg({ world, sender, args }) {
  if (args.length < 2) {
    write_error({ sender })
    return
  }

  const [username, ...message_words] = args

  const private_message = message_words.join(' ')

  const options = {
    message: JSON.stringify({ text: private_message }),
    position: Position.CHAT,
    sender: sender.uuid,
  }

  world.events.emit(World.PRIVATE_MESSAGE, {
    receiver_username: username,
    options,
  })
}
