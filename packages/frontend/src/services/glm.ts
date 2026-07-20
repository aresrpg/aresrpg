// ---------------------------------------------------------------------------
//  GLM-5.1 (Zhipu AI / Z.ai) — OpenAI-compatible text generation
// ---------------------------------------------------------------------------

const GLM_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
const GLM_MODEL = 'glm-5.1'

// ---------------------------------------------------------------------------
//  localStorage key helpers
// ---------------------------------------------------------------------------

export function get_glm_key(): string {
  return localStorage.getItem('ares_glm_key') || ''
}

export function set_glm_key(key: string) {
  localStorage.setItem('ares_glm_key', key.replace(/[^\x20-\x7E]/g, '').trim())
}

// ---------------------------------------------------------------------------
//  Description improvement
// ---------------------------------------------------------------------------

const SPELL_SYSTEM_PROMPT = `You IMPROVE existing spell descriptions for a dark fantasy MMORPG.
The user gives you a draft — your job is to REFINE it, not replace it. Keep the same intent, the same action, the same meaning.
First sentence: rewrite the draft to sound like a proper RPG tooltip — clearer, punchier, more evocative. Do NOT invent mechanics, effects, damage numbers, or abilities that aren't in the draft.
Second sentence (optional): add heavy sarcasm or dark humor as flavor — but the first sentence always stays faithful to the draft.
Think classic tactical-RPG tooltip style. Never address the reader. No "you" or "your". No meta-commentary.
1-2 sentences max. Return ONLY a JSON array of 3 improved versions. No markdown, no explanation.`

const QUEST_SYSTEM_PROMPT = `You IMPROVE existing quest descriptions for AresRPG, a dark fantasy MMORPG.
The user gives you a draft — your job is to EXPAND and POLISH it, not replace it. Keep EVERY piece of information, every instruction, every game mechanic mentioned. Do NOT remove or simplify any content.
Rules:
- ADDRESS the player directly ("you", "your") — this is a guide teaching them how to play.
- KEEP all gameplay instructions intact (key bindings, UI navigation, stat names, formulas, percentages). These are critical for new players.
- EXPAND the draft: add atmosphere, add encouragement, add context about WHY this matters in their journey. Make it feel like a mentor speaking to a new adventurer.
- Write 3-5 sentences. Longer is better — the player needs to understand the mechanic fully.
- Tone: warm but with edge. A battle-scarred veteran teaching a recruit. Occasional dark humor welcome but instruction comes first.
- NEVER cut mechanical details to make room for flavor. The flavor wraps AROUND the instructions.
- NEVER invent game mechanics, stats, or features that aren't in the draft.
Return ONLY a JSON array of 3 improved versions. No markdown, no explanation.`

const ITEM_SYSTEM_PROMPT = `You IMPROVE existing item descriptions for a dark fantasy MMORPG.
The user gives you a draft — your job is to REFINE it, not replace it. Keep the same intent, the same subject, the same meaning.
First sentence: rewrite the draft into proper RPG flavor text — punchier, more evocative, in-universe. Do NOT invent lore, effects, or details that aren't implied by the draft.
Second sentence (optional): add heavy sarcasm, dark humor, or irreverent worldbuilding — but always anchored to the draft's intent.
Think classic tactical-RPG item descriptions. Never address the reader. No "you" or "your". No meta-commentary.
NEVER mention damage numbers, combat mechanics, stat bonuses, or percentage chances.
1-2 sentences max. Return ONLY a JSON array of 3 improved versions. No markdown, no explanation.`

export async function improve_description(
  description: string,
  context: { name?: string; type?: string; template_kind?: 'item' | 'spell' | 'quest' }
): Promise<string[]> {
  const api_key = get_glm_key()
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
  if (!api_key) throw new Error('GLM API key not configured')

  const system_prompt =
    context.template_kind === 'quest'
      ? QUEST_SYSTEM_PROMPT
      : context.template_kind === 'item'
        ? ITEM_SYSTEM_PROMPT
        : SPELL_SYSTEM_PROMPT

  const user_msg = [
    context.name && `Name: ${context.name}`,
    context.type && `Type: ${context.type}`,
    `Draft: ${description}`,
  ]
    .filter(Boolean)
    .join('\n')

  const response = await fetch(`${GLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify({
      model: GLM_MODEL,
      messages: [
        { role: 'system', content: system_prompt },
        { role: 'user', content: user_msg },
      ],
      temperature: 0.5,
      thinking: { type: 'disabled' },
      max_tokens: context.template_kind === 'quest' ? 1500 : 300,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GLM API Error: ${response.status} — ${text}`)
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content
  if (!content) throw new Error('No content in GLM response')

  // Parse the JSON array from the response, stripping any markdown fences
  const cleaned = content
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`GLM returned invalid JSON: ${cleaned.slice(0, 100)}`)
  }

  if (!Array.isArray(parsed) || parsed.length < 3) throw new Error('GLM returned invalid format')

  // GLM sometimes returns objects instead of strings — coerce gracefully
  return parsed.slice(0, 3).map((item: unknown) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      return String(obj.description || obj.text || obj.content || obj.name || JSON.stringify(obj))
    }
    return String(item)
  })
}

// ---------------------------------------------------------------------------
//  Translatable field definitions
// ---------------------------------------------------------------------------

export const TRANSLATABLE_FIELDS: Record<string, string[]> = {
  mob: ['name'],
  item: ['name', 'description'],
  quest: ['name', 'description'],
}

// ---------------------------------------------------------------------------
//  Template translation via tool calling
// ---------------------------------------------------------------------------

const TRANSLATION_SYSTEM_PROMPT = `You are an expert RPG game translator for a dark fantasy MMORPG (AresRPG). You translate game content while preserving the dark, sarcastic, slightly unhinged tone.

Critical rules:
- Names are often WORDPLAY or PUNS built from real words. Decode the joke first, then recreate an equivalent pun in each target language using the SAME root concept. Example: "Wooligan" = wool + hooligan (it's a sheep mob). French could be "Moutonneur" (mouton + bagarreur), Spanish "Lanalfón" (lana + matón), German "Wolligan" (Wolle + Hooligan) — the pun must land in each language while staying recognizable as the same creature.
- NEVER invent a completely unrelated name. The translated name must clearly evoke the same animal/creature/concept as the original.
- If a name has no wordplay and is a pure fantasy proper noun (e.g. "Zephyron", "Kharos"), keep it identical or minimally adapted phonetically across all languages.
- Keep RPG terminology consistent: stat names, damage types, quality tiers should use standard RPG translations for each language.
- Japanese: use katakana for foreign-origin fantasy names, kanji+hiragana for descriptive/punny names. Preserve the pun concept when possible.
- Ukrainian: use proper Cyrillic forms, not transliterations. Recreate wordplay using Ukrainian roots.
- Descriptions: keep them punchy, atmospheric, 1-2 sentences. Same energy as the English original.
- dialogText may contain ICU MessageFormat parameters like {playerName} — preserve them exactly as-is.`

const TRANSLATE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_translations',
    description: 'Submit translations for all fields across all target languages',
    parameters: {
      type: 'object',
      properties: {
        translations: {
          type: 'object',
          description: 'Map of field name to language translations',
          additionalProperties: {
            type: 'object',
            properties: {
              fr: { type: 'string', description: 'French translation' },
              es: { type: 'string', description: 'Spanish translation' },
              de: { type: 'string', description: 'German translation' },
              uk: { type: 'string', description: 'Ukrainian translation' },
              ja: { type: 'string', description: 'Japanese translation' },
            },
            required: ['fr', 'es', 'de', 'uk', 'ja'],
          },
        },
      },
      required: ['translations'],
    },
  },
}

export async function translate_template(
  template_type: string,
  fields: Record<string, string>
): Promise<Record<string, { fr: string; es: string; de: string; uk: string; ja: string }>> {
  const api_key = get_glm_key()
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
  if (!api_key) throw new Error('GLM API key not configured')

  const translatable = TRANSLATABLE_FIELDS[template_type]
  if (!translatable) throw new Error(`No translatable fields for type: ${template_type}`)

  const field_lines = translatable.filter((f) => fields[f]?.trim()).map((f) => `${f}: "${fields[f]}"`)

  if (field_lines.length === 0) throw new Error('No non-empty translatable fields')

  const user_msg = `Template type: ${template_type}\nSource language: English\nTarget languages: French (fr), Spanish (es), German (de), Ukrainian (uk), Japanese (ja)\n\nFields to translate:\n${field_lines.join('\n')}`

  const response = await fetch(`${GLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify({
      model: GLM_MODEL,
      messages: [
        { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
        { role: 'user', content: user_msg },
      ],
      tools: [TRANSLATE_TOOL],
      tool_choice: { type: 'function', function: { name: 'submit_translations' } },
      temperature: 0.3,
      thinking: { type: 'disabled' },
      max_tokens: 1500,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GLM API Error: ${response.status} — ${text}`)
  }

  const result = await response.json()
  const tool_call = result.choices?.[0]?.message?.tool_calls?.[0]
  if (!tool_call?.function?.arguments) throw new Error('No tool call in GLM response')

  let parsed
  try {
    parsed = JSON.parse(tool_call.function.arguments)
  } catch {
    throw new Error('GLM returned invalid tool call JSON')
  }
  return parsed.translations
}
