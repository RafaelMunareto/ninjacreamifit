import { readFile } from "node:fs/promises"
import { createFoodCatalog, searchFoods } from "../src/lib/nutrition.js"

let loading
const getCatalog = () => {
  if (!loading)
    loading = readFile(
      new URL("../public/data/ibge-foods-v1.json", import.meta.url),
      "utf8",
    )
      .then((text) => createFoodCatalog(JSON.parse(text).foods))
      .catch((error) => {
        loading = undefined
        throw error
      })
  return loading
}

export function createFoodHandler(load = getCatalog) {
  return async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8")
    response.setHeader("X-Content-Type-Options", "nosniff")
    try {
      if (request.method !== "GET") {
        response.statusCode = 405
        response.setHeader("Allow", "GET")
        response.end(JSON.stringify({ error: "Método não permitido." }))
        return
      }
      const url = new URL(request.url, "http://localhost")
      const ids = url.searchParams.get("ids")
      const query = url.searchParams.get("q") || ""
      const barcode = url.searchParams.get("barcode") || ""
      const limit = Number(url.searchParams.get("limit") || 20)
      if (
        ids !== null
          ? !ids ||
            ids.split(",").length > 50 ||
            !ids
              .split(",")
              .every((id) =>
                /^(?:IBGE:\d{1,10}:(?:na|\d{1,3})|OFF:[A-Za-z0-9._-]{1,80}|FATSECRET:\d+)$/.test(
                  id,
                ),
              )
          : (!barcode && query.trim().length < 2) ||
            query.length > 100 ||
            (barcode && !/^\d{8,14}$/.test(barcode)) ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 2000
      ) {
        response.statusCode = 400
        response.end(JSON.stringify({ error: "Busca de alimentos inválida." }))
        return
      }
      const catalog = await load()
      const result =
        ids !== null
          ? {
              foods: (
                await Promise.all(
                  [...new Set(ids.split(","))].map(
                    async (id) =>
                      catalog.byId.get(id) ||
                      (id.startsWith("FATSECRET:")
                        ? (await searchFatSecret("", id.slice(11), 1)).foods[0]
                        : null),
                  ),
                )
              ).filter(Boolean),
            }
          : await searchAllSources(catalog, query, barcode, limit)
      response.statusCode = 200
      response.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600")
      response.end(JSON.stringify({ ...result, source: "IBGE" }))
    } catch {
      response.statusCode = 503
      response.setHeader("Cache-Control", "no-store")
      response.end(
        JSON.stringify({ error: "A busca complementar está indisponível." }),
      )
    }
  }
}

async function searchOpenFoodFacts(query, limit, barcode = "") {
  const endpoint = barcode
    ? new URL(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      )
    : new URL("https://world.openfoodfacts.org/api/v2/search")
  if (!barcode) {
    endpoint.searchParams.set("search_terms", query)
    endpoint.searchParams.set("page_size", String(Math.min(limit, 40)))
    endpoint.searchParams.set(
      "fields",
      "code,product_name,categories,nutriments",
    )
  }
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "NinjaCreamiFit/1.0 (nutrition search)" },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Open Food Facts ${response.status}`)
  const data = await response.json()
  const products = barcode
    ? data.status === 1 && data.product
      ? [data.product]
      : []
    : data.products
  const foods = (Array.isArray(products) ? products : [])
    .map((product) => {
      const nutrition = product.nutriments || {}
      const food = {
        id: `OFF:${String(product.code || "")}`,
        name: String(product.product_name || "").trim(),
        category: String(product.categories || "Open Food Facts")
          .split(",")[0]
          .trim(),
        source: "Open Food Facts",
        calories: Number.isFinite(Number(nutrition["energy-kcal_100g"]))
          ? Number(nutrition["energy-kcal_100g"])
          : null,
        protein: Number.isFinite(Number(nutrition.proteins_100g))
          ? Number(nutrition.proteins_100g)
          : null,
        carbs: Number.isFinite(Number(nutrition.carbohydrates_100g))
          ? Number(nutrition.carbohydrates_100g)
          : null,
        fat: Number.isFinite(Number(nutrition.fat_100g))
          ? Number(nutrition.fat_100g)
          : null,
      }
      return food.name && /^OFF:[A-Za-z0-9._-]{1,80}$/.test(food.id)
        ? food
        : null
    })
    .filter(Boolean)
  return { foods, total: foods.length }
}

async function searchFatSecret(query, barcode, limit) {
  if (!process.env.FATSECRET_CLIENT_ID || !process.env.FATSECRET_CLIENT_SECRET)
    return { foods: [], total: 0 }
  const auth = Buffer.from(
    `${process.env.FATSECRET_CLIENT_ID}:${process.env.FATSECRET_CLIENT_SECRET}`,
  ).toString("base64")
  const tokenResponse = await fetch(
    "https://oauth.fatsecret.com/connect/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        // FatSecret grants barcode and text search through different scopes.
        scope: barcode ? "basic barcode" : "basic",
      }),
      signal: AbortSignal.timeout(5000),
    },
  )
  if (!tokenResponse.ok)
    throw new Error(`FatSecret auth ${tokenResponse.status}`)
  const token = (await tokenResponse.json()).access_token
  const request = async (method, params) => {
    const endpoint = new URL("https://platform.fatsecret.com/rest/server.api")
    endpoint.searchParams.set("method", method)
    endpoint.searchParams.set("format", "json")
    for (const [key, value] of Object.entries(params))
      endpoint.searchParams.set(key, String(value))
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`FatSecret ${response.status}`)
    return response.json()
  }
  let ids
  if (barcode) {
    const found = await request("food.find_id_for_barcode", { barcode })
    const foodId = found.food_id || found.fod_id?.value
    ids = foodId && foodId !== "0" ? [String(foodId)] : []
  } else {
    const data = await request("foods.search", {
      search_expression: query,
      max_results: Math.min(limit, 20),
    })
    const entries = Array.isArray(data.foods?.food)
      ? data.foods.food
      : data.foods?.food
        ? [data.foods.food]
        : []
    ids = entries.map((item) => String(item.food_id)).filter(Boolean)
  }
  const foods = (await Promise.all(ids.slice(0, limit).map(async (foodId) => {
        const data = await request("food.get.v2", { food_id: foodId })
        const item = data.food || {}
        const servings = Array.isArray(item.servings?.serving)
          ? item.servings.serving
          : item.servings?.serving
            ? [item.servings.serving]
            : []
        const serving =
          servings.find(
            (entry) => String(entry.metric_serving_amount) === "100",
          ) ||
          servings[0] ||
          {}
        const amount = Number(serving.metric_serving_amount) || 100
        const scale = 100 / amount
        const number = (key) => {
          const value = Number(serving[key])
          return Number.isFinite(value)
            ? Math.round(value * scale * 100) / 100
            : null
        }
        return {
          id: `FATSECRET:${foodId}`,
          name: String(item.food_name || "").trim(),
          category: String(item.food_type || "FatSecret"),
          source: "FatSecret",
          calories: number("calories"),
          protein: number("protein"),
          carbs: number("carbohydrate"),
          fat: number("fat"),
        }
      }))).filter((item) => item.name && /^FATSECRET:\d+$/.test(item.id))
  return { foods, total: foods.length }
}

async function searchAllSources(catalog, query, barcode, limit) {
  const perSourceLimit = Math.max(1, Math.ceil(limit / 3))
  let fatSecretError = ""
  const [local, openFoodFacts, fatSecret] = await Promise.all([
    Promise.resolve(
      barcode
        ? { foods: [], total: 0 }
        : searchFoods(catalog, query, perSourceLimit),
    ),
    searchOpenFoodFacts(query, perSourceLimit, barcode).catch(() => ({
      foods: [],
      total: 0,
    })),
    searchFatSecret(query, barcode, perSourceLimit).catch((error) => {
      fatSecretError = error instanceof Error ? error.message : String(error)
      return { foods: [], total: 0 }
    }),
  ])
  const foods = []
  const max = Math.max(
    local.foods.length,
    openFoodFacts.foods.length,
    fatSecret.foods.length,
  )
  for (let index = 0; index < max; index++) {
    for (const source of [local, openFoodFacts, fatSecret]) {
      if (source.foods[index]) foods.push(source.foods[index])
    }
  }
  return {
    foods: foods.slice(0, limit),
    total: foods.length,
    sources: ["TBCA", "IBGE", "Open Food Facts", "FatSecret"],
    sourceDiagnostics: {
      FatSecret:
        fatSecretError ||
        (process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET
          ? "ok"
          : "credentials_missing"),
    },
  }
}
export default createFoodHandler()
