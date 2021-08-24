import { expect, test } from '@jest/globals'

import bot from './bot.js'

function connected() {
  return new Promise((resolve) => {
    bot.on('spawn', () => {
      resolve(true)
    })
  })
}

test('Can connect', () => {
  return connected().then((data) => {
    expect(data).toBeTruthy()
  })
})
