import { create } from 'zustand'

import {
  generate_item_image,
  generate_spell_icon,
  generate_quest_icon,
  remove_background,
  resize_image,
  data_url_to_uint8array,
} from '../services/gemini'
import { save_local_item_image } from '../lib/local_items'

import { use_image_version } from './image_version'

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

const MAX_ACTIVE_TASKS = 20
const READY_TTL_MS = 10 * 60 * 1000
const MAX_CONCURRENT_GENERATIONS = 3
const DEFAULT_VARIANT_COUNT = 3

// ---------------------------------------------------------------------------
//  Types — the store is intentionally dumb: every task carries its own
//  generate() and finalize() closures, so adding a new image kind is a
//  caller-side concern only.
// ---------------------------------------------------------------------------

export type TaskStatus = 'generating' | 'ready' | 'processing' | 'error'

export type PreviewKind = 'checker' | 'plain'

export interface ImageQueueTask {
  id: string
  label: string // display name in the panel
  kind: string // short badge text (e.g. 'ITEM', 'SPELL', 'MOB')
  preview_kind: PreviewKind
  dedup_key: string | null // null → never deduped; siblings allowed in parallel
  status: TaskStatus
  variants: string[]
  picked_index: number | null
  finalize_attempt: number
  error?: string
  created_at: number
  prompt?: string // original prompt text (for pre-filling reroll textarea)
  on_reroll?: (prompt: string) => void // callback to re-enqueue with new prompt
  // Closures captured at enqueue time
  generate: () => Promise<string[]>
  finalize: (picked_variant: string) => Promise<void>
}

export interface EnqueueParams {
  label: string
  kind: string
  preview_kind?: PreviewKind
  dedup_key?: string | null
  prompt?: string
  on_reroll?: (prompt: string) => void
  generate: () => Promise<string[]>
  finalize: (picked_variant: string) => Promise<void>
}

export type ImageQueueInput =
  | Readonly<{ type: 'finalize_succeeded'; task_id: string; finalize_attempt: number }>
  | Readonly<{ type: 'finalize_failed'; task_id: string; finalize_attempt: number; error: string }>

interface ImageQueueState {
  tasks: Record<string, ImageQueueTask>
  panel_collapsed: boolean

  enqueue: (params: EnqueueParams) => string
  select_variant: (task_id: string, variant_index: number) => void
  retry: (task_id: string) => void
  dismiss: (task_id: string) => void
  set_panel_collapsed: (collapsed: boolean) => void
  input: (message: ImageQueueInput) => void
}

// ---------------------------------------------------------------------------
//  Variant helper — runs fn N times in parallel, tolerates partial failure,
//  throws only if every attempt fails.
// ---------------------------------------------------------------------------

export async function generate_variants<T>(fn: () => Promise<T>, count: number = DEFAULT_VARIANT_COUNT): Promise<T[]> {
  const settled = await Promise.allSettled(Array.from({ length: count }, () => fn()))
  const results: T[] = []
  const errors: string[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled') results.push(r.value)
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
  }
  if (results.length === 0) throw new Error(errors[0] || 'All generations failed')
  return results
}

// ---------------------------------------------------------------------------
//  FIFO eviction — generating tasks are never evicted
// ---------------------------------------------------------------------------

const STATUS_EVICT_PRIORITY: Record<TaskStatus, number> = {
  error: 0,
  ready: 1,
  processing: 2,
  generating: 99,
}

function evict_if_full(tasks: Record<string, ImageQueueTask>): Record<string, ImageQueueTask> {
  const entries = Object.values(tasks)
  if (entries.length < MAX_ACTIVE_TASKS) return tasks
  const sorted = [...entries].sort((a, b) => {
    const pa = STATUS_EVICT_PRIORITY[a.status]
    const pb = STATUS_EVICT_PRIORITY[b.status]
    if (pa !== pb) return pa - pb
    return a.created_at - b.created_at
  })
  const [victim] = sorted
  if (!victim || victim.status === 'generating') return tasks
  const next = { ...tasks }
  delete next[victim.id]
  return next
}

export function reduce_image_queue(
  state: Readonly<ImageQueueState>,
  message: ImageQueueInput
): Readonly<ImageQueueState> {
  const task = state.tasks[message.task_id]
  if (!task || task.status !== 'processing' || task.finalize_attempt !== message.finalize_attempt) return state
  if (message.type === 'finalize_succeeded') {
    const tasks = Object.fromEntries(Object.entries(state.tasks).filter(([task_id]) => task_id !== message.task_id))
    return { ...state, tasks }
  }
  return {
    ...state,
    tasks: {
      ...state.tasks,
      [message.task_id]: { ...task, status: 'error', error: message.error },
    },
  }
}

// ---------------------------------------------------------------------------
//  Store
// ---------------------------------------------------------------------------

export const use_image_queue = create<ImageQueueState>((set, get) => ({
  tasks: {},
  panel_collapsed: false,

  enqueue: (params) => {
    const id = crypto.randomUUID()
    const dedup_key = params.dedup_key ?? null

    set((s) => {
      // Latest-intent-wins: drop any pre-existing ready task with the same key
      const filtered: Record<string, ImageQueueTask> = {}
      for (const [tid, task] of Object.entries(s.tasks)) {
        if (dedup_key && task.status === 'ready' && task.dedup_key === dedup_key) continue
        filtered[tid] = task
      }

      const capped = evict_if_full(filtered)

      const new_task: ImageQueueTask = {
        id,
        label: params.label,
        kind: params.kind,
        preview_kind: params.preview_kind ?? 'plain',
        dedup_key,
        status: 'generating',
        variants: [],
        picked_index: null,
        finalize_attempt: 0,
        created_at: Date.now(),
        prompt: params.prompt,
        on_reroll: params.on_reroll,
        generate: params.generate,
        finalize: params.finalize,
      }

      return { tasks: { ...capped, [id]: new_task } }
    })

    run_generation_throttled(id).catch((err) => console.error('image_queue: run_generation crashed', err))
    return id
  },

  select_variant: (task_id, variant_index) => {
    const task = get().tasks[task_id]
    if (!task || task.status !== 'ready') return
    if (!task.variants[variant_index]) return

    set((s) => {
      const existing = s.tasks[task_id]
      if (!existing) return s
      return {
        tasks: {
          ...s.tasks,
          [task_id]: {
            ...existing,
            status: 'processing',
            picked_index: variant_index,
            finalize_attempt: existing.finalize_attempt + 1,
            error: undefined,
          },
        },
      }
    })

    enqueue_finalize(task_id)
  },

  retry: (task_id) => {
    const task = get().tasks[task_id]
    if (!task || task.status !== 'error') return

    const resume_finalize = task.variants.length > 0 && task.picked_index != null

    set((s) => {
      const existing = s.tasks[task_id]
      if (!existing) return s
      return {
        tasks: {
          ...s.tasks,
          [task_id]: resume_finalize
            ? {
                ...existing,
                status: 'processing',
                finalize_attempt: existing.finalize_attempt + 1,
                error: undefined,
              }
            : {
                ...existing,
                status: 'generating',
                variants: [],
                picked_index: null,
                error: undefined,
              },
        },
      }
    })

    if (resume_finalize) {
      enqueue_finalize(task_id)
    } else {
      run_generation_throttled(task_id).catch((err) => console.error('image_queue: run_generation crashed', err))
    }
  },

  dismiss: (task_id) => {
    set((s) => {
      if (!s.tasks[task_id]) return s
      const next = { ...s.tasks }
      delete next[task_id]
      return { tasks: next }
    })
  },

  set_panel_collapsed: (collapsed) => set({ panel_collapsed: collapsed }),
  input: (message) => set((state) => reduce_image_queue(state, message)),
}))

// ---------------------------------------------------------------------------
//  Worker: generation (throttled)
// ---------------------------------------------------------------------------

let active_generations = 0
const generation_queue: string[] = []

async function run_generation_throttled(task_id: string): Promise<void> {
  if (active_generations >= MAX_CONCURRENT_GENERATIONS) {
    generation_queue.push(task_id)
    return
  }
  active_generations++
  try {
    await run_generation(task_id)
  } finally {
    active_generations--
    const next = generation_queue.shift()
    if (next) {
      run_generation_throttled(next).catch((err) => console.error('image_queue: run_generation crashed', err))
    }
  }
}

async function run_generation(task_id: string): Promise<void> {
  const task = use_image_queue.getState().tasks[task_id]
  if (!task) return

  try {
    const variants = await task.generate()
    if (variants.length === 0) throw new Error('No variants returned')

    use_image_queue.setState((s) => {
      const existing = s.tasks[task_id]
      if (!existing) return s
      return {
        tasks: {
          ...s.tasks,
          [task_id]: { ...existing, status: 'ready', variants, error: undefined },
        },
      }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Generation failed'
    use_image_queue.setState((s) => {
      const existing = s.tasks[task_id]
      if (!existing) return s
      return {
        tasks: {
          ...s.tasks,
          [task_id]: { ...existing, status: 'error', error: msg },
        },
      }
    })
  }
}

// ---------------------------------------------------------------------------
//  Worker: finalize (serial — one at a time so closures that observe shared
//  admin_data slots don't cross streams)
// ---------------------------------------------------------------------------

let finalize_in_flight = false
const finalize_queue: string[] = []

function enqueue_finalize(task_id: string): void {
  finalize_queue.push(task_id)
  drain_finalize_queue()
}

function drain_finalize_queue(): void {
  if (finalize_in_flight) return
  const next = finalize_queue.shift()
  if (!next) return
  finalize_in_flight = true
  run_finalize(next)
    .catch((err) => console.error('image_queue: run_finalize crashed', err))
    .finally(() => {
      finalize_in_flight = false
      drain_finalize_queue()
    })
}

async function run_finalize(task_id: string): Promise<void> {
  const task = use_image_queue.getState().tasks[task_id]
  if (!task || task.status !== 'processing' || task.picked_index == null) return
  const picked = task.variants[task.picked_index]
  if (!picked) return
  const { finalize_attempt } = task

  try {
    await task.finalize(picked)
    use_image_queue.getState().input({ type: 'finalize_succeeded', task_id, finalize_attempt })
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Save failed'
    use_image_queue.getState().input({ type: 'finalize_failed', task_id, finalize_attempt, error })
  }
}

// ---------------------------------------------------------------------------
//  Image persist — #96: LOCAL-FIRST. "Generate with AI" no longer round-trips a backend; it saves the
//  generated PNGs (normal 64px + HD full-res) to the repo's local seed image dir via the DEV-ONLY
//  local_content_plugin middleware. The admin later PUBLISHES the item — the mint PTB signs while the middleware
//  uploads these PNGs to the asset storage bucket (skipping any id already there). ItemImage falls back to the local
//  endpoint until the bucket has it, so the generated icon shows immediately. Non-item kinds (spell/quest) have
//  no local-author path yet (out of #96 scope) — they still fail honestly rather than pretend to upload.
// ---------------------------------------------------------------------------

export async function save_template_image(
  template_type: 'item' | 'spell' | 'quest',
  template_id: string,
  game_bytes: Uint8Array,
  hd_bytes: Uint8Array
): Promise<void> {
  if (template_type !== 'item')
    throw new Error(`Image upload for ${template_type} has no local-authoring path yet (icons come from the CDN)`)
  // normal (game, 64px) → items/{id}.png ; HD (full-res) → items/{id}_hd.png
  // Re-encode both through canvas first (2026-07-13): `hd_bytes` here is the RAW remove.bg response — it
  // never passes through a browser canvas, so it ships whatever encoder remove.bg's server used. The
  // 2026-07-13 compression audit measured the live CDN average at 602 KB/icon (worst case 3.3 MB) for what
  // should be ~50-200 KB icons, root-caused to exactly this gap. `canvas.toBlob('image/png')` round-trips
  // the same pixels through Chromium's own PNG/zlib encoder and reliably cuts 30-60% for free — still
  // lossless 32-bit RGBA (no palette quantization; that needs a native binary like pngquant/oxipng, which a
  // backend-less browser build has no way to run — WebP was considered but rejected: every consumer
  // (ItemImage, admin previews, the local dev middleware's publish upload) hardcodes a `.png` extension and
  // `Content-Type: image/png`, so shipping WebP bytes here would silently break all of them).
  const [game_out, hd_out] = await Promise.all([reencode_png(game_bytes), reencode_png(hd_bytes)])
  await save_local_item_image(template_id, game_out, false)
  await save_local_item_image(template_id, hd_out, true)
}

/** Re-encode PNG bytes through an offscreen canvas (see save_template_image). Never throws — falls back to
 * the original bytes (with a console warning) so a rare canvas failure degrades size, not correctness. */
async function reencode_png(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    // TS 5.9's generic Uint8Array<ArrayBufferLike> doesn't structurally satisfy BlobPart (a lib.dom typings
    // gap, not a runtime issue — Blob has always accepted any typed array) — the cast is the standard workaround.
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const out_blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!out_blob) throw new Error('canvas.toBlob returned null')
    return new Uint8Array(await out_blob.arrayBuffer())
  } catch (err) {
    console.warn('image_queue: PNG re-encode failed, saving original bytes', err)
    return bytes
  }
}

// ---------------------------------------------------------------------------
//  Shared enqueue helpers — encapsulate the gen_fn / finalize_fn / do_enqueue
//  pattern so callers (ImageGeneratorModal, quick_generate_icon, etc.) don't
//  duplicate the wiring.
// ---------------------------------------------------------------------------

export interface EnqueueItemImageParams {
  template_id: string
  template_name: string
  item_type: string
  description?: string
  prompt: string
  reference_image?: string
}

export interface EnqueueSpellImageParams {
  template_id: string
  template_name: string
  template_type: string
  description?: string
  prompt: string
  elements: string[]
  reference_image?: string
}

export interface EnqueueQuestImageParams {
  template_id: string
  template_name: string
  description?: string
  prompt: string
  reference_image?: string
}

export function enqueue_item_image(params: EnqueueItemImageParams): void {
  function do_enqueue(style_desc: string) {
    const gen_params = {
      item_name: params.template_name,
      item_type: params.item_type,
      description: params.description,
      prompt: style_desc || 'A detailed fantasy RPG item',
      reference_image: params.reference_image,
    }
    const gen_fn = () => generate_variants(() => generate_item_image(gen_params))
    const finalize_fn = async (picked: string) => {
      const hd = await remove_background(picked)
      const game = await resize_image(hd, 64, 64)
      await save_template_image('item', params.template_id, data_url_to_uint8array(game), data_url_to_uint8array(hd))
      use_image_version.getState().bump_image_version(params.template_id)
    }

    use_image_queue.getState().enqueue({
      label: params.template_name,
      kind: 'ITEM',
      preview_kind: 'checker',
      dedup_key: params.template_id,
      prompt: style_desc,
      on_reroll: (new_prompt) => do_enqueue(new_prompt),
      generate: gen_fn,
      finalize: finalize_fn,
    })
  }

  do_enqueue(params.prompt)
}

export function enqueue_spell_image(params: EnqueueSpellImageParams): void {
  function do_enqueue(style_desc: string) {
    const gen_params = {
      spell_name: params.template_name,
      description: params.description,
      prompt: style_desc || 'A magical spell effect',
      elements: params.elements,
      reference_image: params.reference_image,
    }
    const gen_fn = () => generate_variants(() => generate_spell_icon(gen_params))
    const finalize_fn = async (picked: string) => {
      const game = await resize_image(picked, 128, 128)
      await save_template_image(
        params.template_type as 'spell',
        params.template_id,
        data_url_to_uint8array(game),
        data_url_to_uint8array(picked)
      )
      use_image_version.getState().bump_image_version(params.template_id)
    }

    use_image_queue.getState().enqueue({
      label: params.template_name,
      kind: 'SPELL',
      preview_kind: 'plain',
      dedup_key: params.template_id,
      prompt: style_desc,
      on_reroll: (new_prompt) => do_enqueue(new_prompt),
      generate: gen_fn,
      finalize: finalize_fn,
    })
  }

  do_enqueue(params.prompt)
}

export function enqueue_quest_image(params: EnqueueQuestImageParams): void {
  function do_enqueue(style_desc: string) {
    const gen_params = {
      quest_name: params.template_name,
      description: params.description,
      prompt: style_desc || 'A compelling quest icon',
      reference_image: params.reference_image,
    }
    const gen_fn = () => generate_variants(() => generate_quest_icon(gen_params))
    const finalize_fn = async (picked: string) => {
      const game = await resize_image(picked, 64, 64)
      await save_template_image(
        'quest',
        params.template_id,
        data_url_to_uint8array(game),
        data_url_to_uint8array(picked)
      )
      use_image_version.getState().bump_image_version(params.template_id)
    }

    use_image_queue.getState().enqueue({
      label: params.template_name,
      kind: 'QUEST',
      preview_kind: 'plain',
      dedup_key: params.template_id,
      prompt: style_desc,
      on_reroll: (new_prompt) => do_enqueue(new_prompt),
      generate: gen_fn,
      finalize: finalize_fn,
    })
  }

  do_enqueue(params.prompt)
}

// ---------------------------------------------------------------------------
//  Item UV reskin — RETIRED with the WS backend.
//  The reskin pipeline pre-fetched the vanilla texture from the asset bucket (via the admin WS) and, on finalize, uploaded
//  the AI-generated appearance back to the asset bucket + rewired the ItemTemplate. Both endpoints are gone in the on-chain
//  build (and ItemTemplate is immutable on-chain), so the whole flow can't run. It throws early with a clear
//  message; callers (template editor GENERATE ICON, item editor texture modal) already toast the failure.
// ---------------------------------------------------------------------------

export interface EnqueueItemTextureParams {
  template_id: string
  template_name: string
  appearance: string
  parent_appearance?: string
  prompt: string
  on_enqueued?: (new_appearance: string, parent: string) => void
}

export async function enqueue_item_texture(_params: EnqueueItemTextureParams): Promise<void> {
  // UV reskin stays retired (out of #96 scope — that feature rewrote an ItemTemplate's texture via the WS
  // backend + the asset bucket; templates are immutable on-chain and the backend is gone). Icon generation is local (#96).
  throw new Error('Item UV reskin requires the (retired) backend — not available in the on-chain build')
}

// ---------------------------------------------------------------------------
//  TTL sweep — evict stale ready tasks every 60s
// ---------------------------------------------------------------------------

setInterval(() => {
  const now = Date.now()
  use_image_queue.setState((s) => {
    let changed = false
    const next: Record<string, ImageQueueTask> = {}
    for (const [id, task] of Object.entries(s.tasks)) {
      if (task.status === 'ready' && now - task.created_at > READY_TTL_MS) {
        changed = true
        continue
      }
      next[id] = task
    }
    if (!changed) return s
    return { tasks: next }
  })
}, 60_000)
