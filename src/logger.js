import { dirname, relative } from 'path'
import { fileURLToPath } from 'url'

import pino from 'pino'

const root = dirname(fileURLToPath(import.meta.url))

const strip_extension = (path) => path.slice(0, path.lastIndexOf('.'))

export default function logger({
  url = null,
  name = strip_extension(relative(root, fileURLToPath(url))),
}) {
  return pino({
    base: { name },
    level: 'info',
  })
}
