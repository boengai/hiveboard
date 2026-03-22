const MAX_WIDTH = 1920

/**
 * Resize an image file if it exceeds maxWidth.
 * Skips GIFs (canvas loses animation).
 * Returns the original file if no resize is needed.
 */
export async function resizeImage(
  file: File,
  maxWidth = MAX_WIDTH,
): Promise<File> {
  // Skip GIFs — canvas loses animation frames
  if (file.type === 'image/gif') return file

  const bitmap = await createImageBitmap(file)

  if (bitmap.width <= maxWidth) {
    bitmap.close()
    return file
  }

  const scale = maxWidth / bitmap.width
  const newWidth = maxWidth
  const newHeight = Math.round(bitmap.height * scale)

  const canvas = new OffscreenCanvas(newWidth, newHeight)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, newWidth, newHeight)
  bitmap.close()

  const blob = await canvas.convertToBlob({ type: file.type })
  return new File([blob], file.name, { type: file.type })
}
