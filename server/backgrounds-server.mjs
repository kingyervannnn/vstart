import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = process.env.PORT ? Number(process.env.PORT) : 3600
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('/app/uploads/backgrounds')

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    ...headers,
  })
  res.end(payload)
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!m) return null
  const mime = m[1]
  const b64 = m[2]
  try {
    const buf = Buffer.from(b64, 'base64')
    return { mime, buffer: buf }
  } catch {
    return null
  }
}

function extForMime(mime) {
  if (!mime) return 'bin'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/svg+xml') return 'svg'
  if (mime === 'video/mp4') return 'mp4'
  if (mime === 'video/webm') return 'webm'
  if (mime.startsWith('image/')) return mime.split('/')[1]
  if (mime.startsWith('video/')) return mime.split('/')[1]
  return 'bin'
}

async function saveBackground(buffer, mime, suggestedName) {
  await ensureDir(UPLOAD_DIR)
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16)
  const ext = extForMime(mime) || 'bin'
  const base = suggestedName ? path.parse(String(suggestedName)).name.replace(/[^a-z0-9\-_.]/gi, '').slice(0, 40) : 'background'
  const fileName = `${base}-${hash}.${ext}`
  const filePath = path.join(UPLOAD_DIR, fileName)
  await fs.writeFile(filePath, buffer)
  const publicUrl = `/uploads/backgrounds/${fileName}`
  return { 
    id: hash, 
    fileName, 
    filePath, 
    url: publicUrl, 
    size: buffer.length, 
    mime,
    createdAt: Date.now()
  }
}

function serveStatic(req, res, filePath) {
  fs.readFile(filePath).then((buf) => {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mime = 
      ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'gif' ? 'image/gif'
      : ext === 'svg' ? 'image/svg+xml'
      : ext === 'mp4' ? 'video/mp4'
      : ext === 'webm' ? 'video/webm'
      : 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(buf)
  }).catch((e) => {
    send(res, 404, { ok: false, error: 'Not found' })
  })
}

async function listBackgrounds() {
  try {
    await ensureDir(UPLOAD_DIR)
    const files = await fs.readdir(UPLOAD_DIR)
    const backgrounds = []
    for (const file of files) {
      try {
        const filePath = path.join(UPLOAD_DIR, file)
        const stats = await fs.stat(filePath)
        if (stats.isFile()) {
          const ext = path.extname(file).slice(1).toLowerCase()
          const mime = 
            ext === 'png' ? 'image/png'
            : ext === 'webp' ? 'image/webp'
            : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'gif' ? 'image/gif'
            : ext === 'svg' ? 'image/svg+xml'
            : ext === 'mp4' ? 'video/mp4'
            : ext === 'webm' ? 'video/webm'
            : 'application/octet-stream'
          const hash = file.split('-').pop()?.split('.')[0] || crypto.createHash('sha1').update(file).digest('hex').slice(0, 16)
          backgrounds.push({
            id: hash,
            name: file,
            url: `/uploads/backgrounds/${file}`,
            size: stats.size,
            mime,
            createdAt: stats.mtimeMs
          })
        }
      } catch (e) {
        // Skip files we can't read
      }
    }
    return backgrounds.sort((a, b) => b.createdAt - a.createdAt)
  } catch (e) {
    return []
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    // CORS preflight
    if (req.method === 'OPTIONS') {
      send(res, 204, '')
      return
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true })
      return
    }
    // Static uploads
    if (req.method === 'GET' && url.pathname.startsWith('/uploads/backgrounds/')) {
      const fileName = url.pathname.replace(/^\/uploads\/backgrounds\//, '')
      const filePath = path.join(UPLOAD_DIR, fileName)
      serveStatic(req, res, filePath)
      return
    }
    // List backgrounds
    if (req.method === 'GET' && url.pathname === '/list') {
      const backgrounds = await listBackgrounds()
      send(res, 200, { ok: true, backgrounds })
      return
    }
    // Save background
    if (req.method === 'POST' && url.pathname === '/save') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        try {
          const obj = JSON.parse(body || '{}')
          const parsed = parseDataUrl(obj.dataUrl)
          if (!parsed) { 
            send(res, 400, { ok: false, error: 'Invalid dataUrl' })
            return 
          }
          const saved = await saveBackground(parsed.buffer, parsed.mime, obj.name)
          send(res, 200, { ok: true, ...saved })
        } catch (e) {
          send(res, 500, { ok: false, error: e?.message || 'Server error' })
        }
      })
      return
    }
    // Delete background
    if (req.method === 'DELETE' && url.pathname.startsWith('/delete/')) {
      const id = url.pathname.replace(/^\/delete\//, '')
      try {
        const backgrounds = await listBackgrounds()
        const bg = backgrounds.find(b => b.id === id || b.fileName.includes(id))
        if (!bg) {
          send(res, 404, { ok: false, error: 'Background not found' })
          return
        }
        const filePath = path.join(UPLOAD_DIR, bg.fileName)
        await fs.unlink(filePath)
        send(res, 200, { ok: true })
      } catch (e) {
        send(res, 500, { ok: false, error: e?.message || 'Server error' })
      }
      return
    }
    send(res, 404, { ok: false, error: 'Not found' })
  } catch (e) {
    send(res, 500, { ok: false, error: e?.message || 'Server error' })
  }
})

server.listen(PORT, () => {
  console.log(`backgrounds-server listening on :${PORT}`)
})



