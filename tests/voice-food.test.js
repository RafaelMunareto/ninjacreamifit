import test from "node:test"
import assert from "node:assert/strict"
import { parseSpokenFood } from "../src/lib/voice-food.js"

for (const [speech, expected] of [
  ["banana 150 gramas", { food: "banana", quantity: 150, unit: "g" }],
  ["150 gramas de banana", { food: "banana", quantity: 150, unit: "g" }],
  ["Adicione 150 gramas de banana.", { food: "banana", quantity: 150, unit: "g" }],
  ["banana 150g", { food: "banana", quantity: 150, unit: "g" }],
  ["Leite desnatado 200ml", { food: "Leite desnatado", quantity: 200, unit: "ml" }],
  ["meio quilo de banana", { food: "banana", quantity: 500, unit: "g" }],
  ["banana cento e cinquenta gramas", { food: "banana", quantity: 150, unit: "g" }],
  ["duzentos e cinquenta mililitros de leite", { food: "leite", quantity: 250, unit: "ml" }],
  ["leite 0,5 litro", { food: "leite", quantity: 500, unit: "ml" }],
  ["banana 1.5 kg", { food: "banana", quantity: 1500, unit: "g" }],
  ["banana 2 quilogramas", { food: "banana", quantity: 2000, unit: "g" }],
  ["leite", { food: "leite" }],
]) test(`a fala “${speech}” preserva alimento e quantidade`, () => assert.deepEqual(parseSpokenFood(speech), expected))

test("quantidades inválidas não são aceitas e a fala precisa conter alimento", () => {
  for (const speech of ["banana 0 gramas", "banana 11000g", "150 gramas"]) assert.throws(() => parseSpokenFood(speech))
})
