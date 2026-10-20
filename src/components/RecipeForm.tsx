import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent,
} from "react"
import type {
  AdminDetails,
  Category,
  Program,
  Recipe,
  RecipeInput,
  FoodReference,
  Nutrition,
} from "../types"
import { categories, programs } from "../data/recipes.js"
import { errorMessage } from "../lib/api.js"
import { preparePhoto } from "../lib/photo.js"
import Icon from "./Icon"
import Modal from "./Modal"
import FoodCalculator from "./FoodCalculator"

export default function RecipeForm({
  recipe,
  author,
  onClose,
  onSave,
  adminMode = false,
  page = false,
}: {
  recipe?: Recipe
  author: string
  onClose: () => void
  onSave: (
    input: RecipeInput,
    id?: string,
    details?: AdminDetails,
  ) => Promise<void>
  adminMode?: boolean
  page?: boolean
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!page) return
    const previousTitle = document.title
    document.title = "Nova receita · Ninja CREAMi Fit"
    window.scrollTo({ top: 0 })
    titleRef.current?.focus({ preventScroll: true })
    return () => {
      document.title = previousTitle
    }
  }, [page])
  const [hasToppings, setHasToppings] = useState(Boolean(recipe?.toppings))
  const [photo, setPhoto] = useState(recipe?.image || "")
  const [photoError, setPhotoError] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [processingPhoto, setProcessingPhoto] = useState(false)
  const [savingFood, setSavingFood] = useState(false)
  const [foodItems, setFoodItems] = useState<FoodReference[]>(
    recipe?.foodItems || [],
  )
  const [automaticIngredients, setAutomaticIngredients] = useState(
    () => recipe?.ingredients.slice(0, recipe.foodItems?.length || 0) || [],
  )
  const [manualIngredients, setManualIngredients] = useState(
    () =>
      recipe?.ingredients.slice(recipe.foodItems?.length || 0).join("\n") || "",
  )
  const [showCalculator, setShowCalculator] = useState(true)
  const [macros, setMacros] = useState<Record<keyof Nutrition, string>>(() => ({
    protein: recipe ? String(recipe.protein) : "",
    carbs: recipe ? String(recipe.carbs) : "",
    fat: recipe ? String(recipe.fat) : "",
    calories: recipe ? String(recipe.calories) : "",
  }))
  const photoVersion = useRef(0)
  const savingRef = useRef(false)
  const initialRatings = useRef({
    rating: recipe?.rating ?? 0,
    votes: recipe?.votes ?? 0,
  })
  const busy = saving || processingPhoto || savingFood

  const updateFoods = (
    references: FoodReference[],
    descriptions: string[],
    totals: Nutrition | null,
  ) => {
    setFoodItems(references)
    setAutomaticIngredients(descriptions)
    setMacros({
      protein: totals ? String(totals.protein) : "",
      carbs: totals ? String(totals.carbs) : "",
      fat: totals ? String(totals.fat) : "",
      calories: totals ? String(totals.calories) : "",
    })
  }
  const detachFoods = () => {
    setManualIngredients(
      [...automaticIngredients, manualIngredients].filter(Boolean).join("\n"),
    )
    setAutomaticIngredients([])
    setFoodItems([])
    setShowCalculator(false)
  }

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const version = ++photoVersion.current
    setProcessingPhoto(true)
    setPhotoError("")
    try {
      const encoded = await preparePhoto(file)
      if (version === photoVersion.current) setPhoto(encoded)
    } catch (cause) {
      if (version === photoVersion.current) {
        setPhotoError(errorMessage(cause))
        event.target.value = ""
      }
    } finally {
      if (version === photoVersion.current) setProcessingPhoto(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || savingRef.current) return
    if (!photo || photoError) {
      setError("Adicione uma foto válida antes de salvar.")
      return
    }
    const form = new FormData(event.currentTarget)
    const string = (key: string) => String(form.get(key) || "")
    const requiredNumber = (key: string) => {
      const value = string(key).trim()
      return value === "" ? Number.NaN : Number(value)
    }
    const lines = (key: string) =>
      string(key)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    savingRef.current = true
    setSaving(true)
    setError("")
    try {
      await onSave(
        {
          title: string("recipe_name"),
          category: string("category") as Category,
          image: photo,
          program: string("program") as Program,
          respin: string("respin") === "sim",
          toppings: hasToppings ? string("toppings") : "",
          ingredients: [...automaticIngredients, ...lines("ingredients")],
          foodItems,
          instructions: lines("instructions"),
          protein: requiredNumber("protein_g"),
          carbs: requiredNumber("carbs_g"),
          fat: requiredNumber("fat_g"),
          calories: requiredNumber("calories"),
          ...(adminMode ? {} : { authorName: string("author_name") }),
        },
        recipe?.id,
        adminMode
          ? {
              author: string("author"),
              rating: Number(string("rating")),
              votes: Number(string("votes")),
              ratingsChanged:
                Number(string("rating")) !== initialRatings.current.rating ||
                Number(string("votes")) !== initialRatings.current.votes,
            }
          : undefined,
      )
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const Heading = page ? "h1" : "h2"
  const content = (
    <div
      className={
        page
          ? "mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8"
          : "p-6 sm:p-9"
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#ef4f78]">
            {adminMode ? "administração do catálogo" : "compartilhe seu sabor"}
          </p>
          <Heading
            ref={titleRef}
            tabIndex={page ? -1 : undefined}
            id="recipe-form-title"
            className="mt-2 font-display text-3xl font-black outline-none sm:text-4xl"
          >
            {recipe ? "Editar receita" : "Nova receita"}
          </Heading>
        </div>
        {!page && (
          <button
            onClick={onClose}
            disabled={busy}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-surface"
            aria-label="Fechar formulário"
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      <p className="mt-3 text-sm text-muted">
        {adminMode
          ? "Altere os dados da receita e salve para atualizar o catálogo para todos."
          : recipe
            ? "Atualize sua receita. As avaliações serão preservadas."
            : "Escolha seu nome e envie a receita. Depois, você poderá editar ou excluir em Minhas receitas."}
      </p>
      <form onSubmit={submit} className="mt-7 space-y-5" aria-busy={busy}>
        <fieldset disabled={busy} className="min-w-0 space-y-6 border-0 p-0">
          <section
            className={
              page
                ? "rounded-[28px] border border-outline bg-surface p-4 sm:p-7"
                : "space-y-5"
            }
          >
            {page && (
              <h2 className="mb-6 font-display text-xl font-black">
                Sobre a receita
              </h2>
            )}
            <div
              className={
                page
                  ? "grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]"
                  : "space-y-5"
              }
            >
              <div>
                <span className="mb-2 block text-sm font-extrabold">
                  Foto da receita
                </span>
                <label
                  className={`relative flex min-h-48 cursor-pointer items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed bg-surface focus-within:border-[#ef4f78] ${
                    photoError
                      ? "border-[#ef4f78]"
                      : "border-outline hover:border-[#ef4f78]"
                  }`}
                >
                  {photo ? (
                    <>
                      <img
                        src={photo}
                        alt="Pré-visualização da receita"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <span className="relative rounded-full bg-[#342820]/85 px-5 py-2.5 text-sm font-extrabold text-white">
                        {processingPhoto ? "Preparando foto…" : "Trocar foto"}
                      </span>
                    </>
                  ) : (
                    <span className="flex flex-col items-center px-6 py-8 text-center">
                      <span className="grid size-12 place-items-center rounded-full bg-pink-soft text-[#ef4f78]">
                        <Icon name="plus" size={24} />
                      </span>
                      <strong className="mt-3 text-sm">
                        {processingPhoto
                          ? "Preparando foto…"
                          : "Adicione uma foto do resultado"}
                      </strong>
                      <span className="mt-1 text-xs font-semibold text-muted">
                        JPG, PNG ou WEBP · máximo 10 MB
                      </span>
                    </span>
                  )}
                  <input
                    name="photo"
                    aria-label="Foto da receita"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    required={!photo}
                    onChange={handlePhoto}
                    className="sr-only"
                  />
                </label>
                {photoError && (
                  <p
                    role="alert"
                    className="mt-2 text-xs font-bold text-[#d63f68]"
                  >
                    {photoError}
                  </p>
                )}
              </div>
              <div className="min-w-0 space-y-5">
                {!adminMode && (
                  <div>
                    <Field
                      label="Seu nome"
                      name="author_name"
                      placeholder="Como você quer aparecer nas receitas?"
                      defaultValue={author === "Você" ? "" : author}
                      maxLength={60}
                    />
                    <p className="mt-2 text-xs text-muted">
                      Vamos lembrar seu nome neste navegador para as próximas
                      receitas.
                    </p>
                  </div>
                )}
                <Field
                  label="Nome da receita"
                  name="recipe_name"
                  placeholder="Ex: Bombom de coco proteico"
                  defaultValue={recipe?.title}
                  maxLength={100}
                />
                {adminMode && (
                  <Field
                    label="Autor da receita"
                    name="author"
                    placeholder="Nome do autor"
                    defaultValue={recipe?.author || author}
                    maxLength={60}
                  />
                )}
                <div className="grid gap-5 sm:grid-cols-2">
                  <SelectField
                    label="Categoria"
                    name="category"
                    defaultValue={recipe?.category}
                    options={categories
                      .slice(1)
                      .map((category) => [category, category])}
                  />
                  <SelectField
                    label="Programa da Ninja CREAMi"
                    name="program"
                    defaultValue={recipe?.program}
                    options={Object.entries(programs)}
                  />
                  <SelectField
                    label="Precisa de re-spin?"
                    name="respin"
                    defaultValue={recipe?.respin ? "sim" : "nao"}
                    options={[
                      ["nao", "Não"],
                      ["sim", "Sim"],
                    ]}
                  />
                  <label className="block">
                    <span className="mb-2 block text-sm font-extrabold">
                      Tem toppings?
                    </span>
                    <select
                      name="has_toppings"
                      value={hasToppings ? "sim" : "nao"}
                      onChange={(event) =>
                        setHasToppings(event.target.value === "sim")
                      }
                      className="form-input"
                    >
                      <option value="nao">Não</option>
                      <option value="sim">Sim</option>
                    </select>
                  </label>
                </div>
                {hasToppings && (
                  <Field
                    label="Quais toppings?"
                    name="toppings"
                    placeholder="Ex: morangos, granola e nibs de cacau"
                    defaultValue={recipe?.toppings}
                    maxLength={500}
                  />
                )}
              </div>
            </div>
          </section>
          <section
            className={
              page
                ? "min-w-0 space-y-5 rounded-[28px] border border-outline bg-surface p-4 sm:p-7"
                : "space-y-5"
            }
          >
            {page && (
              <h2 className="font-display text-xl font-black">
                Alimentos e ingredientes
              </h2>
            )}
            {showCalculator ? (
              <FoodCalculator
                embedded={page}
                onBusyChange={setSavingFood}
                initialItems={foodItems}
                initialLabels={automaticIngredients}
                onRestore={setAutomaticIngredients}
                onChange={updateFoods}
                onDetach={detachFoods}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowCalculator(true)}
                className="text-sm font-bold text-[#d63f68] underline"
              >
                Voltar à busca de alimentos por peso
              </button>
            )}
            <label className="block">
              <span className="mb-2 block text-sm font-extrabold">
                {foodItems.length
                  ? "Outros ingredientes e observações · opcional"
                  : "Ingredientes · um por linha"}
              </span>
              <textarea
                name="ingredients"
                required={!automaticIngredients.length}
                rows={4}
                maxLength={15000}
                value={manualIngredients}
                onChange={(event) => setManualIngredients(event.target.value)}
                placeholder={
                  "200 ml de leite desnatado\n30 g de whey de baunilha"
                }
                className="form-input resize-y"
              />
              {foodItems.length > 0 && (
                <span className="mt-2 block text-xs leading-relaxed text-muted">
                  Só os alimentos selecionados entram no cálculo automático. Se
                  adicionar outro ingrediente com calorias aqui, inclua-o também
                  na calculadora ou ajuste os totais abaixo.
                </span>
              )}
            </label>
          </section>
          <div
            className={
              page ? "grid items-start gap-6 lg:grid-cols-2" : "space-y-5"
            }
          >
            <section
              className={
                page
                  ? "rounded-[28px] border border-outline bg-surface p-4 sm:p-7"
                  : ""
              }
            >
              <label className="block">
                <span className="mb-2 block text-sm font-extrabold">
                  Modo de preparo · uma etapa por linha
                </span>
                <textarea
                  name="instructions"
                  required
                  rows={4}
                  maxLength={15000}
                  defaultValue={recipe?.instructions.join("\n")}
                  placeholder={
                    "Misture os ingredientes.\nCongele por 24 horas.\nProcesse no programa escolhido."
                  }
                  className="form-input resize-y"
                />
              </label>
            </section>
            <section
              className={
                page
                  ? "rounded-[28px] border border-outline bg-surface p-4 sm:p-7"
                  : ""
              }
            >
              <div>
                <p className="text-sm font-extrabold">
                  Macros e calorias por pote · obrigatório
                </p>
                <p className="mb-3 mt-1 text-xs text-muted">
                  {foodItems.length
                    ? "Totais dos alimentos selecionados. Você pode corrigir os valores, se necessário."
                    : "Preencha os quatro campos ou escolha alimentos acima para calcular. Informe 0 quando o nutriente não estiver presente."}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field
                    label="Proteína (g)"
                    name="protein_g"
                    type="number"
                    placeholder="0"
                    value={macros.protein}
                    onValueChange={(value) =>
                      setMacros((previous) => ({ ...previous, protein: value }))
                    }
                  />
                  <Field
                    label="Carbo (g)"
                    name="carbs_g"
                    type="number"
                    placeholder="0"
                    value={macros.carbs}
                    onValueChange={(value) =>
                      setMacros((previous) => ({ ...previous, carbs: value }))
                    }
                  />
                  <Field
                    label="Gordura (g)"
                    name="fat_g"
                    type="number"
                    placeholder="0"
                    value={macros.fat}
                    onValueChange={(value) =>
                      setMacros((previous) => ({ ...previous, fat: value }))
                    }
                  />
                  <Field
                    label="Calorias"
                    name="calories"
                    type="number"
                    placeholder="0"
                    value={macros.calories}
                    onValueChange={(value) =>
                      setMacros((previous) => ({
                        ...previous,
                        calories: value,
                      }))
                    }
                  />
                </div>
              </div>
            </section>
          </div>
          {adminMode && (
            <div className="rounded-3xl border border-outline bg-yellow-soft p-5">
              <h3 className="font-display text-xl font-black">
                Estrelas e avaliações
              </h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label="Média de estrelas (0 a 5)"
                  name="rating"
                  type="number"
                  placeholder="0"
                  defaultValue={recipe?.rating ?? 0}
                  min={0}
                  max={5}
                  step={0.1}
                />
                <Field
                  label="Total de avaliações"
                  name="votes"
                  type="number"
                  placeholder="0"
                  defaultValue={recipe?.votes ?? 0}
                  min={0}
                  max={10000000}
                  step={1}
                />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Use média 0 para nenhuma avaliação. Ao alterar estes totais, as
                avaliações anteriores serão incorporadas ao consolidado; uma
                nova avaliação contará à parte. Se os totais não mudarem, sua
                nota será preservada.
              </p>
            </div>
          )}
        </fieldset>
        {error && (
          <p
            role="alert"
            className="rounded-2xl bg-pink-soft p-4 text-sm font-bold text-[#b92e53]"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#ef4f78] px-7 py-4 font-extrabold text-white shadow-[0_6px_0_#c9355c] transition hover:-translate-y-0.5"
        >
          {saving
            ? "Salvando receita…"
            : processingPhoto
              ? "Preparando foto…"
              : recipe
                ? "Salvar alterações"
                : "Salvar minha receita"}
          <Icon name="arrow" />
        </button>
      </form>
    </div>
  )

  if (page) {
    return (
      <main className="min-h-svh bg-page text-foreground">
        <header className="sticky top-0 z-30 border-b border-outline bg-page/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 lg:px-8">
            <span className="font-display text-lg font-black tracking-tight sm:text-xl">
              Ninja CREAMi <span className="text-[#ef4f78]">Fit</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex items-center gap-2 rounded-full border border-outline bg-surface px-3 py-2.5 text-xs font-extrabold sm:px-4 sm:text-sm"
            >
              <span className="rotate-180">
                <Icon name="arrow" size={16} />
              </span>
              Voltar às receitas
            </button>
          </div>
        </header>
        {content}
      </main>
    )
  }

  return (
    <Modal
      titleId="recipe-form-title"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      {content}
    </Modal>
  )
}

function Field({
  label,
  name,
  placeholder,
  type = "text",
  defaultValue,
  value,
  onValueChange,
  min = 0,
  max = 10000,
  step = "any",
  maxLength,
}: {
  label: string
  name: string
  placeholder: string
  type?: string
  defaultValue?: string | number
  value?: string
  onValueChange?: (value: string) => void
  min?: number
  max?: number
  step?: string | number
  maxLength?: number
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-extrabold">{label}</span>
      <input
        name={name}
        type={type}
        required
        min={type === "number" ? min : undefined}
        max={type === "number" ? max : undefined}
        step={type === "number" ? step : undefined}
        maxLength={maxLength}
        defaultValue={value === undefined ? defaultValue : undefined}
        value={value}
        onChange={
          onValueChange
            ? (event) => onValueChange(event.target.value)
            : undefined
        }
        placeholder={placeholder}
        className="form-input"
      />
    </label>
  )
}

function SelectField({
  label,
  name,
  options,
  defaultValue = "",
}: {
  label: string
  name: string
  options: string[][]
  defaultValue?: string
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-extrabold">{label}</span>
      <select
        name={name}
        required
        defaultValue={defaultValue}
        className="form-input"
      >
        <option value="" disabled>
          Selecione uma opção
        </option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}
