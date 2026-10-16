import "fake-indexeddb/auto"
import assert from "node:assert/strict"
import test from "node:test"

globalThis.BroadcastChannel = class extends EventTarget {
  postMessage() {}
}
const api = await import("../src/lib/local-api.js")
const password = "Creme-local-teste-123!"
const replacement = "Nova-senha-local-456!"

test("administração local exige senha e gerencia todo o catálogo", async (t) => {
  let recipe
  await t.test("bloqueia edição e exclusão antes da configuração", async () => {
    const snapshot = await api.getSnapshot()
    recipe = snapshot.recipes.find((recipe) => recipe.id === "1")
    assert.deepEqual(snapshot.admin, {
      configured: false,
      authenticated: false,
    })
    await assert.rejects(
      api.saveRecipe({ ...recipe, title: "Não permitido" }, recipe.id),
      /administrador/,
    )
    await assert.rejects(api.deleteRecipe(recipe.id), /administrador/)
    await assert.rejects(api.setupAdmin("curta"), /10 a 128/)
    await assert.rejects(api.setupAdmin(" ".repeat(12)), /10 a 128/)
    assert.equal((await api.getSnapshot()).admin.configured, false)
  })

  await t.test(
    "cria senha sem armazenar texto puro e impede nova configuração",
    async () => {
      await api.setupAdmin(password)
      assert.deepEqual((await api.getSnapshot()).admin, {
        configured: true,
        authenticated: true,
      })
      await assert.rejects(api.setupAdmin("outra-senha-teste"), /Já existe/)
      const credential = await new Promise((resolve, reject) => {
        const request = indexedDB.open("ninja-creami-fit", 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction("settings", "readonly")
          const read = transaction.objectStore("settings").get("admin")
          read.onsuccess = () => resolve(read.result)
          transaction.oncomplete = () => database.close()
        }
      })
      assert.equal(credential.hash.length, 64)
      assert.equal(credential.salt.length, 32)
      assert.equal(credential.iterations, 600000)
      assert.ok(!JSON.stringify(credential).includes(password))
      assert.ok(
        !JSON.stringify((await api.getSnapshot()).admin).includes(
          credential.hash,
        ),
      )
    },
  )

  await t.test(
    "rejeita senha incorreta e uma nova instância não herda a sessão",
    async () => {
      api.logoutAdmin()
      await assert.rejects(api.loginAdmin("incorreta"), /Senha incorreta/)
      assert.equal((await api.getSnapshot()).admin.authenticated, false)
      await api.loginAdmin(password)
      const otherTab = await import("../src/lib/local-api.js?other-tab")
      assert.deepEqual((await otherTab.getSnapshot()).admin, {
        configured: true,
        authenticated: false,
      })
      await assert.rejects(otherTab.deleteRecipe(recipe.id), /administrador/)
    },
  )

  await t.test(
    "edita receita de exemplo sem trocar sua foto, alterando macros, autor e estrelas",
    async () => {
      await api.saveRecipe(
        {
          ...recipe,
          title: "Morango da administração",
          protein: 42.5,
          calories: 310,
        },
        recipe.id,
        { author: "Chef Admin", rating: 4.2, votes: 1000 },
      )
      recipe = (await api.getSnapshot()).recipes.find(
        (item) => item.id === recipe.id,
      )
      assert.equal(recipe.title, "Morango da administração")
      assert.equal(recipe.author, "Chef Admin")
      assert.equal(recipe.protein, 42.5)
      assert.equal(recipe.calories, 310)
      assert.equal(recipe.rating, 4.2)
      assert.equal(recipe.votes, 1000)
      assert.ok(recipe.image.startsWith("https://"))
    },
  )

  await t.test(
    "preserva votos ao editar detalhes e aplica totais exatos quando o admin os altera",
    async () => {
      await api.rateRecipe(recipe.id, 5)
      recipe = (await api.getSnapshot()).recipes.find(
        (item) => item.id === recipe.id,
      )
      await api.saveRecipe({ ...recipe, fat: 8 }, recipe.id, {
        author: recipe.author,
        rating: recipe.rating,
        votes: recipe.votes,
      })
      recipe = (await api.getSnapshot()).recipes.find(
        (item) => item.id === recipe.id,
      )
      assert.equal(recipe.ownRating, 5)
      assert.equal(recipe.votes, 1001)
      await api.saveRecipe(recipe, recipe.id, {
        author: recipe.author,
        rating: 3.7,
        votes: 250,
      })
      recipe = (await api.getSnapshot()).recipes.find(
        (item) => item.id === recipe.id,
      )
      assert.equal(recipe.ownRating, 0)
      assert.equal(recipe.votes, 250)
      assert.equal(recipe.rating, 3.7)
      await api.rateRecipe(recipe.id, 4)
      assert.equal(
        (await api.getSnapshot()).recipes.find((item) => item.id === recipe.id)
          .votes,
        251,
      )
    },
  )

  await t.test(
    "valida estrelas, contagem, autor e imagem sem salvar alterações parciais",
    async () => {
      const before = (await api.getSnapshot()).recipes.find(
        (item) => item.id === recipe.id,
      )
      for (const details of [
        { author: "Chef", rating: -1, votes: 10 },
        { author: "Chef", rating: 5.1, votes: 10 },
        { author: "Chef", rating: 3.75, votes: 10 },
        { author: "Chef", rating: NaN, votes: 10 },
        { author: "Chef", rating: 3, votes: -1 },
        { author: "Chef", rating: 3, votes: 1.5 },
        { author: "Chef", rating: 0, votes: 10 },
        { author: "Chef", rating: 3, votes: 0 },
        { author: " ", rating: 3, votes: 10 },
      ])
        await assert.rejects(
          api.saveRecipe(
            { ...before, title: "Não deve salvar" },
            recipe.id,
            details,
          ),
        )
      await assert.rejects(
        api.saveRecipe(
          { ...before, image: "https://outro.example/image.jpg" },
          recipe.id,
        ),
      )
      assert.deepEqual(
        (await api.getSnapshot()).recipes.find((item) => item.id === recipe.id),
        before,
      )
      await api.saveRecipe(before, recipe.id, {
        author: before.author,
        rating: 0,
        votes: 0,
      })
      recipe = (await api.getSnapshot()).recipes.find(
        (item) => item.id === recipe.id,
      )
      assert.equal(recipe.votes, 0)
      assert.equal(recipe.rating, 0)
      assert.equal(recipe.ownRating, 0)
    },
  )

  await t.test(
    "altera senha verificando a atual e invalida outras sessões",
    async () => {
      const otherTab = await import("../src/lib/local-api.js?other-tab")
      await otherTab.loginAdmin(password)
      await assert.rejects(
        api.changeAdminPassword("incorreta", replacement),
        /Senha atual incorreta/,
      )
      await api.changeAdminPassword(password, replacement)
      assert.equal((await otherTab.getSnapshot()).admin.authenticated, false)
      await assert.rejects(otherTab.deleteRecipe(recipe.id), /administrador/)
      api.logoutAdmin()
      await assert.rejects(api.loginAdmin(password), /Senha incorreta/)
      await api.loginAdmin(replacement)
      assert.equal((await api.getSnapshot()).admin.authenticated, true)
    },
  )

  await t.test(
    "exclui uma receita de exemplo com seus relacionamentos e bloqueia após sair",
    async () => {
      await api.toggleFavorite(recipe.id)
      await api.rateRecipe(recipe.id, 4)
      await api.deleteRecipe(recipe.id)
      const snapshot = await api.getSnapshot()
      assert.equal(snapshot.recipes.length, 5)
      assert.ok(!snapshot.recipes.some((item) => item.id === recipe.id))
      api.logoutAdmin()
      await assert.rejects(
        api.saveRecipe(snapshot.recipes[0], snapshot.recipes[0].id),
        /administrador/,
      )
      await assert.rejects(
        api.deleteRecipe(snapshot.recipes[0].id),
        /administrador/,
      )
      const reloaded = await import("../src/lib/local-api.js?reload-admin")
      assert.deepEqual((await reloaded.getSnapshot()).admin, {
        configured: true,
        authenticated: false,
      })
      assert.equal((await reloaded.getSnapshot()).recipes.length, 5)
    },
  )

  await t.test(
    "o administrador altera uma receita do autor sem remover seu vínculo de edição",
    async () => {
      const input = {
        ...recipe,
        title: "Receita do perfil local",
        image: "data:image/jpeg;base64,aGVsbG8=",
        authorName: "Autor local",
      }
      const id = await api.saveRecipe(input)
      let snapshot = await api.getSnapshot()
      const ownerId = snapshot.profile.id
      const own = snapshot.recipes.find((item) => item.id === id)
      await api.loginAdmin(replacement)
      await api.saveRecipe(own, id, {
        author: "Nome revisado pelo admin",
        rating: 4.5,
        votes: 80,
      })
      api.logoutAdmin()
      snapshot = await api.getSnapshot()
      const moderated = snapshot.recipes.find((item) => item.id === id)
      assert.equal(moderated.author, "Nome revisado pelo admin")
      assert.equal(moderated.authorId, ownerId)
      await api.saveRecipe(
        { ...moderated, title: "Autor ainda pode editar" },
        id,
      )
      const edited = (await api.getSnapshot()).recipes.find(
        (item) => item.id === id,
      )
      assert.equal(edited.title, "Autor ainda pode editar")
      assert.equal(edited.votes, 80)
      assert.equal(edited.rating, 4.5)
      assert.equal(edited.authorId, ownerId)
      await api.deleteRecipe(id)
      assert.ok(
        !(await api.getSnapshot()).recipes.some((item) => item.id === id),
      )
    },
  )
})
