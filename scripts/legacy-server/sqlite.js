import initSqlJs from "sql.js/dist/sql-wasm-inline.js"

let engine
// The inline build keeps the SQLite engine in the function's JS package.
const sqlite = () => (engine ||= initSqlJs())

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  PRAGMA user_version = 2;
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY, tokenHash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, position INTEGER NOT NULL
  );
  CREATE TABLE recipes (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
    image TEXT NOT NULL, program TEXT NOT NULL,
    respin INTEGER NOT NULL CHECK (respin IN (0, 1)), toppings TEXT NOT NULL,
    protein REAL NOT NULL CHECK (protein >= 0),
    carbs REAL NOT NULL CHECK (carbs >= 0),
    fat REAL NOT NULL CHECK (fat >= 0),
    calories REAL NOT NULL CHECK (calories >= 0),
    author TEXT NOT NULL, authorId TEXT,
    authorOverride INTEGER CHECK (authorOverride IN (0, 1)),
    color TEXT NOT NULL, rating REAL NOT NULL CHECK (rating BETWEEN 0 AND 5),
    votes INTEGER NOT NULL CHECK (votes >= 0), createdAt TEXT NOT NULL,
    ingredients TEXT NOT NULL CHECK (json_valid(ingredients)),
    instructions TEXT NOT NULL CHECK (json_valid(instructions)),
    position INTEGER NOT NULL
  );
  CREATE TABLE ratings (
    profileId TEXT NOT NULL REFERENCES profiles(id),
    recipeId TEXT NOT NULL REFERENCES recipes(id),
    value INTEGER NOT NULL CHECK (value BETWEEN 1 AND 5),
    position INTEGER NOT NULL, PRIMARY KEY (profileId, recipeId)
  );
  CREATE TABLE foodItems (
    recipeId TEXT NOT NULL REFERENCES recipes(id), position INTEGER NOT NULL,
    foodId TEXT NOT NULL,
    grams REAL NOT NULL CHECK (grams > 0 AND grams <= 10000),
    unit TEXT NOT NULL DEFAULT 'g' CHECK (unit IN ('g', 'ml')),
    customFood TEXT,
    PRIMARY KEY (recipeId, position)
  );
  CREATE TABLE foodRecipes (
    recipeId TEXT PRIMARY KEY REFERENCES recipes(id)
  );
  CREATE TABLE favorites (
    profileId TEXT NOT NULL REFERENCES profiles(id),
    recipeId TEXT NOT NULL REFERENCES recipes(id),
    position INTEGER NOT NULL, PRIMARY KEY (profileId, recipeId)
  );
  -- Imports keep tombstones after a recipe is deleted: no recipe foreign key.
  CREATE TABLE legacyImports (
    profileId TEXT NOT NULL REFERENCES profiles(id),
    legacyId TEXT NOT NULL, id TEXT NOT NULL,
    position INTEGER NOT NULL, PRIMARY KEY (profileId, legacyId)
  );
  CREATE TABLE legacyPreferences (
    profileId TEXT NOT NULL REFERENCES profiles(id), recipeId TEXT NOT NULL,
    position INTEGER NOT NULL, PRIMARY KEY (profileId, recipeId)
  );
  CREATE TABLE admin (
    id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL,
    iterations INTEGER NOT NULL, hash TEXT NOT NULL
  );
`

const recipeColumns = [
  "id",
  "title",
  "category",
  "image",
  "program",
  "respin",
  "toppings",
  "protein",
  "carbs",
  "fat",
  "calories",
  "author",
  "authorId",
  "authorOverride",
  "color",
  "rating",
  "votes",
  "createdAt",
  "ingredients",
  "instructions",
]

const insertRows = (database, table, columns, rows) => {
  const statement = database.prepare(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  )
  try {
    for (const row of rows) statement.run(row)
  } finally {
    statement.free()
  }
}

const select = (database, sql) => {
  const statement = database.prepare(sql)
  const rows = []
  try {
    while (statement.step()) rows.push(statement.getAsObject())
  } finally {
    statement.free()
  }
  return rows
}

export const isSqlite = (bytes) =>
  bytes.length >= 16 &&
  new TextDecoder().decode(bytes.subarray(0, 16)) === "SQLite format 3\u0000"

export async function encodeSqlite(state) {
  const SQL = await sqlite()
  const database = new SQL.Database()
  try {
    database.run(SCHEMA)
    database.run("BEGIN TRANSACTION")
    insertRows(database, "metadata", ["key", "value"], [
      ["appVersion", state.version],
    ])
    insertRows(
      database,
      "profiles",
      ["id", "tokenHash", "name", "position"],
      state.profiles.map((profile, position) => [
        profile.id,
        profile.tokenHash,
        profile.name,
        position,
      ]),
    )
    insertRows(
      database,
      "recipes",
      [...recipeColumns, "position"],
      state.recipes.map((recipe, position) => [
        ...recipeColumns.map((key) => {
          if (key === "ingredients" || key === "instructions")
            return JSON.stringify(recipe[key])
          if (key === "respin") return Number(recipe[key])
          if (key === "authorOverride")
            return recipe[key] === undefined ? null : Number(recipe[key])
          return recipe[key] ?? null
        }),
        position,
      ]),
    )
    insertRows(
      database,
      "ratings",
      ["profileId", "recipeId", "value", "position"],
      state.ratings.map((rating, position) => [
        rating.profileId,
        rating.recipeId,
        rating.value,
        position,
      ]),
    )
    for (const recipe of state.recipes) {
      if (recipe.foodItems === undefined) continue
      insertRows(database, "foodRecipes", ["recipeId"], [[recipe.id]])
      insertRows(
        database,
        "foodItems",
        ["recipeId", "position", "foodId", "grams", "unit", "customFood"],
        recipe.foodItems.map((item, position) => [
          recipe.id,
          position,
          item.foodId,
          item.grams,
          item.unit === "ml" ? "ml" : "g",
          item.food ? JSON.stringify(item.food) : null,
        ]),
      )
    }
    for (const profile of state.profiles) {
      insertRows(
        database,
        "favorites",
        ["profileId", "recipeId", "position"],
        profile.favorites.map((id, position) => [profile.id, id, position]),
      )
      insertRows(
        database,
        "legacyImports",
        ["profileId", "legacyId", "id", "position"],
        profile.imports.map((item, position) => [
          profile.id,
          item.legacyId,
          item.id,
          position,
        ]),
      )
      insertRows(
        database,
        "legacyPreferences",
        ["profileId", "recipeId", "position"],
        profile.preferences.map((id, position) => [profile.id, id, position]),
      )
    }
    if (state.admin)
      insertRows(database, "admin", ["id", "salt", "iterations", "hash"], [
        [1, state.admin.salt, state.admin.iterations, state.admin.hash],
      ])
    database.run("COMMIT")
    return database.export()
  } finally {
    database.close()
  }
}

export async function decodeSqlite(bytes) {
  const SQL = await sqlite()
  const database = new SQL.Database(bytes)
  try {
    const version = database.exec("PRAGMA user_version")[0]?.values[0][0]
    if (version !== 1 && version !== 2)
      throw new Error("Versão do banco SQLite não suportada.")
    const profiles = select(
      database,
      "SELECT id, tokenHash, name FROM profiles ORDER BY position",
    ).map((profile) => ({
      ...profile,
      favorites: [],
      imports: [],
      preferences: [],
    }))
    const byId = new Map(profiles.map((profile) => [profile.id, profile]))
    for (const item of select(
      database,
      "SELECT * FROM favorites ORDER BY position",
    ))
      byId.get(item.profileId).favorites.push(item.recipeId)
    for (const item of select(
      database,
      "SELECT * FROM legacyImports ORDER BY position",
    ))
      byId
        .get(item.profileId)
        .imports.push({ legacyId: item.legacyId, id: item.id })
    for (const item of select(
      database,
      "SELECT * FROM legacyPreferences ORDER BY position",
    ))
      byId.get(item.profileId).preferences.push(item.recipeId)
    const recipes = select(
      database,
      `SELECT ${recipeColumns.join(",")} FROM recipes ORDER BY position`,
    ).map((row) => {
      const recipe = {
        ...row,
        respin: Boolean(row.respin),
        ingredients: JSON.parse(row.ingredients),
        instructions: JSON.parse(row.instructions),
      }
      if (row.authorOverride === null) delete recipe.authorOverride
      else recipe.authorOverride = Boolean(row.authorOverride)
      return recipe
    })
    if (version === 2) {
      const byRecipe = new Map(recipes.map((recipe) => [recipe.id, recipe]))
      for (const row of select(database, "SELECT recipeId FROM foodRecipes"))
        byRecipe.get(row.recipeId).foodItems = []
      const foodColumns = select(database, "PRAGMA table_info(foodItems)")
      const hasUnit = foodColumns.some((column) => column.name === "unit")
      const hasCustomFood = foodColumns.some((column) => column.name === "customFood")
      const foodRows = select(
        database,
        `SELECT recipeId, foodId, grams${
          hasUnit ? ", unit" : ""
        }${hasCustomFood ? ", customFood" : ""} FROM foodItems ORDER BY position`,
      )
      for (const row of foodRows) {
        const { recipeId, ...item } = row
        if (item.unit !== "ml") delete item.unit
        if (item.customFood) {
          item.food = JSON.parse(item.customFood)
        }
        delete item.customFood
        byRecipe.get(recipeId).foodItems.push(item)
      }
    }
    return {
      version: select(
        database,
        "SELECT value FROM metadata WHERE key = 'appVersion'",
      )[0].value,
      recipes,
      profiles,
      ratings: select(
        database,
        "SELECT recipeId, profileId, value FROM ratings ORDER BY position",
      ),
      admin:
        select(
          database,
          "SELECT salt, iterations, hash FROM admin WHERE id = 1",
        )[0] || null,
    }
  } finally {
    database.close()
  }
}

// Supports the previous server format during the migration; never resets data.
export async function decodeCatalog(bytes) {
  return isSqlite(bytes)
    ? decodeSqlite(bytes)
    : JSON.parse(new TextDecoder().decode(bytes))
}
