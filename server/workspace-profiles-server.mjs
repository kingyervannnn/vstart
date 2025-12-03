import http from 'node:http'

const PORT = process.env.PORT ? Number(process.env.PORT) : 3700

// In-memory cache for workspace profiles
const profileCache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const p = url.pathname
    const is = (...paths) => paths.includes(p)

    if (req.method === 'OPTIONS') {
      send(res, 204, '')
      return
    }

    if (req.method === 'GET' && (is('/workspace-profiles/health', '/health'))) {
      send(res, 200, { ok: true, cacheSize: profileCache.size })
      return
    }

    if (req.method === 'GET' && p.startsWith('/workspace-profiles/')) {
      const workspaceId = p.split('/workspace-profiles/')[1]
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

    if (req.method === 'POST' && is('/workspace-profiles', '/workspace-profiles/cache')) {
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

    if (req.method === 'POST' && is('/workspace-profiles/precompute')) {
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

    if (req.method === 'POST' && is('/workspace-profiles/invalidate')) {
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

    send(res, 404, { error: 'Not found' })
  } catch (e) {
    console.error('Workspace profiles server error:', e)
    send(res, 500, { error: String(e?.message || e) })
  }
})

server.listen(PORT, () => {
  console.log(`Workspace profiles server listening on port ${PORT}`)
})


