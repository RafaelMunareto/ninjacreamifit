import { useRef, useState, type FormEvent } from "react"
import type { Profile, Recipe } from "../types"
import { errorMessage } from "../lib/local-api.js"
import Modal from "./Modal"
import Icon from "./Icon"

export default function ProfileModal({
  profile,
  recipes,
  onClose,
  onSave,
  onCollection,
}: {
  profile: Profile
  recipes: Recipe[]
  onClose: () => void
  onSave: (name: string) => Promise<void>
  onCollection: (collection: "favorites" | "mine") => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const locked = useRef(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (locked.current) return
    const data = new FormData(event.currentTarget)
    locked.current = true
    setSaving(true)
    setError("")
    setSaved(false)
    try {
      await onSave(String(data.get("name") || ""))
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      locked.current = false
      setSaving(false)
    }
  }
  return (
    <Modal
      titleId="profile-title"
      onClose={() => {
        if (!saving) onClose()
      }}
    >
      <div className="p-6 sm:p-9">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ef4f78]">
              seu cantinho cremoso
            </p>
            <h2
              id="profile-title"
              className="mt-2 font-display text-3xl font-black"
            >
              Meu perfil
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white"
            aria-label="Fechar perfil"
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-[#78665b]">
          Este perfil pertence a este navegador. Suas receitas, favoritos e
          avaliações ficam salvos aqui. Limpar os dados do site remove essas
          informações.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-extrabold">
              Seu nome nas receitas
            </span>
            <input
              name="name"
              required
              maxLength={60}
              defaultValue={profile.name}
              onChange={() => setSaved(false)}
              className="form-input"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-[#342820] px-6 py-3 text-sm font-extrabold text-white"
          >
            {saving ? "Salvando…" : "Salvar perfil"}
          </button>
          {error && (
            <p role="alert" className="text-sm font-bold text-[#b92e53]">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm font-bold text-[#52642f]">
              Perfil salvo!
            </p>
          )}
        </form>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button
            disabled={saving}
            onClick={() => onCollection("mine")}
            className="rounded-3xl bg-[#b8e46c] p-5 text-left"
          >
            <strong className="block font-display text-3xl font-black">
              {
                recipes.filter((recipe) => recipe.authorId === profile.id)
                  .length
              }
            </strong>
            <span className="mt-1 block text-sm font-extrabold">
              Minhas receitas →
            </span>
          </button>
          <button
            disabled={saving}
            onClick={() => onCollection("favorites")}
            className="rounded-3xl bg-[#ffadc4] p-5 text-left"
          >
            <strong className="block font-display text-3xl font-black">
              {recipes.filter((recipe) => recipe.isFavorite).length}
            </strong>
            <span className="mt-1 block text-sm font-extrabold">
              Meus favoritos →
            </span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
