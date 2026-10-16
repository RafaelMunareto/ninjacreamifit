// @ts-check
/** @typedef {import("../types").LocalFood} LocalFood */
/** @typedef {import("../types").FoodReference} FoodReference */
/** @typedef {import("../types").Nutrition} Nutrition */
/** @typedef {{food: LocalFood, grams: string}} FoodLine */
/** @typedef {{foods: LocalFood[], byId: Map<string, LocalFood>, index: {food: LocalFood, text: string, name: string}[]}} FoodCatalog */

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

// The catalog is a versioned local build asset, downloaded only when needed.
/** @returns {Promise<FoodCatalog>} */
export function loadFoodCatalog() {
  if (!loading)
    loading = fetch(`${import.meta.env.BASE_URL}data/tbca-foods-v1.json`, {
      cache: "force-cache",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("A tabela de alimentos não está disponível.")
        const data = await response.json()
        if (
          data.version !== 1 ||
          data.source?.basisGrams !== 100 ||
          !Array.isArray(data.foods) ||
          !data.foods.length
        )
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
      text: normalize(
        `${food.source || "TBCA"} ${food.id} ${food.name} ${food.category}`,
      ),
    })),
  }
}

/** @param {LocalFood} food */
export const hasCompleteNutrition = (food) =>
  [food.protein, food.carbs, food.fat, food.calories].every(
    (value) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  )

/** @param {FoodCatalog} catalog @param {string} query @param {number} [limit] @param {string} [source] */
export function searchFoods(catalog, query, limit = 20, source = "all") {
  const term = normalize(query)
  if (term.length < 2) return { foods: [], total: 0 }
  const words = term.split(/\s+/)
  const matches = catalog.index.filter(
    (entry) =>
      (source === "all" || (entry.food.source || "TBCA") === source) &&
      words.every((word) => entry.text.includes(word)),
  )
  matches.sort((a, b) => {
    const rank = /** @param {typeof a} item */ (item) =>
      (item.name.startsWith(term) ? 0 : 100) +
      item.food.name.length / 10 +
      (hasCompleteNutrition(item.food) ? 0 : 1000)
    return (
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
  items.map((item) => ({ foodId: item.food.id, grams: Number(item.grams) }))
/** @param {FoodLine[]} items */
export const foodDescriptions = (items) =>
  items.map((item) => `${item.grams.replace(".", ",")} g de ${item.food.name}`)

/** @typedef {{foods: LocalFood[], total: number, source: string, fallback: boolean}} FoodResults */
/** @param {string} query @param {number} limit @param {AbortSignal} [signal] */
export async function searchFoodApi(query, limit, signal) {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  const response = await fetch(
    `${import.meta.env.BASE_URL}api/foods?${params}`,
    { signal },
  )
  if (!response.ok)
    throw new Error(
      "A busca complementar está indisponível. Tente novamente ou preencha manualmente.",
    )
  const data = await response.json()
  if (!Array.isArray(data.foods) || !Number.isInteger(data.total))
    throw new Error("Resposta de alimentos inválida.")
  return /** @type {{foods: LocalFood[], total: number}} */ (data)
}

/** @param {string[]} ids @param {AbortSignal} [signal] @returns {Promise<LocalFood[]>} */
export async function restoreApiFoods(ids, signal) {
  if (!ids.length) return []
  const response = await fetch(
    `${import.meta.env.BASE_URL}api/foods?${new URLSearchParams({ ids: ids.join(",") })}`,
    { signal },
  )
  if (!response.ok)
    throw new Error("Não foi possível recuperar os alimentos salvos.")
  const data = await response.json()
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
  const foods = [...local.foods, ...api.foods]
  return {
    foods: foods.slice(0, limit),
    total: foods.length,
    source: "Todas",
    fallback: false,
  }
}
