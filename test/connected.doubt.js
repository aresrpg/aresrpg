import bot from './bot.js'
import { doubt } from './test_runner.js'

const prm = new Promise((resolve, reject) => {
  bot.on(
    'spawn',
    () => {
      resolve(true)
    },
    bot.on('error', (err) => reject(err))
  )
})

export default {
  name: 'Test connection',
  promise: prm,
  test() {
    this.promise.then(
      (result) => {
        doubt[this.name]({
          because: result,
          is: true,
        })
      },
      (error) => {
        doubt[this.name]({
          because: error,
          is: true,
        })
      }
    )
  },
}
