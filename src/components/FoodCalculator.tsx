import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react"
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser"
import type { FoodReference, LocalFood, Nutrition } from "../types"
import {
  calculateNutrition,
  foodDescriptions,
  foodReferences,
  hasCompleteNutrition,
  loadFoodCatalog,
  searchFoodApi,
  restoreApiFoods,
  searchFoods,
  searchFoodsWithFallback,
} from "../lib/nutrition.js"
import Icon from "./Icon"

type FoodLine = {
  key: string
  food: LocalFood
  grams: string
  unit: "g" | "ml"
}
type AiSuggestion = {
  food: string
  brand: string
  quantity?: number
  unit?: "g" | "ml"
  matchedFood?: LocalFood
}
type Catalog = Awaited<ReturnType<typeof loadFoodCatalog>>
type VoiceQuantity = { quantity: number; unit: "g" | "ml" }
type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike
type Props = {
  initialItems: FoodReference[]
  initialLabels: string[]
  onRestore: (lines: string[]) => void
  onChange: (
    items: FoodReference[],
    lines: string[],
    totals: Nutrition | null,
  ) => void
  onDetach: () => void
}

const display = (value: number | null) =>
  value === null ? "não informado" : value.toLocaleString("pt-BR")

export default function FoodCalculator({
  initialItems,
  initialLabels,
  onRestore,
  onChange,
  onDetach,
}: Props) {
  const initial = useRef(initialItems).current
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [items, setItems] = useState<FoodLine[]>([])
  const source = "all"
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [limit, setLimit] = useState(20)
  const [results, setResults] =
    useState<Awaited<ReturnType<typeof searchFoodsWithFallback>>>({
      foods: [],
      total: 0,
      source: "TBCA",
      fallback: false,
    })
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [scanning, setScanning] = useState(false)
  const [identifyingPhoto, setIdentifyingPhoto] = useState(false)
  const [aiMessage, setAiMessage] = useState("")
  const [aiError, setAiError] = useState("")
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([])
  const [listening, setListening] = useState(false)
  const [voiceQuantity, setVoiceQuantity] = useState<VoiceQuantity | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const aiPhotoRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const scanStreamRef = useRef<MediaStream | null>(null)
  const scannerControlsRef = useRef<IScannerControls | null>(null)
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [error, setError] = useState("")
  const [restoreError, setRestoreError] = useState("")
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setError("")
    setRestoreError("")
    void loadFoodCatalog()
      .then(async (data) => {
        const missing = initial
          .filter((item) => !data.byId.has(item.foodId))
          .map((item) => item.foodId)
        const restoredFoods = await restoreApiFoods(missing, controller.signal)
        const available = new Map(data.byId)
        for (const food of restoredFoods) available.set(food.id, food)
        if (cancelled) return
        setCatalog(data)
        const restored: FoodLine[] = []
        for (const reference of initial) {
          const food = available.get(reference.foodId)
          if (!food || !hasCompleteNutrition(food)) {
            setRestoreError(
              "Um alimento salvo não está disponível para cálculo nesta base. Os ingredientes e macros da receita foram preservados.",
            )
            return
          }
          restored.push({
            key: crypto.randomUUID(),
            food,
            grams: String(reference.grams),
            unit: reference.unit === "ml" ? "ml" : "g",
          })
        }
        setItems(restored)
        if (restored.length) onRestore(foodDescriptions(restored))
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Não foi possível carregar a tabela de alimentos. Tente novamente ou preencha os dados manualmente.",
          )
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [initial, onRestore, retry])

  useEffect(() => {
    if (!catalog) return
    const controller = new AbortController()
    let active = true
    setSearchError("")
    setResults({ foods: [], total: 0, source: "TBCA", fallback: false })
    const valid = deferredQuery.trim().length >= 2
    setSearching(valid)
    const timer = window.setTimeout(
      () => {
        void searchFoodsWithFallback(
          catalog,
          deferredQuery,
          limit,
          source,
          (term, count) => searchFoodApi(term, count, controller.signal),
        )
          .then((data) => {
            if (!active) return
            setResults(data)
          })
          .catch(() => {
            if (active)
              setSearchError(
                "A busca complementar está indisponível. Tente outro nome ou preencha manualmente.",
              )
          })
          .finally(() => {
            if (active) setSearching(false)
          })
      },
      valid ? 300 : 0,
    )
    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [catalog, deferredQuery, limit, source])
  const publish = (updated: FoodLine[]) => {
    setItems(updated)
    onChange(
      foodReferences(updated),
      foodDescriptions(updated),
      updated.length ? calculateNutrition(updated) : null,
    )
  }
  const startVoiceInput = () => {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor
      webkitSpeechRecognition?: SpeechRecognitionConstructor
    }
    if (listening) {
      speechRecognitionRef.current?.stop()
      return
    }
    const Constructor =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Constructor) {
      setSearchError(
        "Seu navegador não oferece reconhecimento de voz. Use Chrome ou Safari atualizado.",
      )
      return
    }
    const recognition = new Constructor()
    recognition.lang = "pt-BR"
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const transcript = String(event.results[0]?.[0]?.transcript || "")
        .trim()
        .replace(/\s+/g, " ")
      if (!transcript) return
      const quantityMatch = transcript.match(
        /(\d+(?:[,.]\d+)?)\s*(kg|quilo(?:s)?|g|grama(?:s)?|ml|mililitro(?:s)?)/i,
      )
      let spokenFood = transcript
      if (quantityMatch) {
        let quantity = Number(quantityMatch[1].replace(",", "."))
        const rawUnit = quantityMatch[2].toLocaleLowerCase("pt-BR")
        const unit = /ml|mililitro/.test(rawUnit) ? "ml" : "g"
        if (unit === "g" && /kg|quilo/.test(rawUnit)) quantity *= 1000
        if (quantity > 0 && quantity <= 10000)
          setVoiceQuantity({ quantity, unit })
        spokenFood = transcript.replace(quantityMatch[0], "").trim()
      }
      setQuery(spokenFood || transcript)
      setLimit(20)
      setSearchError("")
      setAiMessage(
        `Voz reconhecida: ${transcript}${quantityMatch ? " · quantidade detectada" : ""}`,
      )
    }
    recognition.onerror = () => {
      setListening(false)
      setSearchError("Não consegui entender o áudio. Fale novamente em português.")
    }
    recognition.onend = () => {
      setListening(false)
      speechRecognitionRef.current = null
    }
    speechRecognitionRef.current = recognition
    setSearchError("")
    setAiMessage("Pode falar o alimento e a quantidade, por exemplo: banana 150 gramas.")
    setListening(true)
    recognition.start()
  }

  useEffect(() => () => speechRecognitionRef.current?.stop(), [])
  const add = (food: LocalFood, suggestion?: AiSuggestion) => {
    if (items.length >= 50 || !hasCompleteNutrition(food)) return
    const quantity = suggestion?.quantity ?? voiceQuantity?.quantity ?? 100
    const unit = suggestion?.unit ?? voiceQuantity?.unit ?? "g"
    publish([
      ...items,
      { key: crypto.randomUUID(), food, grams: String(quantity), unit },
    ])
    if (suggestion)
      setAiSuggestions((current) =>
        current.filter((item) => item.food !== suggestion.food),
      )
    setQuery("")
    setLimit(20)
    setVoiceQuantity(null)
  }

  const scanBarcode = async () => {
    const video = videoRef.current
    if (!video) return
    setSearchError("")
    setScanning(true)
    try {
      const hints = new Map<number, unknown>([
        [3, true],
        [
          2,
          [
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.ITF,
          ],
        ],
      ]) as never
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 100,
        delayBetweenScanSuccess: 500,
      })
      scannerControlsRef.current = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        video,
        (result, _error, controls) => {
          const value = result?.getText().trim()
          if (!value) return
          controls.stop()
          scannerControlsRef.current = null
          scanStreamRef.current?.getTracks().forEach((track) => track.stop())
          scanStreamRef.current = null
          setQuery(value)
          setScanning(false)
        },
      )
    } catch {
      scannerControlsRef.current = null
      setSearchError(
        "Não foi possível acessar a câmera. Confira a permissão ou digite o código manualmente.",
      )
      setScanning(false)
    }
  }
  const closeScanner = () => {
    scannerControlsRef.current?.stop()
    scannerControlsRef.current = null
    scanStreamRef.current?.getTracks().forEach((track) => track.stop())
    scanStreamRef.current = null
    setScanning(false)
  }
  const identifyFoodPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setSearchError("Escolha uma foto JPG, PNG ou WEBP.")
      return
    }
    if (file.size > 6 * 1024 * 1024) {
      setSearchError("A foto deve ter no máximo 6 MB.")
      return
    }
    setIdentifyingPhoto(true)
    setAiMessage("")
    setAiError("")
    setSearchError("")
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error("Falha ao ler a foto."))
        reader.readAsDataURL(file)
      })
      const response = await fetch("/api/food-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.detail
            ? `${result.error || "Não foi possível identificar o alimento."} (${result.detail})`
            : result.error || "Não foi possível identificar o alimento.",
        )
      const quantity = Number(result.quantity)
      const rawSuggestions = (
        Array.isArray(result.foods) ? result.foods : [result]
      ) as Array<{
        food?: unknown
        brand?: unknown
        quantity?: unknown
        unit?: unknown
      }>
      const suggestions = rawSuggestions
        .map((item) => {
          const itemQuantity = Number(item.quantity)
          return {
            food: typeof item.food === "string" ? item.food.trim() : "",
            brand: typeof item.brand === "string" ? item.brand.trim() : "",
            ...(Number.isFinite(itemQuantity) && itemQuantity > 0
              ? {
                  quantity: itemQuantity,
                  unit: (item.unit === "ml" ? "ml" : "g") as "g" | "ml",
                }
              : {}),
          }
        })
        .filter((item) => item.food.length >= 2)
        .slice(0, 3) satisfies AiSuggestion[]
      if (!suggestions.length)
        throw new Error("A IA não conseguiu reconhecer os alimentos na foto.")
      const suggestion = suggestions[0]
      setAiSuggestions(suggestions)
      if (catalog) {
        void Promise.all(
          suggestions.map(async (item) => {
            try {
              const localMatch = searchFoods(
                catalog,
                item.food,
                5,
                source,
              ).foods.find(hasCompleteNutrition)
              if (localMatch) return localMatch
              const found = await searchFoodsWithFallback(
                catalog,
                item.food,
                5,
                source,
                (term, count) => searchFoodApi(term, count),
              )
              return found.foods.find(hasCompleteNutrition)
            } catch {
              return undefined
            }
          }),
        ).then((matches) => {
          setAiSuggestions((current) =>
            current.map((item, index) => ({
              ...item,
              matchedFood: matches[index],
            })),
          )
        })
      }
      const details = [
        suggestion.brand && `marca ${suggestion.brand}`,
        suggestion.quantity && `${suggestion.quantity} ${suggestion.unit}`,
      ].filter(Boolean)
      setAiMessage(
        "Alimento identificado na sugestão abaixo: " +
          suggestion.food +
          (details.length ? ` · ${details.join(" · ")}` : ""),
      )
    } catch (cause) {
      setAiError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível analisar a foto agora.",
      )
      setSearchError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível identificar o alimento pela foto.",
      )
    } finally {
      setIdentifyingPhoto(false)
    }
  }

  const acceptAiSuggestion = (suggestion: AiSuggestion) => {
    if (!suggestion.quantity || !Number.isFinite(suggestion.quantity)) {
      setSearchError("Informe a quantidade antes de adicionar o alimento.")
      return
    }
    const food =
      suggestion.matchedFood || results.foods.find(hasCompleteNutrition)
    if (!food) {
      setSearchError(
        "A IA identificou o alimento, mas não encontrei dados nutricionais para ele. Escolha um resultado da busca para adicionar.",
      )
      return
    }
    add(food, suggestion)
    setAiMessage(`${suggestion.food} adicionado à receita.`)
  }

  const rejectAiSuggestion = () => {
    setAiSuggestions([])
    setAiMessage("Sugestão da IA recusada.")
  }

  return (
    <section
      aria-label="Calculadora de alimentos"
      className="rounded-3xl border border-[#eadfd5] bg-white p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl font-black">
          Alimentos e peso do pote
        </h3>
      </div>
      {!catalog && !error && (
        <p role="status" className="mt-4 text-sm text-[#78665b]">
          Carregando a tabela de alimentos…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-2xl bg-[#fff6d8] p-3 text-sm text-[#78665b]"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="mt-2 font-bold underline"
          >
            Tentar novamente
          </button>
        </div>
      )}
      {restoreError && (
        <div className="mt-4 rounded-2xl bg-[#fff6d8] p-4 text-sm text-[#78665b]">
          <p>{restoreError}</p>
          <ul className="mt-2 space-y-1">
            {initialLabels.map((label, index) => (
              <li key={index}>{label}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onDetach}
            className="mt-3 font-bold underline"
          >
            Editar estes ingredientes manualmente
          </button>
        </div>
      )}
      {catalog && !restoreError && (
        <>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-extrabold">
              Buscar alimento
            </span>
            <div className="flex items-center gap-3 rounded-2xl border border-[#e5d8cc] bg-[#fffaf3] px-4">
              <Icon name="search" size={18} />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setLimit(20)
                }}
                maxLength={100}
                placeholder="Ex: banana, leite desnatado, cacau…"
                className="min-w-0 flex-1 bg-transparent py-3.5 text-sm outline-none"
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault()
                }}
              />
            </div>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startVoiceInput}
              aria-pressed={listening}
              className={`rounded-full px-4 py-2.5 text-xs font-bold text-white transition ${
                listening
                  ? "animate-pulse bg-[#b92e53]"
                  : "bg-[#52642f] hover:bg-[#435326]"
              }`}
            >
              {listening ? "Ouvindo… toque para parar" : "🎙️ Falar alimento"}
            </button>
            <button
              type="button"
              onClick={() => void scanBarcode()}
              className="rounded-full bg-[#ef4f78] px-4 py-2.5 text-xs font-bold text-white"
            >
              {scanning ? "Lendo código…" : "Cod de barras"}
            </button>
            <button
              type="button"
              onClick={() => aiPhotoRef.current?.click()}
              disabled={identifyingPhoto}
              aria-busy={identifyingPhoto}
              className="rounded-full border border-[#9b7de1] bg-[#b79af6] px-4 py-2.5 text-xs font-extrabold text-[#342820] transition hover:bg-[#a688eb] disabled:cursor-wait disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                {identifyingPhoto && (
                  <span
                    className="size-3.5 animate-spin rounded-full border-2 border-[#342820]/30 border-t-[#342820]"
                    aria-hidden="true"
                  />
                )}
                {identifyingPhoto ? "Analisando foto…" : "Foto (IA)"}
              </span>
            </button>
            <input
              ref={aiPhotoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={identifyFoodPhoto}
              className="sr-only"
              aria-label="Tirar foto do alimento para identificar com IA"
            />
          </div>
          <div
            className={`relative mt-3 overflow-hidden rounded-2xl bg-black ${
              scanning ? "" : "hidden"
            }`}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-video w-full object-cover"
              aria-label="Câmera para leitura do código de barras"
            />
            <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-20 -translate-y-1/2 rounded-xl border-2 border-[#b8e46c] shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
            <button
              type="button"
              onClick={closeScanner}
              className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-2 text-xs font-bold text-white"
            >
              Fechar câmera
            </button>
          </div>
          {identifyingPhoto && (
            <div
              role="status"
              aria-live="polite"
              className="mt-3 overflow-hidden rounded-2xl border border-[#d9cdf8] bg-[#faf7ff]"
            >
              <div className="h-1 w-full animate-pulse bg-[#b79af6]" />
              <div className="flex items-center gap-3 p-4">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e9e0ff] text-[#6950a8]"
                  aria-hidden="true"
                >
                  <span className="size-4 animate-spin rounded-full border-2 border-[#6950a8]/30 border-t-[#6950a8]" />
                </span>
                <span>
                  <strong className="block text-sm text-[#342820]">
                    Analisando sua foto
                  </strong>
                  <span className="mt-0.5 block text-xs text-[#78665b]">
                    Procurando alimento, marca e quantidade…
                  </span>
                </span>
              </div>
            </div>
          )}
          {query.trim().length >= 2 && (
            <p role="status" className="mt-3 text-xs text-[#8a776b]">
              {searching
                ? "Buscando alimento…"
                : searchError
                  ? searchError
                  : results.total
                    ? `${results.total.toLocaleString("pt-BR")} alimentos encontrados`
                    : "Nenhum alimento encontrado. Tente outro nome ou use o preenchimento manual abaixo."}
            </p>
          )}
          {aiMessage && (
            <p role="status" className="mt-2 text-xs font-bold text-[#52642f]">
              {aiMessage}
            </p>
          )}
          {aiError && (
            <div
              role="alert"
              className="mt-3 rounded-2xl border border-[#f2b8c8] bg-[#fff2f5] p-3 text-sm text-[#9b2448]"
            >
              <strong className="block">A identificação por IA falhou</strong>
              <span className="mt-1 block">{aiError}</span>
              <span className="mt-1 block text-xs">
                Tente outra foto com boa luz e a embalagem inteira visível.
              </span>
            </div>
          )}
          <div className="flex flex-col">
            {!!results.foods.length && (
              <ul
                aria-label="Resultados de alimentos"
                className="order-2 mt-3 max-h-80 space-y-2 overflow-y-auto overscroll-contain"
              >
                {results.foods.map((food) => {
                  const complete = hasCompleteNutrition(food)
                  return (
                    <li key={food.id}>
                      <button
                        type="button"
                        disabled={!complete || items.length >= 50}
                        onClick={() => add(food)}
                        aria-label={`Adicionar ${food.name} · ${food.source || "TBCA"}`}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#eadfd5] p-3 text-left transition hover:border-[#ef4f78] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <strong className="block break-words text-sm">
                            {food.name}
                          </strong>
                          <span className="mt-1 block text-xs text-[#78665b]">
                            {complete
                              ? `Por 100 g: ${display(food.calories)} kcal · P ${display(food.protein)} g · C ${display(food.carbs)} g · G ${display(food.fat)} g`
                              : "Dados incompletos na base · preencha manualmente"}
                          </span>
                        </span>
                        {complete && (
                          <span className="shrink-0 text-[#ef4f78]">
                            <Icon name="plus" />
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {!!aiSuggestions.length && (
              <div className="order-1 mt-4 rounded-2xl border border-[#cfc0f5] bg-[#faf7ff] p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#6950a8]">
                  Sugestões da IA — confirme antes de adicionar
                </p>
                <div className="mt-3 space-y-3">
                  {aiSuggestions.map((aiSuggestion) => (
                    <div
                      key={aiSuggestion.food}
                      className="rounded-xl bg-white p-3"
                    >
                      <p className="text-sm font-black">{aiSuggestion.food}</p>
                      <p className="mt-1 text-xs text-[#78665b]">
                        {aiSuggestion.brand
                          ? `Marca: ${aiSuggestion.brand}`
                          : "Marca não identificada"}
                      </p>
                      <div className="mt-3 grid max-w-xs grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <label>
                          <span className="mb-1 block text-xs font-bold">
                            Quantidade
                          </span>
                          <input
                            type="number"
                            min={0.01}
                            max={10000}
                            step="any"
                            value={aiSuggestion.quantity ?? ""}
                            onChange={(event) =>
                              setAiSuggestions((current) =>
                                current.map((item) =>
                                  item.food === aiSuggestion.food
                                    ? {
                                        ...item,
                                        quantity: event.target.value
                                          ? Number(event.target.value)
                                          : undefined,
                                      }
                                    : item,
                                ),
                              )
                            }
                            className="form-input bg-white"
                          />
                        </label>
                        <label>
                          <span className="mb-1 block text-xs font-bold">
                            Unidade
                          </span>
                          <select
                            value={aiSuggestion.unit ?? "g"}
                            onChange={(event) =>
                              setAiSuggestions((current) =>
                                current.map((item) =>
                                  item.food === aiSuggestion.food
                                    ? {
                                        ...item,
                                        unit:
                                          event.target.value === "ml"
                                            ? "ml"
                                            : "g",
                                      }
                                    : item,
                                ),
                              )
                            }
                            className="form-input bg-white"
                          >
                            <option value="g">g</option>
                            <option value="ml">ml</option>
                          </select>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => acceptAiSuggestion(aiSuggestion)}
                        disabled={
                          items.length >= 50 ||
                          !aiSuggestion.matchedFood ||
                          !aiSuggestion.quantity
                        }
                        className="mt-3 rounded-lg bg-[#6950a8] px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {!aiSuggestion.quantity
                          ? "Informe a quantidade"
                          : aiSuggestion.matchedFood
                            ? "Aceitar e adicionar"
                            : "Buscando dados…"}
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={rejectAiSuggestion}
                  className="mt-3 rounded-lg border border-[#cfc0f5] px-3 py-2 text-xs font-bold text-[#6950a8]"
                >
                  Recusar todas
                </button>
              </div>
            )}
          </div>
          {results.total > limit && (
            <button
              type="button"
              onClick={() => setLimit((value) => value + 20)}
              className="mt-3 rounded-full border border-[#eadfd5] px-4 py-2 text-xs font-bold"
            >
              Mostrar mais alimentos
            </button>
          )}
          {!!items.length && (
            <ul aria-label="Alimentos do pote" className="mt-5 space-y-3">
              {items.map((item, index) => {
                const nutrition = calculateNutrition([item])
                return (
                  <li key={item.key} className="rounded-2xl bg-[#fffaf3] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block break-words text-sm">
                          {item.food.name}
                        </strong>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          publish(
                            items.filter((_, position) => position !== index),
                          )
                        }
                        aria-label={`Remover ${item.food.name}`}
                        className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-[#b92e53]"
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-bold">
                          Quantidade ({item.unit})
                        </span>
                        <input
                          type="number"
                          aria-label={`Quantidade (${item.unit}) · ${item.food.name}`}
                          name={`food_grams_${index}`}
                          required
                          min={0.01}
                          max={10000}
                          step="any"
                          value={item.grams}
                          onChange={(event) =>
                            publish(
                              items.map((row, position) =>
                                position === index
                                  ? { ...row, grams: event.target.value }
                                  : row,
                              ),
                            )
                          }
                          className="form-input bg-white"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-bold">
                          Unidade
                        </span>
                        <select
                          aria-label={`Unidade da quantidade · ${item.food.name}`}
                          value={item.unit}
                          onChange={(event) =>
                            publish(
                              items.map((row, position) =>
                                position === index
                                  ? {
                                      ...row,
                                      unit:
                                        event.target.value === "ml"
                                          ? "ml"
                                          : "g",
                                    }
                                  : row,
                              ),
                            )
                          }
                          className="form-input bg-white"
                        >
                          <option value="g">g</option>
                          <option value="ml">ml</option>
                        </select>
                      </label>
                    </div>
                    {nutrition && (
                      <p className="mt-2 text-xs leading-relaxed text-[#78665b]">
                        {display(nutrition.calories)} kcal · P{" "}
                        {display(nutrition.protein)} g · C{" "}
                        {display(nutrition.carbs)} g · G{" "}
                        {display(nutrition.fat)} g
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {items.length >= 50 && (
            <p role="status" className="mt-3 text-xs text-[#78665b]">
              Limite de 50 alimentos por receita.
            </p>
          )}
        </>
      )}
    </section>
  )
}
