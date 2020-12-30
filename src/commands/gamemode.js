import { Position } from '../chat.js'

const GameMode = {
  SURVIVAL: 0,
  CREATIVE: 1,
  ADVENTURE: 2,
  SPECTATOR: 3,
}

const Succesful_Message = {
  SURVIVAL: {
    translate: 'commands.gamemode.success.self',
    with: [{ translate: 'gameMode.survival' }],
  },
  CREATIVE: {
    translate: 'commands.gamemode.success.self',
    with: [{ translate: 'gameMode.creative' }],
  },
  ADVENTURE: {
    translate: 'commands.gamemode.success.self',
    with: [{ translate: 'gameMode.adventure' }],
  },
  SPECTATOR: {
    translate: 'commands.gamemode.success.self',
    with: [{ translate: 'gameMode.spectator' }],
  },
}

function write_error({ sender }) {
  const message = { translate: 'arguments.operation.invalid', color: 'red' }
  const options = {
    message: JSON.stringify(message),
    position: Position.CHAT,
    sender: sender.uuid,
  }
  sender.write('chat', options)
}

function write_gamemode_and_message({ sender, gameMode }, { message }) {
  const gameMode_options = {
    reason: 3, // game_state_change is not only for gamemode but for a lot of things. And 3 is for gamemode.
    gameMode,
  }

  sender.write('game_state_change', gameMode_options)

  const message_options = {
    message: JSON.stringify(message),
    position: Position.CHAT,
    sender: '00000000000000000000000000000000',
  }

  sender.write('chat', message_options)
}

export default function gamemode({ args, sender }) {
  switch (args[0]) {
    case '0':
    case 'survival':
      write_gamemode_and_message(
        { sender, gameMode: GameMode.SURVIVAL },
        { message: Succesful_Message.SURVIVAL }
      )
      break

    case '1':
    case 'creative':
      write_gamemode_and_message(
        { sender, gameMode: GameMode.CREATIVE },
        { message: Succesful_Message.CREATIVE }
      )
      break
    case '2':
    case 'adventure':
      write_gamemode_and_message(
        { sender, gameMode: GameMode.ADVENTURE },
        { message: Succesful_Message.ADVENTURE }
      )
      break
    case '3':
    case 'spectator':
      write_gamemode_and_message(
        { sender, gameMode: GameMode.SPECTATOR },
        { message: Succesful_Message.SPECTATOR }
      )
      break
    default:
      write_error({ sender })
      break
  }
}
