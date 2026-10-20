// Business rules, credentials and persistence live in RepassaFacil.API.
// This same-origin proxy preserves HttpOnly admin cookies across hosting providers.
export const DEFAULT_REPASSAFACIL_API_URL = "https://repassafacil-api.onrender.com"
const MAX_BODY = 9 * 1024 * 1024
export function createRepassafacilProxy(path, { environment = process.env, fetcher = fetch } = {}) {
  return async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8")
    response.setHeader("Cache-Control", "private, no-store")
    response.setHeader("X-Content-Type-Options", "nosniff")
    const fail = (status, error) => { response.statusCode = status; response.end(JSON.stringify({ error })) }
    try {
      const configured = environment.REPASSAFACIL_API_URL ?? DEFAULT_REPASSAFACIL_API_URL
      if (!configured) return fail(503, "Configure REPASSAFACIL_API_URL para conectar a API do Repassa Fácil.")
      const target = new URL(configured)
      if (!/^https?:$/.test(target.protocol) || target.username || target.password || target.search || target.hash || target.pathname !== "/")
        return fail(503, "A URL da API do Repassa Fácil deve conter somente a origem do servidor.")
      if (target.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
        return fail(503, "A URL da API do Repassa Fácil deve usar HTTPS.")
      if (target.host.toLowerCase() === String(request.headers.host || "").toLowerCase())
        return fail(503, "A URL da API deve apontar para o backend do Repassa Fácil.")
      const method = request.method || "GET"
      const allowed = path === "/api/creami" || path === "/api/food-ai" ? "POST" : "GET"
      if (method !== allowed) { response.setHeader("Allow", allowed); return fail(405, "Método não permitido.") }
      if (method === "POST" && request.headers.origin) {
        let origin
        try { origin = new URL(String(request.headers.origin)) }
        catch { return fail(403, "Origem não autorizada.") }
        if (!/^https?:$/.test(origin.protocol) || origin.host.toLowerCase() !== String(request.headers.host || "").toLowerCase())
          return fail(403, "Origem não autorizada.")
      }
      const source = new URL(request.url || path, "http://proxy.local")
      const destination = new URL(path, target)
      destination.search = source.search
      // The browser origin is checked above. This hop is server-to-server;
      // forwarding it would require every preview domain in the backend CORS list.
      const headers = {}
      for (const key of ["authorization", "cookie", "content-type"]) {
        const value = request.headers[key]
        if (typeof value === "string") headers[key] = value
      }
      let body
      if (method === "POST") {
        if (!String(request.headers["content-type"] || "").startsWith("application/json")) return fail(415, "Envie os dados em JSON.")
        if (request.body != null) body = Buffer.isBuffer(request.body) ? request.body : typeof request.body === "string" ? request.body : JSON.stringify(request.body)
        else {
          const chunks = []; let size = 0
          for await (const chunk of request) {
            size += Buffer.byteLength(chunk)
            if (size > MAX_BODY) return fail(413, "A foto é muito grande.")
            chunks.push(Buffer.from(chunk))
          }
          body = Buffer.concat(chunks)
        }
        if (Buffer.byteLength(body) > MAX_BODY) return fail(413, "A foto é muito grande.")
      }
      const upstream = await fetcher(destination, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(28000) })
      if (upstream.status >= 300 && upstream.status < 400) return fail(502, "A API do Repassa Fácil retornou um redirecionamento inesperado.")
      if (upstream.status === 404 && !upstream.headers.get("content-type")?.includes("application/json"))
        return fail(503, "O serviço da Ninja CREAMi ainda não está disponível no Repassa Fácil. Tente novamente em instantes.")
      response.statusCode = upstream.status
      for (const key of ["content-type", "cache-control", "allow"]) {
        const value = upstream.headers.get(key)
        if (value) response.setHeader(key, value)
      }
      const cookies = upstream.headers.getSetCookie()
      if (cookies.length) response.setHeader("Set-Cookie", cookies)
      response.end(Buffer.from(await upstream.arrayBuffer()))
    } catch {
      fail(502, "Não foi possível conectar à API do Repassa Fácil. Tente novamente.")
    }
  }
}
