import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createRepassafacilProxy } from "../server/repassafacil-proxy.js"

async function serve(t, path, options) {
  const server = createServer(createRepassafacilProxy(path, options))
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}

test("proxy valida origem, encaminha perfil e JSON e preserva cookie administrativo", async t => {
  const base = await serve(t, "/api/creami", {
    environment: { REPASSAFACIL_API_URL: "https://api.example.com" },
    fetcher: async (url, options) => {
      assert.equal(String(url), "https://api.example.com/api/creami")
      assert.equal(options.headers.authorization, "Bearer perfil-privado")
      assert.equal(options.headers.cookie, "creami_admin=anterior")
      assert.equal(options.headers.origin, undefined)
      assert.equal(JSON.parse(options.body.toString()).action, "snapshot")
      return new Response(JSON.stringify({ data: { profile: { name: "Teste" } } }), {
        headers: { "Content-Type": "application/json", "Set-Cookie": "creami_admin=nova; Path=/; HttpOnly; Secure; SameSite=Strict" },
      })
    },
  })
  const response = await fetch(`${base}/api/creami`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer perfil-privado", Cookie: "creami_admin=anterior", Origin: base },
    body: JSON.stringify({ action: "snapshot", data: {} }),
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.profile.name, "Teste")
  assert.match(response.headers.get("set-cookie"), /HttpOnly/)
})

test("proxy preserva imagens binárias e consulta de alimentos", async t => {
  const bytes = new Uint8Array([0, 255, 12, 65])
  const base = await serve(t, "/api/image", {
    environment: { REPASSAFACIL_API_URL: "https://api.example.com/" },
    fetcher: async url => {
      assert.equal(new URL(url).searchParams.get("id"), "foto")
      return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } })
    },
  })
  const response = await fetch(`${base}/api/image?id=foto`)
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes)
  assert.equal(response.headers.get("content-type"), "image/png")
})

test("proxy rejeita método inválido, configuração ausente e redirecionamentos", async t => {
  const missing = await serve(t, "/api/creami", { environment: { REPASSAFACIL_API_URL: "" } })
  assert.equal((await fetch(`${missing}/api/creami`, { method: "POST" })).status, 503)
  const base = await serve(t, "/api/creami", {
    environment: { REPASSAFACIL_API_URL: "https://api.example.com" },
    fetcher: async () => new Response(null, { status: 307, headers: { Location: "https://outro.example" } }),
  })
  assert.equal((await fetch(`${base}/api/creami`)).status, 405)
  const denied = await fetch(`${base}/api/creami`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://outro.example" }, body: "{}" })
  assert.equal(denied.status, 403)
  const redirect = await fetch(`${base}/api/creami`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
  assert.equal(redirect.status, 502)
})


test("produção usa o endereço público do Repassa Fácil por padrão", async t => {
  const base = await serve(t, "/api/food-catalog", {
    environment: {},
    fetcher: async url => {
      assert.equal(String(url), "https://repassafacil-api.onrender.com/api/food-catalog")
      return Response.json({ version: 1, foods: [] })
    },
  })
  assert.equal((await fetch(`${base}/api/food-catalog`)).status, 200)
})

test("rotas ainda não publicadas retornam erro JSON e fotos ausentes mantêm 404", async t => {
  const unpublished = await serve(t, "/api/food-catalog", { environment: {}, fetcher: async () => new Response(null, { status: 404 }) })
  const response = await fetch(`${unpublished}/api/food-catalog`)
  assert.equal(response.status, 503)
  assert.match((await response.json()).error, /serviço da Ninja CREAMi/)
  const missingPhoto = await serve(t, "/api/image", { environment: {}, fetcher: async () => Response.json({ error: "Imagem não encontrada." }, { status: 404 }) })
  assert.equal((await fetch(`${missingPhoto}/api/image?id=ausente`)).status, 404)
})
