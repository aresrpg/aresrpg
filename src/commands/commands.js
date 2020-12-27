import { Position } from '../chat.js'

import gamemode from './gamemode.js'

export function write_unfounded_command({ sender }) {
  const message = { translate: 'commands.help.failed', color: 'red' }
  const options = {
    message: JSON.stringify(message),
    position: Position.CHAT,
    sender: sender.uuid,
  }
  sender.write('chat', options)
}

export default function execute_command({ message, sender }) {
  const splited_message = message.trimStart().split(/\s+/)
  const command = {
    command_name: splited_message[0],
    args: splited_message.slice(1),
    sender,
  }

  switch (command.command_name) {
    case '/gm':
    case '/gamemode':
      gamemode(command)
      break

    default:
      write_unfounded_command(command)
      break
  }
}
