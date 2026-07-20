import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, X, Zap, AlertCircle, Loader2, RefreshCw } from 'lucide-react'

import { use_image_queue, type ImageQueueTask } from '../stores/image_queue'

// ---------------------------------------------------------------------------
//  Task row
// ---------------------------------------------------------------------------

interface TaskRowProps {
  task: ImageQueueTask
  animate: boolean
  on_pick: (variant_index: number) => void
  on_retry: () => void
  on_dismiss: () => void
  on_reroll?: (prompt: string) => void
  initial_prompt?: string
}

function TaskRow({ task, animate, on_pick, on_retry, on_dismiss, on_reroll, initial_prompt }: TaskRowProps) {
  const { t } = useTranslation()
  const [reroll_open, set_reroll_open] = useState(false)
  const [reroll_prompt, set_reroll_prompt] = useState(initial_prompt || '')
  const textarea_ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (reroll_open && textarea_ref.current) {
      textarea_ref.current.focus()
    }
  }, [reroll_open])

  function handle_regenerate() {
    if (!on_reroll) return
    on_reroll(reroll_prompt)
    on_dismiss()
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 border-b border-border/60 last:border-b-0">
      {/* Header: kind + label + dismiss */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-1.5 py-0.5 border border-gold/40 text-gold text-[8px] tracking-[0.2em] uppercase font-mono shrink-0">
            {task.kind}
          </span>
          <span className="text-text text-[10px] tracking-[0.1em] uppercase font-mono truncate">{task.label}</span>
        </div>
        <button
          type="button"
          onClick={on_dismiss}
          className="text-muted hover:text-red-400 cursor-pointer transition-colors shrink-0"
          title={t('queue.dismiss')}
        >
          <X size={12} />
        </button>
      </div>

      {/* Body by status */}
      {task.status === 'generating' && (
        <div
          className={`h-10 w-full bg-gold/5 border border-gold/20 ${animate ? 'animate-pulse' : ''} flex items-center justify-center`}
        >
          <div className="text-gold/70 text-[9px] tracking-[0.2em] uppercase font-mono flex items-center gap-2">
            <Loader2 size={10} className={animate ? 'animate-spin' : ''} />
            {t('queue.generating')}
          </div>
        </div>
      )}

      {task.status === 'ready' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            {task.variants.map((variant_url, i) => (
              <button
                key={i}
                type="button"
                onClick={() => on_pick(i)}
                className="relative border border-border hover:border-gold hover:shadow-[0_0_20px_rgba(200,150,60,0.3)] cursor-pointer transition-all overflow-hidden"
              >
                {task.preview_kind === 'checker' ? (
                  <div
                    className="w-full"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='8' height='8' fill='%23222'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%23222'/%3E%3Crect x='8' width='8' height='8' fill='%23333'/%3E%3Crect y='8' width='8' height='8' fill='%23333'/%3E%3C/svg%3E")`,
                      backgroundSize: '16px 16px',
                    }}
                  >
                    <img src={variant_url} alt="" className="w-full h-auto block" />
                  </div>
                ) : (
                  <img src={variant_url} alt="" className="w-full h-auto block bg-bg" />
                )}
              </button>
            ))}
          </div>

          {on_reroll && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => set_reroll_open(!reroll_open)}
                className="self-start px-2.5 py-1 border border-gold/40 text-gold text-[9px] tracking-[0.2em] uppercase font-mono hover:border-gold hover:shadow-[0_0_20px_rgba(200,150,60,0.3)] cursor-pointer transition-all flex items-center gap-1.5"
              >
                <RefreshCw size={10} />
                {t('queue.reroll')}
              </button>

              {reroll_open && (
                <div className="flex flex-col gap-2">
                  <textarea
                    ref={textarea_ref}
                    className="w-full min-h-[60px] p-2 bg-white/5 border border-border text-text text-[11px] resize-y font-mono outline-none focus:border-gold/30 transition-colors"
                    placeholder={t('queue.reroll_placeholder')}
                    value={reroll_prompt}
                    onChange={(e) => set_reroll_prompt(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handle_regenerate}
                    className="self-start px-3 py-1.5 bg-gradient-to-r from-gold-dark to-gold text-bg text-[9px] font-semibold tracking-[0.2em] uppercase cursor-pointer hover:shadow-[0_0_20px_rgba(200,150,60,0.3)] transition-all"
                  >
                    {t('queue.regenerate')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {task.status === 'processing' && (
        <div className="h-10 w-full bg-cyan/5 border border-cyan/20 flex items-center justify-center">
          <div className="text-cyan text-[9px] tracking-[0.2em] uppercase font-mono flex items-center gap-2">
            <Loader2 size={10} className={animate ? 'animate-spin' : ''} />
            {t('queue.processing')}
          </div>
        </div>
      )}

      {task.status === 'error' && (
        <div className="flex flex-col gap-2">
          <div className="px-2 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 text-[9px] tracking-[0.1em] font-mono flex items-start gap-1.5">
            <AlertCircle size={10} className="shrink-0 mt-0.5" />
            <span className="break-words">{task.error || t('queue.error')}</span>
          </div>
          <button
            type="button"
            onClick={on_retry}
            className="self-start px-2.5 py-1 border border-gold/40 text-gold text-[9px] tracking-[0.2em] uppercase font-mono hover:border-gold hover:shadow-[0_0_20px_rgba(200,150,60,0.3)] cursor-pointer transition-all flex items-center gap-1.5"
          >
            <RefreshCw size={10} />
            {t('queue.retry')}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Panel
// ---------------------------------------------------------------------------

export function ImageQueuePanel() {
  const tasks_record = use_image_queue((s) => s.tasks)
  const collapsed = use_image_queue((s) => s.panel_collapsed)
  const set_collapsed = use_image_queue((s) => s.set_panel_collapsed)
  const select_variant = use_image_queue((s) => s.select_variant)
  const retry = use_image_queue((s) => s.retry)
  const dismiss = use_image_queue((s) => s.dismiss)
  const { t } = useTranslation()

  const tasks = Object.values(tasks_record).sort((a, b) => b.created_at - a.created_at)

  // Esc collapses the panel — but only if no modal is open
  useEffect(() => {
    const on_key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (collapsed) return
      // If a modal is mounted, let it handle Esc first
      if (document.querySelector('[role="dialog"]')) return
      set_collapsed(true)
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [collapsed, set_collapsed])

  if (tasks.length === 0) return null

  const generating_count = tasks.filter((x) => x.status === 'generating').length
  const ready_count = tasks.filter((x) => x.status === 'ready').length
  const error_count = tasks.filter((x) => x.status === 'error').length
  const processing_count = tasks.filter((x) => x.status === 'processing').length

  if (collapsed) {
    const label =
      error_count > 0
        ? t('queue.pill_error', { count: error_count })
        : ready_count > 0
          ? t('queue.pill_ready', { count: ready_count })
          : processing_count > 0
            ? t('queue.processing')
            : t('queue.pill_generating', { count: generating_count })
    return (
      <button
        type="button"
        onClick={() => set_collapsed(false)}
        className="fixed bottom-4 right-4 z-[60] px-4 py-2 bg-surface border border-gold/40 text-gold text-[10px] tracking-[0.2em] uppercase font-mono hover:border-gold hover:shadow-[0_0_20px_rgba(200,150,60,0.3)] transition-all cursor-pointer"
      >
        [ <Zap size={10} className="inline mb-0.5 opacity-60" /> {label} ]
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[380px] max-w-[calc(100vw-2rem)] max-h-[70vh] glass-panel flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="text-gold text-[10px] tracking-[0.2em] uppercase font-mono flex items-center gap-2">
          <Zap size={12} className="opacity-60" />
          {t('queue.title')} ({tasks.length})
        </div>
        <button
          type="button"
          onClick={() => set_collapsed(true)}
          className="text-muted hover:text-gold cursor-pointer transition-colors"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {tasks.map((task, idx) => (
          <TaskRow
            key={task.id}
            task={task}
            animate={idx < 3}
            on_pick={(i) => {
              void select_variant(task.id, i)
            }}
            on_retry={() => retry(task.id)}
            on_dismiss={() => dismiss(task.id)}
            on_reroll={task.on_reroll ? (prompt) => task.on_reroll!(prompt) : undefined}
            initial_prompt={task.prompt}
          />
        ))}
      </div>
    </div>
  )
}
