import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  calculateNutrition,
  createFoodCatalog,
  hasCompleteNutrition,
  searchFoods,
} from "../src/lib/nutrition.js"
import { convertFood, parseNutrient } from "../scripts/import-tbca.mjs"

const banana = {
  id: "C0001C",
  name: "Banana, crua",
  category: "Frutas",
  calories: 98,
  protein: 1.3,
  carbs: 26,
  fat: 0.1,
}
const milk = {
  id: "C0001G",
  name: "Leite, desnatado",
  category: "Laticínios",
  calories: 34,
  protein: 3.4,
  carbs: 4.8,
  fat: 0.1,
}

test("peso em gramas escala todos os nutrientes e soma o pote", () => {
  assert.deepEqual(
    calculateNutrition([
      { food: banana, grams: "150" },
      { food: milk, grams: "250" },
    ]),
    { calories: 232, protein: 10.45, carbs: 51, fat: 0.4 },
  )
  assert.deepEqual(calculateNutrition([{ food: banana, grams: "12.5" }]), {
    calories: 12.25,
    protein: 0.16,
    carbs: 3.25,
    fat: 0.01,
  })
  const tiny = { ...banana, fat: 0.004 }
  assert.equal(
    calculateNutrition(
      Array.from({ length: 3 }, () => ({ food: tiny, grams: "100" })),
    ).fat,
    0.01,
  )
})

test("quantidades inválidas e valores desconhecidos não viram zero", () => {
  for (const grams of ["", " ", "0", "-1", "Infinity", "NaN", "10001"])
    assert.equal(calculateNutrition([{ food: banana, grams }]), null)
  const incomplete = { ...banana, protein: null }
  assert.equal(hasCompleteNutrition(incomplete), false)
  assert.equal(calculateNutrition([{ food: incomplete, grams: "100" }]), null)
  assert.equal(hasCompleteNutrition({ ...banana, protein: 0 }), true)
})

test("busca local aceita acentos, múltiplas palavras e código TBCA", () => {
  const apple = { ...banana, id: "A0105N", name: "Maçã, crua" }
  const catalog = createFoodCatalog([banana, milk, apple])
  assert.equal(searchFoods(catalog, "MACA").foods[0].id, apple.id)
  assert.equal(searchFoods(catalog, "desnatado leite").foods[0].id, milk.id)
  assert.equal(searchFoods(catalog, "A0105N").foods[0].id, apple.id)
  assert.equal(searchFoods(catalog, "inexistente").total, 0)
  assert.equal(searchFoods(catalog, "a").total, 0)
})

test("importação distingue kcal de kJ, vírgula decimal, traços e NA", () => {
  assert.deepEqual(parseNutrient("8,91"), { value: 8.91, trace: false })
  assert.deepEqual(parseNutrient("0,00"), { value: 0, trace: false })
  assert.deepEqual(parseNutrient("NA"), { value: null, trace: false })
  assert.deepEqual(parseNutrient("tr"), { value: 0, trace: true })
  const row = {
    codigo: "A0105N",
    descricao: "Alimento, teste,",
    classe: "Teste",
    nutrientes: [
      { Componente: "Energia", Unidades: "kJ", "Valor por 100g": "510" },
      { Componente: "Energia", Unidades: "kcal", "Valor por 100g": "121" },
      { Componente: "Proteína", Unidades: "g", "Valor por 100g": "8,91" },
      {
        Componente: "Carboidrato total",
        Unidades: "g",
        "Valor por 100g": "23,1",
      },
      {
        Componente: "Carboidrato disponível",
        Unidades: "g",
        "Valor por 100g": "16,9",
      },
      { Componente: "Lipídios", Unidades: "g", "Valor por 100g": "tr" },
    ],
  }
  const food = convertFood(row)
  assert.equal(food.calories, 121)
  assert.equal(food.protein, 8.91)
  assert.equal(food.carbs, 23.1)
  assert.equal(food.fat, 0)
  assert.deepEqual(food.traces, ["fat"])
  row.nutrientes.push({
    Componente: "Proteína",
    Unidades: "g",
    "Valor por 100g": "9,00",
  })
  assert.equal(convertFood(row).protein, null)
})

test("cópia local contém a base completa e sinaliza registros contraditórios", async () => {
  const data = JSON.parse(
    await readFile(
      new URL("../public/data/tbca-foods-v1.json", import.meta.url),
      "utf8",
    ),
  )
  assert.equal(data.foods.length, 5668)
  assert.equal(data.source.basisGrams, 100)
  assert.equal(new Set(data.foods.map((food) => food.id)).size, 5668)
  assert.equal(data.foods.filter(hasCompleteNutrition).length, 5654)
  const food = data.foods.find((item) => item.id === "C0113T")
  assert.deepEqual(calculateNutrition([{ food, grams: "100" }]), {
    calories: 121,
    protein: 8.91,
    carbs: 23.1,
    fat: 0.58,
  })
  assert.equal(data.foods.find((item) => item.id === "C0237T").calories, null)
})
