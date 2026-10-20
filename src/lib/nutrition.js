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
let loadedAt = 0
export function invalidateFoodCatalog() {
  loading = undefined
  loadedAt = 0
}

// The shared catalog is served by Repassa Fácil and cached by the browser.
/** @returns {Promise<FoodCatalog>} */
export function loadFoodCatalog() {
  if (!loading || Date.now() - loadedAt > 60000) {
    loadedAt = Date.now()
    loading = requestApi("food-catalog", { cache: "no-store" })
      .then((data) => {
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
  }
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
    typeof food.calories === "number" &&
    Number.isFinite(food.calories) &&
    food.calories >= 0
      ? food.calories
      : Infinity
  const first = calories(a)
  const second = calories(b)
  return first < second ? -1 : first > second ? 1 : 0
}

/** @param {LocalFood[]} foods @param {string} query */
function orderFoodResults(foods, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  return foods
    .map((food) => {
      const name = normalize(food.name)
      // Product names come before dishes that only mention the ingredient.
      // Token matching also recognizes "Leite, vaca, condensado" and queries
      // with reordered words, without changing which foods match the search.
      const mainName = normalize(food.name.split(/\(|\bc\s*\//i)[0])
      const firstWord = name.split(" ")[0]
      const relevance = words.some(
        (word) => word === firstWord || similarWord(word, firstWord),
      )
        ? 0
        : Number.isFinite(nameMatchCost(mainName, words))
          ? 1
          : 2
      const cost = nameMatchCost(name, words)
      return { food, relevance, cost: Number.isFinite(cost) ? cost : 0 }
    })
    .sort(
      (a, b) =>
        Number(!hasCompleteNutrition(a.food)) -
          Number(!hasCompleteNutrition(b.food)) ||
        a.cost - b.cost ||
        a.relevance - b.relevance ||
        compareFoodCalories(a.food, b.food) ||
        a.food.name.localeCompare(b.food.name, "pt-BR") ||
        a.food.id.localeCompare(b.food.id),
    )
    .map(({ food }) => food)
}

// Keep nutritional qualifiers and identifiers exact. A typo in another word
// must not turn "iogurte zero" into an unrelated or non-zero product.
const exactTerms = new Set([
  "zero",
  "sem",
  "com",
  "light",
  "diet",
  "integral",
  "desnatado",
  "lactose",
  "gluten",
])

/** @param {string} word */
const allowsTypo = (word) => /^[a-z]{4,}$/.test(word) && !exactTerms.has(word)

/** @param {string} word @param {string} candidate */
function similarWord(word, candidate) {
  if (
    Math.abs(word.length - candidate.length) > 1 ||
    !allowsTypo(word) ||
    !/^[a-z]{4,}$/.test(candidate)
  )
    return false
  if (word.length === candidate.length) {
    let first = -1
    for (let i = 0; i < word.length; i++) {
      if (word[i] === candidate[i]) continue
      if (first < 0) first = i
      else
        return (
          i === first + 1 &&
          word[first] === candidate[i] &&
          word[i] === candidate[first] &&
          word.slice(i + 1) === candidate.slice(i + 1)
        )
    }
    return true
  }
  const shorter = word.length < candidate.length ? word : candidate
  const longer = word.length < candidate.length ? candidate : word
  let i = 0,
    j = 0,
    skipped = false
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++
      j++
    } else {
      if (skipped) return false
      skipped = true
      j++
    }
  }
  return true
}

/** @param {string} name @param {string[]} words */
function nameMatchCost(name, words) {
  let cost = 0
  let tokens
  for (const word of words) {
    if (name.includes(word)) continue
    if (!allowsTypo(word)) return Infinity
    tokens ??= name.split(" ")
    if (!tokens.some((candidate) => similarWord(word, candidate)))
      return Infinity
    cost++
  }
  return cost
}

/** @param {string} name @param {string} identifier @param {string[]} words */
function matchesTerms(name, identifier, words) {
  return (
    words.length > 0 &&
    (Number.isFinite(nameMatchCost(name, words)) ||
      (words.some((word) => /\d/.test(word)) &&
        words.every((word) => identifier.includes(word))))
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
  return {
    foods: orderFoodResults(
      matches.map((entry) => entry.food),
      query,
    ).slice(0, limit),
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

/** @typedef {{foods: LocalFood[], total: number, source: string, fallback: boolean, nextCursor?: string | null, retryCursor?: string | null, sourceDiagnostics?: Record<string, string>, sourceWarnings?: Record<string, string>, providerTotals?: Record<string, number | null>}} FoodResults */

/** @param {string} value */
export function normalizeFoodBarcode(value) {
  const digits = value.replace(/[\s.-]/g, "")
  return /^\d{8,14}$/.test(digits) ? digits : ""
}

/** @param {FoodCatalog} catalog @param {string} query @param {string} [cursor] @param {AbortSignal} [signal] @param {LocalFood[]} [previous] @param {FoodResults} [previousPage] @returns {Promise<FoodResults>} */
export async function searchFoodPage(
  catalog,
  query,
  cursor = "0,0",
  signal,
  previous = [],
  previousPage,
) {
  if (normalize(query).length < 2)
    return {
      foods: [],
      total: 0,
      source: "Todas",
      fallback: false,
      nextCursor: null,
    }
  const barcode = normalizeFoodBarcode(query)
  let api
  try {
    api = barcode
      ? await searchFoodApi(barcode, 20, signal)
      : await requestApi(`foods?${new URLSearchParams({ q: query, cursor })}`, {
          signal,
          cache: "no-store",
        })
    if (!Array.isArray(api.foods))
      throw new Error("Resposta de alimentos inválida.")
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error
    api = {
      foods: [],
      nextCursor: barcode ? null : cursor,
      sourceDiagnostics: { remote: "unavailable" },
    }
  }
  const local = barcode
    ? []
    : searchFoods(catalog, query, Number.MAX_SAFE_INTEGER).foods
  const foods = orderFoodResults(
    [
      ...new Map(
        [...previous, ...local, ...api.foods].map((food) => [food.id, food]),
      ).values(),
    ].filter((food) => barcode || matchesFoodQuery(food, query)),
    query,
  )
  const diagnostics = {
    ...previousPage?.sourceDiagnostics,
    ...api.sourceDiagnostics,
  }
  const sources = ["FatSecret", "Open Food Facts"]
  /** @type {number[]} */
  const next = String(api.nextCursor || "-1,-1")
    .split(",")
    .map(Number)
  const failed = (previousPage?.retryCursor || "-1,-1").split(",").map(Number)
  const requested = cursor.split(",").map(Number)
  if (!api.sourceDiagnostics?.remote) delete diagnostics.remote
  for (let i = 0; i < 2; i++) {
    if (requested[i] < 0) continue
    const status = api.sourceDiagnostics?.[sources[i]]
    if (api.sourceDiagnostics?.remote || (status && status !== "ok")) {
      failed[i] = next[i] >= 0 ? next[i] : requested[i]
      next[i] = -1
    } else failed[i] = -1
  }
  const retry = next.map((position, i) =>
    failed[i] >= 0 ? failed[i] : position,
  )
  return {
    ...api,
    foods,
    total: foods.length,
    source: "Todas",
    fallback: false,
    sourceDiagnostics: diagnostics,
    nextCursor: barcode || next.every((n) => n < 0) ? null : next.join(","),
    retryCursor: barcode || failed.every((n) => n < 0) ? null : retry.join(","),
  }
}
/** @param {string} query @param {number} limit @param {AbortSignal} [signal] */
export async function searchFoodApi(query, limit, signal) {
  const barcode = normalizeFoodBarcode(query)
  const params = new URLSearchParams({
    [barcode ? "barcode" : "q"]: barcode || query,
    limit: String(limit),
  })
  const data = await requestApi(`foods?${params}`, {
    signal,
    cache: "no-store",
  })
  if (!Array.isArray(data.foods) || !Number.isInteger(data.total))
    throw new Error("Resposta de alimentos inválida.")
  const matching = barcode
    ? data.foods
    : data.foods.filter((/** @type {LocalFood} */ food) =>
        matchesFoodQuery(food, query),
      )
  return /** @type {{foods: LocalFood[], total: number}} */ ({
    ...data,
    foods: orderFoodResults(matching, query),
    total: matching.length === data.foods.length ? data.total : matching.length,
  })
}

/** @param {string[]} ids @param {AbortSignal} [signal] @returns {Promise<LocalFood[]>} */
export async function restoreApiFoods(ids, signal) {
  if (!ids.length) return []
  const data = await requestApi(
    `foods?${new URLSearchParams({ ids: ids.join(",") })}`,
    { signal },
  )
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
  const foods = orderFoodResults(
    [
      ...new Map(
        [...api.foods, ...local.foods].map((food) => [food.id, food]),
      ).values(),
    ].filter(
      (food) =>
        /^\d{8,14}$/.test(query.trim()) || matchesFoodQuery(food, query),
    ),
    query,
  )
  return {
    foods: foods.slice(0, limit),
    total: foods.length,
    source: "Todas",
    fallback: false,
  }
}
