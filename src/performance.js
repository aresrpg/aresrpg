import { PerformanceObserver, createHistogram } from 'perf_hooks'

import logger from './logger.js'

function create_debounced_observer({
  log,
  timeout = 1000,
  with_histogram = true,
}) {
  let timer = null
  let counter = 0
  const histogram = createHistogram()

  const end = () => {
    if (with_histogram)
      log.info(
        {
          counter,
          max: histogram.max,
          mean: Math.round(histogram.mean),
          min: histogram.min,
          percentile: { 99: histogram.percentile(99) },
        },
        'Ended'
      )
    else
      log.info(
        {
          counter,
        },
        'Ended'
      )

    timer = null
    counter = 0
    histogram.reset()
  }

  return entries => {
    if (entries.length !== 0) {
      if (timer == null) log.info('Started')
      else clearTimeout(timer)
      timer = setTimeout(end, timeout)

      for (const entry of entries) {
        counter++
        const duration = Math.floor(entry.duration)
        if (with_histogram && duration > 0) histogram.record(duration)
      }
    }
  }
}

export default function observe() {
  const observe_load_chunk = create_debounced_observer({
    log: logger({ name: 'perf/chunk/load' }),
  })
  const observe_chunk_gc = create_debounced_observer({
    log: logger({ name: 'perf/chunk/gc' }),
    with_histogram: false,
  })

  const observer = new PerformanceObserver(list => {
    observe_load_chunk(list.getEntriesByName('load_chunk'))
    observe_chunk_gc(list.getEntriesByName('chunk_gc'))
  })

  observer.observe({
    entryTypes: ['measure', 'mark'],
  })
}
