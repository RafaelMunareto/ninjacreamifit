// @ts-check
import {
  categories,
  categoryColors,
  programs,
  seedRecipes,
} from "../data/recipes.js"

/** @typedef {import("../types").StoredRecipe} StoredRecipe */
/** @typedef {import("../types").RecipeInput} RecipeInput */
/** @typedef {import("../types").Recipe} Recipe */
/** @typedef {import("../types").Profile} Profile */
/** @typedef {import("../types").Snapshot} Snapshot */

const DATABASE_NAME = "ninja-creami-fit"
const DATABASE_VERSION = 1
const STORES = ["recipes", "favorites", "ratings", "settings"]
/** @type {Promise<IDBDatabase> | undefined} */
let connection
const updates = new EventTarget()
const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(DATABASE_NAME)
channel?.addEventListener("message", () =>
  updates.dispatchEvent(new Event("change")),
)

/** @template T @param {IDBRequest<T>} request @returns {Promise<T>} */
function resultOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** @param {IDBTransaction} transaction */
function committed(transaction) {
  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(undefined)
    transaction.onabort = () =>
      reject(
        transaction.error ||
          new Error("A operação não foi salva. Tente novamente."),
      )
    transaction.onerror = () => reject(transaction.error)
  })
  // A failed request can reject before its caller reaches the commit await.
  void done.catch(() => {})
  return done
}

function openDatabase() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(
          new Error(
            "Seu navegador não disponibilizou o armazenamento local. Abra o site em uma janela comum e tente novamente.",
          ),
        )
        return
      }
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        for (const name of STORES) {
          database.createObjectStore(name, {
            keyPath:
              name === "settings"
                ? "key"
                : name === "recipes"
                  ? "id"
                  : "recipeId",
          })
        }
        const transaction = request.transaction
        if (!transaction) return
        const recipes = transaction.objectStore("recipes")
        for (const recipe of seedRecipes) recipes.put(recipe)
        transaction
          .objectStore("settings")
          .put({ key: "profile", id: crypto.randomUUID(), name: "Você" })
      }
      request.onsuccess = () => {
        const database = request.result
        database.onversionchange = () => {
          database.close()
          connection = undefined
        }
        database.onclose = () => {
          connection = undefined
        }
        resolve(database)
      }
      request.onerror = () =>
        reject(
          new Error(
            "Não foi possível abrir o banco local. Verifique se o navegador permite salvar dados neste site.",
          ),
        )
      request.onblocked = () =>
        reject(
          new Error(
            "Feche as outras abas deste site e tente novamente para atualizar o banco local.",
          ),
        )
    }).catch((error) => {
      connection = undefined
      throw error
    })
  }
  return connection
}

function notify() {
  updates.dispatchEvent(new Event("change"))
  channel?.postMessage("change")
}

/** @param {() => void} listener */
export function subscribe(listener) {
  updates.addEventListener("change", listener)
  return () => updates.removeEventListener("change", listener)
}

/** All reads share one transaction, so recipes, favorites and ratings stay consistent. @returns {Promise<Snapshot>} */
export async function getSnapshot() {
  const database = await openDatabase()
  const transaction = database.transaction(STORES, "readonly")
  const done = committed(transaction)
  const [recipes, favorites, ratings, profile] = await Promise.all([
    resultOf(transaction.objectStore("recipes").getAll()),
    resultOf(transaction.objectStore("favorites").getAll()),
    resultOf(transaction.objectStore("ratings").getAll()),
    resultOf(transaction.objectStore("settings").get("profile")),
    done,
  ])
  const favoriteIds = new Set(favorites.map((favorite) => favorite.recipeId))
  const ratingMap = new Map(
    ratings.map((rating) => [rating.recipeId, rating.value]),
  )
  return {
    profile: { id: profile.id, name: profile.name },
    recipes: recipes
      .map((/** @type {StoredRecipe} */ recipe) => {
        const ownRating = ratingMap.get(recipe.id) || 0
        const votes = recipe.votes + (ownRating ? 1 : 0)
        return {
          ...recipe,
          author: recipe.authorId === profile.id ? profile.name : recipe.author,
          isFavorite: favoriteIds.has(recipe.id),
          ownRating,
          votes,
          rating: votes
            ? Math.round(
                ((recipe.rating * recipe.votes + ownRating) / votes) * 10,
              ) / 10
            : 0,
        }
      })
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || Number(a.id) - Number(b.id),
      ),
  }
}

/** @param {unknown} value @param {string} label @param {number} limit */
function text(value, label, limit) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Preencha ${label}.`)
  if (value.trim().length > limit)
    throw new Error(`${label} deve ter no máximo ${limit} caracteres.`)
  return value.trim()
}

/** @param {RecipeInput} input @returns {RecipeInput} */
function validateRecipe(input) {
  const title = text(input.title, "o nome da receita", 100)
  if (!categories.slice(1).includes(input.category))
    throw new Error("Selecione uma categoria válida.")
  if (!Object.prototype.hasOwnProperty.call(programs, input.program))
    throw new Error("Selecione um programa válido.")
  if (typeof input.respin !== "boolean")
    throw new Error("Informe se a receita precisa de re-spin.")
  if (
    typeof input.image !== "string" ||
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(input.image)
  ) {
    throw new Error("Adicione uma foto válida da receita.")
  }
  if (input.image.length > 2 * 1024 * 1024)
    throw new Error("A foto está muito grande. Escolha uma imagem menor.")
  /** @param {unknown} values @param {string} label @returns {string[]} */
  const lines = (values, label) => {
    if (!Array.isArray(values) || !values.length || values.length > 100)
      throw new Error(`Informe ${label}, uma linha por item (até 100 linhas).`)
    return values.map((value) => text(value, label, 1500))
  }
  for (const key of /** @type {const} */ ([
    "protein",
    "carbs",
    "fat",
    "calories",
  ])) {
    if (
      typeof input[key] !== "number" ||
      !Number.isFinite(input[key]) ||
      input[key] < 0 ||
      input[key] > 10000
    ) {
      throw new Error("Os macros devem ser números entre 0 e 10.000.")
    }
  }
  if (
    !Number.isInteger(input.prepMinutes) ||
    input.prepMinutes < 1 ||
    input.prepMinutes > 1440
  )
    throw new Error("O tempo de preparo deve ser de 1 a 1.440 minutos.")
  const toppings =
    typeof input.toppings === "string" ? input.toppings.trim() : ""
  if (toppings.length > 500)
    throw new Error("Descreva os toppings em até 500 caracteres.")
  return {
    title,
    category: input.category,
    image: input.image,
    prepMinutes: input.prepMinutes,
    program: input.program,
    respin: input.respin,
    toppings,
    ingredients: lines(input.ingredients, "os ingredientes"),
    instructions: lines(input.instructions, "o modo de preparo"),
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    calories: input.calories,
  }
}

/** Creates a new recipe or updates a recipe owned by this local profile. @param {RecipeInput} input @param {string | undefined} id */
export async function saveRecipe(input, id) {
  const values = validateRecipe(input)
  const database = await openDatabase()
  const transaction = database.transaction(["recipes", "settings"], "readwrite")
  const done = committed(transaction)
  const store = transaction.objectStore("recipes")
  const [existing, profile] = await Promise.all([
    id ? resultOf(store.get(id)) : Promise.resolve(undefined),
    resultOf(transaction.objectStore("settings").get("profile")),
  ])
  if (id && (!existing || existing.authorId !== profile.id)) {
    await done
    throw new Error(
      "Você só pode editar as receitas que criou neste navegador.",
    )
  }
  const recipeId = id || crypto.randomUUID()
  store.put({
    ...values,
    id: recipeId,
    author: profile.name,
    authorId: profile.id,
    color: categoryColors[values.category],
    rating: existing?.rating || 0,
    votes: existing?.votes || 0,
    createdAt: existing?.createdAt || new Date().toISOString(),
  })
  await done
  notify()
  return recipeId
}

/** @param {string} id */
export async function deleteRecipe(id) {
  const database = await openDatabase()
  const transaction = database.transaction(STORES, "readwrite")
  const done = committed(transaction)
  const [recipe, profile] = await Promise.all([
    resultOf(transaction.objectStore("recipes").get(id)),
    resultOf(transaction.objectStore("settings").get("profile")),
  ])
  if (!recipe || recipe.authorId !== profile.id) {
    await done
    throw new Error(
      "Você só pode excluir as receitas que criou neste navegador.",
    )
  }
  transaction.objectStore("recipes").delete(id)
  transaction.objectStore("favorites").delete(id)
  transaction.objectStore("ratings").delete(id)
  await done
  notify()
}

/** @param {string} id @param {"favorites" | "ratings"} collection @param {number | undefined} value */
async function updateReaction(id, collection, value) {
  const database = await openDatabase()
  const transaction = database.transaction(["recipes", collection], "readwrite")
  const done = committed(transaction)
  const store = transaction.objectStore(collection)
  const [recipe, existing] = await Promise.all([
    resultOf(transaction.objectStore("recipes").get(id)),
    resultOf(store.get(id)),
  ])
  if (!recipe) {
    await done
    throw new Error("Esta receita não está mais disponível.")
  }
  if (collection === "favorites" && existing) store.delete(id)
  else
    store.put({ recipeId: id, ...(collection === "ratings" ? { value } : {}) })
  await done
  notify()
}

/** @param {string} id */
export function toggleFavorite(id) {
  return updateReaction(id, "favorites", undefined)
}

/** Each local profile gets one vote per recipe; subsequent ratings replace that vote. @param {string} id @param {number} value */
export function rateRecipe(id, value) {
  if (!Number.isInteger(value) || value < 1 || value > 5)
    return Promise.reject(
      new Error("A nota deve ser um número inteiro de 1 a 5."),
    )
  return updateReaction(id, "ratings", value)
}

/** @param {string} name */
export async function saveProfile(name) {
  const cleanName = text(name, "seu nome", 60)
  const database = await openDatabase()
  const transaction = database.transaction("settings", "readwrite")
  const done = committed(transaction)
  const store = transaction.objectStore("settings")
  const profile = await resultOf(store.get("profile"))
  store.put({ ...profile, name: cleanName })
  await done
  notify()
}

/** @param {string} value */
function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
}

/** @param {Recipe[]} recipes @param {{query?: string, category?: string, collection?: string, profileId?: string, sort?: string}} [filters] */
export function filterRecipes(
  recipes,
  {
    query = "",
    category = "Todos",
    collection = "all",
    profileId = "",
    sort = "recent",
  } = {},
) {
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean)
  const matches = recipes.filter((recipe) => {
    if (category !== "Todos" && recipe.category !== category) return false
    if (collection === "favorites" && !recipe.isFavorite) return false
    if (collection === "mine" && recipe.authorId !== profileId) return false
    const content = normalize(
      [
        recipe.title,
        recipe.author,
        recipe.category,
        recipe.toppings,
        ...recipe.ingredients,
      ].join(" "),
    )
    return terms.every((term) => content.includes(term))
  })
  if (sort === "rating")
    matches.sort((a, b) => b.rating - a.rating || b.votes - a.votes)
  if (sort === "protein") matches.sort((a, b) => b.protein - a.protein)
  if (sort === "calories") matches.sort((a, b) => a.calories - b.calories)
  return matches
}

/** @param {unknown} error */
export function errorMessage(error) {
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "O armazenamento deste navegador está cheio. Libere espaço e tente novamente."
  return error instanceof Error
    ? error.message
    : "Não foi possível salvar. Tente novamente."
}
