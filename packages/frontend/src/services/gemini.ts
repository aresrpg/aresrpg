/** Gemini model for image generation/editing — Gemini 3 Pro ONLY (never flash/2.x).
 *  gemini-3-pro-image = Nano Banana Pro, the stable flagship (verified ai.google.dev 2026-07-10). */
export const GENERATE_MODEL = 'gemini-3-pro-image'

/** Element colors for spell icon backgrounds */
export const ELEMENT_COLORS: Record<string, string> = {
  WATER: '#3b82f6',
  AIR: '#84cc16',
  EARTH: '#8B4513',
  FIRE: '#ef4444',
}

// ---------------------------------------------------------------------------
//  localStorage key helpers
// ---------------------------------------------------------------------------

export function get_gemini_key(): string {
  return localStorage.getItem('ares_gemini_key') || ''
}

export function set_gemini_key(key: string) {
  localStorage.setItem('ares_gemini_key', key)
}

export function get_removebg_key(): string {
  return localStorage.getItem('ares_removebg_key') || ''
}

export function set_removebg_key(key: string) {
  localStorage.setItem('ares_removebg_key', key)
}

// ---------------------------------------------------------------------------
//  Element gradient helper
// ---------------------------------------------------------------------------

export function get_element_gradient(elements: string[]): string {
  if (elements.length === 0) return '#333333'
  const [first] = elements
  if (elements.length === 1) return (first && ELEMENT_COLORS[first]) ?? '#333333'
  const colors = elements.map((e) => ELEMENT_COLORS[e] ?? '#333333')
  return `linear-gradient(135deg, ${colors.join(', ')})`
}

// ---------------------------------------------------------------------------
//  Gemini API types
// ---------------------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        inlineData?: { mimeType: string; data: string }
      }>
    }
  }>
  error?: { message: string }
}

interface GeminiImageConfig {
  aspectRatio?: string
  imageSize?: string
}

interface CallGeminiOptions {
  config?: GeminiImageConfig
  images?: Array<{ mimeType: string; data: string }>
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
//  Core API call helper
// ---------------------------------------------------------------------------

async function call_gemini_image(prompt: string, options: CallGeminiOptions = {}): Promise<string> {
  const { config = {}, images, signal } = options
  const api_key = get_gemini_key()
  if (!api_key) throw new Error('Gemini API key not configured. Add it in Settings.')

  // Images must come BEFORE text for Gemini to treat them as reference
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = []
  if (images) parts.push(...images.map((img) => ({ inlineData: img })))
  parts.push({ text: prompt })

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(Object.keys(config).length > 0 && { imageConfig: config }),
    },
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GENERATE_MODEL}:generateContent?key=${api_key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    }
  )

  const result = (await response.json()) as GeminiResponse
  if (result.error) throw new Error(`Gemini API Error: ${result.error.message}`)

  const image_part = result.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
  if (!image_part?.inlineData?.data) throw new Error('No image data in Gemini response')

  const mime = image_part.inlineData.mimeType || 'image/png'
  return `data:${mime};base64,${image_part.inlineData.data}`
}

// ---------------------------------------------------------------------------
//  Item image generation
// ---------------------------------------------------------------------------

export interface GenerateItemImageParams {
  item_name: string
  item_type: string
  description?: string
  prompt: string
  reference_image?: string
}

const ITEM_IMAGE_PROMPT = `Create a large, bold fantasy RPG item icon.
STYLE: Hand-drawn pixelart aesthetic, thick black outlines, flat colors with simple shading, low detail, chunky proportions.
SIZE: Item must fill 95% of the canvas - MASSIVE and prominent, fills entire frame.
ITEM: ITEM_TYPE - USER_PROMPT
CRITICAL: PURE WHITE (#FFFFFF) background, perfectly centered, no shadows on background, clean crisp edges.
FORBIDDEN: No text, no letters, no numbers, no words, no realistic rendering, no complex gradients, no tiny items, no excessive detail.`

export async function generate_item_image(params: GenerateItemImageParams): Promise<string> {
  let prompt = ITEM_IMAGE_PROMPT.replace('ITEM_TYPE', params.item_type).replace(
    'USER_PROMPT',
    params.prompt || 'A detailed fantasy item'
  )
  const images = params.reference_image ? [{ mimeType: 'image/png', data: params.reference_image }] : undefined
  if (images)
    prompt +=
      '\nREFERENCE: Use the provided image as visual inspiration. Match its shape, colors and concept but render in the pixelart style described above.'
  return call_gemini_image(prompt, { config: { aspectRatio: '1:1', imageSize: '1K' }, images })
}

// ---------------------------------------------------------------------------
//  Spell icon generation
// ---------------------------------------------------------------------------

export interface GenerateSpellIconParams {
  spell_name: string
  description?: string
  prompt: string
  elements: string[]
  reference_image?: string
}

function build_spell_color_instruction(elements: string[]): string {
  const [first] = elements
  if (elements.length === 1 && first) {
    return `${first.toLowerCase()}-themed gradient from ${ELEMENT_COLORS[first] ?? '#333'} with darker edges`
  } else if (elements.length > 1) {
    return `gradient blending ${elements.map((e) => e.toLowerCase()).join('/')}: ${elements
      .map((e) => ELEMENT_COLORS[e] ?? '#333')
      .join(' to ')}`
  }
  return 'rich gradient from deep purple through vibrant blue to cyan'
}

const SPELL_ICON_PROMPT = `Create a mobile game spell icon (Hearthstone/Clash Royale style).
FULL BLEED: Artwork must extend to ALL edges - NO empty space, NO background color showing, seamless square.
STYLE: Rich fantasy art, bold central element, vibrant with soft glow, painterly with dramatic lighting.
FORBIDDEN: No empty corners, no round/circular shapes, no borders, no text, no background colors.
Color Palette: COLOR_INSTRUCTION
Spell: SPELL_NAME SPELL_DESC
Direction: USER_PROMPT`

export async function generate_spell_icon(params: GenerateSpellIconParams): Promise<string> {
  let prompt = SPELL_ICON_PROMPT.replace('COLOR_INSTRUCTION', build_spell_color_instruction(params.elements))
    .replace('SPELL_NAME', params.spell_name)
    .replace('SPELL_DESC', params.description ? `\nConcept: ${params.description}` : '')
    .replace('USER_PROMPT', params.prompt)
  const images = params.reference_image ? [{ mimeType: 'image/png', data: params.reference_image }] : undefined
  if (images)
    prompt +=
      '\nREFERENCE: Use the provided image as visual inspiration. Match its mood, composition and concept but render in the spell icon style described above.'
  return call_gemini_image(prompt, { config: { aspectRatio: '1:1', imageSize: '1K' }, images })
}

// ---------------------------------------------------------------------------
//  Quest icon generation
// ---------------------------------------------------------------------------

export interface GenerateQuestIconParams {
  quest_name: string
  description?: string
  prompt: string
  reference_image?: string
}

const QUEST_ICON_PROMPT = `Create a square quest icon for a fantasy MMORPG storybook journal.
FULL BLEED: Artwork must fill the ENTIRE square with a warm parchment/sepia background.
STYLE: Pixel art in monochrome ink-on-parchment style. Single accent color: warm gold (#c9a04e). Everything else in dark brown ink (#3a2a1a) on light parchment (#f0e6d0). Crisp clean pixels, 1-2px outlines, dithering for shading instead of gradients. Think pixel art reimagining of medieval manuscript marginalia — old explorer's journal sketches rendered in chunky retro pixels.
PALETTE: STRICTLY 3 colors only — dark brown ink, parchment background, gold accent for highlights/glows. No other colors allowed.
COMPOSITION: A single symbolic scene or object that represents the quest concept. Simple, iconic, immediately readable at 32x32. Center the subject with generous negative space.
Examples: a lone sword planted in earth, a winding forest trail, an open book with light, a coin stack beside scales, a dungeon archway, two hands clasping, a mortar and pestle.
MOOD: Ancient, wise, like a page from a weathered adventure journal. Quiet elegance, not flashy.
Quest: QUEST_NAME
QUEST_DESC
Direction: USER_PROMPT
FORBIDDEN: No text, no letters, no numbers, no words, no UI elements, no borders, no frames, no rounded corners, no color outside the 3-color palette. Pure ink-on-parchment aesthetic.`

export async function generate_quest_icon(params: GenerateQuestIconParams): Promise<string> {
  let prompt = QUEST_ICON_PROMPT.replace('QUEST_NAME', params.quest_name)
    .replace('QUEST_DESC', params.description ? `Concept: ${params.description}` : '')
    .replace('USER_PROMPT', params.prompt || 'A compelling quest icon')
  const images = params.reference_image ? [{ mimeType: 'image/png', data: params.reference_image }] : undefined
  if (images)
    prompt +=
      '\nREFERENCE: Use the provided image as visual inspiration. Match its mood and composition but render in the quest icon style described above.'
  return call_gemini_image(prompt, { config: { aspectRatio: '1:1', imageSize: '1K' }, images })
}

// ---------------------------------------------------------------------------
//  Mob texture generation
// ---------------------------------------------------------------------------

export interface GenerateMobTextureParams {
  style_prompt: string
  reference_image: string // base64 (no data: prefix) of the vanilla texture
  width: number
  height: number
}

const MOB_TEXTURE_PROMPT = `Update this image: recolor the creature's body regions with a new color palette. Do not change anything else.

This is a game mob's UV texture map. Keep the EXACT same pixel layout — same shapes, same edges, same region boundaries, same dimensions. Only change the colors within existing painted areas. The dark background areas must stay untouched. Maintain the pixelart style.

Color direction: USER_PROMPT`

export async function generate_mob_texture(params: GenerateMobTextureParams): Promise<string> {
  const size_hint = `\nCRITICAL: The input image is ${params.width}x${params.height} pixels. Your output MUST match this exact resolution and aspect ratio. Do NOT upscale or change dimensions.`
  const prompt =
    MOB_TEXTURE_PROMPT.replace(
      'USER_PROMPT',
      params.style_prompt || 'A fantasy creature variant with unique coloring'
    ) + size_hint
  const images = [{ mimeType: 'image/png', data: params.reference_image }]
  return call_gemini_image(prompt, {
    config: { aspectRatio: closest_aspect_ratio(params.width, params.height) },
    images,
  })
}

// ---------------------------------------------------------------------------
//  Item texture generation (UV reskin)
// ---------------------------------------------------------------------------

export interface GenerateItemTextureParams {
  style_prompt: string
  reference_image: string
  width: number
  height: number
}

const ITEM_TEXTURE_PROMPT = `Update this image: recolor each UV region with a new color palette. Do not change anything else.

This is a game item's UV texture atlas. Keep the EXACT same pixel layout — same shapes, same edges, same region boundaries, same dimensions. Only change the colors within existing painted areas. The dark/transparent background padding must stay untouched. Do not bleed colors across region boundaries. Maintain the pixelart style.

Color direction: USER_PROMPT`

export async function generate_item_texture(params: GenerateItemTextureParams): Promise<string> {
  const size_hint = `\nCRITICAL: The input image is ${params.width}x${params.height} pixels. Your output MUST match this exact resolution and aspect ratio. Do NOT upscale or change dimensions.`
  const prompt =
    ITEM_TEXTURE_PROMPT.replace('USER_PROMPT', params.style_prompt || 'A fantasy item variant with unique coloring') +
    size_hint
  const images = [{ mimeType: 'image/png', data: params.reference_image }]
  return call_gemini_image(prompt, {
    config: { aspectRatio: closest_aspect_ratio(params.width, params.height) },
    images,
  })
}

// ---------------------------------------------------------------------------
//  Block texture generation (sprite reskin)
// ---------------------------------------------------------------------------

export interface GenerateBlockTextureParams {
  style_prompt: string
  reference_image: string
  width: number
  height: number
}

const BLOCK_TEXTURE_PROMPT = `Update this image: recolor this 2D sprite with a new color palette. Do not change anything else.

This is a flat 2D game block sprite. Keep the EXACT same pixel layout — same shapes, same edges, same dimensions. Only change the colors within existing painted areas. The transparent/dark background must stay untouched. Maintain the pixelart style.

Color direction: USER_PROMPT`

function closest_aspect_ratio(w: number, h: number): string {
  const ratio = w / h
  const options: [string, number][] = [
    ['1:1', 1],
    ['5:4', 5 / 4],
    ['4:3', 4 / 3],
    ['3:2', 3 / 2],
    ['16:9', 16 / 9],
    ['21:9', 21 / 9],
    ['4:5', 4 / 5],
    ['3:4', 3 / 4],
    ['2:3', 2 / 3],
    ['9:16', 9 / 16],
  ]
  let best = '1:1'
  let best_diff = Infinity
  for (const [label, val] of options) {
    const diff = Math.abs(ratio - val)
    if (diff < best_diff) {
      best_diff = diff
      best = label
    }
  }
  return best
}

export async function generate_block_texture(params: GenerateBlockTextureParams): Promise<string> {
  const size_hint = `\nCRITICAL: The input image is ${params.width}x${params.height} pixels. Your output MUST match this exact resolution and aspect ratio. Do NOT upscale or change dimensions.`
  const prompt =
    BLOCK_TEXTURE_PROMPT.replace('USER_PROMPT', params.style_prompt || 'A fantasy variant with unique coloring') +
    size_hint
  const images = [{ mimeType: 'image/png', data: params.reference_image }]
  return call_gemini_image(prompt, {
    config: { aspectRatio: closest_aspect_ratio(params.width, params.height) },
    images,
  })
}

// ---------------------------------------------------------------------------
//  Background removal (remove.bg)
// ---------------------------------------------------------------------------

export async function remove_background(image_base64: string): Promise<string> {
  const api_key = get_removebg_key()
  if (!api_key) throw new Error('Remove.bg API key not configured. Add it in Settings.')

  // Re-encode through canvas to guarantee valid JPEG bytes
  // (Gemini lies about mimeType — claims PNG but sends JPEG bytes)
  const img = await load_image(image_base64)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const clean_data_url = canvas.toDataURL('image/jpeg', 0.95)

  const base64_data = clean_data_url.replace(/^data:image\/\w+;base64,/, '')
  const form_data = new FormData()
  form_data.append('image_file_b64', base64_data)
  form_data.append('size', 'auto')

  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': api_key },
    body: form_data,
  })

  if (!response.ok) {
    const error_text = await response.text()
    throw new Error(`Remove.bg API Error: ${response.status} - ${error_text}`)
  }

  const blob = await response.blob()
  const array_buffer = await blob.arrayBuffer()
  const base64 = btoa(new Uint8Array(array_buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''))
  return `data:image/png;base64,${base64}`
}

// ---------------------------------------------------------------------------
//  Canvas-based image utilities
// ---------------------------------------------------------------------------

export async function resize_image(data_url: string, width: number, height: number): Promise<string> {
  const img = new Image()

  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load image for resizing'))
  })

  img.src = data_url
  await loaded

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas 2d context')

  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

// ---------------------------------------------------------------------------
//  Image loading helper
// ---------------------------------------------------------------------------

function load_image(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

// ---------------------------------------------------------------------------
//  Alpha flattening & restoration for generated textures
// ---------------------------------------------------------------------------

export async function flatten_alpha_to_fill(data_url: string): Promise<string> {
  const img = await load_image(data_url)
  const w = img.naturalWidth
  const h = img.naturalHeight

  // Read original pixels
  const src_canvas = document.createElement('canvas')
  src_canvas.width = w
  src_canvas.height = h
  const src_ctx = src_canvas.getContext('2d')!
  src_ctx.drawImage(img, 0, 0)
  const src_data = src_ctx.getImageData(0, 0, w, h).data

  // Build output with transparent pixels filled by nearby opaque color averages
  const out_canvas = document.createElement('canvas')
  out_canvas.width = w
  out_canvas.height = h
  const out_ctx = out_canvas.getContext('2d')!
  const out_image = out_ctx.getImageData(0, 0, w, h)
  const out = out_image.data
  const radius = 5

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (src_data[i + 3]! >= 128) {
        // Opaque pixel — copy as-is
        out[i] = src_data[i]!
        out[i + 1] = src_data[i + 1]!
        out[i + 2] = src_data[i + 2]!
        out[i + 3] = 255
      } else {
        // Transparent pixel — average nearby opaque pixels
        let r_sum = 0,
          g_sum = 0,
          b_sum = 0,
          count = 0
        const x0 = Math.max(0, x - radius)
        const x1 = Math.min(w - 1, x + radius)
        const y0 = Math.max(0, y - radius)
        const y1 = Math.min(h - 1, y + radius)
        for (let ny = y0; ny <= y1; ny++) {
          for (let nx = x0; nx <= x1; nx++) {
            const ni = (ny * w + nx) * 4
            if (src_data[ni + 3]! >= 128) {
              r_sum += src_data[ni]!
              g_sum += src_data[ni + 1]!
              b_sum += src_data[ni + 2]!
              count++
            }
          }
        }
        if (count > 0) {
          out[i] = (r_sum / count) | 0
          out[i + 1] = (g_sum / count) | 0
          out[i + 2] = (b_sum / count) | 0
        } else {
          // No opaque neighbors — neutral dark gray
          out[i] = 0x1a
          out[i + 1] = 0x1a
          out[i + 2] = 0x1a
        }
        out[i + 3] = 255
      }
    }
  }

  out_ctx.putImageData(out_image, 0, 0)
  return out_canvas.toDataURL('image/png')
}

export async function restore_alpha_mask(generated_data_url: string, original_data_url: string): Promise<string> {
  const [gen_img, orig_img] = await Promise.all([load_image(generated_data_url), load_image(original_data_url)])

  const width = orig_img.naturalWidth
  const height = orig_img.naturalHeight

  const gen_canvas = document.createElement('canvas')
  gen_canvas.width = width
  gen_canvas.height = height
  const gen_ctx = gen_canvas.getContext('2d')!
  gen_ctx.drawImage(gen_img, 0, 0, width, height)

  const orig_canvas = document.createElement('canvas')
  orig_canvas.width = width
  orig_canvas.height = height
  const orig_ctx = orig_canvas.getContext('2d')!
  orig_ctx.drawImage(orig_img, 0, 0, width, height)

  const gen_data = gen_ctx.getImageData(0, 0, width, height)
  const orig_data = orig_ctx.getImageData(0, 0, width, height)

  // Copy alpha channel from original to generated
  for (let i = 0; i < gen_data.data.length; i += 4) {
    gen_data.data[i + 3] = orig_data.data[i + 3]
  }

  gen_ctx.putImageData(gen_data, 0, 0)
  return gen_canvas.toDataURL('image/png')
}

export function data_url_to_uint8array(data_url: string): Uint8Array {
  const base64 = data_url.split(',')[1]!
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
