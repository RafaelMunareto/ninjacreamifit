import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  calculateNutrition,
  createFoodCatalog,
  hasCompleteNutrition,
  searchFoods,
  matchesFoodQuery,
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

test("busca tolera uma letra errada por palavra e mantém todas as palavras obrigatórias", () => {
  const pineapple = {
    ...milk,
    id: "CUSTOM:pineapple",
    name: "PINEAPPLE WHEY ESSENTIAL NUTRITION",
    source: "Manual",
  }
  const catalog = createFoodCatalog([
    pineapple,
    { ...banana, id: "OFF:1", name: "Pineapple Juice" },
    { ...milk, id: "OFF:2", name: "Banana Whey" },
  ])
  for (const query of [
    "pineaple whey",
    "pineaapple whey",
    "pineappke whey",
    "pineappel whey",
    "pineapple whei",
  ]) {
    assert.deepEqual(
      searchFoods(catalog, query).foods.map((food) => food.id),
      [pineapple.id],
      query,
    )
    assert.equal(matchesFoodQuery(pineapple, query), true)
  }
  for (const query of ["pinaple whey", "pineaple banana", "pineaple zero"])
    assert.equal(searchFoods(catalog, query).total, 0, query)
  assert.equal(
    matchesFoodQuery(
      { ...milk, name: "Iogurte Vero", category: "iogurte zero" },
      "iogurte zero",
    ),
    false,
  )
  assert.equal(
    matchesFoodQuery(
      { ...milk, name: "Pineapple Whey 80" },
      "pineaple whey 90",
    ),
    false,
  )
  assert.equal(searchFoods(createFoodCatalog([milk]), "C0002G").total, 0)
})

test("nomes exatos ficam antes dos aproximados, com calorias crescentes no mesmo grupo", () => {
  const make = (id, name, calories) => ({ ...milk, id, name, calories })
  const catalog = createFoodCatalog([
    make("FATSECRET:1", "Pineapple Whey", 300),
    make("FATSECRET:2", "Pineaple Whey", 400),
    make("FATSECRET:3", "Pineapple Whey Essencial", 200),
  ])
  assert.deepEqual(
    searchFoods(catalog, "pineaple whey").foods.map((food) => food.id),
    ["FATSECRET:2", "FATSECRET:3", "FATSECRET:1"],
  )
  assert.deepEqual(
    searchFoods(catalog, "pineapple whey").foods.map((food) => food.id),
    ["FATSECRET:3", "FATSECRET:1", "FATSECRET:2"],
  )
})

test("leite condensado aparece antes das preparações, com calorias crescentes entre os produtos", async () => {
  const data = await Promise.all(
    ["tbca", "ibge"].map(async (source) =>
      JSON.parse(
        await readFile(
          new URL(`../public/data/${source}-foods-v1.json`, import.meta.url),
          "utf8",
        ),
      ),
    ),
  )
  const catalog = createFoodCatalog(data.flatMap((entry) => entry.foods))
  for (const query of ["LEITE CONDENSADO", "condensado leite"]) {
    const result = searchFoods(catalog, query, 2)
    assert.deepEqual(
      result.foods.map((food) => food.id),
      ["C0030G", "IBGE:7900901:99"],
    )
    assert.ok(
      result.total > 20,
      "a busca continua incluindo preparações relacionadas",
    )
    assert.ok(result.foods[0].calories <= result.foods[1].calories)
  }
  const result = searchFoods(catalog, "leite condensado", 100)
  assert.ok(
    result.foods.findIndex((food) => food.id === "C0084K") > 1,
    "o pavê de 85 kcal não deve esconder o ingrediente",
  )
})

test("resultados selecionáveis não são escondidos por produtos externos com macros ausentes", () => {
  const condensed = {
    ...milk,
    id: "condensado",
    name: "Leite condensado",
    calories: 319,
  }
  const dessert = {
    ...milk,
    id: "pave",
    name: "Pavê (leite condensado)",
    calories: 85,
  }
  const incomplete = Array.from({ length: 25 }, (_, i) => ({
    ...condensed,
    id: `OFF:${i}`,
    calories: i,
    protein: null,
  }))
  const result = searchFoods(
    createFoodCatalog([...incomplete, dessert, condensed]),
    "leite condensado",
    2,
  )
  assert.deepEqual(
    result.foods.map((food) => food.id),
    [condensed.id, dessert.id],
  )
  assert.equal(result.total, 27)
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
