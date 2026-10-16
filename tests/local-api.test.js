import "fake-indexeddb/auto"
import assert from "node:assert/strict"
import test from "node:test"

// Cross-tab browser messages have no recipient in this single-process test.
globalThis.BroadcastChannel = class extends EventTarget {
  postMessage() {}
}
const api = await import("../src/lib/local-api.js")

const input = {
  title: "Coco & açaí da casa",
  category: "Veganos",
  image: "data:image/jpeg;base64,aGVsbG8=",
  program: "sorbet",
  respin: false,
  toppings: "Granola",
  ingredients: ["200 ml de bebida de coco", "100 g de açaí"],
  instructions: [
    "Misture a base.",
    "Congele por 24 horas.",
    "Processe no modo Sorbet.",
  ],
  protein: 24.5,
  carbs: 22,
  fat: 6,
  calories: 240,
}

test("o catálogo local preserva o fluxo completo de uma receita", async (t) => {
  let id
  let initial
  await t.test("inicializa o catálogo e o perfil uma única vez", async () => {
    initial = await api.getSnapshot()
    assert.equal(initial.recipes.length, 6)
    assert.ok(initial.profile.id)
    assert.ok(
      initial.recipes.every(
        (recipe) => !recipe.isFavorite && recipe.ownRating === 0,
      ),
    )
    const second = await api.getSnapshot()
    assert.deepEqual(second, initial)
  })

  await t.test(
    "salva nome, foto, macros, toppings e etapas sem perder os dados originais",
    async () => {
      id = await api.saveRecipe({ ...input, authorName: "  Júlia  " })
      const snapshot = await api.getSnapshot()
      const recipe = snapshot.recipes.find((recipe) => recipe.id === id)
      assert.equal(snapshot.recipes.length, 7)
      assert.equal(snapshot.profile.name, "Júlia")
      assert.equal(recipe.author, "Júlia")
      assert.equal(recipe.authorId, snapshot.profile.id)
      for (const [key, value] of Object.entries(input))
        assert.deepEqual(recipe[key], value)
      assert.equal(recipe.rating, 0)
      assert.equal(recipe.votes, 0)
      assert.equal(snapshot.recipes[0].id, id)
    },
  )

  await t.test(
    "busca ingredientes sem diferenciar acentos e aplica categoria, coleção e ordenação",
    async () => {
      const snapshot = await api.getSnapshot()
      assert.ok(
        api
          .filterRecipes(snapshot.recipes, { query: "bebida coco" })
          .some((recipe) => recipe.id === id),
      )
      assert.ok(
        api
          .filterRecipes(snapshot.recipes, { query: "ACAI" })
          .some((recipe) => recipe.id === id),
      )
      assert.equal(
        api.filterRecipes(snapshot.recipes, {
          query: "bebida coco",
          category: "Chocolate",
        }).length,
        0,
      )
      assert.equal(
        api.filterRecipes(snapshot.recipes, {
          collection: "mine",
          profileId: snapshot.profile.id,
        }).length,
        1,
      )
      assert.equal(
        api.filterRecipes(snapshot.recipes, { collection: "favorites" }).length,
        0,
      )
      const byProtein = api.filterRecipes(snapshot.recipes, { sort: "protein" })
      assert.ok(
        byProtein.every(
          (recipe, index) =>
            !index || byProtein[index - 1].protein >= recipe.protein,
        ),
      )
      const byCalories = api.filterRecipes(snapshot.recipes, {
        sort: "calories",
      })
      assert.ok(
        byCalories.every(
          (recipe, index) =>
            !index || byCalories[index - 1].calories <= recipe.calories,
        ),
      )
      assert.equal(
        snapshot.recipes[0].id,
        id,
        "a ordenação não altera o catálogo original",
      )
    },
  )

  await t.test(
    "persiste favoritos e substitui a nota anterior sem duplicar avaliações",
    async () => {
      await api.toggleFavorite(id)
      await api.rateRecipe(id, 5)
      let snapshot = await api.getSnapshot()
      let recipe = snapshot.recipes.find((recipe) => recipe.id === id)
      assert.equal(recipe.isFavorite, true)
      assert.equal(recipe.rating, 5)
      assert.equal(recipe.votes, 1)
      await api.rateRecipe(id, 2)
      snapshot = await api.getSnapshot()
      recipe = snapshot.recipes.find((recipe) => recipe.id === id)
      assert.equal(recipe.rating, 2)
      assert.equal(recipe.votes, 1)
      assert.equal(recipe.ownRating, 2)
      await api.toggleFavorite(id)
      assert.equal(
        (await api.getSnapshot()).recipes.find((recipe) => recipe.id === id)
          .isFavorite,
        false,
      )
      await api.rateRecipe("1", 4)
      await api.rateRecipe("1", 3)
      const seed = (await api.getSnapshot()).recipes.find(
        (recipe) => recipe.id === "1",
      )
      assert.equal(
        seed.votes,
        initial.recipes.find((recipe) => recipe.id === "1").votes + 1,
      )
    },
  )

  await t.test(
    "recupera o mesmo banco ao carregar uma nova instância da API",
    async () => {
      const reloaded = await import("../src/lib/local-api.js?reload")
      const snapshot = await reloaded.getSnapshot()
      assert.equal(snapshot.recipes.length, 7)
      assert.equal(snapshot.profile.name, "Júlia")
      const recipe = snapshot.recipes.find((recipe) => recipe.id === id)
      assert.equal(recipe.image, input.image)
      assert.equal(recipe.ownRating, 2)
    },
  )

  await t.test(
    "edita a receita mantendo as avaliações e atualiza o nome do autor",
    async () => {
      await api.saveRecipe(
        { ...input, title: "Coco atualizado", protein: 30, respin: true },
        id,
      )
      await api.saveProfile("Júlia Silva")
      const snapshot = await api.getSnapshot()
      const recipe = snapshot.recipes.find((recipe) => recipe.id === id)
      assert.equal(recipe.title, "Coco atualizado")
      assert.equal(recipe.protein, 30)
      assert.equal(recipe.respin, true)
      assert.equal(recipe.author, "Júlia Silva")
      assert.equal(recipe.ownRating, 2)
      assert.equal(recipe.votes, 1)
      assert.equal(snapshot.recipes.length, 7)
    },
  )

  await t.test(
    "lembra o nome sem mudar a autoria e impede alterar os totais de estrelas",
    async () => {
      const before = await api.getSnapshot()
      assert.equal(before.admin.authenticated, false)
      const own = before.recipes.find((recipe) => recipe.id === id)
      await assert.rejects(
        api.saveRecipe(own, id, {
          author: "Júlia Silva",
          rating: 5,
          votes: 1000,
        }),
        /administrador/,
      )
      await api.saveRecipe(
        {
          ...own,
          authorName: "Júlia Cozinha",
          authorId: "outro-perfil",
          rating: 5,
          votes: 1000,
        },
        id,
      )
      const after = await api.getSnapshot()
      const updated = after.recipes.find((recipe) => recipe.id === id)
      assert.equal(after.profile.name, "Júlia Cozinha")
      assert.equal(after.profile.id, before.profile.id)
      assert.equal(updated.authorId, before.profile.id)
      assert.equal(updated.author, "Júlia Cozinha")
      assert.equal(updated.rating, own.rating)
      assert.equal(updated.votes, own.votes)
      assert.equal(updated.ownRating, own.ownRating)
    },
  )

  await t.test(
    "salva nome e receita juntos e rejeita nomes inválidos sem alterações parciais",
    async () => {
      const before = await api.getSnapshot()
      await assert.rejects(
        api.saveRecipe({
          ...input,
          authorName: " ",
          title: "Receita inválida",
        }),
      )
      await assert.rejects(
        api.saveRecipe({ ...input, authorName: "Outro nome", protein: -1 }),
      )
      await assert.rejects(
        api.saveRecipe({ ...input, authorName: "a".repeat(61) }, id),
      )
      assert.deepEqual(await api.getSnapshot(), before)
    },
  )

  await t.test(
    "usar o nome de outra pessoa não concede autoria das receitas dela",
    async () => {
      const before = await api.getSnapshot()
      const seed = before.recipes.find((recipe) => recipe.id === "1")
      await api.saveProfile(seed.author)
      await assert.rejects(
        api.saveRecipe({ ...seed, authorId: before.profile.id }, seed.id),
        /administrador/,
      )
      await assert.rejects(api.deleteRecipe(seed.id), /administrador/)
      const after = await api.getSnapshot()
      assert.equal(after.profile.id, before.profile.id)
      assert.equal(
        api.filterRecipes(after.recipes, {
          collection: "mine",
          profileId: after.profile.id,
        }).length,
        1,
      )
      await api.saveProfile(before.profile.name)
    },
  )

  await t.test(
    "rejeita dados inválidos sem gravar receitas parciais",
    async () => {
      for (const change of [
        { title: "  " },
        { category: "inválida" },
        { program: "toString" },
        { protein: -1 },
        { carbs: NaN },
        { calories: Infinity },
        { fat: 10001 },
        { ingredients: [" "] },
        { ingredients: [] },
        { instructions: [] },
        { image: "blob:temporario" },
        { respin: "sim" },
        { toppings: "a".repeat(501) },
      ])
        await assert.rejects(api.saveRecipe({ ...input, ...change }))
      for (const value of [0, 6, 1.5, NaN])
        await assert.rejects(api.rateRecipe(id, value))
      await assert.rejects(api.saveProfile(" "))
      await assert.rejects(api.saveProfile("a".repeat(61)))
      assert.equal((await api.getSnapshot()).recipes.length, 7)
    },
  )

  await t.test(
    "exige todos os macros e calorias no cadastro e na edição, aceitando zero explícito",
    async () => {
      const before = await api.getSnapshot()
      for (const key of ["protein", "carbs", "fat", "calories"]) {
        const missing = { ...input }
        delete missing[key]
        await assert.rejects(api.saveRecipe(missing))
        await assert.rejects(api.saveRecipe(missing, id))
        for (const value of ["", " ", null, undefined, NaN]) {
          await assert.rejects(api.saveRecipe({ ...input, [key]: value }))
        }
      }
      assert.deepEqual(await api.getSnapshot(), before)
      const own = before.recipes.find((recipe) => recipe.id === id)
      await api.saveRecipe(
        { ...own, protein: 0, carbs: 0, fat: 0, calories: 0 },
        id,
      )
      const zero = (await api.getSnapshot()).recipes.find(
        (recipe) => recipe.id === id,
      )
      for (const key of ["protein", "carbs", "fat", "calories"])
        assert.equal(zero[key], 0)
      assert.equal(zero.ownRating, own.ownRating)
      assert.equal(zero.votes, own.votes)
      assert.equal("prepMinutes" in zero, false)
      await api.saveRecipe(own, id)
    },
  )

  await t.test(
    "protege o catálogo de exemplo contra alterações do perfil local",
    async () => {
      await assert.rejects(api.saveRecipe(input, "1"), /administrador/)
      await assert.rejects(api.deleteRecipe("1"), /administrador/)
      await assert.rejects(api.saveRecipe(input, "nao-existe"))
      assert.equal((await api.getSnapshot()).recipes.length, 7)
    },
  )

  await t.test(
    "exclui receita, favorito e nota em uma única operação",
    async () => {
      await api.toggleFavorite(id)
      await api.deleteRecipe(id)
      const snapshot = await api.getSnapshot()
      assert.equal(snapshot.recipes.length, 6)
      assert.ok(!snapshot.recipes.some((recipe) => recipe.id === id))
      assert.equal(
        api.filterRecipes(snapshot.recipes, { collection: "favorites" }).length,
        0,
      )
      await assert.rejects(api.rateRecipe(id, 5), /não está mais disponível/)
      await assert.rejects(api.toggleFavorite(id), /não está mais disponível/)
    },
  )
})
