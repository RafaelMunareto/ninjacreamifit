import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes, randomUUID } from "node:crypto"
import { createFileStorage } from "../scripts/legacy-server/storage.js"
import { createService, makeAdminCredential } from "../scripts/legacy-server/service.js"
import { createHttpHandler } from "../scripts/legacy-server/http.js"

const input = {
  title: "Coco compartilhado",
  category: "Veganos",
  image: "data:image/jpeg;base64,aGVsbG8=",
  program: "sorbet",
  respin: true,
  toppings: "Coco",
  ingredients: ["200 ml de leite de coco"],
  instructions: ["Misture.", "Congele por 24 horas."],
  protein: 30.5,
  carbs: 20,
  fat: 6,
  calories: 256,
  authorName: "Autora A",
}

test("API no servidor compartilha dados e valida autoria entre aparelhos", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "creami-server-"))
  const credential = await makeAdminCredential("admin-servidor-teste-123")
  const storage = createFileStorage(directory)
  let service = createService(storage, { initialAdmin: credential })
  const server = createServer(createHttpHandler(() => service))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const tokenA = randomBytes(32).toString("hex")
  const tokenB = randomBytes(32).toString("hex")
  let cookie = ""
  let id
  const request = async (token, action, data = {}, admin = false) => {
    const response = await fetch(`${base}/api/creami`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(admin && cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ action, data }),
    })
    const body = await response.json()
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0]
    return {
      status: response.status,
      value: body.data,
      error: body.error,
      headers: response.headers,
    }
  }
  try {
    await t.test(
      "dois aparelhos têm perfis diferentes e um catálogo compartilhado",
      async () => {
        const a = await request(tokenA, "snapshot")
        const b = await request(tokenB, "snapshot")
        assert.equal(a.value.recipes.length, 6)
        assert.equal(b.value.recipes.length, 6)
        assert.notEqual(a.value.profile.id, b.value.profile.id)
        const created = await request(tokenA, "save", { input })
        assert.equal(created.status, 200)
        id = created.value
        const shared = (await request(tokenB, "snapshot")).value.recipes.find(
          (recipe) => recipe.id === id,
        )
        assert.equal(shared.title, input.title)
        assert.equal(shared.author, input.authorName)
        assert.equal(shared.protein, input.protein)
        assert.ok(shared.image.startsWith("/api/image?id="))
        const photo = await fetch(base + shared.image)
        assert.equal(photo.status, 200)
        assert.equal(photo.headers.get("content-type"), "image/jpeg")
        assert.equal(await photo.text(), "hello")
        assert.equal(a.headers.get("cache-control"), "private, no-store")
        assert.ok(!JSON.stringify(b.value).includes(credential.hash))
      },
    )
    await t.test(
      "autoria usa identificação privada, não nome ou ID enviado pelo cliente",
      async () => {
        const a = (await request(tokenA, "snapshot")).value
        await request(tokenB, "profile", { name: input.authorName })
        assert.equal(
          (
            await request(tokenB, "save", {
              id,
              input: { ...input, authorId: a.profile.id },
            })
          ).status,
          403,
        )
        assert.equal((await request(tokenB, "delete", { id })).status, 403)
        assert.equal(
          (
            await request(tokenA, "save", {
              id,
              input: { ...input, calories: 300 },
            })
          ).status,
          200,
        )
        assert.equal(
          (
            await request(tokenA, "save", {
              id,
              input,
              details: { author: "Admin", rating: 5, votes: 500 },
            })
          ).status,
          403,
        )
        assert.equal(
          (await request(tokenA, "save", { id: "1", input })).status,
          403,
        )
      },
    )
    await t.test(
      "avaliações são compartilhadas e favoritos pertencem a cada perfil",
      async () => {
        await request(tokenA, "rate", { id, value: 5 })
        await request(tokenB, "rate", { id, value: 3 })
        await request(tokenA, "favorite", { id })
        let a = (await request(tokenA, "snapshot")).value.recipes.find(
          (recipe) => recipe.id === id,
        )
        let b = (await request(tokenB, "snapshot")).value.recipes.find(
          (recipe) => recipe.id === id,
        )
        assert.equal(a.votes, 2)
        assert.equal(a.rating, 4)
        assert.equal(a.ownRating, 5)
        assert.equal(b.ownRating, 3)
        assert.equal(a.isFavorite, true)
        assert.equal(b.isFavorite, false)
        await request(tokenB, "rate", { id, value: 1 })
        b = (await request(tokenB, "snapshot")).value.recipes.find(
          (recipe) => recipe.id === id,
        )
        assert.equal(b.votes, 2)
        assert.equal(b.rating, 3)
      },
    )
    await t.test(
      "dados continuam disponíveis após reiniciar o servidor",
      async () => {
        service = createService(createFileStorage(directory), {
          initialAdmin: credential,
        })
        const recipe = (await request(tokenB, "snapshot")).value.recipes.find(
          (recipe) => recipe.id === id,
        )
        assert.ok(recipe)
        assert.equal(recipe.votes, 2)
      },
    )
    await t.test(
      "importação antiga é idempotente e não ressuscita receitas excluídas",
      async () => {
        const legacyId = randomUUID()
        const payload = {
          legacyId,
          input: { ...input, title: "Receita antiga" },
          ownRating: 4,
          favorite: true,
        }
        const first = await request(tokenA, "import", payload)
        const again = await request(tokenA, "import", payload)
        assert.equal(first.value, again.value)
        const imported = (await request(tokenB, "snapshot")).value.recipes.find(
          (recipe) => recipe.id === first.value,
        )
        assert.equal(imported.rating, 4)
        assert.equal(imported.votes, 1)
        await request(tokenA, "delete", { id: first.value })
        await request(tokenA, "import", payload)
        assert.ok(
          !(await request(tokenB, "snapshot")).value.recipes.some(
            (recipe) => recipe.id === first.value,
          ),
        )
      },
    )
    await t.test(
      "macros são obrigatórios e nenhuma alteração parcial é gravada",
      async () => {
        for (const key of ["protein", "carbs", "fat", "calories"]) {
          const missing = { ...input }
          delete missing[key]
          assert.equal(
            (await request(tokenA, "save", { id, input: missing })).status,
            400,
          )
        }
        assert.equal(
          (await request(tokenA, "save", { id, input: { ...input, fat: -1 } }))
            .status,
          400,
        )
        assert.equal(
          (await request(tokenA, "snapshot")).value.recipes.find(
            (recipe) => recipe.id === id,
          ).calories,
          300,
        )
      },
    )
    await t.test(
      "gravações simultâneas preservam as duas receitas",
      async () => {
        const outcomes = await Promise.all([
          request(tokenA, "save", { input: { ...input, title: "Paralela A" } }),
          request(tokenB, "save", { input: { ...input, title: "Paralela B" } }),
        ])
        assert.ok(outcomes.every((result) => result.status === 200))
        const shared = (await request(tokenA, "snapshot")).value
        assert.ok(
          outcomes.every((result) =>
            shared.recipes.some((recipe) => recipe.id === result.value),
          ),
        )
        await request(tokenA, "delete", { id: outcomes[0].value })
        await request(tokenB, "delete", { id: outcomes[1].value })
      },
    )
    await t.test(
      "administrador tem sessão protegida, edita totais e troca senha",
      async () => {
        assert.equal(
          (await request(tokenA, "setup", { password: "qualquer-senha-123" }))
            .status,
          403,
        )
        assert.equal(
          (await request(tokenA, "login", { password: "incorreta" })).status,
          401,
        )
        const login = await request(tokenA, "login", {
          password: "admin-servidor-teste-123",
        })
        assert.equal(login.status, 200)
        assert.ok(login.headers.get("set-cookie").includes("HttpOnly"))
        assert.equal(
          (await request(tokenA, "snapshot", {}, true)).value.admin
            .authenticated,
          true,
        )
        assert.equal(
          (await request(tokenB, "snapshot")).value.admin.authenticated,
          false,
        )
        assert.equal(
          (
            await request(
              tokenA,
              "save",
              {
                id,
                input,
                details: { author: "Autora A", rating: 4.8, votes: 100 },
              },
              true,
            )
          ).status,
          200,
        )
        const recipe = (await request(tokenB, "snapshot")).value.recipes.find(
          (recipe) => recipe.id === id,
        )
        assert.equal(recipe.votes, 100)
        assert.equal(recipe.rating, 4.8)
        assert.equal(recipe.ownRating, 0)
        const oldCookie = cookie
        assert.equal(
          (
            await request(
              tokenA,
              "changePassword",
              {
                currentPassword: "admin-servidor-teste-123",
                newPassword: "nova-senha-servidor-123",
              },
              true,
            )
          ).status,
          200,
        )
        const newCookie = cookie
        cookie = oldCookie
        assert.equal(
          (await request(tokenA, "snapshot", {}, true)).value.admin
            .authenticated,
          false,
        )
        cookie = newCookie
        assert.equal(
          (await request(tokenA, "delete", { id: "1" }, true)).status,
          200,
        )
        await request(tokenA, "logout", {}, true)
        assert.equal(
          (await request(tokenA, "snapshot", {}, true)).value.admin
            .authenticated,
          false,
        )
      },
    )
    await t.test(
      "autor exclui e a exclusão aparece no outro aparelho",
      async () => {
        const photo = (await request(tokenA, "snapshot")).value.recipes.find(
          (recipe) => recipe.id === id,
        ).image
        assert.equal((await request(tokenA, "delete", { id })).status, 200)
        const b = (await request(tokenB, "snapshot")).value
        assert.ok(!b.recipes.some((recipe) => recipe.id === id))
        assert.equal((await fetch(base + photo)).status, 404)
        assert.equal(
          (await request(tokenA, "rate", { id, value: 5 })).status,
          404,
        )
      },
    )
    await t.test(
      "rejeita origem externa, ausência de identificação e caminhos privados",
      async () => {
        const response = await fetch(`${base}/api/creami`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://outro-site.example",
          },
          body: JSON.stringify({ action: "snapshot" }),
        })
        assert.equal(response.status, 403)
        assert.equal((await request("", "snapshot")).status, 401)
        assert.equal(
          (await fetch(`${base}/api/image?id=../catalog.json`)).status,
          400,
        )
      },
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
