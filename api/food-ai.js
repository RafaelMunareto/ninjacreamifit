const MAX_IMAGE_BYTES = 6 * 1024 * 1024

function parseDataUrl(image) {
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image)
  return match ? { mimeType: match[1], data: match[2] } : null
}

function parseModelJson(content) {
  const cleaned = String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
  return JSON.parse(cleaned || "{}")
}

const UNKNOWN_FOOD_NAMES = new Set([
  "nao identificado",
  "não identificado",
  "desconhecido",
  "unknown",
  "none",
  "null",
])

async function analyzeWithGemini(imageData) {
  const preferred = [
    process.env.GEMINI_MODEL,
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
  ].filter(Boolean)
  let discovered = []
  try {
    const listing = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
    )
    if (listing.ok) {
      const data = await listing.json()
      discovered = (data.models || [])
        .filter((item) =>
          item.supportedGenerationMethods?.includes("generateContent"),
        )
        .map((item) => String(item.name || "").replace(/^models\//, ""))
        .filter((model) => /flash/i.test(model))
    }
  } catch {
    // The static list below remains available if model discovery is unavailable.
  }
  const models = [...preferred, ...discovered].filter(
    (model, index, all) => model && all.indexOf(model) === index,
  )
  let lastError
  const failures = []
  for (const model of models) {
    const endpoint = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    )
    endpoint.searchParams.set("key", process.env.GEMINI_API_KEY)
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: 'Identifique até três alimentos visíveis na foto. Para cada um, leia a marca e a quantidade/volume quando estiverem visíveis. Responda somente JSON no formato {"foods":[{"food":"nome curto","brand":"marca ou vazio","quantity":0,"unit":"g ou ml","confidence":0.0}]}. Use quantity null quando não for possível ler. Não invente marca, quantidade ou nutrientes. Use português do Brasil.',
              },
              {
                inline_data: {
                  mime_type: imageData.mimeType,
                  data: imageData.data,
                },
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      }),
    })
    const data = await upstream.json()
    if (upstream.ok) {
      const content = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
      return parseModelJson(content)
    }
    lastError = new Error(data.error?.message || `Gemini ${model} error`)
    failures.push(`${model}: ${lastError.message}`)
    if (![404, 429, 500, 503].includes(upstream.status)) throw lastError
  }
  throw new Error(failures.join(" | ") || lastError?.message || "Gemini error")
}

async function analyzeWithHuggingFace(imageData) {
  const upstream = await fetch(
    "https://router.huggingface.co/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.HF_MODEL || "Qwen/Qwen2.5-VL-3B-Instruct",
        temperature: 0.1,
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: 'Identifique até três alimentos visíveis na foto. Para cada um, leia marca e quantidade/volume quando estiverem visíveis. Responda somente JSON no formato {"foods":[{"food":"nome curto","brand":"marca ou vazio","quantity":0,"unit":"g ou ml","confidence":0.0}]}. Use quantity null quando não for possível ler. Não invente dados. Use português do Brasil.',
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${imageData.mimeType};base64,${imageData.data}`,
                },
              },
            ],
          },
        ],
      }),
    },
  )
  const data = await upstream.json()
  if (!upstream.ok) throw new Error(data.error?.message || "Hugging Face error")
  const content = data.choices?.[0]?.message?.content
  return parseModelJson(
    Array.isArray(content)
      ? content.map((part) => part.text || "").join("")
      : content,
  )
}

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.setHeader("X-Content-Type-Options", "nosniff")
  if (request.method !== "POST") {
    response.statusCode = 405
    response.setHeader("Allow", "POST")
    response.end(JSON.stringify({ error: "Método não permitido." }))
    return
  }
  if (
    !process.env.HF_TOKEN &&
    !process.env.GEMINI_API_KEY &&
    !process.env.OPENAI_API_KEY
  ) {
    response.statusCode = 503
    response.end(
      JSON.stringify({
        error: "A identificação por IA ainda não está configurada no servidor.",
      }),
    )
    return
  }
  try {
    const body =
      typeof request.body === "string"
        ? JSON.parse(request.body)
        : request.body || {}
    const image = body.image
    if (
      typeof image !== "string" ||
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) ||
      Buffer.byteLength(image, "utf8") > MAX_IMAGE_BYTES * 1.4
    ) {
      response.statusCode = 400
      response.end(
        JSON.stringify({ error: "Imagem inválida ou muito grande." }),
      )
      return
    }
    const imageData = parseDataUrl(image)
    if (!imageData) {
      response.statusCode = 400
      response.end(JSON.stringify({ error: "Imagem inválida." }))
      return
    }
    let parsed
    if (process.env.HF_TOKEN) {
      parsed = await analyzeWithHuggingFace(imageData)
    } else if (process.env.GEMINI_API_KEY) {
      parsed = await analyzeWithGemini(imageData)
    } else {
      const upstream = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + process.env.OPENAI_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  'Identifique até três alimentos visíveis na foto. Para cada um, leia a marca e a quantidade/volume quando estiverem visíveis. Responda somente JSON no formato {"foods":[{"food":"nome curto","brand":"marca ou vazio","quantity":0,"unit":"g ou ml","confidence":0.0}]}. Use quantity null quando não for possível ler. Não invente marca, quantidade ou nutrientes. Use português do Brasil.',
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Qual alimento aparece nesta foto? Use o nome comum em português do Brasil.",
                  },
                  { type: "image_url", image_url: { url: image } },
                ],
              },
            ],
          }),
        },
      )
      const data = await upstream.json()
      if (!upstream.ok) throw new Error("OpenAI error")
      const content = data.choices?.[0]?.message?.content
      parsed = parseModelJson(content)
    }
    const candidates = Array.isArray(parsed.foods)
      ? parsed.foods
      : parsed.food
        ? [parsed]
        : []
    const foods = candidates
      .map((candidate) => {
        const food =
          typeof candidate?.food === "string" ? candidate.food.trim() : ""
        const confidence = Number(candidate?.confidence)
        const unknownName = UNKNOWN_FOOD_NAMES.has(
          food.toLocaleLowerCase("pt-BR"),
        )
        if (
          food.length < 2 ||
          food.length > 100 ||
          unknownName ||
          (Number.isFinite(confidence) && confidence < 0.45)
        )
          return null
        const brand =
          typeof candidate.brand === "string" &&
          candidate.brand.trim().length <= 100
            ? candidate.brand.trim()
            : ""
        const quantity = Number(candidate.quantity)
        const unit = candidate.unit === "ml" ? "ml" : "g"
        return {
          food,
          brand,
          ...(Number.isFinite(quantity) && quantity > 0 && quantity <= 10000
            ? { quantity, unit }
            : {}),
        }
      })
      .filter(Boolean)
      .slice(0, 3)
    if (!foods.length) {
      response.statusCode = 422
      response.end(
        JSON.stringify({ error: "A IA não conseguiu reconhecer o alimento." }),
      )
      return
    }
    response.statusCode = 200
    response.setHeader("Cache-Control", "no-store")
    response.end(JSON.stringify({ foods, ...foods[0] }))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const depleted = /credits? are depleted|prepayment credits/i.test(detail)
    console.error("food-ai provider error", detail)
    response.statusCode = 500
    response.end(
      JSON.stringify({
        error: depleted
          ? "A IA está sem créditos no projeto do Google. Adicione créditos ou configure outro provedor de IA."
          : "A IA não respondeu. Tente novamente com uma foto mais nítida.",
        detail: detail.slice(0, 240),
      }),
    )
  }
}
