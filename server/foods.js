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
  const endpoint = new URL("https://world.openfoodfacts.org/api/v2/search")
  endpoint.searchParams.set("search_terms", barcode || query)
  endpoint.searchParams.set("page_size", String(Math.min(limit, 40)))
  endpoint.searchParams.set("fields", "code,product_name,categories,nutriments")
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "NinjaCreamiFit/1.0 (nutrition search)" },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Open Food Facts ${response.status}`)
  const data = await response.json()
  const foods = (Array.isArray(data.products) ? data.products : [])
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
      body: "grant_type=client_credentials&scope=basic",
      signal: AbortSignal.timeout(5000),
    },
  )
  if (!tokenResponse.ok)
    throw new Error(`FatSecret auth ${tokenResponse.status}`)
  const token = (await tokenResponse.json()).access_token
  const endpoint = new URL(
    "https://platform.fatsecret.com/rest/foods/search/v1",
  )
  endpoint.searchParams.set("format", "json")
  endpoint.searchParams.set("max_results", String(Math.min(limit, 50)))
  endpoint.searchParams.set("search_expression", barcode || query)
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`FatSecret ${response.status}`)
  const data = await response.json()
  const foods = (Array.isArray(data.foods?.food) ? data.foods.food : [])
    .map((item) => {
      const text = String(item.food_description || "")
      const number = (label) => {
        const value = Number(
          text.match(new RegExp(`${label}:\\s*([\\d.]+)`, "i"))?.[1],
        )
        return Number.isFinite(value) ? value : null
      }
      return {
        id: `FATSECRET:${String(item.food_id || "")}`,
        name: String(item.food_name || "").trim(),
        category: String(item.food_type || "FatSecret"),
        source: "FatSecret",
        calories: number("Calories"),
        protein: number("Protein"),
        carbs: number("Carbs"),
        fat: number("Fat"),
      }
    })
    .filter((item) => item.name && /^FATSECRET:\d+$/.test(item.id))
  return { foods, total: foods.length }
}

async function searchAllSources(catalog, query, barcode, limit) {
  const [local, openFoodFacts, fatSecret] = await Promise.all([
    Promise.resolve(
      barcode ? { foods: [], total: 0 } : searchFoods(catalog, query, limit),
    ),
    searchOpenFoodFacts(query, limit, barcode).catch(() => ({
      foods: [],
      total: 0,
    })),
    searchFatSecret(query, barcode, limit).catch(() => ({
      foods: [],
      total: 0,
    })),
  ])
  const foods = [...local.foods, ...openFoodFacts.foods, ...fatSecret.foods]
  return {
    foods: foods.slice(0, limit),
    total: foods.length,
    sources: ["TBCA", "IBGE", "Open Food Facts", "FatSecret"],
  }
}
export default createFoodHandler()
