const MAX_IMAGE_BYTES = 6 * 1024 * 1024

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.setHeader("X-Content-Type-Options", "nosniff")
  if (request.method !== "POST") {
    response.statusCode = 405
    response.setHeader("Allow", "POST")
    response.end(JSON.stringify({ error: "Método não permitido." }))
    return
  }
  if (!process.env.OPENAI_API_KEY) {
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
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
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
              'Identifique o alimento principal na foto. Responda somente JSON no formato {"food":"nome curto","confidence":0.0}. Não invente marca ou nutrientes.',
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
    })
    const data = await upstream.json()
    if (!upstream.ok) {
      response.statusCode = 502
      response.end(
        JSON.stringify({
          error: "O serviço de IA não conseguiu analisar a foto.",
        }),
      )
      return
    }
    const content = data.choices?.[0]?.message?.content
    const parsed = JSON.parse(content || "{}")
    if (
      typeof parsed.food !== "string" ||
      parsed.food.trim().length < 2 ||
      parsed.food.trim().length > 100
    ) {
      response.statusCode = 422
      response.end(
        JSON.stringify({ error: "A IA não conseguiu reconhecer o alimento." }),
      )
      return
    }
    response.statusCode = 200
    response.setHeader("Cache-Control", "no-store")
    response.end(JSON.stringify({ food: parsed.food.trim() }))
  } catch {
    response.statusCode = 500
    response.end(
      JSON.stringify({ error: "Não foi possível analisar a foto agora." }),
    )
  }
}
