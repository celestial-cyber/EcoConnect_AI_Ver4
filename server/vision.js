/* ============================================================
  Server-side vision. Provider keys live here and only here —
  they are never sent to a browser.
  ============================================================ */

const OPENAI_KEY = process.env.OPENAI_API_KEY
const GEMINI_KEY = process.env.GEMINI_API_KEY
const REQUESTED_PROVIDER = String(process.env.VISION_PROVIDER || '').toLowerCase()
const PROVIDER = REQUESTED_PROVIDER === 'openai'
  ? (OPENAI_KEY ? 'openai' : null)
  : REQUESTED_PROVIDER === 'gemini'
    ? (GEMINI_KEY ? 'gemini' : null)
    : GEMINI_KEY ? 'gemini' : OPENAI_KEY ? 'openai' : null
const MODEL = PROVIDER === 'openai'
  ? process.env.OPENAI_MODEL || 'gpt-4o-mini'
  : process.env.GEMINI_MODEL || 'gemini-3.7-flash'

export const hasVision = Boolean(PROVIDER)
export const modelName = MODEL

export const WASTE_IDS = [
  'textile', 'paper', 'e-waste', 'plastic', 'metal', 'glass', 'furniture', 'organic',
]

const PROMPT = `You are the intake classifier for a waste-recovery platform.
Look at the photograph and identify the single main discarded item in it.

Return strict JSON only:
- item_label: a short human name for the item, 2-4 words, sentence case (e.g. "Cardboard cartons").
- waste_type: exactly one of ${WASTE_IDS.join(', ')}.
- condition: 0-10, how much usable life is left. 9-10 nearly new, 6-8 good and reusable,
  3-5 worn but repairable or recyclable, 0-2 only fit for material recovery.
- pathway: one of "REUSABLE · DONATE", "REPAIRABLE · REFURBISH", "RECYCLABLE", "NOT RECOVERABLE".
- confidence: 0-100, how sure you are of item_label and waste_type.
- est_weight_kg: a realistic single-item weight in kilograms.

If the photo does not show a discardable object at all — a person, a screen, a document,
a blank wall, a page of handwriting — set waste_type to "unclear", confidence below 40, and
say what you actually see in item_label. Never guess a plausible-sounding object that is not
in the picture.`

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    item_label: { type: 'STRING' },
    waste_type: { type: 'STRING', enum: [...WASTE_IDS, 'unclear'] },
    condition: { type: 'NUMBER' },
    pathway: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
    est_weight_kg: { type: 'NUMBER' },
  },
  required: ['item_label', 'waste_type', 'condition', 'pathway', 'confidence', 'est_weight_kg'],
}

export async function classifyBuffer(buffer, mimeType = 'image/jpeg') {
  if (!PROVIDER) {
    const e = new Error('No vision model configured on the server. Set OPENAI_API_KEY.')
    e.status = 503
    throw e
  }

  if (PROVIDER === 'openai') return classifyWithOpenAI(buffer, mimeType)
  return classifyWithGemini(buffer, mimeType)
}

async function classifyWithOpenAI(buffer, mimeType) {
  const url = 'https://api.openai.com/v1/chat/completions'
  const res = await requestVision(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } },
        ],
      }],
    }),
  })
  if (!res.ok) throw visionError(res.status, await errorDetail(res), 'OpenAI')
  const json = await res.json()
  const text = json?.choices?.[0]?.message?.content || ''
  if (!text) throw emptyVisionError()
  return parseVision(text)
}

async function classifyWithGemini(buffer, mimeType) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          response_schema: SCHEMA,
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) { throw networkVisionError(err) }

  if (!res.ok) {
    throw visionError(res.status, await errorDetail(res), 'Gemini')
  }

  const json = await res.json()
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''
  if (!text) throw emptyVisionError()
  return parseVision(text)
}

async function requestVision(url, options) {
  let parsed
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) })
  } catch (err) {
    throw networkVisionError(err)
  }
}

async function errorDetail(res) {
  try { return (await res.json())?.error?.message || '' } catch { return '' }
}

function networkVisionError(err) {
  const e = new Error(err.name === 'TimeoutError'
    ? 'The vision model did not answer in 30 seconds.'
    : `Could not reach the vision model: ${err.message}`)
  e.status = 504
  return e
}

function visionError(status, detail, provider) {
  const e = new Error(
    status === 429 ? 'Vision model rate limit hit. Try again in a moment.'
      : /API key|authentication|api_key/i.test(detail)
      ? `The server rejected its ${provider} API key. Check ${provider === 'OpenAI' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'}.`
      : detail || `Vision model returned ${status}.`
  )
  e.status = status === 429 ? 429 : 502
  return e
}

function emptyVisionError() {
  const e = new Error('The vision model returned nothing — the image may have been blocked.')
  e.status = 502
  return e
}

function parseVision(text) {
  let parsed
  try { parsed = JSON.parse(text) } catch {
    const e = new Error('The vision model did not return valid JSON.')
    e.status = 502
    throw e
  }
  return normalise(parsed)
}

/** Never trust the model's shape. Clamp it into ours before it can reach the database. */
function normalise(r) {
  const type = WASTE_IDS.includes(r.waste_type) ? r.waste_type : null
  const num = (v, lo, hi, dflt) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
  }
  return {
    item_label: String(r.item_label || 'Unidentified item').slice(0, 80),
    waste_type: type,
    unclear: !type,
    condition: num(r.condition, 0, 10, 5),
    pathway: String(r.pathway || 'RECYCLABLE').slice(0, 40),
    confidence: num(r.confidence, 0, 100, 0),
    est_weight_kg: Math.max(0.1, num(r.est_weight_kg, 0.1, 500, 1)),
    model: MODEL,
  }
}
