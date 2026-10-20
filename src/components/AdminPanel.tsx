import { useEffect, useRef, useState } from "react"
import { Show, SignInButton, UserButton } from "@clerk/react"
import type { AdminDetails, RecipeInput, Snapshot } from "../types"
import * as api from "../lib/api.js"
import { categories } from "../data/recipes.js"
import Icon from "./Icon"
import Modal from "./Modal"
import RecipeForm from "./RecipeForm"

export default function AdminPanel({
  snapshot,
  onClose,
}: {
  snapshot: Snapshot
  onClose: () => void
}) {
  const { authenticated } = snapshot.admin
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("Todos")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const locked = useRef(false)
  const editing = snapshot.recipes.find((recipe) => recipe.id === editingId)
  const deleting = snapshot.recipes.find((recipe) => recipe.id === deletingId)
  const recipes = api.filterRecipes(snapshot.recipes, { query, category })
  const totalVotes = snapshot.recipes.reduce(
    (total, recipe) => total + recipe.votes,
    0,
  )

  useEffect(() => {
    if (!authenticated) {
      setEditingId(null)
      setDeletingId(null)
    }
  }, [authenticated])
  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(""), 6000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const run = async (action: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError("")
    try {
      await action()
    } catch (cause) {
      setError(api.errorMessage(cause))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const save = async (
    input: RecipeInput,
    id?: string,
    details?: AdminDetails,
  ) => {
    if (!id || !details) throw new Error("Selecione uma receita para editar.")
    await api.saveRecipe(input, id, details)
    setEditingId(null)
    setNotice("Receita, macros e avaliações atualizados!")
  }

  return (
    <main className="min-h-screen bg-page text-foreground">
      <header className="border-b border-outline bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5 lg:px-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ef4f78]">
              Ninja CREAMi Fit
            </p>
            <h1 className="mt-1 font-display text-2xl font-black">
              Administração
            </h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <Show when="signed-in">
              <UserButton />
            </Show>
            <button
              disabled={busy}
              onClick={onClose}
              className="rounded-full bg-[#342820] px-5 py-2.5 text-sm font-bold text-white"
            >
              Voltar ao site
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-10 lg:px-8">
        {!authenticated ? (
          <section className="mx-auto max-w-md rounded-[32px] border border-outline bg-surface p-6 shadow-sm sm:p-9">
            <span className="grid size-14 place-items-center rounded-2xl bg-pink-soft text-[#ef4f78]">
              <Icon name="user" size={26} />
            </span>
            <h2 className="mt-5 font-display text-3xl font-black">
              Acesso restrito
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              A administração é liberada pela conta de e-mail autorizada. Entre
              com essa conta para gerenciar receitas e avaliações.
            </p>
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="mt-6 w-full rounded-full bg-[#ef4f78] px-6 py-3.5 text-sm font-extrabold text-white">
                  Entrar com minha conta
                </button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <p
                role="status"
                className="mt-5 text-sm leading-relaxed text-muted"
              >
                O acesso de administrador não está liberado para a conta
                conectada. Use o menu da sua conta, no topo, para sair e entrar
                com outra conta.
              </p>
            </Show>
          </section>
        ) : (
          <>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ef4f78]">
                  controle do catálogo
                </p>
                <h2 className="mt-2 font-display text-4xl font-black tracking-tight">
                  Gerenciar receitas
                </h2>
                <p className="mt-3 max-w-2xl text-sm text-muted">
                  Edite qualquer receita, inclusive as do catálogo inicial. As
                  alterações são salvas no servidor e aparecem para todos.
                </p>
              </div>
              <span className="self-start rounded-full bg-green-soft px-4 py-2 text-xs font-extrabold text-[#52642f]">
                Administrador conectado
              </span>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-3">
              <Summary
                value={snapshot.recipes.length}
                label="receitas no catálogo"
              />
              <Summary value={totalVotes} label="avaliações no total" />
              <Summary
                value={
                  snapshot.recipes.filter((recipe) => recipe.isFavorite).length
                }
                label="receitas favoritas"
              />
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <label className="flex flex-1 items-center gap-3 rounded-2xl border border-outline bg-surface px-4 py-3">
                <Icon name="search" size={18} />
                <input
                  aria-label="Buscar receitas na administração"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar receita, autor ou ingrediente..."
                  className="w-full bg-transparent text-sm outline-none"
                />
              </label>
              <label className="flex items-center gap-3 text-sm font-bold">
                Categoria
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="form-input sm:w-auto"
                >
                  {categories.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
            {error && !deleting && (
              <p
                role="alert"
                className="mt-5 rounded-2xl bg-pink-soft p-4 text-sm font-bold text-[#b92e53]"
              >
                {error}
              </p>
            )}
            <div className="mt-6 space-y-4">
              {recipes.map((recipe) => (
                <article
                  key={recipe.id}
                  className="flex flex-col gap-4 rounded-3xl border border-outline bg-surface p-4 sm:flex-row sm:items-center sm:p-5"
                >
                  <img
                    src={recipe.image}
                    alt={recipe.title}
                    loading="lazy"
                    className="h-36 w-full shrink-0 rounded-2xl object-cover sm:size-24"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-bold text-muted">
                      {recipe.category} · {recipe.author}
                    </span>
                    <h3 className="mt-1 break-words font-display text-xl font-black">
                      {recipe.title}
                    </h3>
                    <p className="mt-2 text-sm font-semibold text-muted">
                      ★ {recipe.rating.toLocaleString("pt-BR")} ·{" "}
                      {recipe.votes.toLocaleString("pt-BR")} avaliações
                    </p>
                    <p className="mt-1 text-xs font-semibold text-muted">
                      P {recipe.protein}g · C {recipe.carbs}g · G {recipe.fat}g
                      · {recipe.calories} kcal
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => {
                        setEditingId(recipe.id)
                        setError("")
                      }}
                      className="flex-1 rounded-full bg-[#342820] px-5 py-3 text-sm font-bold text-white"
                      aria-label={`Editar ${recipe.title}`}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => {
                        setDeletingId(recipe.id)
                        setError("")
                      }}
                      className="flex-1 rounded-full border border-outline px-5 py-3 text-sm font-bold text-[#d63f68]"
                      aria-label={`Excluir ${recipe.title}`}
                    >
                      Excluir
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!recipes.length && (
              <div className="mt-6 rounded-3xl bg-yellow-soft p-8 text-center">
                <strong className="font-display text-xl font-black">
                  Nenhuma receita encontrada.
                </strong>
                <p className="mt-2 text-sm text-muted">
                  Tente outra busca ou categoria.
                </p>
              </div>
            )}
          </>
        )}
      </div>
      {authenticated && editing && (
        <RecipeForm
          key={editing.id}
          adminMode
          recipe={editing}
          author={editing.author}
          onSave={save}
          onClose={() => setEditingId(null)}
        />
      )}
      {authenticated && deleting && (
        <Modal
          titleId="admin-delete-title"
          onClose={() => {
            if (!busy) setDeletingId(null)
          }}
        >
          <div className="p-6 sm:p-9">
            <h2
              id="admin-delete-title"
              className="font-display text-2xl font-black"
            >
              Excluir receita?
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              A receita <strong>{deleting.title}</strong>, seus favoritos e suas
              avaliações serão removidos do site. Essa ação não pode ser
              desfeita.
            </p>
            {error && (
              <p role="alert" className="mt-4 text-sm font-bold text-[#b92e53]">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.deleteRecipe(deleting.id)
                    setDeletingId(null)
                    setNotice("Receita excluída do catálogo.")
                  })
                }
                className="rounded-full bg-[#d63f68] px-6 py-3 text-sm font-bold text-white"
              >
                {busy ? "Excluindo…" : "Confirmar exclusão"}
              </button>
              <button
                disabled={busy}
                onClick={() => setDeletingId(null)}
                className="rounded-full border border-outline bg-surface px-6 py-3 text-sm font-bold"
              >
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
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

type SummaryProps = {
  value: number
  label: string
}

function Summary({ value, label }: SummaryProps) {
  return (
    <div className="rounded-3xl border border-outline bg-surface p-5">
      <strong className="font-display text-3xl font-black">
        {value.toLocaleString("pt-BR")}
      </strong>
      <span className="mt-1 block text-xs font-extrabold uppercase tracking-wide text-muted">
        {label}
      </span>
    </div>
  )
}
