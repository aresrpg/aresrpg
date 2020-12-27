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

export default function gamemode({ args, sender }) {
  const gameMode_options = {
    0: { gameMode: GameMode.SURVIVAL, message: Succesful_Message.SURVIVAL },
    survival: {
      gameMode: GameMode.SURVIVAL,
      message: Succesful_Message.SURVIVAL,
    },

    1: { gameMode: GameMode.CREATIVE, message: Succesful_Message.CREATIVE },
    creative: {
      gameMode: GameMode.CREATIVE,
      message: Succesful_Message.CREATIVE,
    },

    2: { gameMode: GameMode.ADVENTURE, message: Succesful_Message.ADVENTURE },
    adventure: {
      gameMode: GameMode.ADVENTURE,
      message: Succesful_Message.ADVENTURE,
    },

    3: { gameMode: GameMode.SPECTATOR, message: Succesful_Message.SPECTATOR },
    spectator: {
      gameMode: GameMode.SPECTATOR,
      message: Succesful_Message.SPECTATOR,
    },
  }

  if (args[0] in gameMode_options === false) {
    write_error({ sender })
    return
  }

  const { message, gameMode } = gameMode_options[args[0]]

  const write_gameMode_options = {
    reason: 3, // game_state_change is not only for gamemode but for a lot of things. And 3 is for gamemode.
    gameMode,
  }

  sender.write('game_state_change', write_gameMode_options)

  const write_message_options = {
    message: JSON.stringify(message),
    position: Position.CHAT,
    sender: '00000000000000000000000000000000',
  }

  sender.write('chat', write_message_options)
}
