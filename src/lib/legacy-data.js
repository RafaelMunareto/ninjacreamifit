// Read-only migration: never delete or overwrite the previous device database.
/** @returns {Promise<{profile: import("../types").Profile, recipes: import("../types").StoredRecipe[], ratings: {recipeId: string, value: number}[], favorites: {recipeId: string}[]} | null>} */
export async function readLegacyData() {
  if (typeof indexedDB === "undefined") return null
  const database = await new Promise((resolve, reject) => {
    let absent = false
    const request = indexedDB.open("ninja-creami-fit")
    request.onupgradeneeded = () => {
      absent = true
      request.transaction.abort()
    }
    request.onerror = () => (absent ? resolve(null) : reject(request.error))
    request.onsuccess = () => resolve(request.result)
  })
  if (!database) return null
  try {
    const stores = ["settings", "recipes", "ratings", "favorites"]
    if (!stores.every((name) => database.objectStoreNames.contains(name)))
      return null
    const transaction = database.transaction(stores, "readonly")
    const result = (request) =>
      new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const [profile, recipes, ratings, favorites] = await Promise.all([
      result(transaction.objectStore("settings").get("profile")),
      result(transaction.objectStore("recipes").getAll()),
      result(transaction.objectStore("ratings").getAll()),
      result(transaction.objectStore("favorites").getAll()),
    ])
    if (!profile) return null
    return {
      profile,
      recipes: recipes.filter((recipe) => recipe.authorId === profile.id),
      ratings,
      favorites,
    }
  } finally {
    database.close()
  }
}
