import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import {
  createFoodCatalog,
  searchFoodApi,
  searchFoods,
  searchFoodsWithFallback,
} from "../src/lib/nutrition.js"
import { createFoodHandler } from "../scripts/legacy-server/foods.js"

const food = {
  id: "C0001C",
  name: "Banana",
  category: "Fruta",
  calories: 90,
  protein: 1,
  carbs: 20,
  fat: 0,
}
const local = createFoodCatalog([food])

test("iogurte zero exclui água, Perly e nomes sem todos os termos antes de ordenar por calorias", async () => {
  const yogurt = {
    ...food,
    id: "FATSECRET:1",
    name: "Iogurte Zero Morango",
    source: "FatSecret",
    calories: 27,
  }
  const greek = {
    ...yogurt,
    id: "FATSECRET:2",
    name: "Iogurte Grego Pense Zero",
    calories: 60,
  }
  const water = {
    ...food,
    id: "OFF:6111035000430",
    name: "Sidi Ali",
    category: "Iogurte zero",
    calories: 0,
  }
  const perly = {
    ...water,
    id: "OFF:6111242100992",
    name: "Perly",
    calories: 1,
  }
  const plain = {
    ...yogurt,
    id: "FATSECRET:3",
    name: "Iogurte Desnatado",
    calories: 20,
  }
  const catalog = createFoodCatalog([water, perly])
  assert.equal(searchFoods(catalog, "iogurte zero").total, 0)
  const result = await searchFoodsWithFallback(
    catalog,
    "IÓGURTE zÉro",
    20,
    "all",
    async () => ({
      foods: [water, plain, greek, perly, yogurt],
      total: 5,
    }),
  )
  assert.deepEqual(
    result.foods.map((entry) => entry.id),
    [yogurt.id, greek.id],
  )
  assert.equal(result.total, 2)
})

test("o cliente filtra nomes remotos sem aplicar termos de busca a um código de barras", async () => {
  const originalFetch = globalThis.fetch
  try {
    const yogurt = { ...food, id: "FATSECRET:1", name: "Iogurte Zero Morango" }
    const water = {
      ...food,
      id: "OFF:6111035000430",
      name: "Sidi Ali",
      calories: 0,
    }
    globalThis.fetch = async () =>
      Response.json({ foods: [water, yogurt], total: 2 })
    assert.deepEqual(
      (await searchFoodApi("iogurte zero", 20)).foods.map((entry) => entry.id),
      [yogurt.id],
    )
    globalThis.fetch = async () => Response.json({ foods: [yogurt], total: 1 })
    assert.deepEqual(
      (await searchFoodApi("7891000100103", 20)).foods.map((entry) => entry.id),
      [yogurt.id],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("todas as fontes são consultadas e os resultados são combinados", async () => {
  let calls = 0
  const remote = async () => {
    calls++
    return { foods: [{ ...food, id: "IBGE:1:na", source: "IBGE" }], total: 1 }
  }
  assert.equal(
    (await searchFoodsWithFallback(local, "banana", 20, "all", remote)).source,
    "Todas",
  )
  assert.equal(calls, 1)
  assert.equal(
    (await searchFoodsWithFallback(local, "outro", 20, "all", remote)).source,
    "Todas",
  )
  assert.equal(calls, 2)
  assert.equal(
    (
      await searchFoodsWithFallback(
        createFoodCatalog([{ ...food, protein: null }]),
        "banana",
        20,
        "all",
        remote,
      )
    ).fallback,
    false,
  )
  assert.equal(calls, 3)
  await searchFoodsWithFallback(local, "a", 20, "all", remote)
  assert.equal(calls, 3)
  const noResults = await searchFoodsWithFallback(
    local,
    "inexistente",
    20,
    "all",
    async () => ({ foods: [], total: 0 }),
  )
  assert.equal(noResults.total, 0)
  const reverse = await searchFoodsWithFallback(
    local,
    "banana",
    20,
    "IBGE",
    async () => ({ foods: [], total: 0 }),
  )
  assert.equal(reverse.source, "Todas")
  assert.equal(reverse.fallback, false)
  const unavailable = async () => {
    throw new Error("offline")
  }
  assert.equal(
    (await searchFoodsWithFallback(local, "banana", 20, "IBGE", unavailable))
      .source,
    "Todas",
  )
  const incomplete = await searchFoodsWithFallback(
    createFoodCatalog([{ ...food, protein: null }]),
    "banana",
    20,
    "all",
    async () => ({ foods: [], total: 0 }),
  )
  assert.equal(incomplete.foods[0].protein, null)
  const offline = await searchFoodsWithFallback(
    local,
    "outro",
    20,
    "all",
    async () => {
      throw new Error("offline")
    },
  )
  assert.equal(offline.total, 0)
})

test("busca remota e fallback mantêm o ingrediente antes de receitas com menos calorias", async () => {
  const originalFetch = globalThis.fetch
  const condensed = {
    ...food,
    id: "FATSECRET:condensado",
    source: "FatSecret",
    name: "Leite Condensado (Marca)",
    calories: 319,
  }
  const dessert = {
    ...food,
    id: "TBCA:pave",
    name: "Pavê (leite condensado, creme de leite)",
    calories: 85,
  }
  try {
    globalThis.fetch = async () =>
      Response.json({ foods: [dessert, condensed], total: 2 })
    assert.deepEqual(
      (await searchFoodApi("leite condensado", 20)).foods.map(
        (food) => food.id,
      ),
      [condensed.id, dessert.id],
    )
    const result = await searchFoodsWithFallback(
      createFoodCatalog([dessert]),
      "leite condensado",
      1,
      "all",
      async () => ({ foods: [condensed], total: 1 }),
    )
    assert.equal(result.foods[0].id, condensed.id)
    assert.equal(result.total, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("API do projeto busca o IBGE do repositório e restaura códigos salvos", async () => {
  const server = createServer(createFoodHandler())
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    let response = await fetch(`${base}/api/foods?q=6300101`)
    assert.equal(response.status, 200)
    let data = await response.json()
    assert.equal(data.foods[0].id, "IBGE:6300101:na")
    assert.equal(data.foods[0].calories, 135.62)
    response = await fetch(
      `${base}/api/foods?ids=IBGE:6300101:na,IBGE:6300701:2`,
    )
    data = await response.json()
    assert.deepEqual(
      data.foods.map((f) => f.id),
      ["IBGE:6300101:na", "IBGE:6300701:2"],
    )
    assert.ok(
      Array.isArray(
        (
          await (
            await fetch(`${base}/api/foods?q=zzzzzzzzzz-inexistente-987654321`)
          ).json()
        ).foods,
      ),
    )
    for (const suffix of ["?q=a", "?q=banana&limit=99999", "?ids=unknown"])
      assert.equal((await fetch(`${base}/api/foods${suffix}`)).status, 400)
    assert.equal(
      (await fetch(`${base}/api/foods?q=banana`, { method: "POST" })).status,
      405,
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
