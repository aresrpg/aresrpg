import { bot, doubt } from './bot.js'

const prm = new Promise((resolve, reject) => {
  bot.on(
    'spawn',
    () => {
      resolve('Player connected')
    },
    bot.on('error', (err) => {
      reject(err)
    })
  )
})

prm.then((value) => {
  console.log(value)
})

prm.then((result) => {
  doubt[result]({
    because: 'Player connected',
    is: result,
  })
})
