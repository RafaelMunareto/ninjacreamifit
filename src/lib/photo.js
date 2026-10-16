// @ts-check

/** Read, resize and encode an upload so it remains available after a reload. @param {File} file @returns {Promise<string>} */
export async function preparePhoto(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Escolha uma imagem em JPG, PNG ou WEBP.")
  if (file.size > 10 * 1024 * 1024)
    throw new Error("A foto deve ter no máximo 10 MB.")
  const source = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = source
    await image.decode()
    const ratio = Math.min(
      1,
      1200 / Math.max(image.naturalWidth, image.naturalHeight),
    )
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Não foi possível preparar a foto.")
    context.fillStyle = "#fffaf3"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", 0.8)
  } catch {
    throw new Error("Não foi possível ler esta foto. Escolha outra imagem.")
  } finally {
    URL.revokeObjectURL(source)
  }
}
