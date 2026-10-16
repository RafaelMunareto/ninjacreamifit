import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import {
  createFoodCatalog,
  searchFoodsWithFallback,
} from "../src/lib/nutrition.js"
import { createFoodHandler } from "../server/foods.js"

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
  const offline = await searchFoodsWithFallback(local, "outro", 20, "all", async () => {
    throw new Error("offline")
  })
  assert.equal(offline.total, 0)
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
    assert.equal(
      (
        await (
          await fetch(`${base}/api/foods?q=alimento-inexistente-xyz`)
        ).json()
      ).total,
      0,
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
