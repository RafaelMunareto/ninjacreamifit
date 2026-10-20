import assert from "node:assert/strict"
import test from "node:test"

test("trocar a sessão não reutiliza a leitura anterior nem remove a leitura atual", async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = globalThis.localStorage
  const originalChannel = globalThis.BroadcastChannel
  const device = "a".repeat(64)
  const storage = new Map([
    ["ninja-creami-fit-device", device],
    [`ninja-creami-fit-migrated:${device}`, "1"],
  ])
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  globalThis.BroadcastChannel = class extends EventTarget {
    postMessage() {}
  }
  const requests = []
  globalThis.fetch = (_url, options) => new Promise((resolve) => {
    requests.push({
      authorization: options.headers.Authorization,
      finish: (profile, status = 200) => resolve(Response.json(
        status === 200 ? { data: { profile: { id: profile } } } : { error: "Sessão inválida" },
        { status },
      )),
    })
  })
  const tick = () => new Promise(setImmediate)
  try {
    const api = await import("../src/lib/api.js?session-tests")
    api.setSessionTokenProvider(async () => "session-first")
    const first = api.getSnapshot()
    await tick()
    assert.equal(requests[0].authorization, "Bearer session-first")

    api.setSessionTokenProvider(async () => "session-second")
    const second = api.getSnapshot()
    await tick()
    assert.equal(requests[1].authorization, "Bearer session-second")
    requests[0].finish("first")
    await first
    assert.equal(api.getSnapshot(), second)
    requests[1].finish("second")
    assert.equal((await second).profile.id, "second")

    const unauthorized = api.getSnapshot()
    await tick()
    requests[2].finish(null, 401)
    await assert.rejects(unauthorized, /Sessão inválida/)
    assert.equal(requests.length, 3, "401 não reenvia a operação como outro perfil")

    api.setSessionTokenProvider(null)
    const anonymous = api.getSnapshot()
    await tick()
    assert.equal(requests[3].authorization, `Bearer ${device}`)
    requests[3].finish("device")
    assert.equal((await anonymous).profile.id, "device")
  } finally {
    globalThis.fetch = originalFetch
    globalThis.localStorage = originalStorage
    globalThis.BroadcastChannel = originalChannel
  }
})
