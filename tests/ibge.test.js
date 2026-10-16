import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { convertFood, parseRows } from "../scripts/import-ibge.mjs"
import {
  calculateNutrition,
  createFoodCatalog,
  hasCompleteNutrition,
  searchFoods,
} from "../src/lib/nutrition.js"

const load = async (source) =>
  JSON.parse(
    await readFile(
      new URL(`../public/data/${source}-foods-v1.json`, import.meta.url),
      "utf8",
    ),
  )

test("importação IBGE separa preparações e preserva valores desconhecidos", () => {
  const row = {
    Codigo: "6300701",
    Codigo_de_preparacao: "2",
    descricacao_do_alimento: "Milho",
    descricao_da_preparacao: "Cozido(a)",
    Categoria: "Cereais",
    Energia_kcal: "160,14",
    Proteina_g: "3,32",
    Lipidios_totais_g: "0,00",
    Carboi_drato_g: "-",
  }
  const food = convertFood(row)
  assert.equal(food.id, "IBGE:6300701:2")
  assert.equal(food.name, "Milho · Cozido(a)")
  assert.equal(food.calories, 160.14)
  assert.equal(food.fat, 0)
  assert.equal(food.carbs, null)
  assert.equal(hasCompleteNutrition(food), false)
  assert.notEqual(
    convertFood({ ...row, Codigo_de_preparacao: "1" }).id,
    food.id,
  )
  assert.equal(
    convertFood({ ...row, Codigo_de_preparacao: null }).id,
    "IBGE:6300701:na",
  )
  assert.deepEqual(
    parseRows(
      "INSERT INTO `ibges` (`Codigo`, `name`) VALUES (1, 'D''água, (teste)'), (2, 'D\\'água');",
    ),
    [
      { Codigo: "1", name: "D'água, (teste)" },
      { Codigo: "2", name: "D'água" },
    ],
  )
  assert.throws(() =>
    parseRows("INSERT INTO `ibges` (`Codigo`) VALUES (evil());"),
  )
})

test("catálogos combinados permitem filtrar fonte e somar pesos sem colisão", async () => {
  const [tbca, ibge] = await Promise.all([load("tbca"), load("ibge")])
  assert.equal(ibge.foods.length, 1971)
  assert.equal(ibge.foods.filter(hasCompleteNutrition).length, 1312)
  const catalog = createFoodCatalog([...tbca.foods, ...ibge.foods])
  assert.equal(catalog.byId.size, 7639)
  assert.ok(
    searchFoods(catalog, "arroz", 100, "IBGE").foods.every(
      (food) => food.source === "IBGE",
    ),
  )
  assert.ok(
    searchFoods(catalog, "banana", 100, "TBCA").foods.every(
      (food) => !food.source || food.source === "TBCA",
    ),
  )
  const rice = catalog.byId.get("IBGE:6300101:na")
  assert.equal(searchFoods(catalog, "IBGE 6300101").foods[0].id, rice.id)
  assert.deepEqual(
    calculateNutrition([
      { food: rice, grams: "50" },
      { food: catalog.byId.get("C0007C"), grams: "100" },
    ]),
    { calories: 158.81, protein: 2.57, carbs: 35.69, fat: 0.81 },
  )
  assert.throws(() => createFoodCatalog([rice, rice]), /repetidos/)
})
