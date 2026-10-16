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
              .every((id) => /^IBGE:\d{1,10}:(?:na|\d{1,3})$/.test(id))
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
          : searchFoods(catalog, query, limit)
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
export default createFoodHandler()
