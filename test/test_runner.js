import Doubt from '@hydre/doubt'

import '../src/index.js'
import logger from '../src/logger.js'

import connected from './connected.doubt.js'

export const doubt = Doubt({
  title: 'Testing client',
  calls: 1,
  stdout: process.stdout,
})

export const log = logger(import.meta)

const to_test = new Set()

to_test.add(connected)

for (const test of to_test) {
  test.test()
}
