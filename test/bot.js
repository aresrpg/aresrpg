// import '../src/index.js'
import mineflayer from 'mineflayer'
import Doubt from '@hydre/doubt'

export const bot = mineflayer.createBot({
  username: '#iRobot',
  host: '127.0.0.1',
  port: '25567',
})

// bot.on('kicked', console.log)

export const doubt = Doubt({
  title: 'Testing client',
  calls: 1,
  stdout: process.stdout,
})
