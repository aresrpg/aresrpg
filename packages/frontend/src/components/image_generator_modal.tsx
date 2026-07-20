// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Sparkles, Key, ChevronDown, ChevronRight, X, ImagePlus, Package } from 'lucide-react'
import { item_icon_url } from '@aresrpg/sdk/jobs'
import { slugs } from 'virtual:item_catalog'

import { use_toast } from '../toast'
import {
  enqueue_item_image,
  enqueue_item_texture,
  enqueue_spell_image,
  enqueue_quest_image,
} from '../stores/image_queue'
import { get_gemini_key, set_gemini_key, get_removebg_key, set_removebg_key, ELEMENT_COLORS } from '../services/gemini'
import { cosmetic_icon_of } from '../game/cosmetic_icons.js'

import { use_onchain_templates } from './template_editor/onchain_templates'
import { SearchPickerModal, type PickerItem } from './search_picker_modal'

const MAX_REFERENCE_IMAGE_BYTES = 2 * 1024 * 1024

interface ImageGeneratorModalProps {
  mode: 'item' | 'spell' | 'quest'
  template_type: 'item' | 'spell' | 'quest'
  template_id: string
  template_name: string
  name: string
  item_type?: string
  description?: string
  elements?: string[]
  current_image?: string
  default_prompt?: string
  // Items only: when set, a UV reskin is queued alongside the icon so visible
  // equipment (chestplate/pants/helmet/boots) gets its texture regenerated too.
  appearance?: string
  parent_appearance?: string
  on_reskin_enqueued?: (new_appearance: string, parent: string) => void
  on_close: () => void
}

export function ImageGeneratorModal({
  mode,
  template_type,
  template_id,
  template_name,
  name,
  item_type,
  description,
  elements,
  current_image,
  default_prompt,
  appearance,
  parent_appearance,
  on_reskin_enqueued,
  on_close,
}: ImageGeneratorModalProps) {
  const { t } = useTranslation()
  const [prompt, set_prompt] = useState(default_prompt || '')
  const [validation_error, set_validation_error] = useState<string | null>(null)
  const [keys_open, set_keys_open] = useState(!get_gemini_key())
  const [gemini_key_input, set_gemini_key_input] = useState(get_gemini_key())
  const [removebg_key_input, set_removebg_key_input] = useState(get_removebg_key())
  const [selected_elements, set_selected_elements] = useState<string[]>(elements || [])
  const [reference_image, set_reference_image] = useState<string | null>(null)
  const [reference_preview, set_reference_preview] = useState<string | null>(null)
  const [template_picker_open, set_template_picker_open] = useState(false)
  const [current_image_failed, set_current_image_failed] = useState(false)

  // Reference-image template picker: the LIVE on-chain ItemTemplate list (chain-direct; auto-loads on mount).
  const item_templates = use_onchain_templates('item').data

  useEffect(() => set_current_image_failed(false), [current_image])

  const template_picker_items: PickerItem[] = useMemo(() => {
    if (!Array.isArray(item_templates)) return []
    return item_templates.map((tpl: any) => ({
      id: tpl.id,
      label: tpl.name || tpl.id,
      category: tpl.category || 'ITEM',
    }))
  }, [item_templates])

  useEffect(() => {
    const handle_key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', handle_key)
    return () => window.removeEventListener('keydown', handle_key)
  }, [on_close])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  function handle_overlay_click(e: React.MouseEvent) {
    if (e.target === e.currentTarget) on_close()
  }

  function handle_reference_upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
      set_validation_error(`Reference image too large (max ${MAX_REFERENCE_IMAGE_BYTES / 1024 / 1024}MB)`)
      e.target.value = ''
      return
    }
    set_validation_error(null)
    const reader = new FileReader()
    reader.onload = () => {
      const data_url = reader.result as string
      set_reference_preview(data_url)
      set_reference_image(data_url.replace(/^data:image\/\w+;base64,/, ''))
    }
    reader.readAsDataURL(file)
  }

  async function handle_template_pick(picked_id: string) {
    set_template_picker_open(false)
    try {
      const picked = item_templates?.find((tpl: any) => tpl.id === picked_id)
      const picked_name = String(picked?.name ?? '')
      const template_slug = picked_name ? slugs[picked_name] : undefined
      const icon_slug = cosmetic_icon_of({ slug: template_slug, name: picked_name }) ?? template_slug
      const url = item_icon_url(icon_slug, { hd: true })
      if (!url) return
      const res = await fetch(url)
      if (!res.ok) throw new Error('Image not found')
      const blob = await res.blob()
      const reader = new FileReader()
      reader.onload = () => {
        const data_url = reader.result as string
        set_reference_preview(data_url)
        set_reference_image(data_url.replace(/^data:image\/\w+;base64,/, ''))
      }
      reader.readAsDataURL(blob)
    } catch {
      // Silently fail - template might not have an HD image uploaded yet
    }
  }

  function handle_submit() {
    set_validation_error(null)
    set_gemini_key(gemini_key_input)
    if (mode === 'item') set_removebg_key(removebg_key_input)

    if (!gemini_key_input) {
      set_validation_error(t('queue.gemini_key_required'))
      return
    }
    if (mode === 'item' && !removebg_key_input) {
      set_validation_error(t('queue.removebg_key_required'))
      return
    }

    const desc = prompt.trim()
    if (desc.length < 5 && !reference_image) {
      set_validation_error(t('queue.description_too_short'))
      return
    }

    // Capture everything the closures need — modal unmounts right after enqueue
    const _template_id = template_id
    const _template_name = template_name
    const _template_type = template_type
    const _reference_image = reference_image || undefined
    const _elements = [...selected_elements]
    const _description = description
    const _item_type = item_type
    const _mode = mode

    if (_mode === 'item') {
      enqueue_item_image({
        template_id: _template_id,
        template_name: _template_name,
        item_type: _item_type || 'item',
        description: _description,
        prompt: desc,
        reference_image: _reference_image,
      })
      if (appearance) {
        const _appearance = appearance
        const _parent = parent_appearance
        const _on_reskin_enqueued = on_reskin_enqueued
        enqueue_item_texture({
          template_id: _template_id,
          template_name: _template_name,
          appearance: _appearance,
          parent_appearance: _parent,
          prompt: desc,
          on_enqueued: (new_appearance, parent) => {
            _on_reskin_enqueued?.(new_appearance, parent)
          },
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err)
          use_toast.getState().add(`Reskin failed: ${msg}`, 'error')
        })
      }
    } else if (_mode === 'quest') {
      enqueue_quest_image({
        template_id: _template_id,
        template_name: _template_name,
        description: _description,
        prompt: desc,
        reference_image: _reference_image,
      })
    } else {
      enqueue_spell_image({
        template_id: _template_id,
        template_name: _template_name,
        template_type: _template_type,
        description: _description,
        prompt: desc,
        elements: _elements,
        reference_image: _reference_image,
      })
    }

    use_toast.getState().add(t('queue.queued', { name: _template_name }), 'info')
    on_close()
  }

  return createPortal(
    <div
      role="dialog"
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={handle_overlay_click}
    >
      <div
        className="bg-surface border border-border p-5 min-w-[420px] max-w-[500px] flex flex-col gap-4"
        style={{ animation: 'modal-enter 0.3s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="text-text text-[13px] font-medium tracking-[0.15em] uppercase flex items-center gap-2">
            <Sparkles size={14} className="text-gold opacity-60" />
            <span>GENERATE IMAGE</span>
            <span className="text-gold">{name}</span>
          </div>
          <button
            type="button"
            className="text-muted hover:text-red-400 cursor-pointer transition-colors"
            onClick={on_close}
          >
            <X size={14} />
          </button>
        </div>

        {/* API Keys section */}
        <div className="border border-border">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-muted text-[9px] tracking-[0.2em] uppercase cursor-pointer hover:text-text transition-colors"
            onClick={() => set_keys_open(!keys_open)}
          >
            <Key size={12} />
            <span>API KEYS</span>
            {keys_open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>

          {keys_open && (
            <div className="px-3 pb-3 flex flex-col gap-3">
              <div className="flex gap-3">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-muted text-[9px] tracking-[0.2em] uppercase">GEMINI API KEY</label>
                  <input
                    type="password"
                    className="w-full p-2 bg-white/5 border border-border text-text text-[11px] font-mono outline-none focus:border-gold/30 transition-colors"
                    value={gemini_key_input}
                    onChange={(e) => set_gemini_key_input(e.target.value)}
                    placeholder="AIza..."
                  />
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan text-[8px] tracking-[0.15em] uppercase hover:underline"
                  >
                    Get Gemini key
                  </a>
                </div>

                {mode === 'item' && (
                  <div className="flex-1 flex flex-col gap-1">
                    <label className="text-muted text-[9px] tracking-[0.2em] uppercase">REMOVE.BG API KEY</label>
                    <input
                      type="password"
                      className="w-full p-2 bg-white/5 border border-border text-text text-[11px] font-mono outline-none focus:border-gold/30 transition-colors"
                      value={removebg_key_input}
                      onChange={(e) => set_removebg_key_input(e.target.value)}
                      placeholder="Key..."
                    />
                    <a
                      href="https://www.remove.bg/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan text-[8px] tracking-[0.15em] uppercase hover:underline"
                    >
                      Get remove.bg key
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Preview row */}
        <div className="flex items-center gap-3">
          {current_image &&
            (current_image_failed ? (
              <span className="w-12 h-12 border border-border flex items-center justify-center text-muted/50">
                <Package size={18} aria-hidden="true" />
              </span>
            ) : (
              <img
                src={current_image}
                alt=""
                className="w-12 h-12 border border-border"
                style={mode === 'item' ? { imageRendering: 'pixelated' } : undefined}
                onError={() => set_current_image_failed(true)}
                onLoad={(event) => {
                  if (!event.currentTarget.naturalWidth) set_current_image_failed(true)
                }}
              />
            ))}
          {mode === 'item' && item_type && (
            <span className="px-2 py-1 bg-white/5 border border-border text-muted text-[9px] tracking-[0.15em] uppercase">
              {item_type}
            </span>
          )}
          {mode === 'spell' && (
            <div className="flex gap-1.5">
              {Object.keys(ELEMENT_COLORS).map((el) => {
                const active = selected_elements.includes(el)
                return (
                  <button
                    key={el}
                    type="button"
                    className="px-2 py-1 text-[9px] tracking-[0.15em] uppercase font-semibold border cursor-pointer transition-all"
                    style={{
                      color: active ? (ELEMENT_COLORS[el] ?? '#6b7280') : '#6b7280',
                      borderColor: active ? (ELEMENT_COLORS[el] ?? '#1e1e2e') : '#1e1e2e',
                      backgroundColor: active ? `${ELEMENT_COLORS[el] ?? '#6b7280'}20` : 'transparent',
                      opacity: active ? 1 : 0.4,
                    }}
                    onClick={() =>
                      set_selected_elements((prev) =>
                        prev.includes(el) ? prev.filter((e) => e !== el) : [...prev, el]
                      )
                    }
                  >
                    {el}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Reference image upload */}
        <div className="flex flex-col gap-1">
          <label className="text-muted text-[9px] tracking-[0.2em] uppercase">REFERENCE IMAGE (OPTIONAL)</label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-border text-muted text-[9px] tracking-[0.15em] uppercase cursor-pointer hover:border-gold/30 hover:text-text transition-all">
              <ImagePlus size={12} />
              {reference_preview ? 'CHANGE' : 'UPLOAD'}
              <input type="file" accept="image/*" className="hidden" onChange={handle_reference_upload} />
            </label>
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-border text-muted text-[9px] tracking-[0.15em] uppercase cursor-pointer hover:border-gold/30 hover:text-text transition-all"
              onClick={() => set_template_picker_open(true)}
            >
              <Package size={12} />
              PICK TEMPLATE
            </button>
            {reference_preview && (
              <>
                <img src={reference_preview} alt="" className="w-10 h-10 border border-border object-cover" />
                <button
                  type="button"
                  className="text-muted hover:text-red-400 cursor-pointer transition-colors"
                  onClick={() => {
                    set_reference_image(null)
                    set_reference_preview(null)
                  }}
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Textarea */}
        <div className="flex flex-col gap-1">
          <label className="text-muted text-[9px] tracking-[0.2em] uppercase">VISUAL DESCRIPTION (OPTIONAL)</label>
          <textarea
            className="w-full min-h-[80px] p-3 bg-white/5 border border-border text-text text-[11px] resize-y font-mono outline-none focus:border-gold/30 transition-colors"
            placeholder="Describe the visual style, colors, mood..."
            value={prompt}
            onChange={(e) => set_prompt(e.target.value)}
          />
        </div>

        {/* Validation error */}
        {validation_error && (
          <div className="p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] tracking-[0.1em] font-mono">
            {validation_error}
          </div>
        )}

        {/* Submit button */}
        <button
          type="button"
          className="px-5 py-2 bg-gradient-to-r from-gold-dark to-gold text-bg text-[10px] font-semibold tracking-[0.2em] uppercase cursor-pointer hover:shadow-[0_0_20px_rgba(200,150,60,0.3)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handle_submit}
          disabled={!gemini_key_input}
        >
          GENERATE
        </button>

        {template_picker_open && (
          <SearchPickerModal
            title="Pick Item Template"
            items={template_picker_items}
            value=""
            on_select={handle_template_pick}
            on_close={() => set_template_picker_open(false)}
          />
        )}
      </div>
    </div>,
    document.body
  )
}
