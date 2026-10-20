// @ts-check
// All browser requests use the site's proxy, including cookies and uploaded photos.
// The proxy selects the Repassa Fácil host without exposing server credentials.
/** @param {string} endpoint @param {RequestInit} [options] @returns {Promise<any>} */
export async function requestApi(endpoint, options = {}) {
  let response
  try {
    response = await fetch(`/api/${endpoint.replace(/^\/+/, "")}`, {
      credentials: "same-origin",
      ...options,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error
    throw new Error("Não foi possível conectar ao Repassa Fácil. Verifique sua conexão e tente novamente.")
  }
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("A API do Repassa Fácil não está disponível. Tente novamente em instantes.")
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error("O Repassa Fácil retornou uma resposta inválida. Tente novamente.")
  }
  if (!response.ok)
    throw new Error(result?.error || "Não foi possível concluir a operação no Repassa Fácil. Tente novamente.")
  return result
}
