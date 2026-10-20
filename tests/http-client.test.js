import test from "node:test"
import assert from "node:assert/strict"
import { requestApi } from "../src/lib/http.js"

test("o cliente compartilha o proxy e envia cookies em todas as operações", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/creami")
    assert.equal(options.credentials, "same-origin")
    assert.equal(options.method, "POST")
    assert.equal(options.headers.Authorization, "Bearer perfil")
    return Response.json({ data: { profile: { name: "Autor" } } })
  })
  const result = await requestApi("creami", { method: "POST", headers: { Authorization: "Bearer perfil" }, body: "{}" })
  assert.equal(result.data.profile.name, "Autor")
})

test("falhas da API e respostas inválidas geram mensagens utilizáveis", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Entre como administrador." }, { status: 403 }))
  await assert.rejects(requestApi("creami"), /Entre como administrador/)
  fetch.mock.mockImplementation(async () => new Response("<html>Não encontrado</html>", { status: 404 }))
  await assert.rejects(requestApi("foods?q=banana"), /API do Repassa Fácil não está disponível/)
  fetch.mock.mockImplementation(async () => new Response("{", { headers: { "Content-Type": "application/json" } }))
  await assert.rejects(requestApi("food-catalog"), /resposta inválida/)
})

test("cancelar uma busca preserva AbortError sem mostrar falha de conexão", async t => {
  const cancellation = new DOMException("Consulta cancelada", "AbortError")
  t.mock.method(globalThis, "fetch", async () => { throw cancellation })
  await assert.rejects(requestApi("foods?q=banana"), error => error === cancellation)
})
