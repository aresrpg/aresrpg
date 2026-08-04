// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE network-edge scheduler for the world shell's recurring /v1 reads. Callers keep their domain-owned
// timers/reducers, but every character/party/zones/fights request enters this single FIFO before it can touch
// fetch. Exact URL duplicates share one promise and unique URLs start at a bounded cadence, so the 3x3 zone
// neighborhood can never become a same-frame burst or consume the API's entire per-IP minute bucket.

export const WORLD_POLL_STAGGER_MS = 750
const PAUSED_RECHECK_MS = 1000

type TimerHandle = ReturnType<typeof setTimeout>

type SchedulerDeps = {
  now?: () => number
  set_timeout?: (handler: () => void, delay_ms: number) => TimerHandle
  clear_timeout?: (handle: TimerHandle) => void
  is_paused?: () => boolean
}

type PollJob<T = unknown> = {
  readonly key: string
  readonly run: () => Promise<T>
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
  readonly generation: number
  readonly bypass_stagger: boolean
}

export type WorldPollScheduler = {
  schedule: <T>(key: string, run: () => Promise<T>, priority?: boolean) => Promise<T>
  promote: (key: string) => void
  reset: () => void
}

const default_now = () => Date.now()
const default_set_timeout = (handler: () => void, delay_ms: number) => globalThis.setTimeout(handler, delay_ms)
const default_clear_timeout = (handle: TimerHandle) => globalThis.clearTimeout(handle)
const default_is_paused = () => typeof document !== 'undefined' && document.hidden

/** Create the scheduler with injectable clock/timers so its coalescing and request budget stay headless-testable. */
export function create_world_poll_scheduler({
  now = default_now,
  set_timeout = default_set_timeout,
  clear_timeout = default_clear_timeout,
  is_paused = default_is_paused,
}: SchedulerDeps = {}): WorldPollScheduler {
  let queue: PollJob[] = []
  const pending = new Map<string, PollJob>()
  let timer: TimerHandle | null = null
  let last_started_at = Number.NEGATIVE_INFINITY
  let generation = 0
  const started_kinds = new Set<string>()

  const arm = (delay_override?: number) => {
    if (timer != null || queue.length === 0) return
    const stagger_wait = Number.isFinite(last_started_at)
      ? Math.max(0, last_started_at + WORLD_POLL_STAGGER_MS - now())
      : 0
    timer = set_timeout(run_next, delay_override ?? stagger_wait)
  }

  const finish = (job: Readonly<PollJob>, result: Readonly<{ data?: unknown; error?: unknown }>) => {
    if (job.generation !== generation) return
    if (pending.get(job.key) === job) pending.delete(job.key)
    if ('error' in result) job.reject(result.error)
    else job.resolve(result.data)
  }

  const start = (job: Readonly<PollJob>) => {
    last_started_at = now()
    try {
      void job.run().then(
        (data) => finish(job, { data }),
        (error) => finish(job, { error })
      )
    } catch (error) {
      finish(job, { error })
    }
  }

  const run_next = () => {
    timer = null
    if (is_paused()) {
      arm(PAUSED_RECHECK_MS)
      return
    }
    const [job, ...remaining] = queue
    if (!job) return
    queue = remaining
    start(job)
    if (queue[0]?.bypass_stagger) {
      run_next()
      return
    }
    arm()
  }

  const promote = (key: string) => {
    const job = pending.get(key)
    if (!job || !queue.includes(job)) return
    queue = [job, ...queue.filter((candidate) => candidate !== job)]
  }

  /** Pull a queued job out of the FIFO and run it now, then re-arm the ticker for whatever is left behind it. */
  const start_now = (job: Readonly<PollJob>) => {
    queue = queue.filter((candidate) => candidate !== job)
    if (timer != null) clear_timeout(timer)
    timer = null
    start(job)
    arm()
  }

  const schedule = <T>(key: string, run: () => Promise<T>, priority = false): Promise<T> => {
    const existing = pending.get(key)
    if (existing) {
      if (priority && queue.includes(existing)) start_now(existing)
      return existing.promise as Promise<T>
    }

    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((resolve_job, reject_job) => {
      resolve = resolve_job
      reject = reject_job
    })
    // reset() may reject a queued request after its caller has unmounted. Mark it handled internally while
    // preserving the original rejecting promise for live callers.
    void promise.catch(() => undefined)
    const kind = (() => {
      if (!/^https?:\/\//.test(key)) return key.split(':')[0]
      try {
        return new URL(key).pathname
      } catch {
        return key.split(':')[0]
      }
    })()
    const bypass_stagger = !started_kinds.has(kind)
    started_kinds.add(kind)
    const job: PollJob<T> = { key, run, promise, resolve, reject, generation, bypass_stagger }
    pending.set(key, job as PollJob)
    // PRIORITY IS THE INTERACTION (#2158). The stagger exists so a RECURRING wave — the 3x3 zone neighborhood
    // re-read every tick — cannot burst or eat the per-IP minute bucket. A priority read is the opposite animal:
    // a one-shot the player is standing still for (a travel click's route, a post-tx reconcile). Making it wait
    // its turn behind background polls put seconds on a tx-free interaction, so it starts now and the background
    // ticker re-arms behind it. Human click rate bounds it; the 429 wave still gates it (is_paused).
    if ((bypass_stagger || priority) && !is_paused()) start(job as PollJob)
    else {
      queue = priority ? [job as PollJob, ...queue] : [...queue, job as PollJob]
      arm(bypass_stagger ? PAUSED_RECHECK_MS : undefined)
    }
    return promise
  }

  const reset = () => {
    const abandoned = [...pending.values()]
    generation += 1
    if (timer != null) clear_timeout(timer)
    timer = null
    last_started_at = Number.NEGATIVE_INFINITY
    queue = []
    started_kinds.clear()
    for (const job of abandoned) job.reject(new DOMException('world poll scheduler reset', 'AbortError'))
    pending.clear()
  }

  return { schedule, promote, reset }
}
