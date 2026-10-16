import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import initSqlJs from "sql.js"
import { createService } from "../server/service.js"
import { createFileStorage } from "../server/storage.js"
import { encodeSqlite, decodeSqlite } from "../server/sqlite.js"
import { seedRecipes } from "../src/data/recipes.js"

test("alimentos e pesos sobrevivem à edição e reinicialização do servidor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "creami-foods-"))
  try {
    let service = createService(createFileStorage(directory))
    const token = randomBytes(32).toString("hex")
    const foodItems = [
      { foodId: "C0113T", grams: 150.5 },
      { foodId: "A0105N", grams: 25 },
      { foodId: "IBGE:6300101:na", grams: 50 },
      { foodId: "IBGE:6300701:2", grams: 100 },
    ]
    const input = {
      title: "Pote calculado",
      category: "Veganos",
      image: "data:image/png;base64,aGVsbG8=",
      program: "sorbet",
      respin: false,
      toppings: "",
      ingredients: ["150,5 g de ingrediente", "25 g de outro ingrediente"],
      instructions: ["Misture e congele."],
      protein: 20,
      carbs: 30,
      fat: 4,
      calories: 240,
      foodItems,
    }
    const saved = await service.perform("save", { input }, token)
    service = createService(createFileStorage(directory))
    let recipe = (await service.snapshot(token)).recipes.find(
      (item) => item.id === saved.value,
    )
    assert.deepEqual(recipe.foodItems, foodItems)
    const { foodItems: omitted, ...oldClientInput } = input
    await service.perform(
      "save",
      {
        id: saved.value,
        input: { ...oldClientInput, image: recipe.image, title: "Editada" },
      },
      token,
    )
    recipe = (await service.snapshot(token)).recipes.find(
      (item) => item.id === saved.value,
    )
    assert.deepEqual(recipe.foodItems, foodItems)
    await assert.rejects(
      service.perform(
        "save",
        {
          id: saved.value,
          input: {
            ...input,
            image: recipe.image,
            foodItems: [{ foodId: "C0113T", grams: 0 }],
          },
        },
        token,
      ),
      /quantidade válida/,
    )
    assert.equal(
      (await service.snapshot(token)).recipes.find(
        (item) => item.id === saved.value,
      ).title,
      "Editada",
    )
    await service.perform(
      "save",
      {
        id: saved.value,
        input: { ...input, image: recipe.image, foodItems: [] },
      },
      token,
    )
    assert.deepEqual(
      (await service.snapshot(token)).recipes.find(
        (item) => item.id === saved.value,
      ).foodItems,
      [],
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("bancos SQLite anteriores continuam sendo lidos sem perda de dados", async () => {
  const state = {
    version: 1,
    recipes: structuredClone(seedRecipes),
    profiles: [],
    ratings: [],
    admin: null,
  }
  const SQL = await initSqlJs()
  const database = new SQL.Database(await encodeSqlite(state))
  try {
    database.run(
      "DROP TABLE foodItems; DROP TABLE foodRecipes; PRAGMA user_version = 1;",
    )
    const previous = await decodeSqlite(database.export())
    assert.deepEqual(previous, state)
    assert.deepEqual(await decodeSqlite(await encodeSqlite(previous)), state)
  } finally {
    database.close()
  }
})
