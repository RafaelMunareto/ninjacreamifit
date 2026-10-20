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
  searchFoodPage,
  invalidateFoodCatalog,
} from "../lib/nutrition.js"
import { requestApi } from "../lib/http.js"
import { saveSharedFood, errorMessage } from "../lib/api.js"
import { createSpeechInput } from "../lib/speech-input.js"
import { parseSpokenFood } from "../lib/voice-food.js"
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
  lookupComplete?: boolean
}
type Catalog = Awaited<ReturnType<typeof loadFoodCatalog>>
type Props = {
  embedded?: boolean
  onBusyChange?: (busy: boolean) => void
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
  embedded = false,
  onBusyChange,
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
  const [voicePhase, setVoicePhase] =
    useState<"idle" | "starting" | "listening" | "stopping">("idle")
  const [voiceTranscript, setVoiceTranscript] = useState("")
  const [processingVoice, setProcessingVoice] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualFood, setManualFood] = useState({
    name: "",
    barcode: "",
    quantity: "100",
    unit: "g" as "g" | "ml",
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
  })
  const [savingFood, setSavingFood] = useState(false)
  const [foodNotice, setFoodNotice] = useState("")
  const foodSaveLock = useRef(false)
  const manualFoodId = useRef(`CUSTOM:${crypto.randomUUID()}`)
  const moreRequest = useRef<AbortController | null>(null)
  const queryVersion = useRef(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const aiPhotoRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const scanStreamRef = useRef<MediaStream | null>(null)
  const scannerControlsRef = useRef<IScannerControls | null>(null)
  const speechRecognitionRef =
    useRef<ReturnType<typeof createSpeechInput> | null>(null)
  const voiceLookupRef = useRef<AbortController | null>(null)
  const voiceGenerationRef = useRef(0)
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
          .filter((item) => !item.food && !data.byId.has(item.foodId))
          .map((item) => item.foodId)
        const restoredFoods = await restoreApiFoods(missing, controller.signal)
        const available = new Map(data.byId)
        for (const food of restoredFoods) available.set(food.id, food)
        if (cancelled) return
        setCatalog(data)
        const restored: FoodLine[] = []
        for (const reference of initial) {
          const food = reference.food || available.get(reference.foodId)
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
    moreRequest.current?.abort()
    ++queryVersion.current
    setLimit(20)
    let active = true
    setSearchError("")
    setResults({ foods: [], total: 0, source: "TBCA", fallback: false })
    const valid = deferredQuery.trim().length >= 2
    setSearching(valid)
    const timer = window.setTimeout(
      () => {
        void searchFoodPage(catalog, deferredQuery, "0,0", controller.signal)
          .then((data) => {
            if (!active) return
            setResults(data)
            if (/^\d{8,14}$/.test(deferredQuery.trim()) && !data.foods.length) {
              setManualFood((current) => ({
                ...current,
                barcode: deferredQuery.trim(),
              }))
              setManualOpen(true)
            }
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
      moreRequest.current?.abort()
    }
  }, [catalog, deferredQuery])

  const loadMore = async (expand = true) => {
    if (!catalog || searching || moreRequest.current) return
    if (expand) setLimit((value) => value + 20)
    if (!results.nextCursor) return
    const version = queryVersion.current
    const controller = new AbortController()
    moreRequest.current = controller
    setSearching(true)
    setSearchError("")
    try {
      const data = await searchFoodPage(
        catalog,
        deferredQuery,
        results.nextCursor,
        controller.signal,
        results.foods,
      )
      if (version === queryVersion.current) setResults(data)
    } catch (cause) {
      if (
        version === queryVersion.current &&
        !(cause instanceof Error && cause.name === "AbortError")
      )
        setSearchError(errorMessage(cause))
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null
      if (version === queryVersion.current) setSearching(false)
    }
  }
  const publish = (updated: FoodLine[]) => {
    setItems(updated)
    onChange(
      foodReferences(updated),
      foodDescriptions(updated),
      updated.length ? calculateNutrition(updated) : null,
    )
  }
  const addManualFood = async () => {
    if (foodSaveLock.current) return
    const values = [
      manualFood.quantity,
      manualFood.calories,
      manualFood.protein,
      manualFood.carbs,
      manualFood.fat,
    ].map((value) => Number(value.replace(",", ".")))
    if (
      manualFood.name.trim().length < 2 ||
      [
        manualFood.quantity,
        manualFood.calories,
        manualFood.protein,
        manualFood.carbs,
        manualFood.fat,
      ].some((value) => !value.trim()) ||
      values.some((value) => !Number.isFinite(value) || value < 0) ||
      values[0] <= 0 ||
      values[0] > 10000
    ) {
      setSearchError("Informe nome, quantidade e todos os macros do alimento.")
      return
    }
    const food: LocalFood = {
      id: manualFoodId.current,
      name: manualFood.name.trim(),
      category: "Alimento informado pelo usuário",
      source: "Manual",
      calories: values[1],
      protein: values[2],
      carbs: values[3],
      fat: values[4],
      barcode: manualFood.barcode.trim(),
      basisUnit: manualFood.unit,
    }
    foodSaveLock.current = true
    setSavingFood(true)
    onBusyChange?.(true)
    setSearchError("")
    try {
      const savedFood = await saveSharedFood(food)
      add(savedFood, {
        food: food.name,
        brand: "",
        quantity: values[0],
        unit: manualFood.unit,
        matchedFood: food,
      })
      manualFoodId.current = `CUSTOM:${crypto.randomUUID()}`
      setManualFood({
        name: "",
        barcode: "",
        quantity: "100",
        unit: "g",
        calories: "",
        protein: "",
        carbs: "",
        fat: "",
      })
      setManualOpen(false)
      setFoodNotice(
        savedFood.barcode
          ? "Alimento salvo na base com o código de barras."
          : "Alimento salvo na base e disponível nas próximas buscas.",
      )
      invalidateFoodCatalog()
      void loadFoodCatalog()
        .then(setCatalog)
        .catch(() => {})
    } catch (cause) {
      setSearchError(errorMessage(cause))
    } finally {
      foodSaveLock.current = false
      setSavingFood(false)
      onBusyChange?.(false)
    }
  }
  const suggestVoiceFood = async (transcript: string, generation: number) => {
    let suggestion: AiSuggestion
    try {
      suggestion = { ...parseSpokenFood(transcript), brand: "" }
    } catch (cause) {
      setSearchError(
        cause instanceof Error
          ? cause.message
          : "Não consegui identificar o alimento.",
      )
      setProcessingVoice(false)
      return
    }
    setProcessingVoice(true)
    setAiSuggestions([suggestion])
    setAiMessage(
      `Sugestão por voz: ${suggestion.food}${
        suggestion.quantity
          ? ` · ${suggestion.quantity} ${suggestion.unit}`
          : ""
      }`,
    )
    const controller = new AbortController()
    voiceLookupRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    try {
      const localMatch =
        catalog &&
        searchFoods(catalog, suggestion.food, 5, source).foods.find(
          hasCompleteNutrition,
        )
      const match =
        localMatch ||
        (await searchFoodApi(suggestion.food, 5, controller.signal)).foods.find(
          hasCompleteNutrition,
        )
      if (generation !== voiceGenerationRef.current) return
      setAiSuggestions((current) =>
        current.map((item) =>
          item.food === suggestion.food
            ? { ...item, matchedFood: match, lookupComplete: true }
            : item,
        ),
      )
      if (!match)
        setSearchError(
          "Entendi sua fala, mas não encontrei os nutrientes. Ajuste o nome na busca ou inclua o alimento manualmente.",
        )
    } catch {
      if (generation !== voiceGenerationRef.current) return
      setAiSuggestions((current) =>
        current.map((item) =>
          item.food === suggestion.food
            ? { ...item, lookupComplete: true }
            : item,
        ),
      )
      setSearchError(
        "Entendi sua fala, mas a busca demorou ou ficou indisponível. Tente buscar o alimento pelo nome.",
      )
    } finally {
      window.clearTimeout(timeout)
      if (generation === voiceGenerationRef.current) {
        voiceLookupRef.current = null
        setProcessingVoice(false)
      }
    }
  }
  const startVoiceInput = () => {
    if (voicePhase === "listening") {
      speechRecognitionRef.current?.stop()
      return
    }
    if (voicePhase !== "idle" || processingVoice || identifyingPhoto) return
    speechRecognitionRef.current?.cancel()
    voiceLookupRef.current?.abort()
    const generation = ++voiceGenerationRef.current
    setSearchError("")
    setAiError("")
    setAiSuggestions([])
    setVoiceTranscript("")
    setAiMessage("")
    if (scanning) closeScanner()
    const speech = createSpeechInput({
      onState: setVoicePhase,
      onPreview: setVoiceTranscript,
      onTranscript: (transcript) =>
        void suggestVoiceFood(transcript, generation),
      onError: (message) => {
        setProcessingVoice(false)
        setSearchError(message)
      },
    })
    speechRecognitionRef.current = speech
    speech.start()
  }

  useEffect(() => {
    const interrupt = () => {
      speechRecognitionRef.current?.cancel({
        notify: true,
        message:
          "A gravação foi interrompida. Toque em Falar alimento para tentar novamente.",
      })
      if (voiceLookupRef.current) {
        ++voiceGenerationRef.current
        voiceLookupRef.current.abort()
        voiceLookupRef.current = null
        setProcessingVoice(false)
        setAiSuggestions([])
        setSearchError(
          "A busca por voz foi interrompida. Toque em Falar alimento para tentar novamente.",
        )
      }
    }
    const visibility = () => {
      if (document.visibilityState === "hidden") interrupt()
    }
    document.addEventListener("visibilitychange", visibility)
    window.addEventListener("pagehide", interrupt)
    return () => {
      document.removeEventListener("visibilitychange", visibility)
      window.removeEventListener("pagehide", interrupt)
      ++voiceGenerationRef.current
      speechRecognitionRef.current?.cancel()
      voiceLookupRef.current?.abort()
    }
  }, [])
  const listening = voicePhase === "listening"
  const voiceBusy = voicePhase !== "idle" || processingVoice
  const voiceWaiting =
    voicePhase === "starting" || voicePhase === "stopping" || processingVoice
  const add = (food: LocalFood, suggestion?: AiSuggestion) => {
    if (items.length >= 50 || !hasCompleteNutrition(food)) return
    const quantity = suggestion?.quantity ?? 100
    const unit = suggestion?.unit ?? food.basisUnit ?? "g"
    publish([
      { key: crypto.randomUUID(), food, grams: String(quantity), unit },
      ...items,
    ])
    if (suggestion)
      setAiSuggestions((current) =>
        current.filter((item) => item.food !== suggestion.food),
      )
    setQuery("")
    setLimit(20)
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
    const generation = ++voiceGenerationRef.current
    setIdentifyingPhoto(true)
    setAiSuggestions([])
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
      const result = await requestApi("food-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      })
      if (generation !== voiceGenerationRef.current) return
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
          if (generation !== voiceGenerationRef.current) return
          setAiSuggestions((current) =>
            current.map((item, index) => ({
              ...item,
              matchedFood: matches[index],
              lookupComplete: true,
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
    ++voiceGenerationRef.current
    voiceLookupRef.current?.abort()
    voiceLookupRef.current = null
    setProcessingVoice(false)
    setAiSuggestions([])
    setAiMessage("Sugestões descartadas.")
  }

  return (
    <section
      aria-label="Calculadora de alimentos"
      className={
        embedded
          ? "min-w-0"
          : "rounded-3xl border border-outline bg-surface p-4 sm:p-5"
      }
    >
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-xl font-black">
            Alimentos e peso do pote
          </h3>
        </div>
      )}
      {!catalog && !error && (
        <p role="status" className="mt-4 text-sm text-muted">
          Carregando a tabela de alimentos…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-2xl bg-yellow-soft p-3 text-sm text-muted"
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
        <div className="mt-4 rounded-2xl bg-yellow-soft p-4 text-sm text-muted">
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
            <div className="flex items-center gap-3 rounded-2xl border border-outline bg-page px-4">
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
              disabled={voiceWaiting || identifyingPhoto}
              aria-pressed={listening}
              aria-busy={voiceWaiting}
              className={`rounded-full px-4 py-2.5 text-xs font-bold text-white transition disabled:cursor-wait disabled:opacity-70 ${
                voiceWaiting
                  ? "animate-pulse bg-[#6950a8]"
                  : listening
                    ? "animate-pulse bg-[#b92e53]"
                    : "bg-[#52642f] hover:bg-[#435326]"
              }`}
            >
              {voicePhase === "starting"
                ? "Ativando microfone…"
                : voicePhase === "stopping"
                  ? "Concluindo gravação…"
                  : processingVoice
                    ? "Buscando alimento…"
                    : listening
                      ? "Parar e analisar"
                      : "🎙️ Falar alimento"}
            </button>
            <button
              type="button"
              onClick={() => void scanBarcode()}
              disabled={voiceBusy}
              className="rounded-full bg-[#ef4f78] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"
            >
              {scanning ? "Lendo código…" : "Cod de barras"}
            </button>
            <button
              type="button"
              onClick={() => aiPhotoRef.current?.click()}
              disabled={identifyingPhoto || voiceBusy}
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
          {voiceTranscript && (
            <p
              aria-label="Transcrição da fala"
              aria-live="polite"
              className="mt-3 text-sm text-muted"
            >
              Você disse: “{voiceTranscript}”
            </p>
          )}
          {voiceBusy && (
            <div
              role="status"
              aria-live="polite"
              className="mt-3 overflow-hidden rounded-2xl border border-[#cbd9b2] bg-green-soft"
            >
              <div
                className={`h-1 w-full ${
                  processingVoice
                    ? "animate-pulse bg-[#6950a8]"
                    : "bg-[#8ca85b]"
                }`}
              />
              <div className="flex items-center gap-3 p-4">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full text-lg ${
                    processingVoice
                      ? "bg-purple-soft text-[#6950a8]"
                      : "animate-pulse bg-[#e5efd0] text-[#52642f]"
                  }`}
                  aria-hidden="true"
                >
                  {processingVoice ? "✦" : "🎙️"}
                </span>
                <span>
                  <strong className="block text-sm text-foreground">
                    {voicePhase === "starting"
                      ? "Ativando o microfone"
                      : voicePhase === "stopping"
                        ? "Concluindo a gravação"
                        : processingVoice
                          ? "Buscando os nutrientes"
                          : "Ouvindo o alimento"}
                  </strong>
                  <span className="mt-0.5 block text-xs text-muted">
                    {voicePhase === "starting"
                      ? "Se o Safari pedir, permita o acesso ao microfone."
                      : voicePhase === "stopping"
                        ? "Aguardando as últimas palavras reconhecidas…"
                        : processingVoice
                          ? "Sua fala foi reconhecida. Buscando o alimento e a quantidade…"
                          : "Fale o alimento e a quantidade. Toque novamente para concluir."}
                  </span>
                </span>
              </div>
            </div>
          )}
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
              className="mt-3 overflow-hidden rounded-2xl border border-[#d9cdf8] bg-purple-soft"
            >
              <div className="h-1 w-full animate-pulse bg-[#b79af6]" />
              <div className="flex items-center gap-3 p-4">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-purple-soft text-[#6950a8]"
                  aria-hidden="true"
                >
                  <span className="size-4 animate-spin rounded-full border-2 border-[#6950a8]/30 border-t-[#6950a8]" />
                </span>
                <span>
                  <strong className="block text-sm text-foreground">
                    Analisando sua foto
                  </strong>
                  <span className="mt-0.5 block text-xs text-muted">
                    Procurando alimento, marca e quantidade…
                  </span>
                </span>
              </div>
            </div>
          )}
          {foodNotice && (
            <p
              role="status"
              className="mt-3 rounded-xl bg-green-soft p-3 text-sm font-bold text-[#52642f]"
            >
              {foodNotice}
            </p>
          )}
          {searchError && (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-pink-soft p-3 text-sm text-[#9b2448]"
            >
              {searchError}
            </p>
          )}
          {query.trim().length >= 2 && !searchError && (
            <p role="status" className="mt-3 text-xs text-muted">
              {searching
                ? "Buscando alimento…"
                : results.total
                  ? `${Math.min(limit, results.total).toLocaleString("pt-BR")} de ${results.total.toLocaleString("pt-BR")} alimentos carregados${
                      results.nextCursor ? " · há mais resultados" : ""
                    }`
                  : "Nenhum alimento encontrado. Tente outro nome ou use o preenchimento manual abaixo."}
            </p>
          )}
          {!searching &&
            results.nextCursor &&
            Object.values(results.sourceDiagnostics || {}).some(
              (status) => status !== "ok",
            ) && (
              <div className="mt-3 rounded-2xl border border-outline bg-yellow-soft p-3 text-sm text-[#52642f]">
                <p role="status">
                  Algumas bases de alimentos estão temporariamente
                  indisponíveis. A lista ainda pode estar incompleta.
                </p>
                <button
                  type="button"
                  onClick={() => void loadMore(false)}
                  className="mt-2 rounded-full border border-current px-4 py-2 text-xs font-extrabold"
                >
                  Tentar busca novamente
                </button>
              </div>
            )}
          <div className="mt-3 rounded-2xl border border-outline bg-page p-3">
            <button
              type="button"
              onClick={() => setManualOpen((value) => !value)}
              className="text-sm font-extrabold text-[#52642f]"
              aria-expanded={manualOpen}
            >
              {manualOpen
                ? "− Fechar alimento manual"
                : "+ Não encontrou? Incluir alimento manualmente"}
            </button>
            {manualOpen && (
              <div className="mt-3 space-y-3">
                {manualFood.barcode && (
                  <p className="text-sm font-semibold">
                    Código não encontrado? Salve os dados do rótulo para as
                    próximas buscas.
                  </p>
                )}
                <label className="block">
                  <span className="mb-1 block text-xs font-bold">
                    Código de barras · opcional
                  </span>
                  <input
                    value={manualFood.barcode}
                    onChange={(event) =>
                      setManualFood((current) => ({
                        ...current,
                        barcode: event.target.value,
                      }))
                    }
                    inputMode="numeric"
                    maxLength={14}
                    pattern="[0-9]{8,14}"
                    className="form-input"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold">
                    Nome do alimento
                  </span>
                  <input
                    value={manualFood.name}
                    onChange={(event) =>
                      setManualFood((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Ex.: pasta de amendoim da minha marca"
                    className="form-input bg-surface"
                  />
                </label>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <label>
                    <span className="mb-1 block text-xs font-bold">
                      Quantidade
                    </span>
                    <input
                      type="number"
                      min={0.01}
                      max={10000}
                      step="any"
                      value={manualFood.quantity}
                      onChange={(event) =>
                        setManualFood((current) => ({
                          ...current,
                          quantity: event.target.value,
                        }))
                      }
                      className="form-input bg-surface"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-bold">
                      Unidade
                    </span>
                    <select
                      value={manualFood.unit}
                      onChange={(event) =>
                        setManualFood((current) => ({
                          ...current,
                          unit: event.target.value === "ml" ? "ml" : "g",
                        }))
                      }
                      className="form-input bg-surface"
                    >
                      <option value="g">g</option>
                      <option value="ml">ml</option>
                    </select>
                  </label>
                </div>
                <p className="text-xs text-muted">
                  Informe os nutrientes referentes a 100 g/ml.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([
                    ["calories", "Calorias (kcal)"],
                    ["protein", "Proteína (g)"],
                    ["carbs", "Carboidratos (g)"],
                    ["fat", "Gorduras (g)"],
                  ] as const).map(([key, label]) => (
                    <label key={key}>
                      <span className="mb-1 block text-xs font-bold">
                        {label}
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={10000}
                        step="any"
                        value={manualFood[key]}
                        onChange={(event) =>
                          setManualFood((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        className="form-input bg-surface"
                      />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void addManualFood()}
                  disabled={savingFood || items.length >= 50}
                  className="rounded-lg bg-[#52642f] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  {savingFood
                    ? "Salvando na base…"
                    : "Salvar na base e adicionar"}
                </button>
              </div>
            )}
          </div>
          {aiMessage && (
            <p role="status" className="mt-2 text-xs font-bold text-[#52642f]">
              {aiMessage}
            </p>
          )}
          {aiError && (
            <div
              role="alert"
              className="mt-3 rounded-2xl border border-[#f2b8c8] bg-pink-soft p-3 text-sm text-[#9b2448]"
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
                {results.foods.slice(0, limit).map((food) => {
                  const complete = hasCompleteNutrition(food)
                  return (
                    <li key={food.id}>
                      <button
                        type="button"
                        disabled={!complete || items.length >= 50}
                        onClick={() => add(food)}
                        aria-label={`Adicionar ${food.name} · ${food.source || "TBCA"}`}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-outline p-3 text-left transition hover:border-[#ef4f78] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <strong className="block break-words text-sm">
                            {food.name}
                          </strong>
                          <span className="mt-1 block text-xs text-muted">
                            {complete
                              ? `${
                                  food.source === "Manual"
                                    ? "Base da comunidade"
                                    : food.source || "TBCA"
                                } · Por 100 ${food.basisUnit || "g"}: ${display(food.calories)} kcal · P ${display(food.protein)} g · C ${display(food.carbs)} g · G ${display(food.fat)} g`
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
              <div className="order-1 mt-4 rounded-2xl border border-[#cfc0f5] bg-purple-soft p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#6950a8]">
                  Confirme o alimento antes de adicionar
                </p>
                <div className="mt-3 space-y-3">
                  {aiSuggestions.map((aiSuggestion) => (
                    <div
                      key={aiSuggestion.food}
                      className="rounded-xl bg-surface p-3"
                    >
                      <p className="text-sm font-black">{aiSuggestion.food}</p>
                      <p className="mt-1 text-xs text-muted">
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
                            className="form-input bg-surface"
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
                            className="form-input bg-surface"
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
                            : aiSuggestion.lookupComplete
                              ? "Sem dados nutricionais"
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
          {(results.total > limit || results.nextCursor) && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={searching}
              className="mt-3 rounded-full border border-outline px-4 py-2 text-xs font-bold"
            >
              {searching ? "Carregando mais…" : "Mostrar mais alimentos"}
            </button>
          )}
          {!!items.length && (
            <ul aria-label="Alimentos do pote" className="mt-5 space-y-3">
              {items.map((item, index) => {
                const nutrition = calculateNutrition([item])
                return (
                  <li key={item.key} className="rounded-2xl bg-page p-4">
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
                        className="grid size-8 shrink-0 place-items-center rounded-full bg-surface text-[#b92e53]"
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
                          className="form-input bg-surface"
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
                          className="form-input bg-surface"
                        >
                          <option value="g">g</option>
                          <option value="ml">ml</option>
                        </select>
                      </label>
                    </div>
                    {nutrition && (
                      <p className="mt-2 text-xs leading-relaxed text-muted">
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
            <p role="status" className="mt-3 text-xs text-muted">
              Limite de 50 alimentos por receita.
            </p>
          )}
        </>
      )}
    </section>
  )
}
