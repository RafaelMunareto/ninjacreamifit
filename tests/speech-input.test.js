import test from "node:test"
import assert from "node:assert/strict"
import { createSpeechInput } from "../src/lib/speech-input.js"

function fixture() {
  let time = 0, nextId = 0
  const timers = new Map(), recognitions = [], states = [], transcripts = [], errors = [], previews = []
  const schedule = (callback, delay) => { const id = ++nextId; timers.set(id, { at: time + delay, callback }); return id }
  const unschedule = id => timers.delete(id)
  const advance = duration => {
    const target = time + duration
    while (true) {
      const [id, timer] = [...timers].sort((a,b) => a[1].at-b[1].at)[0] || []
      if (!timer || timer.at > target) break
      time = timer.at; timers.delete(id); timer.callback()
    }
    time = target
  }
  const input = createSpeechInput({
    onState: value => states.push(value), onTranscript: value => transcripts.push(value),
    onError: value => errors.push(value), onPreview: value => previews.push(value), schedule, unschedule,
    createRecognition: () => {
      const recognition = { startCount: 0, stopCount: 0, abortCount: 0, start() { this.startCount++ }, stop() { this.stopCount++ }, abort() { this.abortCount++ } }
      recognitions.push(recognition); return recognition
    },
  })
  const result = (recognition, segments) => recognition.onresult?.({ results: segments.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) })
  return { input, recognitions, states, transcripts, errors, previews, advance, result, timers }
}

test("o Safari só aparece como ouvindo após iniciar; o texto parcial sobrevive ao botão Parar", () => {
  const f = fixture(); f.input.start(); const r = f.recognitions[0]
  assert.deepEqual(f.states, ["starting"]); assert.equal(r.interimResults, true)
  r.onstart(); f.result(r, [["banana 150 gramas", false]])
  assert.equal(f.previews.at(-1), "banana 150 gramas")
  f.input.stop(); assert.equal(r.stopCount, 1); assert.equal(f.states.at(-1), "stopping")
  r.onend(); f.advance(200)
  assert.deepEqual(f.transcripts, ["banana 150 gramas"]); assert.equal(f.states.at(-1), "idle"); assert.equal(f.timers.size, 0)
})

test("combina segmentos, aceita o último resultado após end e publica uma única vez", () => {
  const f = fixture(); f.input.start(); const r = f.recognitions[0]; r.onstart()
  f.result(r, [["150 gramas", true], ["de banana", false]])
  const lateResult = r.onresult; r.onend()
  f.result(r, [["150 gramas", true], ["de banana", true]])
  f.advance(3000)
  lateResult({ results: [Object.assign([{ transcript: "resultado atrasado" }], { isFinal: true })] })
  assert.deepEqual(f.transcripts, ["150 gramas de banana"])
})

test("o erro de permissão não é apagado pelo end e a próxima tentativa funciona", () => {
  const f = fixture(); f.input.start(); const first = f.recognitions[0]; const oldEnd = first.onend
  first.onerror({ error: "not-allowed" }); oldEnd()
  assert.match(f.errors[0], /Permita o acesso ao microfone/); assert.equal(f.errors.length, 1)
  f.input.start(); const second = f.recognitions[1]; second.onstart(); oldEnd()
  assert.equal(f.states.at(-1), "listening")
  f.result(second, [["leite 200ml", true]]); second.onend(); f.advance(200)
  assert.deepEqual(f.transcripts, ["leite 200ml"])
})

test("capturas repetidas não se sobrepõem e eventos de uma sessão antiga são ignorados", () => {
  const f = fixture(); f.input.start(); f.input.start(); const first = f.recognitions[0]
  assert.equal(f.recognitions.length, 1)
  const oldResult = first.onresult, oldEnd = first.onend
  f.input.cancel(); assert.equal(first.abortCount, 1)
  f.input.start(); const second = f.recognitions[1]; second.onstart()
  oldResult({ results: [Object.assign([{ transcript: "coco" }], { isFinal: true })] }); oldEnd()
  assert.deepEqual(f.transcripts, []); assert.equal(f.states.at(-1), "listening")
})

test("sem end depois de Parar, conclui pelo texto parcial e libera o botão", () => {
  const f = fixture(); f.input.start(); const r = f.recognitions[0]; r.onstart()
  f.result(r, [["banana", false]]); f.input.stop(); f.advance(2500)
  assert.deepEqual(f.transcripts, ["banana"]); assert.equal(f.states.at(-1), "idle"); assert.equal(r.abortCount, 1)
})

test("a permissão pendente, a ausência de fala e a falha de rede nunca deixam o botão travado", () => {
  const f = fixture(); f.input.start(); f.advance(15000)
  assert.equal(f.states.at(-1), "idle"); assert.match(f.errors.at(-1), /microfone não iniciou/)
  f.input.start(); const second = f.recognitions[1]; second.onstart(); second.onend(); f.advance(200)
  assert.match(f.errors.at(-1), /Não ouvi o alimento/)
  f.input.start(); const third = f.recognitions[2]; third.onerror({error: "network"})
  assert.match(f.errors.at(-1), /perdeu a conexão/); assert.equal(f.timers.size, 0)
})

test("fechar o formulário aborta sem entregar texto nem atualizar o componente desmontado", () => {
  const f = fixture(); f.input.start(); const r = f.recognitions[0]; r.onstart(); f.result(r, [["banana", false]])
  const states = f.states.length; f.input.cancel(); f.advance(60000)
  assert.equal(r.abortCount, 1); assert.equal(f.states.length, states); assert.deepEqual(f.transcripts, []); assert.deepEqual(f.errors, [])
})

test("start e stop que lançam exceção não escapam para o React", () => {
  const f = fixture(); f.input.start(); const r = f.recognitions[0]; r.onstart()
  r.stop = () => { throw new DOMException("Already ended", "InvalidStateError") }
  f.result(r, [["banana", false]]); assert.doesNotThrow(() => f.input.stop()); assert.deepEqual(f.transcripts, ["banana"])
  const errors=[]
  const input = createSpeechInput({ onState() {}, onTranscript() {}, onError: e => errors.push(e), createRecognition: () => ({ start() { throw new DOMException("Denied", "NotAllowedError") }, stop() {}, abort() {} }) })
  assert.doesNotThrow(() => input.start()); assert.match(errors[0], /Permita/)
})

test("parar durante a permissão aguarda o início sem chamar stop em um microfone ainda inativo", () => {
  const f = fixture(); f.input.start(); const r = f.recognitions[0]
  f.input.stop(); assert.equal(r.stopCount, 0)
  r.onstart(); assert.equal(r.stopCount, 1)
  f.result(r, [["banana", false]]); r.onend(); f.advance(200)
  assert.deepEqual(f.transcripts, ["banana"])
})

test("no-speech emitido pelo WebKit após uma transcrição não descarta o alimento", () => {
  const f = fixture(); f.input.start(); const r = f.recognitions[0]; r.onstart()
  f.result(r, [["banana 150g", false]]); f.input.stop(); r.onerror({ error: "no-speech" })
  assert.deepEqual(f.transcripts, ["banana 150g"]); assert.deepEqual(f.errors, [])
})
