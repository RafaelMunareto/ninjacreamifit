import { text, validateRecipe } from "./recipe-utils.js"
export { filterRecipes, errorMessage } from "./recipe-utils.js"
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
/** @typedef {import("../types").AdminDetails} AdminDetails */
/** @typedef {{key: string, salt: string, hash: string, iterations: number}} AdminCredential */

const DATABASE_NAME = "ninja-creami-fit"
const DATABASE_VERSION = 1
const STORES = ["recipes", "favorites", "ratings", "settings"]
/** @type {Promise<IDBDatabase> | undefined} */
let connection
// The admin session belongs to this tab and ends on logout or page reload.
/** @type {string | null} */
let adminSession = null
const PASSWORD_ITERATIONS = 600000
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
  const [recipes, favorites, ratings, profile, admin] = await Promise.all([
    resultOf(transaction.objectStore("recipes").getAll()),
    resultOf(transaction.objectStore("favorites").getAll()),
    resultOf(transaction.objectStore("ratings").getAll()),
    resultOf(transaction.objectStore("settings").get("profile")),
    resultOf(transaction.objectStore("settings").get("admin")),
    done,
  ])
  const favoriteIds = new Set(favorites.map((favorite) => favorite.recipeId))
  const ratingMap = new Map(
    ratings.map((rating) => [rating.recipeId, rating.value]),
  )
  return {
    profile: { id: profile.id, name: profile.name },
    admin: {
      configured: Boolean(admin),
      authenticated: Boolean(admin && adminSession === admin.hash),
    },
    recipes: recipes
      .map((/** @type {StoredRecipe} */ recipe) => {
        const ownRating = ratingMap.get(recipe.id) || 0
        const votes = recipe.votes + (ownRating ? 1 : 0)
        return {
          ...recipe,
          author:
            recipe.authorId === profile.id && !recipe.authorOverride
              ? profile.name
              : recipe.author,
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

/** Authors manage their own recipes. Admin-only details can change aggregate ratings and displayed authors. @param {RecipeInput} input @param {string | undefined} id @param {AdminDetails} [details] */
export async function saveRecipe(input, id, details) {
  const database = await openDatabase()
  const transaction = database.transaction(
    ["recipes", "settings", "ratings"],
    "readwrite",
  )
  const done = committed(transaction)
  const store = transaction.objectStore("recipes")
  const [existing, profile, credential, localVote] = await Promise.all([
    id ? resultOf(store.get(id)) : Promise.resolve(undefined),
    resultOf(transaction.objectStore("settings").get("profile")),
    resultOf(transaction.objectStore("settings").get("admin")),
    id
      ? resultOf(transaction.objectStore("ratings").get(id))
      : Promise.resolve(undefined),
  ])
  if (details) requireAdmin(credential)
  if (id && !existing) throw new Error("Esta receita não está mais disponível.")
  if (existing && existing.authorId !== profile.id) requireAdmin(credential)
  const values = validateRecipe(input, existing?.image)
  const localName =
    !details && input.authorName !== undefined
      ? text(input.authorName, "seu nome", 60)
      : profile.name
  let author = existing?.author || profile.name
  const authorId = existing ? existing.authorId : profile.id
  let authorOverride = existing?.authorOverride || false
  if (
    !details &&
    (!existing || existing.authorId === profile.id) &&
    input.authorName !== undefined
  ) {
    author = localName
    authorOverride = false
  }
  let rating = existing?.rating || 0
  let votes = existing?.votes || 0
  if (details) {
    author = text(details.author, "o nome do autor", 60)
    const displayedAuthor =
      existing?.authorId === profile.id && !existing.authorOverride
        ? profile.name
        : existing?.author
    if (author !== displayedAuthor) authorOverride = true
    if (
      !Number.isInteger(details.votes) ||
      details.votes < 0 ||
      details.votes > 10000000
    )
      throw new Error(
        "O total de avaliações deve ser um inteiro entre 0 e 10.000.000.",
      )
    if (
      !Number.isFinite(details.rating) ||
      details.rating < 0 ||
      details.rating > 5 ||
      Math.abs(details.rating * 10 - Math.round(details.rating * 10)) > 0.00001
    )
      throw new Error(
        "A média de estrelas deve estar entre 0 e 5, com até uma casa decimal.",
      )
    if (
      (details.votes === 0 && details.rating !== 0) ||
      (details.votes > 0 && details.rating < 1)
    )
      throw new Error(
        "Use média 0 quando não houver avaliações, ou de 1 a 5 quando houver.",
      )
    const currentVotes = votes + (localVote ? 1 : 0)
    const currentRating = currentVotes
      ? Math.round(
          ((rating * votes + (localVote?.value || 0)) / currentVotes) * 10,
        ) / 10
      : 0
    if (details.votes !== currentVotes || details.rating !== currentRating) {
      rating = details.rating
      votes = details.votes
      // Explicit aggregate changes consolidate the previous local vote.
      // Unchanged aggregates preserve it, including during normal recipe edits.
      if (id) transaction.objectStore("ratings").delete(id)
    }
  }
  const recipeId = id || crypto.randomUUID()
  if (!details && localName !== profile.name)
    transaction.objectStore("settings").put({ ...profile, name: localName })
  store.put({
    ...values,
    id: recipeId,
    author,
    authorId,
    authorOverride,
    color: categoryColors[values.category],
    rating,
    votes,
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
  const [recipe, credential, profile] = await Promise.all([
    resultOf(transaction.objectStore("recipes").get(id)),
    resultOf(transaction.objectStore("settings").get("admin")),
    resultOf(transaction.objectStore("settings").get("profile")),
  ])
  if (!recipe) throw new Error("Esta receita não está mais disponível.")
  if (recipe.authorId !== profile.id) requireAdmin(credential)
  transaction.objectStore("recipes").delete(id)
  transaction.objectStore("favorites").delete(id)
  transaction.objectStore("ratings").delete(id)
  await done
  notify()
}

/** @param {AdminCredential | undefined} credential */
function requireAdmin(credential) {
  if (!credential || !adminSession || adminSession !== credential.hash)
    throw new Error("Entre como administrador para editar ou excluir receitas.")
  return credential
}

/** @returns {Promise<AdminCredential | undefined>} */
async function readAdminCredential() {
  const database = await openDatabase()
  const transaction = database.transaction("settings", "readonly")
  const done = committed(transaction)
  const credential = await resultOf(
    transaction.objectStore("settings").get("admin"),
  )
  await done
  return credential
}

/** @param {string} password */
function validatePassword(password) {
  if (
    typeof password !== "string" ||
    password.trim().length < 10 ||
    password.length > 128
  )
    throw new Error("Use uma senha de 10 a 128 caracteres.")
}

/** @param {Uint8Array} bytes */
function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
}

/** @param {string} password @param {string} salt @param {number} iterations */
async function passwordHash(password, salt, iterations) {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Abra este site em HTTPS ou localhost para usar a administração.",
    )
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const bytes = Uint8Array.from(salt.match(/.{2}/g) || [], (pair) =>
    Number.parseInt(pair, 16),
  )
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: bytes, iterations, hash: "SHA-256" },
    key,
    256,
  )
  return hex(new Uint8Array(hash))
}

/** @param {string} password @returns {Promise<AdminCredential>} */
async function createCredential(password) {
  validatePassword(password)
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return {
    key: "admin",
    salt,
    iterations: PASSWORD_ITERATIONS,
    hash: await passwordHash(password, salt, PASSWORD_ITERATIONS),
  }
}

/** @param {string} first @param {string} second */
function hashesMatch(first, second) {
  if (first.length !== second.length) return false
  let difference = 0
  for (let index = 0; index < first.length; index++)
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index)
  return difference === 0
}

/** First access only: credentials are saved atomically, without overwriting an existing password. @param {string} password */
export async function setupAdmin(password) {
  const credential = await createCredential(password)
  const database = await openDatabase()
  const transaction = database.transaction("settings", "readwrite")
  const done = committed(transaction)
  const store = transaction.objectStore("settings")
  if (await resultOf(store.get("admin")))
    throw new Error(
      "Já existe uma senha de administrador. Entre com a senha cadastrada.",
    )
  store.put(credential)
  await done
  adminSession = credential.hash
  notify()
}

/** @param {string} password */
export async function loginAdmin(password) {
  if (typeof password !== "string" || !password || password.length > 128)
    throw new Error("Informe a senha de administrador.")
  const credential = await readAdminCredential()
  if (!credential)
    throw new Error("Crie a senha de administrador no primeiro acesso.")
  const hash = await passwordHash(
    password,
    credential.salt,
    credential.iterations,
  )
  if (!hashesMatch(hash, credential.hash)) throw new Error("Senha incorreta.")
  const current = await readAdminCredential()
  if (current?.hash !== credential.hash)
    throw new Error("A senha foi alterada em outra aba. Entre novamente.")
  adminSession = credential.hash
  notify()
}

export function logoutAdmin() {
  adminSession = null
  notify()
}

/** @param {string} currentPassword @param {string} newPassword */
export async function changeAdminPassword(currentPassword, newPassword) {
  const previous = requireAdmin(await readAdminCredential())
  if (
    typeof currentPassword !== "string" ||
    !currentPassword ||
    currentPassword.length > 128
  )
    throw new Error("Informe a senha atual.")
  const oldHash = await passwordHash(
    currentPassword,
    previous.salt,
    previous.iterations,
  )
  if (!hashesMatch(oldHash, previous.hash))
    throw new Error("Senha atual incorreta.")
  const credential = await createCredential(newPassword)
  const database = await openDatabase()
  const transaction = database.transaction("settings", "readwrite")
  const done = committed(transaction)
  const store = transaction.objectStore("settings")
  const current = await resultOf(store.get("admin"))
  requireAdmin(current)
  if (current.hash !== previous.hash)
    throw new Error("A senha foi alterada em outra aba. Entre novamente.")
  store.put(credential)
  await done
  adminSession = credential.hash
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
