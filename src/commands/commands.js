import { Position } from '../chat.js'

import gamemode from './gamemode.js'

export function write_unfounded_command({ sender }) {
  sender.write('chat', {
    message: JSON.stringify({
      translate: 'commands.help.failed',
      color: 'red',
    }),
    position: Position.CHAT,
    sender: sender.uuid,
  })
}

export default function execute_command({ message, sender }) {
  const [name, ...args] = message.trimStart().split(/\s+/)
  const command = {
    name,
    args,
    sender,
  }

  switch (command.name) {
    case '/gm':
    case '/gamemode':
      gamemode(command)
      break

    default:
      write_unfounded_command(command)
      break
  }
}
