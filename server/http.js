import { Readable } from "node:stream"
import { fail } from "./service.js"

const COOKIE = "creami_admin"
const MAX_BODY = 4 * 1024 * 1024
const errorStatus = (error) =>
  error.status || (error.name === "SyntaxError" ? 400 : 500)
const readCookie = (header) => {
  const entry = String(header || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
  return entry ? entry.slice(COOKIE.length + 1) : null
}
const readBody = async (request) => {
  if (
    request.body !== undefined &&
    request.body !== null &&
    !Buffer.isBuffer(request.body)
  ) {
    if (typeof request.body === "string") {
      if (Buffer.byteLength(request.body) > MAX_BODY)
        fail("A foto é muito grande.", 413)
      return JSON.parse(request.body)
    }
    if (Buffer.byteLength(JSON.stringify(request.body)) > MAX_BODY)
      fail("A foto é muito grande.", 413)
    return request.body
  }
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk)
    if (size > MAX_BODY) fail("A foto é muito grande.", 413)
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

export function createHttpHandler(
  getService,
  { secureCookies = process.env.VERCEL === "1" } = {},
) {
  return async function handler(request, response) {
    response.setHeader("X-Content-Type-Options", "nosniff")
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      )
      if (url.pathname === "/api/image") {
        if (request.method !== "GET") fail("Método não permitido.", 405)
        const image = await getService().image(url.searchParams.get("id"))
        response.statusCode = 200
        response.setHeader("Content-Type", image.contentType || "image/jpeg")
        response.setHeader("Cache-Control", "public, max-age=3600")
        if (image.body instanceof ReadableStream)
          Readable.fromWeb(image.body).pipe(response)
        else response.end(image.body)
        return
      }
      response.setHeader("Cache-Control", "private, no-store")
      if (request.method !== "POST") fail("Método não permitido.", 405)
      const origin = request.headers.origin
      if (origin && new URL(origin).host !== request.headers.host)
        fail("Origem não autorizada.", 403)
      if (
        !String(request.headers["content-type"] || "").startsWith(
          "application/json",
        )
      )
        fail("Envie os dados em JSON.", 415)
      const body = await readBody(request)
      if (
        !body ||
        typeof body !== "object" ||
        typeof body.action !== "string" ||
        (body.data !== undefined &&
          (!body.data ||
            typeof body.data !== "object" ||
            Array.isArray(body.data)))
      )
        fail("Requisição inválida.")
      const token = String(request.headers.authorization || "").replace(
        /^Bearer /,
        "",
      )
      const adminToken = readCookie(request.headers.cookie)
      const service = getService()
      const result =
        body.action === "snapshot"
          ? { value: await service.snapshot(token, adminToken) }
          : await service.perform(
              body.action,
              body.data || {},
              token,
              adminToken,
            )
      if (Object.hasOwn(result, "adminToken")) {
        response.setHeader(
          "Set-Cookie",
          `${COOKIE}=${result.adminToken || ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${
            result.adminToken ? 28800 : 0
          }${secureCookies ? "; Secure" : ""}`,
        )
      }
      response.statusCode = 200
      response.setHeader("Content-Type", "application/json; charset=utf-8")
      response.end(JSON.stringify({ data: result.value ?? null }))
    } catch (error) {
      const status = errorStatus(error)
      response.statusCode = status
      response.setHeader("Cache-Control", "private, no-store")
      response.setHeader("Content-Type", "application/json; charset=utf-8")
      const message =
        status >= 500 && status !== 503
          ? "Não foi possível acessar o servidor. Tente novamente."
          : error.message
      if (status >= 500) console.error("creami-api:", error.message)
      response.end(JSON.stringify({ error: message }))
    }
  }
}
