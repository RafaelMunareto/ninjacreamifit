// @ts-check
import { categories, programs } from "../data/recipes.js"
/** @typedef {import("../types").RecipeInput} RecipeInput */
/** @typedef {import("../types").Recipe} Recipe */

/** @param {unknown} value @param {string} label @param {number} limit */
export function text(value, label, limit) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Preencha ${label}.`)
  if (value.trim().length > limit)
    throw new Error(`${label} deve ter no máximo ${limit} caracteres.`)
  return value.trim()
}

/** @param {RecipeInput} input @param {string} [existingImage] @returns {RecipeInput} */
export function validateRecipe(input, existingImage) {
  const title = text(input.title, "o nome da receita", 100)
  if (!categories.slice(1).includes(input.category))
    throw new Error("Selecione uma categoria válida.")
  if (!Object.prototype.hasOwnProperty.call(programs, input.program))
    throw new Error("Selecione um programa válido.")
  if (typeof input.respin !== "boolean")
    throw new Error("Informe se a receita precisa de re-spin.")
  if (
    typeof input.image !== "string" ||
    (input.image !== existingImage &&
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(input.image))
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
  const toppings =
    typeof input.toppings === "string" ? input.toppings.trim() : ""
  if (toppings.length > 500)
    throw new Error("Descreva os toppings em até 500 caracteres.")
  let foodItems
  if (input.foodItems !== undefined) {
    if (!Array.isArray(input.foodItems) || input.foodItems.length > 50)
      throw new Error("Adicione no máximo 50 alimentos por receita.")
    foodItems = input.foodItems.map((item) => {
      if (
        !item ||
        typeof item.foodId !== "string" ||
        !/^(?:[A-Z]\d{4}[A-Z]|IBGE:\d{1,10}:(?:na|\d{1,3}))$/.test(
          item.foodId,
        ) ||
        typeof item.grams !== "number" ||
        !Number.isFinite(item.grams) ||
        item.grams <= 0 ||
        item.grams > 10000
      )
        throw new Error(
          "Informe uma quantidade válida para cada alimento selecionado.",
        )
      return { foodId: item.foodId, grams: item.grams }
    })
  }
  return {
    title,
    category: input.category,
    image: input.image,
    program: input.program,
    respin: input.respin,
    toppings,
    ingredients: lines(input.ingredients, "os ingredientes"),
    instructions: lines(input.instructions, "o modo de preparo"),
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    calories: input.calories,
    ...(foodItems === undefined ? {} : { foodItems }),
  }
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
