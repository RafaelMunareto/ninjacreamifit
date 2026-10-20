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

test("código colado com separadores usa a consulta por barras e preserva zeros iniciais", async () => {
  const original = globalThis.fetch
  try {
    for (const [query, barcode] of [
      ["0 12345 67890-5", "012345678905"],
      ["7 891234 567895", "7891234567895"],
      [" 00.123.456 ", "00123456"],
    ]) {
      globalThis.fetch = async (url) => {
        const params = new URL(String(url), "https://example.test").searchParams
        assert.equal(params.get("barcode"), barcode)
        assert.equal(params.has("q"), false)
        assert.equal(params.has("cursor"), false)
        return Response.json({ foods: [food("FATSECRET:1", 60)], total: 1 })
      }
      const result = await searchFoodPage(createFoodCatalog([]), query)
      assert.equal(result.foods[0].id, "FATSECRET:1")
      assert.equal(result.nextCursor, null)
    }
    globalThis.fetch = async (url) => {
      const params = new URL(String(url), "https://example.test").searchParams
      assert.equal(params.get("q"), "Whey 100-000000")
      assert.equal(params.has("barcode"), false)
      return Response.json({ foods: [], total: 0, nextCursor: null })
    }
    await searchFoodPage(createFoodCatalog([]), "Whey 100-000000")
  } finally {
    globalThis.fetch = original
  }
})

test("alimento remoto com nome aproximado sobrevive à mescla e à paginação", async () => {
  const original = globalThis.fetch
  const pineapple = {
    ...food("FATSECRET:pineapple", 100),
    name: "Pineapple Whey",
  }
  try {
    globalThis.fetch = async () =>
      Response.json({
        foods: [
          pineapple,
          { ...pineapple, id: "OFF:juice", name: "Pineapple Juice" },
        ],
        nextCursor: "10,-1",
      })
    const first = await searchFoodPage(createFoodCatalog([]), "pineaple whey")
    assert.deepEqual(
      first.foods.map((food) => food.id),
      [pineapple.id],
    )
    globalThis.fetch = async () =>
      Response.json({
        foods: [{ ...pineapple, id: "OFF:2", calories: 80 }],
        nextCursor: null,
      })
    const next = await searchFoodPage(
      createFoodCatalog([]),
      "pineaple whey",
      first.nextCursor,
      undefined,
      first.foods,
    )
    assert.deepEqual(
      next.foods.map((food) => food.id),
      ["OFF:2", pineapple.id],
    )
    assert.equal(next.nextCursor, null)
  } finally {
    globalThis.fetch = original
  }
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
    assert.equal(result.nextCursor, null)
    assert.equal(result.retryCursor, "2,-1")
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

test("fonte com falha não bloqueia páginas saudáveis e só ela volta na retomada", async () => {
  const original = globalThis.fetch
  try {
    const catalog = createFoodCatalog([])
    globalThis.fetch = async () =>
      Response.json({
        foods: [food("FATSECRET:1", 50)],
        nextCursor: "10,0",
        sourceDiagnostics: {
          FatSecret: "ok",
          "Open Food Facts": "rate_limited",
        },
      })
    const first = await searchFoodPage(catalog, "iogurte zero")
    assert.equal(first.nextCursor, "10,-1")
    assert.equal(first.retryCursor, "10,0")
    globalThis.fetch = async (url) => {
      assert.equal(
        new URL(url, "https://test.example").searchParams.get("cursor"),
        "10,-1",
      )
      return Response.json({
        foods: [food("FATSECRET:2", 60)],
        nextCursor: null,
        sourceDiagnostics: { FatSecret: "ok" },
      })
    }
    const next = await searchFoodPage(
      catalog,
      "iogurte zero",
      first.nextCursor,
      undefined,
      first.foods,
      first,
    )
    assert.equal(next.nextCursor, null)
    assert.equal(next.retryCursor, "-1,0")
    assert.equal(next.sourceDiagnostics["Open Food Facts"], "rate_limited")
    globalThis.fetch = async (url) => {
      assert.equal(
        new URL(url, "https://test.example").searchParams.get("cursor"),
        "-1,0",
      )
      return Response.json({
        foods: [food("OFF:3", 40)],
        nextCursor: null,
        sourceDiagnostics: { "Open Food Facts": "ok" },
      })
    }
    const retried = await searchFoodPage(
      catalog,
      "iogurte zero",
      next.retryCursor,
      undefined,
      next.foods,
      next,
    )
    assert.equal(retried.retryCursor, null)
    assert.equal(retried.nextCursor, null)
    assert.equal(retried.sourceDiagnostics["Open Food Facts"], "ok")
    assert.deepEqual(
      retried.foods.map((f) => f.id),
      ["OFF:3", "FATSECRET:1", "FATSECRET:2"],
    )
  } finally {
    globalThis.fetch = original
  }
})
