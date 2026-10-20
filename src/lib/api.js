// @ts-check
import { requestApi } from "./http.js"
export { filterRecipes, errorMessage } from "./recipe-utils.js"
/** @typedef {import("../types").Snapshot} Snapshot */
/** @typedef {import("../types").RecipeInput} RecipeInput */
/** @typedef {import("../types").AdminDetails} AdminDetails */
const events = new EventTarget()
/** @type {(() => Promise<string | null>) | null} */
let sessionTokenProvider = null
const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("ninja-creami-fit-online")
channel?.addEventListener("message", () =>
  events.dispatchEvent(new Event("change")),
)
/** @type {Promise<void> | undefined} */
let migration
/** @type {Promise<Snapshot> | undefined} */
let reading

function deviceToken() {
  const key = "ninja-creami-fit-device"
  let token = localStorage.getItem(key)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
    localStorage.setItem(key, token)
  }
  return token
}

/** @param {(() => Promise<string | null>) | null} provider */
export function setSessionTokenProvider(provider) {
  sessionTokenProvider = provider
  // A request from the previous account must not become the new account's snapshot.
  reading = undefined
}

/** @param {string} action @param {Record<string, unknown>} [data] @returns {Promise<any>} */
async function request(action, data = {}) {
  const sessionToken = sessionTokenProvider ? await sessionTokenProvider() : null
  const result = await requestApi("creami", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken || deviceToken()}`,
    },
    body: JSON.stringify({ action, data }),
  })
  return result.data
}

function notify() {
  events.dispatchEvent(new Event("change"))
  channel?.postMessage("change")
}

async function migrateLegacy() {
  const marker = `ninja-creami-fit-migrated:${deviceToken()}`
  if (localStorage.getItem(marker) === "1") return
  const { readLegacyData } = await import("./legacy-data.js")
  const legacy = await readLegacyData()
  if (legacy) {
    /** @type {Snapshot} */
    const online = await request("snapshot")
    if (online.profile.name === "Você" && legacy.profile.name !== "Você")
      await request("profile", { name: legacy.profile.name })
    const importedIds = new Map()
    for (const recipe of legacy.recipes) {
      const id = await request("import", {
        input: { ...recipe, authorName: legacy.profile.name },
        legacyId: recipe.id,
        ownRating:
          legacy.ratings.find((rating) => rating.recipeId === recipe.id)
            ?.value || 0,
        favorite: legacy.favorites.some(
          (favorite) => favorite.recipeId === recipe.id,
        ),
      })
      importedIds.set(recipe.id, id)
    }
    const ids = new Set([
      ...legacy.ratings.map((rating) => rating.recipeId),
      ...legacy.favorites.map((favorite) => favorite.recipeId),
    ])
    for (const oldId of ids) {
      if (importedIds.has(oldId)) continue
      if (!online.recipes.some((recipe) => recipe.id === oldId)) continue
      await request("importPreference", {
        id: oldId,
        rating:
          legacy.ratings.find((rating) => rating.recipeId === oldId)?.value ||
          0,
        favorite: legacy.favorites.some(
          (favorite) => favorite.recipeId === oldId,
        ),
      })
    }
  }
  localStorage.setItem(marker, "1")
}

function ready() {
  if (!migration)
    migration = migrateLegacy().catch((error) => {
      migration = undefined
      throw error
    })
  return migration
}

/** @returns {Promise<Snapshot>} */
export function getSnapshot() {
  if (!reading) {
    /** @type {Promise<Snapshot>} */
    const pending = ready()
      .then(() => request("snapshot"))
      .finally(() => {
        if (reading === pending) reading = undefined
      })
    reading = pending
  }
  return reading
}

/** @param {() => void} listener */
export function subscribe(listener) {
  const refresh = () => {
    if (document.visibilityState === "visible") listener()
  }
  events.addEventListener("change", listener)
  window.addEventListener("focus", refresh)
  window.addEventListener("online", refresh)
  document.addEventListener("visibilitychange", refresh)
  const interval = window.setInterval(refresh, 15000)
  return () => {
    events.removeEventListener("change", listener)
    window.removeEventListener("focus", refresh)
    window.removeEventListener("online", refresh)
    document.removeEventListener("visibilitychange", refresh)
    window.clearInterval(interval)
  }
}

/** @param {RecipeInput} input @param {string} [id] @param {AdminDetails} [details] @returns {Promise<string>} */
export async function saveRecipe(input, id, details) {
  await ready()
  const savedId = await request("save", { input, id, details })
  notify()
  return savedId
}
/** @param {string} id */
export async function deleteRecipe(id) {
  await request("delete", { id })
  notify()
}
/** @param {string} id */
export async function toggleFavorite(id) {
  await request("favorite", { id })
  notify()
}
/** @param {string} id @param {number} value */
export async function rateRecipe(id, value) {
  await request("rate", { id, value })
  notify()
}
/** @param {string} name */
export async function saveProfile(name) {
  await request("profile", { name })
  notify()
}
/** @param {string} password */
export async function setupAdmin(password) {
  await request("setup", { password })
  notify()
}
/** @param {string} password */
export async function loginAdmin(password) {
  await request("login", { password })
  notify()
}
export async function logoutAdmin() {
  await request("logout")
  notify()
}
/** @param {string} currentPassword @param {string} newPassword */
export async function changeAdminPassword(currentPassword, newPassword) {
  await request("changePassword", { currentPassword, newPassword })
  notify()
}
