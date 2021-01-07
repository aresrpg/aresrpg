import { Position } from '../chat.js'

import gamemode from './gamemode.js'
import dislike from './dislike.js'
import f from './f.js'
import jerry from './jerry.js'
import like from './like.js'
import osef from './osef.js'
import ragequit from './ragequit.js'
import respect from './respect.js'
import rt from './rt.js'
import tg from './tg.js'
import thug from './thug.js'

export function write_unfounded_command({ sender }) {}

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
    case '/dislike':
      dislike(command)
      break
    case '/f':
      f(command)
      break
    case '/jerry':
      jerry(command)
      break
    case '/like':
      like(command)
      break
    case '/osef':
      osef(command)
      break
    case '/ragequit':
      ragequit(command)
      break
    case '/respect':
      respect(command)
      break
    case '/rt':
      rt(command)
      break
    case '/tg':
      tg(command)
      break
    case '/thug':
      thug(command)
      break

    default:
      sender.write('chat', {
        message: JSON.stringify({
          translate: 'commands.help.failed',
          color: 'red',
        }),
        position: Position.CHAT,
        sender: sender.uuid,
      })
      break
  }
}
