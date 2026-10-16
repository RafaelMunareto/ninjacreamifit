export type Program = "sorbet" | "sorvete" | "sorvete_light" | "gelato"
export type Category = "Frutados" | "Chocolate" | "Cremosos" | "Veganos" | "Baixa caloria"

export interface RecipeInput {
  title: string
  category: Category
  image: string
  prepMinutes: number
  program: Program
  respin: boolean
  toppings: string
  ingredients: string[]
  instructions: string[]
  protein: number
  carbs: number
  fat: number
  calories: number
}

export interface StoredRecipe extends RecipeInput {
  id: string
  author: string
  authorId: string | null
  color: string
  rating: number
  votes: number
  createdAt: string
}

export interface Recipe extends StoredRecipe {
  isFavorite: boolean
  ownRating: number
}

export interface Profile {
  id: string
  name: string
}

export interface Snapshot {
  recipes: Recipe[]
  profile: Profile
}
