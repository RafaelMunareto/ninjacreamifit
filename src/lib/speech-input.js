// @ts-check
/** @typedef {"idle" | "starting" | "listening" | "stopping"} SpeechState */
/** @typedef {{transcript: string}} Alternative */
/** @typedef {ArrayLike<Alternative> & {isFinal?: boolean}} SpeechResult */
/** @typedef {{results: ArrayLike<SpeechResult>}} SpeechEvent */
/** @typedef {{error?: string}} SpeechError */
/** @typedef {{lang: string, continuous: boolean, interimResults: boolean, maxAlternatives?: number, onstart: (() => void) | null, onresult: ((event: SpeechEvent) => void) | null, onerror: ((event: SpeechError) => void) | null, onend: (() => void) | null, start: () => void, stop: () => void, abort?: () => void}} Recognition */
/** @typedef {{recognition: Recognition, text: string, started: boolean, stopping: boolean, ended: boolean, timers: Set<ReturnType<typeof setTimeout>>}} Session */
/** @param {string} code */
export function speechErrorMessage(code) {
  switch (code) {
    case "not-allowed": case "NotAllowedError":
      return "Permita o acesso ao microfone nos ajustes deste site e tente novamente."
    case "service-not-allowed":
      return "O serviço de voz está bloqueado neste aparelho. Confira os ajustes de reconhecimento de voz ou use a busca por texto."
    case "InvalidStateError":
      return "O microfone ainda está encerrando a gravação anterior. Aguarde um instante e tente novamente."
    case "audio-capture": case "NotFoundError":
      return "Não foi possível acessar o microfone. Feche outros aplicativos que usam áudio e tente novamente."
    case "network":
      return "O reconhecimento de voz perdeu a conexão. Confira sua internet e tente novamente."
    case "no-speech":
      return "Não ouvi o alimento. Toque em Falar alimento e fale após aparecer Ouvindo."
    case "aborted":
      return "A gravação foi interrompida. Toque em Falar alimento para tentar novamente."
    case "language-not-supported":
      return "O reconhecimento em português não está disponível neste aparelho. Use a busca por texto."
    default:
      return "Não foi possível iniciar o reconhecimento de voz. Tente novamente ou use a busca por texto."
  }
}

/**
 * Each capture owns its events and timers. Late Safari events cannot clear a newer capture.
 * start() stays synchronous so it runs within the tap gesture required on iOS.
 * @param {{onState: (state: SpeechState) => void, onTranscript: (text: string) => void, onError: (message: string) => void, onPreview?: (text: string) => void, createRecognition?: () => Recognition | null, schedule?: typeof setTimeout, unschedule?: typeof clearTimeout}} options
 */
export function createSpeechInput({ onState, onTranscript, onError, onPreview, createRecognition, schedule = setTimeout, unschedule = clearTimeout }) {
  /** @type {Session | null} */
  let active = null
  const factory = createRecognition || (() => {
    const speechWindow = /** @type {Window & {SpeechRecognition?: new () => Recognition, webkitSpeechRecognition?: new () => Recognition}} */ (window)
    const Constructor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    return Constructor ? new Constructor() : null
  })
  /** @param {Session} session @param {() => void} callback @param {number} delay */
  function later(session, callback, delay) {
    const timer = schedule(() => { session.timers.delete(timer); if (active === session) callback() }, delay)
    session.timers.add(timer)
    return timer
  }
  /** @param {Session} session */
  function clearTimers(session) {
    for (const timer of session.timers) unschedule(timer)
    session.timers.clear()
  }
  /** @param {Session} session */
  function release(session) {
    if (active !== session) return
    active = null
    clearTimers(session)
    const recognition = session.recognition
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null
    if (!session.ended) {
      try { if (recognition.abort) recognition.abort(); else recognition.stop() } catch { /* Already stopped by the browser. */ }
    }
  }
  /** @param {Session} session @param {string} message */
  function fail(session, message) {
    if (active !== session) return
    release(session)
    onState("idle")
    onError(message)
  }
  /** @param {Session} session */
  function finish(session) {
    if (active !== session) return
    const text = session.text.trim()
    release(session)
    onState("idle")
    if (text) onTranscript(text)
    else onError(speechErrorMessage("no-speech"))
  }
  /** @param {Session} session */
  function stopSession(session) {
    if (active !== session || session.stopping) return
    session.stopping = true
    onState("stopping")
    if (!session.started) return // The first permission prompt may still be open.
    clearTimers(session)
    later(session, () => finish(session), 2500)
    try { session.recognition.stop() }
    catch { finish(session) }
  }
  return {
    start() {
      if (active) return
      let recognition
      try { recognition = factory() }
      catch { onError(speechErrorMessage("audio-capture")); return }
      if (!recognition) {
        onError("Este navegador não oferece reconhecimento de voz. Use a busca por texto.")
        return
      }
      /** @type {Session} */
      const session = { recognition, text: "", started: false, stopping: false, ended: false, timers: new Set() }
      active = session
      recognition.lang = "pt-BR"
      recognition.continuous = false
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      recognition.onstart = () => {
        if (active !== session) return
        session.started = true
        clearTimers(session)
        if (session.stopping) { session.stopping = false; stopSession(session); return }
        onState("listening")
        later(session, () => stopSession(session), 20000)
      }
      recognition.onresult = (event) => {
        if (active !== session) return
        // Results contain all current segments, including a changing interim tail.
        const results = Array.from(event.results)
        const text = results.map(result => String(result[0]?.transcript || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
        if (text) { session.text = text; onPreview?.(text) }
        if (text && !session.ended && results.length && results.every(result => result.isFinal)) stopSession(session)
      }
      recognition.onerror = (event) => {
        if (active !== session) return
        // Safari may emit no-speech after a user stop despite having delivered a transcript.
        if (session.text && (event.error === "no-speech" || session.stopping && event.error === "aborted")) { finish(session); return }
        fail(session, speechErrorMessage(event.error || ""))
      }
      recognition.onend = () => {
        if (active !== session) return
        session.ended = true
        clearTimers(session)
        onState("stopping")
        // Let queued result events settle before releasing this capture.
        later(session, () => finish(session), 200)
      }
      onState("starting")
      later(session, () => fail(session, "O microfone não iniciou. Confira a permissão do site e toque em Falar alimento novamente."), 15000)
      try { recognition.start() }
      catch (error) { fail(session, speechErrorMessage(error instanceof Error ? error.name : "")) }
    },
    stop() { if (active) stopSession(active) },
    /** @param {{notify?: boolean, message?: string}} [options] */
    cancel({ notify = false, message } = {}) {
      if (!active) return
      release(active)
      if (notify) { onState("idle"); if (message) onError(message) }
    },
  }
}
