// @ts-check
const numbers = new Map(Object.entries({
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
  quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80,
  noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200,
  trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
  novecentos: 900, novecentas: 900, meio: 0.5, meia: 0.5,
}))
const normalized = (/** @type {string} */ value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
/** @param {string} phrase @returns {number | null} */
function spokenNumber(phrase) {
  const value = normalized(phrase).trim()
  if (/^\d+(?:[,.]\d+)?$/.test(value)) return Number(value.replace(",", "."))
  const parts = value.split(/\s+/)
  if (!parts.length || parts.some(word => word !== "e" && word !== "mil" && !numbers.has(word))) return null
  let total = 0, group = 0
  for (const word of parts) {
    if (word === "e") continue
    if (word === "mil") { total += (group || 1) * 1000; group = 0 }
    else group += numbers.get(word) || 0
  }
  return total + group
}

/** @param {string} transcript @returns {{food: string, quantity?: number, unit?: "g" | "ml"}} */
export function parseSpokenFood(transcript) {
  let food = transcript.trim().replace(/\s+/g, " ")
  // Long unit names must precede abbreviations: "g" must never consume only the start of "gramas".
  const unit = /(quilogramas?|quilos?|kg|gramas?|g|mililitros?|ml|litros?|l)\b/gi
  let match
  let detected
  while ((match = unit.exec(food))) {
    const before = food.slice(0, match.index)
    const tokens = [...before.matchAll(/[\p{L}\d]+(?:[,.]\d+)?/gu)]
    let amount = null, start = before.length
    // Parse the longest numeric suffix immediately preceding the unit.
    for (let index = tokens.length - 1; index >= 0; index--) {
      const candidate = before.slice(tokens[index].index).trim()
      const number = spokenNumber(candidate)
      if (number === null) break
      amount = number; start = tokens[index].index
    }
    if (amount === null) continue
    const name = normalized(match[1])
    const liquid = /^(?:mililitro|ml|litro|l$)/.test(name)
    const scale = /^(?:quilo|kg$|litro|l$)/.test(name) ? 1000 : 1
    const quantity = Math.round(amount * scale * 1000) / 1000
    if (quantity <= 0 || quantity > 10000) throw new Error("Diga uma quantidade maior que zero e de até 10.000 g ou ml.")
    detected = { quantity, unit: /** @type {"g" | "ml"} */ (liquid ? "ml" : "g") }
    food = `${food.slice(0, start)} ${food.slice(match.index + match[0].length)}`
    break
  }
  food = food.replace(/^(?:adicione|adicionar|registrar|registre|coloque|incluir)\s+/i, "")
    .replace(/^\s*(?:de|do|da)\s+/i, "")
    .replace(/\s+(?:de|do|da)\s*$/i, "")
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, "").replace(/\s+/g, " ").trim()
  if (food.length < 2) throw new Error("Diga o nome do alimento, por exemplo: banana 150 gramas.")
  return { food, ...detected }
}
