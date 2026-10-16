export type Program = "sorbet" | "sorvete" | "sorvete_light" | "gelato"
export type Category = "Frutados" | "Chocolate" | "Cremosos" | "Veganos" | "Baixa caloria"

export interface RecipeInput {
  authorName?: string
  title: string
  category: Category
  image: string
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
  authorOverride?: boolean
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

export interface AdminDetails {
  author: string
  rating: number
  votes: number
  ratingsChanged?: boolean
}

export interface AdminStatus {
  configured: boolean
  authenticated: boolean
}

export interface Snapshot {
  recipes: Recipe[]
  profile: Profile
  admin: AdminStatus
}
