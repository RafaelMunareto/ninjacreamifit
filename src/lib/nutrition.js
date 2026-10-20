// @ts-check
import { requestApi } from "./http.js"
/** @typedef {import("../types").LocalFood} LocalFood */
/** @typedef {import("../types").FoodReference} FoodReference */
/** @typedef {import("../types").Nutrition} Nutrition */
/** @typedef {{food: LocalFood, grams: string, unit?: "g" | "ml"}} FoodLine */
/** @typedef {{foods: LocalFood[], byId: Map<string, LocalFood>, index: {food: LocalFood, identifier: string, name: string}[]}} FoodCatalog */

/** @param {string} value */
const normalize = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
/** @type {Promise<FoodCatalog> | undefined} */
let loading

// The shared catalog is served by Repassa Fácil and cached by the browser.
/** @returns {Promise<FoodCatalog>} */
export function loadFoodCatalog() {
  if (!loading)
    loading = requestApi("food-catalog", { cache: "force-cache" })
      .then((data) => {
        if (data.version !== 1 || data.source?.basisGrams !== 100 || !Array.isArray(data.foods) || !data.foods.length)
          throw new Error("Tabela de alimentos inválida.")
        return createFoodCatalog(data.foods)
      })
      .catch((error) => {
        loading = undefined
        throw error
      })
  return loading
}

/** @param {LocalFood[]} foods @returns {FoodCatalog} */
export function createFoodCatalog(foods) {
  if (new Set(foods.map((food) => food.id)).size !== foods.length)
    throw new Error("Códigos de alimentos repetidos.")
  return {
    foods,
    byId: new Map(foods.map((food) => [food.id, food])),
    index: foods.map((food) => ({
      food,
      name: normalize(food.name),
      identifier: normalize(`${food.source || "TBCA"} ${food.id}`),
    })),
  }
}

/** @param {LocalFood} food */
export const hasCompleteNutrition = (food) =>
  [food.protein, food.carbs, food.fat, food.calories].every(
    (value) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  )

/** @param {LocalFood} a @param {LocalFood} b */
function compareFoodCalories(a, b) {
  /** @param {LocalFood} food */
  const calories = (food) =>
    typeof food.calories === "number" && Number.isFinite(food.calories) && food.calories >= 0
      ? food.calories
      : Infinity
  const first = calories(a)
  const second = calories(b)
  return first < second ? -1 : first > second ? 1 : 0
}

/** @param {string} name @param {string} identifier @param {string[]} words */
function matchesTerms(name, identifier, words) {
  return words.length > 0 && (
    words.every((word) => name.includes(word)) ||
    (words.some((word) => /\d/.test(word)) && words.every((word) => identifier.includes(word)))
  )
}

/** @param {LocalFood} food @param {string} query */
export function matchesFoodQuery(food, query) {
  return matchesTerms(
    normalize(food.name),
    normalize(`${food.source || "TBCA"} ${food.id}`),
    normalize(query).split(/\s+/).filter(Boolean),
  )
}

/** @param {FoodCatalog} catalog @param {string} query @param {number} [limit] @param {string} [source] */
export function searchFoods(catalog, query, limit = 20, source = "all") {
  const term = normalize(query)
  if (term.length < 2) return { foods: [], total: 0 }
  const words = term.split(/\s+/)
  const matches = catalog.index.filter(
    (entry) =>
      (source === "all" || (entry.food.source || "TBCA") === source) &&
      matchesTerms(entry.name, entry.identifier, words),
  )
  matches.sort((a, b) => {
    const rank = /** @param {typeof a} item */ (item) =>
      (item.name.startsWith(term) ? 0 : 100) +
      item.food.name.length / 10 +
      (hasCompleteNutrition(item.food) ? 0 : 1000)
    return (
      compareFoodCalories(a.food, b.food) ||
      rank(a) - rank(b) ||
      a.food.name.localeCompare(b.food.name, "pt-BR") ||
      a.food.id.localeCompare(b.food.id)
    )
  })
  return {
    foods: matches.slice(0, limit).map((entry) => entry.food),
    total: matches.length,
  }
}

/** @param {FoodLine[]} items @returns {Nutrition | null} */
export function calculateNutrition(items) {
  const totals = { protein: 0, carbs: 0, fat: 0, calories: 0 }
  for (const item of items) {
    const grams = Number(item.grams)
    if (
      !item.grams.trim() ||
      !Number.isFinite(grams) ||
      grams <= 0 ||
      grams > 10000 ||
      !hasCompleteNutrition(item.food)
    )
      return null
    for (const key of /** @type {const} */ ([
      "protein",
      "carbs",
      "fat",
      "calories",
    ])) {
      const value = item.food[key]
      if (value === null) return null
      totals[key] += (value * grams) / 100
    }
  }
  // Round the final sum, not the separate contributions of each ingredient.
  for (const key of /** @type {const} */ ([
    "protein",
    "carbs",
    "fat",
    "calories",
  ]))
    totals[key] = Math.round((totals[key] + Number.EPSILON) * 100) / 100
  return totals
}

/** @param {FoodLine[]} items @returns {FoodReference[]} */
export const foodReferences = (items) =>
  items.map((item) => ({
    foodId: item.food.id,
    grams: Number(item.grams),
    ...(item.unit === "ml" ? { unit: "ml" } : {}),
    ...(item.food.source === "Manual" ? { food: item.food } : {}),
  }))
/** @param {FoodLine[]} items */
export const foodDescriptions = (items) =>
  items.map(
    (item) =>
      `${item.grams.replace(".", ",")} ${
        item.unit === "ml" ? "ml" : "g"
      } de ${item.food.name}`,
  )

/** @typedef {{foods: LocalFood[], total: number, source: string, fallback: boolean}} FoodResults */
/** @param {string} query @param {number} limit @param {AbortSignal} [signal] */
export async function searchFoodApi(query, limit, signal) {
  const barcode = /^\d{8,14}$/.test(query.trim())
  const params = new URLSearchParams({
    [barcode ? "barcode" : "q"]: query,
    limit: String(limit),
  })
  const data = await requestApi(`foods?${params}`, { signal })
  if (!Array.isArray(data.foods) || !Number.isInteger(data.total))
    throw new Error("Resposta de alimentos inválida.")
  const foods = barcode ? data.foods : data.foods.filter((/** @type {LocalFood} */ food) => matchesFoodQuery(food, query))
  return /** @type {{foods: LocalFood[], total: number}} */ ({
    ...data,
    foods,
    total: foods.length === data.foods.length ? data.total : foods.length,
  })
}

/** @param {string[]} ids @param {AbortSignal} [signal] @returns {Promise<LocalFood[]>} */
export async function restoreApiFoods(ids, signal) {
  if (!ids.length) return []
  const data = await requestApi(`foods?${new URLSearchParams({ ids: ids.join(",") })}`, { signal })
  if (!Array.isArray(data.foods))
    throw new Error("Resposta de alimentos inválida.")
  return data.foods
}

/** @param {FoodCatalog} catalog @param {string} query @param {number} limit @param {string} source @param {(query: string, limit: number) => Promise<{foods: LocalFood[], total: number}>} remote @returns {Promise<FoodResults>} */
export async function searchFoodsWithFallback(
  catalog,
  query,
  limit,
  source,
  remote,
) {
  if (normalize(query).length < 2)
    return { foods: [], total: 0, source: "TBCA", fallback: false }
  const local = searchFoods(catalog, query, limit, "TBCA")
  const api = await remote(query, limit).catch(() => ({ foods: [], total: 0 }))
  const foods = [...new Map([...api.foods, ...local.foods].map((food) => [food.id, food])).values()]
    .filter((food) => /^\d{8,14}$/.test(query.trim()) || matchesFoodQuery(food, query))
    .sort(compareFoodCalories)
  return {
    foods: foods.slice(0, limit),
    total: foods.length,
    source: "Todas",
    fallback: false,
  }
}
