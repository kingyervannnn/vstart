// Client-side image normalization for icons/logos
// - Loads from File/Blob or URL
// - Resizes to a square bounding box (default 96px)
// - Optionally flattens transparency against a background color
// - Returns both Blob (PNG) and dataUrl

export async function normalizeIconSource(source, opts = {}) {
  const {
    size = 96,
    background = null, // e.g., '#fff' to flatten alpha; null to preserve alpha
    padding = 0,        // pixels of inner padding
    type = 'image/png',
    quality = 0.92,
  } = opts

  const { bitmap, width, height } = await loadAsBitmap(source)
  const maxSide = Math.max(1, Number(size) || 96)
  const scale = Math.min((maxSide - padding * 2) / width, (maxSide - padding * 2) / height)
  const outW = Math.max(1, Math.round(width * scale))
  const outH = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = maxSide
  canvas.height = maxSide
  const ctx = canvas.getContext('2d')
  if (background) {
    ctx.save()
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  } else {
    // Clear to fully transparent
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
  const dx = Math.floor((maxSide - outW) / 2)
  const dy = Math.floor((maxSide - outH) / 2)
  ctx.drawImage(bitmap, dx, dy, outW, outH)

  const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
  const dataUrl = await blobToDataUrl(blob)
  return { blob, dataUrl, width: maxSide, height: maxSide }
}

async function loadAsBitmap(src) {
  if (src instanceof Blob || src instanceof File) {
    const url = URL.createObjectURL(src)
    try {
      const bmp = await createImageBitmap(src)
      return { bitmap: bmp, width: bmp.width, height: bmp.height, url }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  if (typeof src === 'string') {
    // Prefer fetch->blob to avoid tainting canvas with cross-origin images
    const resp = await fetch(src)
    const blob = await resp.blob()
    const bmp = await createImageBitmap(blob)
    return { bitmap: bmp, width: bmp.width, height: bmp.height }
  }
  throw new Error('Unsupported source type')
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(blob)
  })
}

