import { useEffect, useMemo, useRef, useState } from "react"
import type { Recipe, RecipeInput, Snapshot } from "./types"
import { categories } from "./data/recipes.js"
import * as api from "./lib/api.js"
import Icon from "./components/Icon"
import Macro from "./components/Macro"
import RecipeDetails from "./components/RecipeDetails"
import RecipeForm from "./components/RecipeForm"
import ProfileModal from "./components/ProfileModal"
import AdminPanel from "./components/AdminPanel"
import DeleteRecipeDialog from "./components/DeleteRecipeDialog"

const EMPTY_RECIPES: Recipe[] = []

function RecipeCard({
  recipe,
  onOpen,
  onFavorite,
  onEdit,
  onDelete,
}: {
  recipe: Recipe
  onOpen: () => void
  onFavorite: () => Promise<void>
  onEdit?: () => void
  onDelete?: () => void
}) {
  const [pending, setPending] = useState(false)
  const locked = useRef(false)
  const favorite = async () => {
    if (locked.current) return
    locked.current = true
    setPending(true)
    try {
      await onFavorite()
    } finally {
      locked.current = false
      setPending(false)
    }
  }
  return (
    <article className="group overflow-hidden rounded-[28px] border border-[#eadfd5] bg-white p-2 shadow-[0_8px_30px_rgba(70,43,28,0.06)] transition hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(70,43,28,0.12)]">
      <div className="relative h-56 overflow-hidden rounded-[22px]">
        <img
          src={recipe.image}
          loading="lazy"
          alt={`Sorvete ${recipe.title}`}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <span
            className={`${recipe.color} rounded-full px-3 py-1.5 text-xs font-extrabold text-[#30251f] shadow-sm`}
          >
            {recipe.category}
          </span>
          <button
            disabled={pending}
            onClick={() => void favorite()}
            className={`grid size-10 place-items-center rounded-full bg-white shadow-md transition hover:scale-105 ${
              recipe.isFavorite ? "text-[#ef4f78]" : "text-[#4b3a30]"
            }`}
            aria-pressed={recipe.isFavorite}
            aria-label={
              recipe.isFavorite
                ? `Remover ${recipe.title} dos favoritos`
                : `Adicionar ${recipe.title} aos favoritos`
            }
          >
            <Icon name="heart" size={19} filled={recipe.isFavorite} />
          </button>
        </div>
      </div>
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="font-display text-xl font-black tracking-tight text-[#30251f]">
            {recipe.title}
          </h3>
          <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-[#30251f]">
            <span className="text-[#f6ae2d]">
              <Icon name="star" size={16} filled />
            </span>
            {recipe.votes ? recipe.rating.toLocaleString("pt-BR") : "Nova"}
          </span>
        </div>
        <p className="mb-4 text-xs font-semibold text-[#8a776b]">
          por {recipe.author} · {recipe.votes} avaliações
        </p>
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-[#f5f0eb] px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#6f5d52]">
          <Icon name="bowl" size={15} /> Ninja CREAMi · pote completo
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <Macro
            value={`${recipe.protein}g`}
            label="proteína"
            tone="bg-[#fff0f4] text-[#d63f68]"
          />
          <Macro
            value={`${recipe.carbs}g`}
            label="carbo"
            tone="bg-[#fff6d8] text-[#9a6c00]"
          />
          <Macro
            value={`${recipe.fat}g`}
            label="gordura"
            tone="bg-[#eef8dd] text-[#5f7f24]"
          />
          <Macro
            value={`${recipe.calories}`}
            label="kcal"
            tone="bg-[#eee8fb] text-[#7655bd]"
          />
        </div>
        <button
          onClick={onOpen}
          className="mt-4 flex w-full items-center justify-between rounded-full bg-[#342820] px-5 py-3 text-sm font-extrabold text-white transition hover:bg-[#ef4f78]"
        >
          Ver receita <Icon name="arrow" size={18} />
        </button>
        {onEdit && onDelete && (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#f0e5da] pt-3">
            <span className="text-xs font-bold text-[#8a776b]">
              Sua receita
            </span>
            <div className="flex gap-2">
              <button
                onClick={onEdit}
                aria-label={`Editar ${recipe.title}`}
                className="rounded-full bg-[#fff0f4] px-3 py-2 text-xs font-extrabold text-[#d63f68]"
              >
                Editar
              </button>
              <button
                onClick={onDelete}
                aria-label={`Excluir ${recipe.title}`}
                className="rounded-full bg-[#f5f0eb] px-3 py-2 text-xs font-extrabold text-[#715f54]"
              >
                Excluir
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [databaseError, setDatabaseError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  const [category, setCategory] = useState("Todos")
  const [query, setQuery] = useState("")
  const [collection, setCollection] = useState("all")
  const [sort, setSort] = useState("recent")
  const [showSubmit, setShowSubmit] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [notice, setNotice] = useState("")

  useEffect(() => {
    let active = true
    let revision = 0
    setLoading(true)
    const load = async () => {
      const current = ++revision
      try {
        const next = await api.getSnapshot()
        if (active && current === revision) {
          setSnapshot(next)
          setDatabaseError("")
        }
      } catch (cause) {
        if (active && current === revision)
          setDatabaseError(api.errorMessage(cause))
      } finally {
        if (active && current === revision) setLoading(false)
      }
    }
    const unsubscribe = api.subscribe(() => void load())
    void load()
    return () => {
      active = false
      unsubscribe()
    }
  }, [reloadKey])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(""), 6000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const recipes = snapshot?.recipes ?? EMPTY_RECIPES
  const selected = recipes.find((recipe) => recipe.id === selectedId)
  const editing = recipes.find((recipe) => recipe.id === editingId)
  const deleting = recipes.find((recipe) => recipe.id === deletingId)
  const visibleRecipes = useMemo(
    () =>
      api.filterRecipes(recipes, {
        category,
        query,
        collection,
        sort,
        profileId: snapshot?.profile.id,
      }),
    [recipes, category, query, collection, sort, snapshot?.profile.id],
  )
  const favoriteCount = recipes.filter((recipe) => recipe.isFavorite).length
  const voteCount = recipes.reduce((total, recipe) => total + recipe.votes, 0)
  const averageRating = voteCount
    ? (
        recipes.reduce(
          (total, recipe) => total + recipe.rating * recipe.votes,
          0,
        ) / voteCount
      ).toLocaleString("pt-BR", { maximumFractionDigits: 1 })
    : "—"
  const maxProtein = recipes.reduce(
    (max, recipe) => Math.max(max, recipe.protein),
    0,
  )

  const scrollToRecipes = () =>
    document.getElementById("receitas")?.scrollIntoView({ behavior: "smooth" })
  const openCollection = (next: "favorites" | "mine") => {
    setCollection(next)
    setQuery("")
    setCategory("Todos")
    setShowProfile(false)
    scrollToRecipes()
  }
  const saveRecipe = async (input: RecipeInput, id?: string) => {
    const savedId = await api.saveRecipe(input, id)
    setShowSubmit(false)
    setEditingId(null)
    setSelectedId(savedId)
    setCategory("Todos")
    setQuery("")
    setCollection("mine")
    setSort("recent")
    setNotice(
      id
        ? "Alterações publicadas no site!"
        : "Receita publicada! Ela já aparece para todos.",
    )
  }
  const toggleFavorite = async (recipe: Recipe) => {
    try {
      await api.toggleFavorite(recipe.id)
    } catch (cause) {
      setNotice(api.errorMessage(cause))
    }
  }

  const openAdmin = () => {
    setShowProfile(false)
    setShowAdmin(true)
    setNotice("")
    window.scrollTo({ top: 0 })
  }
  const editRecipe = (id: string) => {
    setEditingId(id)
    setShowSubmit(true)
  }
  const confirmDelete = (id: string) => {
    setSelectedId(null)
    setDeletingId(id)
  }

  if (showAdmin && snapshot) {
    return (
      <AdminPanel
        snapshot={snapshot}
        onClose={() => {
          setShowAdmin(false)
          window.scrollTo({ top: 0 })
        }}
      />
    )
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#fffaf3] text-[#342820]">
      <nav className="fixed inset-x-0 top-0 z-40 border-b border-[#f0e5da]/80 bg-[#fffaf3]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 lg:px-8">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex items-center gap-2"
            aria-label="Voltar ao topo"
          >
            <span className="logo-scoop">
              <span />
            </span>
            <span className="font-display text-2xl font-black tracking-[-0.05em]">
              Ninja CREAMi <span className="text-[#ef4f78]">Fit</span>
            </span>
          </button>
          <div className="hidden items-center gap-8 md:flex">
            <button
              onClick={scrollToRecipes}
              className="text-sm font-bold transition hover:text-[#ef4f78]"
            >
              Receitas
            </button>
            <button
              onClick={() =>
                document
                  .getElementById("comunidade")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
              className="text-sm font-bold transition hover:text-[#ef4f78]"
            >
              Comunidade
            </button>
            <button
              disabled={!snapshot}
              onClick={() => setShowSubmit(true)}
              className="flex items-center gap-2 rounded-full bg-[#ef4f78] px-5 py-3 text-sm font-extrabold text-white shadow-[0_6px_0_#c9355c] transition hover:-translate-y-0.5"
            >
              <Icon name="plus" size={18} /> Enviar receita
            </button>
            <button
              disabled={!snapshot}
              onClick={() => setShowProfile(true)}
              className="grid size-11 place-items-center rounded-full border border-[#e8dbcf] bg-white"
              aria-label="Abrir perfil"
            >
              <Icon name="user" size={19} />
            </button>
          </div>
          <button
            onClick={() => setMobileMenu(!mobileMenu)}
            aria-expanded={mobileMenu}
            className="grid size-11 place-items-center rounded-full bg-white shadow-sm md:hidden"
            aria-label="Abrir menu"
          >
            <Icon name={mobileMenu ? "close" : "menu"} />
          </button>
        </div>
        {mobileMenu && (
          <div className="border-t border-[#eee1d6] bg-[#fffaf3] px-5 py-5 md:hidden">
            <button
              onClick={() => {
                scrollToRecipes()
                setMobileMenu(false)
              }}
              className="block w-full py-3 text-left font-bold"
            >
              Receitas
            </button>
            <button
              disabled={!snapshot}
              onClick={() => {
                setShowProfile(true)
                setMobileMenu(false)
              }}
              className="block w-full py-3 text-left font-bold"
            >
              Meu perfil
            </button>
            <button
              disabled={!snapshot}
              onClick={() => {
                setShowSubmit(true)
                setMobileMenu(false)
              }}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-[#ef4f78] px-5 py-3 font-extrabold text-white"
            >
              <Icon name="plus" size={18} /> Enviar receita
            </button>
          </div>
        )}
      </nav>

      <section className="relative mx-auto grid min-h-[760px] max-w-7xl items-center gap-10 px-5 pb-16 pt-32 lg:grid-cols-[1.05fr_.95fr] lg:px-8 lg:pt-28">
        <div className="relative z-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#eadfd5] bg-white px-4 py-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[#775f51]">
            <span className="size-2 rounded-full bg-[#9fcd50]" /> exclusivo para
            Ninja CREAMi
          </div>
          <h1 className="font-display max-w-2xl text-6xl font-black leading-[0.92] tracking-[-0.07em] sm:text-7xl lg:text-[92px]">
            Sua CREAMi.
            <br />
            Seu{" "}
            <span className="relative text-[#ef4f78]">
              shape.
              <svg
                className="absolute -bottom-2 left-0 w-full text-[#ffd25e]"
                viewBox="0 0 300 18"
                fill="none"
              >
                <path
                  d="M4 12C73 3 179 4 296 9"
                  stroke="currentColor"
                  strokeWidth="9"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h1>
          <p className="mt-8 max-w-xl text-lg font-medium leading-relaxed text-[#715f54] sm:text-xl">
            Receitas fitness feitas exclusivamente para a Ninja CREAMi, com modo
            de processamento, macros por pote e notas reais de sabor.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={scrollToRecipes}
              className="flex items-center justify-center gap-3 rounded-full bg-[#342820] px-7 py-4 font-extrabold text-white shadow-[0_7px_0_#1d1713] transition hover:-translate-y-1"
            >
              Explorar sabores <Icon name="arrow" />
            </button>
            <button
              disabled={!snapshot}
              onClick={() => setShowSubmit(true)}
              className="flex items-center justify-center gap-3 rounded-full border-2 border-[#342820] bg-white px-7 py-4 font-extrabold transition hover:bg-[#fff0f4]"
            >
              <Icon name="plus" /> Criar receita
            </button>
          </div>
          <div className="mt-10 flex items-center gap-4">
            <div className="flex -space-x-3">
              {[
                "bg-[#ffadc4]",
                "bg-[#b8e46c]",
                "bg-[#b79af6]",
                "bg-[#ffd45e]",
              ].map((c, i) => (
                <span
                  key={i}
                  className={`grid size-10 place-items-center rounded-full border-2 border-[#fffaf3] ${c} text-xs font-black`}
                >
                  {["LM", "RF", "NP", "BD"][i]}
                </span>
              ))}
            </div>
            <p className="text-sm font-bold">
              <strong className="block text-base">
                {recipes.length} sabores cremosos
              </strong>
              <span className="text-[#907b6f]">
                para descobrir e fazer do seu jeito
              </span>
            </p>
          </div>
        </div>

        <div className="relative mx-auto mr-3 aspect-square w-[calc(100%_-_0.75rem)] max-w-[420px] sm:mr-auto sm:aspect-[14/13] sm:w-full sm:max-w-[560px] lg:aspect-auto lg:h-[520px]">
          <div className="absolute inset-5 rotate-3 rounded-[48%_52%_42%_58%/55%_42%_58%_45%] bg-[#b8e46c] sm:inset-8" />
          <div className="absolute inset-0 -rotate-3 overflow-hidden rounded-[46%_54%_56%_44%/47%_42%_58%_53%] border-[6px] border-white shadow-[0_30px_80px_rgba(74,49,32,0.18)] sm:border-[10px]">
            <img
              src="https://images.unsplash.com/photo-1628815870980-f416105d89b3?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=90&w=1080"
              alt="Sorvete cremoso sendo retirado de um pote"
              width={1080}
              height={1620}
              className="block h-full w-full object-cover object-center"
            />
          </div>
          <div className="float-card absolute -left-1 top-8 rounded-2xl bg-white p-3 shadow-xl sm:-left-3 sm:top-16 sm:rounded-3xl sm:p-4">
            <span className="text-xs font-bold text-[#8e7a6f]">
              Muita proteína
            </span>
            <strong className="mt-1 block font-display text-2xl text-[#ef4f78] sm:text-3xl">
              32g
            </strong>
          </div>
          <div className="float-card-delay absolute -bottom-4 right-0 max-w-[calc(100%-1rem)] rounded-2xl bg-[#342820] p-3 text-white shadow-xl sm:-bottom-3 sm:rounded-3xl sm:p-4 sm:pr-6">
            <span className="flex items-center gap-2 text-[10px] font-bold text-[#d8c8bc] sm:text-xs">
              <Icon name="bowl" size={16} /> Modo Lite Ice Cream
            </span>
            <strong className="mt-1 block font-display text-sm sm:text-lg">
              24h congelando + 1 re-spin
            </strong>
          </div>
          <span className="absolute -right-1 top-3 size-10 rotate-12 rounded-[40%] bg-[#b79af6] sm:-right-5 sm:top-4 sm:size-16" />
          <span className="absolute -left-2 bottom-16 size-6 rounded-full bg-[#ffd45e] sm:-left-8 sm:bottom-24 sm:size-10" />
        </div>
      </section>

      <section
        id="receitas"
        className="scroll-mt-20 rounded-t-[48px] bg-white px-5 py-20 lg:px-8"
      >
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-[#ef4f78]">
                descubra seu próximo vício
              </p>
              <h2 className="font-display text-4xl font-black tracking-[-0.04em] sm:text-5xl">
                Sabores que fazem bem
              </h2>
            </div>
            <label className="flex w-full max-w-md items-center gap-3 rounded-full border border-[#e9ddd2] bg-[#fffaf3] px-5 py-3.5 focus-within:border-[#ef4f78]">
              <Icon name="search" size={19} />
              <input
                aria-label="Buscar receitas por sabor ou ingrediente"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-[#a69185]"
                placeholder="Busque por sabor ou ingrediente..."
              />
            </label>
          </div>
          <div className="no-scrollbar mt-9 flex gap-2 overflow-x-auto pb-3">
            {categories.map((item) => (
              <button
                key={item}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
                className={`shrink-0 rounded-full px-5 py-3 text-sm font-extrabold transition ${
                  category === item
                    ? "bg-[#342820] text-white"
                    : "border border-[#e9ddd2] bg-white hover:border-[#ef4f78] hover:text-[#ef4f78]"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Coleção de receitas"
            >
              {[
                ["all", "Todas as receitas"],
                ["favorites", `Favoritos (${favoriteCount})`],
                ["mine", "Minhas receitas"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setCollection(value)}
                  aria-pressed={collection === value}
                  className={`rounded-full px-4 py-2 text-xs font-extrabold ${
                    collection === value
                      ? "bg-[#fff0f4] text-[#d63f68]"
                      : "bg-[#f5f0eb] text-[#715f54]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-[#715f54]">
              Ordenar
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                className="rounded-full border border-[#e9ddd2] bg-white px-3 py-2"
              >
                <option value="recent">Mais recentes</option>
                <option value="rating">Melhor avaliação</option>
                <option value="protein">Mais proteína</option>
                <option value="calories">Menos calorias</option>
              </select>
            </label>
          </div>
          <p className="mt-4 text-xs font-medium text-[#8a776b]">
            Catálogo inicial com receitas e notas de exemplo. As novas receitas
            e avaliações são compartilhadas com toda a comunidade.
          </p>
          {databaseError && (
            <div
              role="alert"
              className="mt-6 rounded-3xl bg-[#fff0f4] p-5 text-sm font-bold text-[#b92e53]"
            >
              <p>{databaseError}</p>
              <button
                onClick={() => setReloadKey((value) => value + 1)}
                className="mt-3 underline"
              >
                Tentar novamente
              </button>
            </div>
          )}
          {loading ? (
            <p
              role="status"
              className="py-12 text-center font-bold text-[#78665b]"
            >
              Carregando suas receitas…
            </p>
          ) : visibleRecipes.length ? (
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {visibleRecipes.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  onOpen={() => setSelectedId(recipe.id)}
                  onFavorite={() => toggleFavorite(recipe)}
                  onEdit={
                    recipe.authorId === snapshot?.profile.id
                      ? () => editRecipe(recipe.id)
                      : undefined
                  }
                  onDelete={
                    recipe.authorId === snapshot?.profile.id
                      ? () => confirmDelete(recipe.id)
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="mt-12 rounded-[32px] bg-[#fff6d8] p-12 text-center">
              <strong className="font-display text-2xl">
                {collection === "mine" && !query && category === "Todos"
                  ? "Suas receitas ficam aqui."
                  : "Nenhum sabor por aqui ainda."}
              </strong>
              <p className="mt-2 text-[#79685d]">
                {collection === "mine" && !query && category === "Todos"
                  ? "Escolha seu nome ao enviar uma receita. Depois, você poderá editar ou excluir por aqui, sem precisar de senha."
                  : "Tente outra busca ou seja a primeira pessoa a criar essa receita."}
              </p>
              <button
                onClick={() => {
                  setQuery("")
                  setCategory("Todos")
                  setCollection("all")
                }}
                className="mt-4 rounded-full bg-[#342820] px-5 py-3 text-sm font-extrabold text-white"
              >
                Ver todas as receitas
              </button>
              {collection === "mine" && (
                <button
                  disabled={!snapshot}
                  onClick={() => {
                    setEditingId(null)
                    setShowSubmit(true)
                  }}
                  className="ml-2 mt-4 rounded-full bg-[#ef4f78] px-5 py-3 text-sm font-extrabold text-white"
                >
                  Criar minha receita
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <section
        id="comunidade"
        className="relative scroll-mt-20 overflow-hidden bg-[#b8e46c] px-5 py-20 lg:px-8"
      >
        <span className="absolute -left-20 -top-24 size-72 rounded-full border-[45px] border-[#a4d04f]/60" />
        <span className="absolute -bottom-32 right-10 size-72 rounded-full bg-[#ffd45e]/70" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-[0.2em]">
              feito por gente de verdade
            </p>
            <h2 className="font-display max-w-xl text-5xl font-black leading-[0.98] tracking-[-0.05em] sm:text-6xl">
              Sua receita pode ser a próxima queridinha.
            </h2>
            <p className="mt-6 max-w-lg text-lg font-semibold leading-relaxed text-[#52642f]">
              Guarde suas invenções feitas na Ninja CREAMi com foto, macros e
              modo de preparo. Favorite os sabores que ama e registre suas notas
              para a próxima rodada.
            </p>
            <button
              disabled={!snapshot}
              onClick={() => setShowSubmit(true)}
              className="mt-8 flex items-center gap-3 rounded-full bg-[#342820] px-7 py-4 font-extrabold text-white shadow-[0_7px_0_#71912f] transition hover:-translate-y-1"
            >
              <Icon name="plus" /> Salvar minha receita
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Stat
              value={String(recipes.length)}
              label="receitas no catálogo"
              color="bg-[#fffaf3]"
            />
            <Stat
              value={averageRating}
              label="média de sabor"
              color="bg-[#ffadc4]"
            />
            <Stat
              value={String(favoriteCount)}
              label="seus favoritos"
              color="bg-[#b79af6]"
            />
            <Stat
              value={`${maxProtein}g`}
              label="recorde de proteína"
              color="bg-[#ffd45e]"
            />
          </div>
        </div>
      </section>

      <footer className="bg-[#342820] px-5 py-12 text-white lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 sm:flex-row sm:items-end">
          <div>
            <div className="font-display text-3xl font-black tracking-[-0.05em]">
              Ninja CREAMi <span className="text-[#ef4f78]">Fit</span>
            </div>
            <p className="mt-3 max-w-sm text-sm font-medium text-[#baa99d]">
              A comunidade brasileira de receitas fitness feitas na Ninja
              CREAMi. Não somos afiliados à marca Ninja.
            </p>
          </div>
          <div className="space-y-3 sm:text-right">
            <button
              disabled={!snapshot}
              onClick={openAdmin}
              className="text-sm font-bold underline underline-offset-4"
            >
              Administração
            </button>
            <p className="text-sm font-semibold text-[#baa99d]">
              Feito com cremosidade no Brasil · {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </footer>

      {selected && !showSubmit && !deleting && (
        <RecipeDetails
          key={selected.id}
          recipe={selected}
          onClose={() => setSelectedId(null)}
          onRate={(value) => api.rateRecipe(selected.id, value)}
          onFavorite={() => api.toggleFavorite(selected.id)}
          onEdit={
            selected.authorId === snapshot?.profile.id
              ? () => editRecipe(selected.id)
              : undefined
          }
          onDelete={
            selected.authorId === snapshot?.profile.id
              ? () => confirmDelete(selected.id)
              : undefined
          }
        />
      )}
      {showSubmit && snapshot && (
        <RecipeForm
          key={editing?.id || "new"}
          recipe={editing}
          author={snapshot.profile.name}
          onSave={saveRecipe}
          onClose={() => {
            setShowSubmit(false)
            setEditingId(null)
          }}
        />
      )}
      {deleting && (
        <DeleteRecipeDialog
          key={deleting.id}
          recipe={deleting}
          onClose={() => setDeletingId(null)}
          onDelete={async () => {
            await api.deleteRecipe(deleting.id)
            setDeletingId(null)
            setNotice("Sua receita foi excluída.")
          }}
        />
      )}
      {showProfile && snapshot && (
        <ProfileModal
          profile={snapshot.profile}
          recipes={recipes}
          onClose={() => setShowProfile(false)}
          onSave={api.saveProfile}
          onCollection={openCollection}
          onAdmin={openAdmin}
        />
      )}
      {notice && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-5 z-[60] mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl bg-[#342820] px-5 py-4 text-sm font-bold text-white shadow-xl"
        >
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Fechar aviso">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
    </main>
  )
}

function Stat({
  value,
  label,
  color,
}: {
  value: string
  label: string
  color: string
}) {
  return (
    <div
      className={`${color} rounded-[30px] p-7 shadow-[0_10px_0_rgba(80,100,40,0.18)]`}
    >
      <strong className="font-display text-5xl font-black tracking-tight">
        {value}
      </strong>
      <span className="mt-2 block text-sm font-extrabold uppercase tracking-wide opacity-70">
        {label}
      </span>
    </div>
  )
}
