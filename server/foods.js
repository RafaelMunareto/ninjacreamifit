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
      const limit = Number(url.searchParams.get("limit") || 20)
      if (
        ids !== null
          ? !ids ||
            ids.split(",").length > 50 ||
            !ids
              .split(",")
              .every((id) =>
                /^(?:IBGE:\d{1,10}:(?:na|\d{1,3})|OFF:[A-Za-z0-9._-]{1,80})$/.test(
                  id,
                ),
              )
          : query.trim().length < 2 ||
            query.length > 100 ||
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
              foods: [...new Set(ids.split(","))]
                .map((id) => catalog.byId.get(id))
                .filter(Boolean),
            }
          : await searchAllSources(catalog, query, limit)
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

async function searchOpenFoodFacts(query, limit) {
  const endpoint = new URL("https://world.openfoodfacts.org/api/v2/search")
  endpoint.searchParams.set("search_terms", query)
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

async function searchAllSources(catalog, query, limit) {
  const [local, openFoodFacts] = await Promise.all([
    Promise.resolve(searchFoods(catalog, query, limit)),
    searchOpenFoodFacts(query, limit).catch(() => ({ foods: [], total: 0 })),
  ])
  const foods = [...local.foods, ...openFoodFacts.foods]
  return {
    foods: foods.slice(0, limit),
    total: foods.length,
    sources: ["IBGE", "Open Food Facts"],
  }
}
export default createFoodHandler()
