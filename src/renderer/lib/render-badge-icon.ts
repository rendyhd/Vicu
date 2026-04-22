export function renderBadgeDataUrl(count: number): string | null {
  if (count <= 0) return null
  const label = count >= 100 ? '99+' : String(count)
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, size, size)

  ctx.fillStyle = '#eb3c44'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  const fontSize = label.length >= 3 ? 14 : 20
  ctx.font = `bold ${fontSize}px -apple-system, "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, size / 2, size / 2 + 1)

  return canvas.toDataURL('image/png')
}
