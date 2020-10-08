import pino from 'pino'
import { fileURLToPath } from 'url'
import { dirname, relative } from 'path'

const root = dirname(fileURLToPath(import.meta.url))

const strip_extension = (path) => path.slice(0, path.lastIndexOf('.'))

export default function logger({ url }) {
  return pino({
    base: { name: strip_extension(relative(root, fileURLToPath(url))) },
    level: 'trace',
  })
}
