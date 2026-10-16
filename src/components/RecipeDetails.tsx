import { useRef, useState } from "react"
import type { Recipe } from "../types"
import { programs } from "../data/recipes.js"
import { errorMessage } from "../lib/local-api.js"
import Icon from "./Icon"
import Macro from "./Macro"
import Modal from "./Modal"

export default function RecipeDetails({
  recipe,
  isOwner,
  onClose,
  onRate,
  onFavorite,
  onEdit,
  onDelete,
}: {
  recipe: Recipe
  isOwner: boolean
  onClose: () => void
  onRate: (value: number) => Promise<void>
  onFavorite: () => Promise<void>
  onEdit: () => void
  onDelete: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const locked = useRef(false)
  const run = async (action: () => Promise<void>, success = "") => {
    if (locked.current) return
    locked.current = true
    setPending(true)
    setError("")
    setMessage("")
    try {
      await action()
      setMessage(success)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      locked.current = false
      setPending(false)
    }
  }

  return (
    <Modal
      wide
      titleId="recipe-title"
      onClose={() => {
        if (!pending) onClose()
      }}
    >
      <div className="relative h-64 sm:h-72">
        <img
          src={recipe.image}
          alt={recipe.title}
          className="h-full w-full rounded-t-[32px] object-cover"
        />
        <button
          onClick={onClose}
          disabled={pending}
          className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-white shadow-lg"
          aria-label="Fechar receita"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="p-6 sm:p-9">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <span
              className={`${recipe.color} inline-block rounded-full px-3 py-1 text-xs font-extrabold`}
            >
              {recipe.category}
            </span>
            <h2
              id="recipe-title"
              className="mt-3 font-display text-3xl font-black tracking-tight sm:text-4xl"
            >
              {recipe.title}
            </h2>
            <p className="mt-2 text-sm font-semibold text-[#8a776b]">
              Receita de {recipe.author}
            </p>
          </div>
          <div className="shrink-0 space-y-2">
            <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold">
              <Icon name="clock" size={18} /> Preparo: {recipe.prepMinutes} min
            </div>
            <div className="flex items-center gap-2 rounded-full bg-[#342820] px-4 py-2 text-sm font-bold text-white">
              <Icon name="bowl" size={18} /> {programs[recipe.program]}
              {recipe.respin ? " + Re-spin" : ""}
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-bold">
            <span className="text-[#f6ae2d]">
              <Icon name="star" size={18} filled />
            </span>
            {recipe.votes
              ? `${recipe.rating.toLocaleString("pt-BR")} · ${recipe.votes} avaliações`
              : "Seja a primeira pessoa a avaliar"}
          </span>
          <button
            onClick={() => void run(onFavorite)}
            disabled={pending}
            aria-pressed={recipe.isFavorite}
            className={`flex items-center gap-2 rounded-full border border-[#e7d9ce] px-4 py-2 text-sm font-bold ${
              recipe.isFavorite ? "bg-[#fff0f4] text-[#d63f68]" : "bg-white"
            }`}
          >
            <Icon name="heart" size={18} filled={recipe.isFavorite} />
            {recipe.isFavorite ? "Salva nos favoritos" : "Salvar nos favoritos"}
          </button>
        </div>
        <div className="mt-7 grid grid-cols-4 gap-2">
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
        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <div>
            <h3 className="font-display text-xl font-black">Ingredientes</h3>
            <ul className="mt-4 space-y-3">
              {recipe.ingredients.map((item, index) => (
                <li
                  key={index}
                  className="flex gap-3 text-sm font-semibold text-[#66564d]"
                >
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#b8e46c]">
                    <Icon name="check" size={12} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            {recipe.toppings && (
              <div className="mt-5 rounded-2xl bg-[#fff6d8] p-4 text-sm text-[#66564d]">
                <strong>Toppings</strong>
                <p className="mt-1 whitespace-pre-wrap">{recipe.toppings}</p>
              </div>
            )}
          </div>
          <div>
            <h3 className="font-display text-xl font-black">Como fazer</h3>
            <ol className="mt-4 space-y-3 text-sm font-semibold leading-relaxed text-[#66564d]">
              {recipe.instructions.map((step, index) => (
                <li key={index} className="flex gap-2">
                  <b>{index + 1}.</b>
                  <span className="whitespace-pre-wrap">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="mt-8 flex flex-col justify-between gap-4 rounded-3xl bg-white p-5 sm:flex-row sm:items-center">
          <div>
            <strong className="block">Já provou? Avalie o sabor</strong>
            <span className="text-xs font-semibold text-[#8a776b]">
              {recipe.ownRating
                ? `Sua nota: ${recipe.ownRating}/5. Você pode alterar quando quiser.`
                : "Sua opinião fica salva neste navegador."}
            </span>
          </div>
          <div className="flex gap-1" role="group" aria-label="Avaliar receita">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                disabled={pending}
                onClick={() => void run(() => onRate(n), "Avaliação salva!")}
                aria-pressed={recipe.ownRating === n}
                className={`grid size-10 place-items-center rounded-full ${
                  n <= recipe.ownRating ? "text-[#f6ae2d]" : "text-[#ddd2c8]"
                }`}
                aria-label={`Dar nota ${n}`}
              >
                <Icon name="star" size={27} filled />
              </button>
            ))}
          </div>
        </div>
        {message && (
          <p role="status" className="mt-3 text-sm font-bold text-[#52642f]">
            {message}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-2xl bg-[#fff0f4] p-4 text-sm font-bold text-[#b92e53]"
          >
            {error}
          </p>
        )}
        {isOwner && (
          <div className="mt-6 border-t border-[#e7d9ce] pt-5">
            {confirmDelete ? (
              <div className="rounded-2xl bg-[#fff0f4] p-4">
                <p className="text-sm font-bold">
                  Excluir esta receita e suas avaliações deste navegador?
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    disabled={pending}
                    onClick={() => void run(onDelete)}
                    className="rounded-full bg-[#d63f68] px-5 py-2 text-sm font-bold text-white"
                  >
                    {pending ? "Excluindo…" : "Sim, excluir receita"}
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-full bg-white px-5 py-2 text-sm font-bold"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={onEdit}
                  disabled={pending}
                  className="rounded-full bg-[#342820] px-5 py-2.5 text-sm font-bold text-white"
                >
                  Editar receita
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={pending}
                  className="rounded-full border border-[#e7d9ce] px-5 py-2.5 text-sm font-bold text-[#d63f68]"
                >
                  Excluir receita
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
