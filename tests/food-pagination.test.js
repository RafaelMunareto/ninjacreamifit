import test from "node:test"
import assert from "node:assert/strict"
import { createFoodCatalog, searchFoodPage } from "../src/lib/nutrition.js"
const food = (id, calories) => ({
  id,
  name: "Iogurte Zero " + id,
  source: "FatSecret",
  category: "",
  calories,
  protein: 10,
  carbs: 5,
  fat: 1,
})

test("mais páginas preservam fontes, retiram duplicatas e reordenam calorias sem perder o cursor", async () => {
  const original = globalThis.fetch
  try {
    const catalog = createFoodCatalog([food("TBCA:local", 40)])
    globalThis.fetch = async (url) => {
      assert.ok(String(url).includes("cursor=0%2C0"))
      return Response.json({
        foods: [food("FATSECRET:1", 60)],
        total: 1,
        nextCursor: "1,-1",
        providerTotals: { FatSecret: 57 },
      })
    }
    const first = await searchFoodPage(catalog, "iogurte zero")
    assert.equal(first.nextCursor, "1,-1")
    assert.equal(first.providerTotals.FatSecret, 57)
    globalThis.fetch = async (url) => {
      assert.ok(String(url).includes("cursor=1%2C-1"))
      return Response.json({
        foods: [food("FATSECRET:1", 60), food("FATSECRET:2", 25)],
        total: 2,
        nextCursor: null,
      })
    }
    const second = await searchFoodPage(
      catalog,
      "iogurte zero",
      first.nextCursor,
      undefined,
      first.foods,
    )
    assert.deepEqual(
      second.foods.map((f) => f.calories),
      [25, 40, 60],
    )
    assert.equal(second.nextCursor, null)
    assert.equal(second.total, 3)
  } finally {
    globalThis.fetch = original
  }
})

test("falha mantém dados e o cursor para tentar novamente; cancelamento não vira resultado vazio", async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      throw new Error("offline")
    }
    const result = await searchFoodPage(
      createFoodCatalog([]),
      "iogurte zero",
      "2,-1",
      undefined,
      [food("FATSECRET:1", 50)],
    )
    assert.equal(result.foods.length, 1)
    assert.equal(result.nextCursor, "2,-1")
    globalThis.fetch = async () => {
      throw new DOMException("cancelado", "AbortError")
    }
    await assert.rejects(
      searchFoodPage(createFoodCatalog([]), "iogurte zero"),
      { name: "AbortError" },
    )
  } finally {
    globalThis.fetch = original
  }
})

test("produto local e produto de nova página ficam antes de pratos que apenas contêm o ingrediente", async () => {
  const original = globalThis.fetch
  const dessert = {
    ...food("TBCA:pave", 85),
    name: "Pavê, baunilha, (leite, leite condensado, biscoito)",
  }
  const condensed = {
    ...food("TBCA:condensado", 319),
    name: "Leite, vaca, condensado, c/ açúcar, enlatado",
  }
  const light = {
    ...food("FATSECRET:light", 250),
    name: "Leite Condensado Light (Marca)",
  }
  try {
    const catalog = createFoodCatalog([dessert, condensed])
    globalThis.fetch = async () =>
      Response.json({ foods: [], nextCursor: "50,-1" })
    const first = await searchFoodPage(catalog, "leite condensado")
    assert.deepEqual(
      first.foods.map((food) => food.id),
      [condensed.id, dessert.id],
    )
    globalThis.fetch = async () =>
      Response.json({
        foods: [
          light,
          dessert,
          {
            ...food("OFF:drink", 50),
            name: "Coquetel, (leite condensado e frutas)",
          },
        ],
        nextCursor: null,
      })
    const second = await searchFoodPage(
      catalog,
      "leite condensado",
      first.nextCursor,
      undefined,
      first.foods,
    )
    assert.deepEqual(
      second.foods.map((food) => food.id),
      [light.id, condensed.id, "OFF:drink", dessert.id],
    )
    assert.equal(second.total, 4)
    assert.equal(second.nextCursor, null)
    assert.equal(first.foods.length, 2)
  } finally {
    globalThis.fetch = original
  }
})
