import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import initSqlJs from "sql.js"
import { seedRecipes } from "../src/data/recipes.js"
import { createFileStorage, ConflictError } from "../scripts/legacy-server/storage.js"
import { decodeSqlite } from "../scripts/legacy-server/sqlite.js"

const previousState = () => ({
  version: 1,
  recipes: structuredClone(seedRecipes),
  profiles: [
    {
      id: "author-id",
      tokenHash: "private-hash",
      name: "Autora 'da receita'",
      favorites: ["2", "1"],
      imports: [{ legacyId: "old-id", id: "already-deleted-id" }],
      preferences: ["1", "deleted-seed"],
    },
  ],
  ratings: [{ recipeId: "1", profileId: "author-id", value: 4 }],
  admin: {
    salt: "private-salt",
    iterations: 600000,
    hash: "private-admin-hash",
  },
})

test("migra o servidor para SQLite sem perder autoria, senha ou tombstones", async () => {
  const directory = await mkdtemp(join(tmpdir(), "creami-sqlite-"))
  try {
    const original = previousState()
    const archive = JSON.stringify(original)
    await writeFile(join(directory, "catalog.json"), archive)
    const storage = createFileStorage(directory)
    const before = await storage.read()
    assert.deepEqual(before.state, original)
    await storage.write(before.state, before.etag)
    const file = await readFile(join(directory, "catalog.sqlite"))
    assert.equal(file.subarray(0, 16).toString(), "SQLite format 3\u0000")
    assert.deepEqual(await decodeSqlite(file), original)
    assert.equal(
      await readFile(join(directory, "catalog.json"), "utf8"),
      archive,
    )
    assert.deepEqual(
      (await createFileStorage(directory).read()).state,
      original,
    )

    const SQL = await initSqlJs()
    const database = new SQL.Database(file)
    try {
      assert.deepEqual(
        database.exec(`
        SELECT recipes.protein, ratings.value, profiles.name
        FROM recipes JOIN ratings ON ratings.recipeId = recipes.id
        JOIN profiles ON profiles.id = ratings.profileId
        WHERE recipes.id = '1'
      `)[0].values,
        [[original.recipes[0].protein, 4, original.profiles[0].name]],
      )
      assert.equal(
        database.exec("PRAGMA integrity_check")[0].values[0][0],
        "ok",
      )
      assert.equal(database.exec("PRAGMA foreign_key_check").length, 0)
    } finally {
      database.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("SQLite rejeita gravação antiga ou dados inválidos sem alterar o banco", async () => {
  const directory = await mkdtemp(join(tmpdir(), "creami-sqlite-"))
  try {
    const storage = createFileStorage(directory)
    await storage.write(previousState(), null)
    const before = await storage.read()
    const updated = structuredClone(before.state)
    updated.recipes[0].protein = 0
    await storage.write(updated, before.etag)
    await assert.rejects(
      storage.write(before.state, before.etag),
      ConflictError,
    )
    const latest = await storage.read()
    const invalid = structuredClone(latest.state)
    invalid.recipes[0].protein = null
    await assert.rejects(
      storage.write(invalid, latest.etag),
      /NOT NULL constraint/,
    )
    assert.deepEqual((await storage.read()).state, updated)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("banco corrompido gera erro e permanece intacto", async () => {
  const directory = await mkdtemp(join(tmpdir(), "creami-sqlite-"))
  try {
    const bytes = Buffer.from("SQLite format 3\u0000arquivo corrompido")
    await writeFile(join(directory, "catalog.sqlite"), bytes)
    await assert.rejects(createFileStorage(directory).read())
    assert.deepEqual(await readFile(join(directory, "catalog.sqlite")), bytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
