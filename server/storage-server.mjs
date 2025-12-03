import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = process.env.PORT ? Number(process.env.PORT) : 3100
const ICONS_DIR = process.env.ICONS_DIR || path.resolve('/app/uploads/icons')
const BACKGROUNDS_DIR = process.env.BACKGROUNDS_DIR || path.resolve('/app/uploads/backgrounds')

// Workspace profiles cache (in-memory)
const profileCache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// ====== Common Utilities ======

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

function extForMime(mime, type = 'icon') {
  if (!mime) return 'bin'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/svg+xml') return 'svg'
  if (type === 'background') {
    if (mime === 'video/mp4') return 'mp4'
    if (mime === 'video/webm') return 'webm'
    if (mime.startsWith('video/')) return mime.split('/')[1]
  }
  if (mime.startsWith('image/')) return mime.split('/')[1]
  return 'bin'
}

function serveStatic(req, res, filePath, type = 'icon') {
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
    console.error(`[storage-api] Failed to serve ${filePath}:`, e.message)
    send(res, 404, { ok: false, error: 'Not found' })
  })
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

// ====== Icons API ======

async function saveIcon(buffer, mime, suggestedName) {
  await ensureDir(ICONS_DIR)
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16)
  const ext = extForMime(mime, 'icon') || 'png'
  const base = suggestedName ? path.parse(String(suggestedName)).name.replace(/[^a-z0-9\-_.]/gi, '').slice(0, 40) : 'icon'
  const fileName = `${base}-${hash}.${ext}`
  const filePath = path.join(ICONS_DIR, fileName)
  await fs.writeFile(filePath, buffer)
  const publicUrl = `/uploads/icons/${fileName}`
  return { fileName, filePath, url: publicUrl, size: buffer.length, mime }
}

// ====== Backgrounds API ======

async function saveBackground(buffer, mime, suggestedName) {
  await ensureDir(BACKGROUNDS_DIR)
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16)
  const ext = extForMime(mime, 'background') || 'bin'
  const base = suggestedName ? path.parse(String(suggestedName)).name.replace(/[^a-z0-9\-_.]/gi, '').slice(0, 40) : 'background'
  const fileName = `${base}-${hash}.${ext}`
  const filePath = path.join(BACKGROUNDS_DIR, fileName)
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

async function listBackgrounds() {
  try {
    await ensureDir(BACKGROUNDS_DIR)
    const files = await fs.readdir(BACKGROUNDS_DIR)
    const backgrounds = []
    for (const file of files) {
      try {
        const filePath = path.join(BACKGROUNDS_DIR, file)
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

// ====== Workspace Profiles API ======

function getCacheKey(workspaceId, settingsHash) {
  return `${workspaceId}:${settingsHash}`
}

function generateSettingsHash(settings) {
  // Simple hash of relevant settings for cache key
  const relevant = {
    appearance: settings?.appearance,
    theme: settings?.theme,
    speedDial: settings?.speedDial,
    background: settings?.background,
  }
  return JSON.stringify(relevant).slice(0, 100) // Truncate for key
}

// ====== Main Server ======

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const pathname = url.pathname
    // Determine storage type from header or path
    const storageType = (req.headers['x-storage-type'] || url.searchParams.get('type') || '').toLowerCase()

    // CORS preflight
    if (req.method === 'OPTIONS') {
      send(res, 204, '')
      return
    }

    // Health check
    if (req.method === 'GET' && pathname === '/health') {
      send(res, 200, { 
        ok: true, 
        service: 'storage-api',
        cacheSize: profileCache.size 
      })
      return
    }

    // ====== Icons API Routes ======
    
    // Serve static icon files
    if (req.method === 'GET' && pathname.startsWith('/uploads/icons/')) {
      const fileName = pathname.replace(/^\/uploads\/icons\//, '')
      let filePath = path.join(ICONS_DIR, fileName)
      
      // Handle filename variations (in case of hash duplication in old URLs)
      // Check if file exists, if not try simplified version
      try {
        await fs.access(filePath)
      } catch {
        // Try without duplicated hash if filename matches pattern like -hash-hash.ext
        const match = fileName.match(/^(.+?)-([a-f0-9]{16})-([a-f0-9]{16})\.(.+)$/)
        if (match && match[2] === match[3]) {
          const simplified = `${match[1]}-${match[2]}.${match[4]}`
          const altPath = path.join(ICONS_DIR, simplified)
          try {
            await fs.access(altPath)
            filePath = altPath
          } catch {
            // File doesn't exist in either form
          }
        }
      }
      
      serveStatic(req, res, filePath, 'icon')
      return
    }

    // Serve any uploads under /uploads/ (general static serving for icons)
    if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
      const rel = pathname.replace(/^\/uploads\//, '')
      const filePath = path.join(path.resolve('/app/uploads'), rel)
      serveStatic(req, res, filePath, 'icon')
      return
    }

    // Save icon - check X-Storage-Type header or path
    if (req.method === 'POST' && pathname === '/save' && storageType === 'icon') {
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
          const saved = await saveIcon(parsed.buffer, parsed.mime, obj.name)
          send(res, 200, { ok: true, ...saved })
        } catch (e) {
          send(res, 500, { ok: false, error: e?.message || 'Server error' })
        }
      })
      return
    }
    
    // Also support direct path for icons
    if (req.method === 'POST' && pathname === '/storage/icons/save') {
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
          const saved = await saveIcon(parsed.buffer, parsed.mime, obj.name)
          send(res, 200, { ok: true, ...saved })
        } catch (e) {
          send(res, 500, { ok: false, error: e?.message || 'Server error' })
        }
      })
      return
    }

    // ====== Backgrounds API Routes ======

    // Serve static background files
    if (req.method === 'GET' && pathname.startsWith('/uploads/backgrounds/')) {
      const fileName = pathname.replace(/^\/uploads\/backgrounds\//, '')
      const filePath = path.join(BACKGROUNDS_DIR, fileName)
      serveStatic(req, res, filePath, 'background')
      return
    }

    // List backgrounds - check X-Storage-Type header or path
    if (req.method === 'GET' && pathname === '/list' && storageType === 'background') {
      const backgrounds = await listBackgrounds()
      send(res, 200, { ok: true, backgrounds })
      return
    }
    
    // Also support direct path for listing backgrounds
    if (req.method === 'GET' && pathname === '/storage/backgrounds/list') {
      const backgrounds = await listBackgrounds()
      send(res, 200, { ok: true, backgrounds })
      return
    }

    // Save background - check X-Storage-Type header
    if (req.method === 'POST' && pathname === '/save' && storageType === 'background') {
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
    
    // Also support direct path for saving backgrounds
    if (req.method === 'POST' && pathname === '/storage/backgrounds/save') {
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

    // Delete background - only for backgrounds (not icons)
    if (req.method === 'DELETE' && (pathname.startsWith('/storage/backgrounds/delete/') || pathname.startsWith('/delete/'))) {
      // Reject if explicitly for icons
      if (storageType === 'icon') {
        send(res, 400, { ok: false, error: 'Delete not supported for icons' })
        return
      }
      const id = pathname.replace(/^\/storage\/backgrounds\/delete\//, '').replace(/^\/delete\//, '')
      try {
        const backgrounds = await listBackgrounds()
        const bg = backgrounds.find(b => b.id === id || b.fileName.includes(id))
        if (!bg) {
          send(res, 404, { ok: false, error: 'Background not found' })
          return
        }
        const filePath = path.join(BACKGROUNDS_DIR, bg.fileName)
        await fs.unlink(filePath)
        send(res, 200, { ok: true })
      } catch (e) {
        send(res, 500, { ok: false, error: e?.message || 'Server error' })
      }
      return
    }

    // ====== Workspace Profiles API Routes ======

    if (req.method === 'GET' && (pathname === '/workspace-profiles/health' || pathname === '/storage/workspace-profiles/health')) {
      send(res, 200, { ok: true, cacheSize: profileCache.size })
      return
    }

    if (req.method === 'GET' && (pathname.startsWith('/workspace-profiles/') || pathname.startsWith('/storage/workspace-profiles/'))) {
      const workspaceId = pathname.split('/workspace-profiles/')[1]?.split('/storage/workspace-profiles/')[0] || 
                         pathname.split('/storage/workspace-profiles/')[1]
      if (!workspaceId) {
        send(res, 400, { error: 'Workspace ID required' })
        return
      }

      const settingsHash = url.searchParams.get('hash') || 'default'
      const cacheKey = getCacheKey(workspaceId, settingsHash)
      const cached = profileCache.get(cacheKey)

      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        send(res, 200, {
          cached: true,
          profile: cached.profile,
          timestamp: cached.timestamp,
        })
        return
      }

      // Cache miss - client should compute
      send(res, 404, { error: 'Not cached', cached: false })
      return
    }

    if (req.method === 'POST' && (
      pathname === '/workspace-profiles' || 
      pathname === '/workspace-profiles/cache' ||
      pathname === '/storage/workspace-profiles' ||
      pathname === '/storage/workspace-profiles/cache'
    )) {
      const body = await parseBody(req)
      const { workspaceId, profile, settingsHash } = body

      if (!workspaceId || !profile) {
        send(res, 400, { error: 'Workspace ID and profile required' })
        return
      }

      const hash = settingsHash || generateSettingsHash(body.settings || {})
      const cacheKey = getCacheKey(workspaceId, hash)

      profileCache.set(cacheKey, {
        profile,
        timestamp: Date.now(),
      })

      // Limit cache size (remove oldest entries)
      if (profileCache.size > 100) {
        const entries = Array.from(profileCache.entries())
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
        const toRemove = entries.slice(0, 20)
        toRemove.forEach(([key]) => profileCache.delete(key))
      }

      send(res, 200, { ok: true, cached: true, key: cacheKey })
      return
    }

    if (req.method === 'POST' && (
      pathname === '/workspace-profiles/precompute' ||
      pathname === '/storage/workspace-profiles/precompute'
    )) {
      const body = await parseBody(req)
      const { profiles } = body

      if (!profiles || typeof profiles !== 'object') {
        send(res, 400, { error: 'Profiles object required' })
        return
      }

      const settingsHash = generateSettingsHash(body.settings || {})
      let cached = 0

      for (const [workspaceId, profile] of Object.entries(profiles)) {
        const cacheKey = getCacheKey(workspaceId, settingsHash)
        profileCache.set(cacheKey, {
          profile,
          timestamp: Date.now(),
        })
        cached++
      }

      send(res, 200, { ok: true, cached })
      return
    }

    if (req.method === 'POST' && (
      pathname === '/workspace-profiles/invalidate' ||
      pathname === '/storage/workspace-profiles/invalidate'
    )) {
      const body = await parseBody(req)
      const { workspaceId, all } = body

      if (all) {
        profileCache.clear()
        send(res, 200, { ok: true, cleared: true })
        return
      }

      if (workspaceId) {
        // Remove all entries for this workspace
        const keysToDelete = []
        profileCache.forEach((value, key) => {
          if (key.startsWith(`${workspaceId}:`)) {
            keysToDelete.push(key)
          }
        })
        keysToDelete.forEach(key => profileCache.delete(key))
        send(res, 200, { ok: true, invalidated: keysToDelete.length })
        return
      }

      send(res, 400, { error: 'Workspace ID or all=true required' })
      return
    }

    // Legacy routes for backward compatibility
    // Icons API legacy: /save (without type param, defaults to icon)
    if (req.method === 'POST' && pathname === '/save') {
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
          // Default to icon for legacy endpoint
          const saved = await saveIcon(parsed.buffer, parsed.mime, obj.name)
          send(res, 200, { ok: true, ...saved })
        } catch (e) {
          send(res, 500, { ok: false, error: e?.message || 'Server error' })
        }
      })
      return
    }

    send(res, 404, { ok: false, error: 'Not found' })
  } catch (e) {
    console.error('Storage server error:', e)
    send(res, 500, { ok: false, error: e?.message || 'Server error' })
  }
})

server.listen(PORT, () => {
  console.log(`storage-server listening on :${PORT}`)
})

