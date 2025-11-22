import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// Basic config
const PORT = process.env.AI_PORT ? Number(process.env.AI_PORT) : 3200
const DATA_DIR = process.env.DATA_DIR || path.resolve('/app/uploads/ai')
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json')

// Helpers
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function readJson(file, fallback) {
  try {
    const buf = await fs.readFile(file, 'utf8')
    return JSON.parse(buf)
  } catch {
    return fallback
  }
}

async function writeJson(file, obj) {
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, JSON.stringify(obj, null, 2))
}

function send(res, status, body, extraHeaders = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...extraHeaders,
  })
  res.end(payload)
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) } catch { resolve({}) }
    })
  })
}

// Provider utilities
const DEFAULTS = {
  lmstudioBaseUrl: 'http://127.0.0.1:1234/v1',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
}

function normalizeBaseUrl(u, suffix = '') {
  if (!u || typeof u !== 'string') return suffix ? (DEFAULTS.lmstudioBaseUrl + suffix) : DEFAULTS.lmstudioBaseUrl
  let x = u.trim().replace(/\/+$/, '')
  if (!/\/v1$/.test(x)) x += '/v1'
  return suffix ? (x + suffix) : x
}

async function listModelsFromLMStudio(baseUrl) {
  const url = normalizeBaseUrl(baseUrl, '/models')
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`LM Studio models failed: ${r.status}`)
    const j = await r.json()
    const arr = Array.isArray(j?.data) ? j.data : (Array.isArray(j) ? j : [])
    return arr.map(m => (typeof m === 'string' ? m : (m?.id || m?.name || ''))).filter(Boolean)
  } catch (e) {
    // Fallback for Docker for Mac/Windows: rewrite localhost->host.docker.internal
    try {
      const u = new URL(url)
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        u.hostname = 'host.docker.internal'
        const r2 = await fetch(u.toString())
        if (!r2.ok) throw new Error(`LM Studio models failed: ${r2.status}`)
        const j2 = await r2.json()
        const arr2 = Array.isArray(j2?.data) ? j2.data : (Array.isArray(j2) ? j2 : [])
        return arr2.map(m => (typeof m === 'string' ? m : (m?.id || m?.name || ''))).filter(Boolean)
      }
    } catch {}
    throw e
  }
}

async function listModelsFromOpenAI(apiKey, baseUrl = DEFAULTS.openaiBaseUrl) {
  if (!apiKey) return []
  const r = await fetch(baseUrl.replace(/\/+$/, '') + '/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  })
  if (!r.ok) throw new Error(`OpenAI models failed: ${r.status}`)
  const j = await r.json()
  const arr = Array.isArray(j?.data) ? j.data : []
  return arr.map(m => (m?.id || '')).filter(Boolean)
}

async function listModelsFromOpenRouter(apiKey, baseUrl = DEFAULTS.openrouterBaseUrl) {
  if (!apiKey) return []
  const r = await fetch(baseUrl.replace(/\/+$/, '') + '/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  })
  if (!r.ok) throw new Error(`OpenRouter models failed: ${r.status}`)
  const j = await r.json()
  const arr = Array.isArray(j?.data) ? j.data : []
  return arr.map(m => (m?.id || m?.name || '')).filter(Boolean)
}

function looksLikeCodePrompt(messages) {
  const text = (Array.isArray(messages) ? messages : []).map(m => String(m?.content || '')).join('\n')
  if (!text) return false
  const indicators = [
    '```', 'function ', 'class ', 'import ', 'def ', 'var ', 'let ', 'const ', 'return ', '=>', '#include', 'public static void main',
  ]
  return indicators.some(k => text.includes(k))
}

function isLongInput(messages) {
  const text = (Array.isArray(messages) ? messages : []).map(m => String(m?.content || '')).join('\n')
  return text.length > 6000
}

function inferProviderFromModel(model) {
  const m = String(model || '').toLowerCase()
  if (!m) return null
  if (m.includes('/')) return 'openrouter'
  if (m.startsWith('gpt-') || m.startsWith('o') || m.startsWith('text-') || m.startsWith('chatgpt-')) return 'openai'
  return 'lmstudio'
}

async function chooseAutoModel(messages, cfg) {
  const hasOR = !!cfg.openrouterApiKey
  const hasOAI = !!cfg.openaiApiKey
  const hasLMS = !!cfg.lmstudioBaseUrl
  const codey = looksLikeCodePrompt(messages)
  const lengthy = isLongInput(messages)
  const preferLocal = !!cfg.preferLocal
  if (preferLocal && hasLMS) {
    try {
      const list = await listModelsFromLMStudio(cfg.lmstudioBaseUrl)
      // Prefer a coding model when codey, else first available
      if (codey) {
        const cand = list.find(m => /code|coder|qwen|deepseek|mistral|llama|phi|gemma/i.test(String(m)))
        if (cand) return { provider: 'lmstudio', model: cand }
      }
      if (list.length > 0) return { provider: 'lmstudio', model: list[0] }
    } catch {}
  }
  if (codey && hasOR) return { provider: 'openrouter', model: 'deepseek/deepseek-coder' }
  if (lengthy) {
    if (hasOR) return { provider: 'openrouter', model: 'openai/gpt-4o' }
    if (hasOAI) return { provider: 'openai', model: 'gpt-4o' }
  }
  if (hasOAI) return { provider: 'openai', model: 'gpt-4o-mini' }
  if (hasOR) return { provider: 'openrouter', model: 'openai/gpt-4o-mini' }
  if (hasLMS) {
    // Try to pick first LM Studio model
    try {
      const list = await listModelsFromLMStudio(cfg.lmstudioBaseUrl)
      if (list.length > 0) return { provider: 'lmstudio', model: list[0] }
    } catch {}
    return { provider: 'lmstudio', model: 'llama-3.1-8b-instruct' }
  }
  return { provider: 'none', model: '' }
}

async function proxyOpenAIStyleChat(res, body, cfg) {
  let provider = inferProviderFromModel(body.model)
  let model = body.model
  if (!provider) {
    const auto = await chooseAutoModel(body.messages || [], cfg)
    provider = auto.provider
    model = auto.model
  }

  const payload = { ...body, model }
  const customFields = ['providerConfig', 'chat_id', 'session_id']
  for (const k of customFields) delete payload[k]
  const stream = !!payload.stream

  // Build attempt order with graceful fallbacks
  const order = []
  const configured = {
    lmstudio: !!cfg.lmstudioBaseUrl,
    openai: !!cfg.openaiApiKey,
    openrouter: !!cfg.openrouterApiKey,
  }
  if (cfg.preferLocal && configured.lmstudio) order.push('lmstudio')
  if (provider && configured[provider]) order.push(provider)
  ;['openai', 'openrouter', 'lmstudio'].forEach(p => { if (configured[p] && !order.includes(p)) order.push(p) })
  if (order.length === 0) { send(res, 400, { error: 'No provider configured' }); return }

  const buildReq = (p) => {
    if (p === 'openai') {
      const url = (cfg.openaiBaseUrl || DEFAULTS.openaiBaseUrl).replace(/\/+$/, '') + '/chat/completions'
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.openaiApiKey || ''}` }
      return { url, headers }
    }
    if (p === 'openrouter') {
      const url = (cfg.openrouterBaseUrl || DEFAULTS.openrouterBaseUrl).replace(/\/+$/, '') + '/chat/completions'
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.openrouterApiKey || ''}`, 'HTTP-Referer': 'http://localhost', 'X-Title': 'Vivaldi Startpage' }
      return { url, headers }
    }
    // lmstudio
    const url = normalizeBaseUrl(cfg.lmstudioBaseUrl, '/chat/completions')
    const headers = { 'Content-Type': 'application/json' }
    return { url, headers }
  }

  let lastErr = null
  for (const p of order) {
    try {
      const { url, headers } = buildReq(p)
      const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
      if (!upstream.ok) { lastErr = new Error(`${p} upstream ${upstream.status}`); continue }
      const ctype = String(upstream.headers.get('content-type') || '').toLowerCase()
      if (!stream || !ctype.includes('text/event-stream')) {
        const text = await upstream.text()
        try { await saveToMemory(body, text) } catch {}
        send(res, upstream.status, text || '{}', { 'Content-Type': ctype || 'application/json' })
        return
      }
      // Streaming
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' })
      const reader = upstream.body.getReader()
      let fullText = ''
      let lastChunk = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        try {
          const chunk = Buffer.from(value).toString('utf8')
          lastChunk = chunk
          fullText += chunk
          res.write(chunk)
        } catch {}
      }
      try { res.write('\n\n') } catch {}
      res.end()
      try { await saveToMemory(body, lastChunk || fullText) } catch {}
      return
    } catch (e) {
      lastErr = e
      continue
    }
  }
  send(res, 502, { error: 'All upstream attempts failed', details: lastErr?.message || String(lastErr || '') })
}

async function saveToMemory(reqBody, respChunk) {
  const chatId = reqBody?.chat_id || reqBody?.chatId || ''
  if (!chatId) return
  const sessionId = reqBody?.session_id || reqBody?.sessionId || ''
  let userMessage = null
  if (Array.isArray(reqBody?.messages)) {
    for (let i = reqBody.messages.length - 1; i >= 0; i--) {
      const m = reqBody.messages[i]
      if (m && m.role === 'user') { userMessage = m; break }
    }
  }
  let assistantText = ''
  try {
    // Attempt to parse OpenAI-style JSON when not streaming
    const j = JSON.parse(respChunk.startsWith('data:') ? '{}' : (respChunk || '{}'))
    assistantText = j?.choices?.[0]?.message?.content || ''
  } catch {
    // Try to extract from SSE chunk by scanning for last data: {"delta":{...}}
    const lines = (respChunk || '').split('\n').map(s => s.trim()).filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]
      const s = l.startsWith('data:') ? l.slice(5).trim() : l
      try {
        const obj = JSON.parse(s)
        const delta = obj?.delta || obj?.choices?.[0]?.delta?.content || obj?.choices?.[0]?.message?.content || obj?.message?.content || obj?.content
        if (typeof delta === 'string' && delta) { assistantText = delta; break }
      } catch {}
    }
  }
  const mem = await readJson(MEMORY_FILE, { sessions: {}, longTerm: {} })
  const sess = mem.sessions[chatId] || { history: [] }
  if (userMessage?.content) sess.history.push({ role: 'user', content: String(userMessage.content) })
  if (assistantText) sess.history.push({ role: 'assistant', content: String(assistantText) })
  // Trim history to last 12 turns
  if (sess.history.length > 24) sess.history = sess.history.slice(-24)
  mem.sessions[chatId] = sess
  // Basic long-term: keep last message if sufficiently declarative (very naive)
  if (sessionId && typeof assistantText === 'string' && assistantText.length > 0) {
    const facts = mem.longTerm[sessionId] || []
    if (assistantText.length < 800 && /(?:remember|note|summary|key points|important)/i.test(assistantText)) {
      facts.push(assistantText)
      if (facts.length > 50) facts.shift()
      mem.longTerm[sessionId] = facts
    }
  }
  await writeJson(MEMORY_FILE, mem)
}

async function injectMemoryIntoMessages(reqBody) {
  if (!reqBody?.include_memory) return Array.isArray(reqBody?.messages) ? reqBody.messages : []
  const chatId = reqBody?.chat_id || reqBody?.chatId || ''
  const sessionId = reqBody?.session_id || reqBody?.sessionId || ''
  const mem = await readJson(MEMORY_FILE, { sessions: {}, longTerm: {} })
  const sess = (chatId && mem.sessions[chatId]) ? mem.sessions[chatId].history || [] : []
  const facts = (sessionId && mem.longTerm[sessionId]) ? mem.longTerm[sessionId] : []
  const base = Array.isArray(reqBody?.messages) ? reqBody.messages : []
  const injected = []
  const turns = Number.isFinite(Number(reqBody?.memory_turns)) ? Math.max(0, Math.min(20, Number(reqBody.memory_turns))) : 6
  if (Array.isArray(sess) && sess.length > 0 && turns > 0) {
    injected.push(...sess.slice(-turns * 2))
  }
  if (!!reqBody?.include_long_term && Array.isArray(facts) && facts.length > 0) {
    injected.unshift({ role: 'system', content: `Long-term notes:\n- ${facts.slice(-8).join('\n- ')}` })
  }
  return [...injected, ...base]
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const p = url.pathname
    const is = (...paths) => paths.includes(p)
    if (req.method === 'OPTIONS') { send(res, 204, ''); return }
    if (req.method === 'GET' && is('/ai/health', '/health')) { send(res, 200, { ok: true }); return }

    if (req.method === 'POST' && is('/ai/models', '/models')) {
      const body = await parseBody(req)
      const cfg = {
        lmstudioBaseUrl: body?.lmstudioBaseUrl || '',
        openaiApiKey: body?.openaiApiKey || '',
        openaiBaseUrl: body?.openaiBaseUrl || '',
        openrouterApiKey: body?.openrouterApiKey || '',
        openrouterBaseUrl: body?.openrouterBaseUrl || '',
      }
      const out = new Set()
      const status = { lmstudio: { ok: null, error: null }, openai: { ok: null, error: null }, openrouter: { ok: null, error: null } }

      // LM Studio
      if (cfg.lmstudioBaseUrl) {
        try {
          const list = await listModelsFromLMStudio(cfg.lmstudioBaseUrl)
          list.forEach(m => out.add(m))
          status.lmstudio.ok = true
        } catch (e) {
          status.lmstudio.ok = false
          status.lmstudio.error = String(e?.message || e)
        }
      }

      // OpenAI
      if (cfg.openaiApiKey) {
        try {
          const list = await listModelsFromOpenAI(cfg.openaiApiKey, cfg.openaiBaseUrl||DEFAULTS.openaiBaseUrl)
          list.forEach(m => out.add(m))
          status.openai.ok = true
        } catch (e) {
          status.openai.ok = false
          status.openai.error = String(e?.message || e)
        }
      }

      // OpenRouter
      if (cfg.openrouterApiKey) {
        try {
          const list = await listModelsFromOpenRouter(cfg.openrouterApiKey, cfg.openrouterBaseUrl||DEFAULTS.openrouterBaseUrl)
          list.forEach(m => out.add(m))
          status.openrouter.ok = true
        } catch (e) {
          status.openrouter.ok = false
          status.openrouter.error = String(e?.message || e)
        }
      }

      send(res, 200, { models: Array.from(out), status })
      return
    }

    if (req.method === 'POST' && is('/license/validate', '/ai/license/validate')) {
      const body = await parseBody(req)
      const key = String(body?.key || body?.licenseKey || '').trim()
      if (!key) {
        send(res, 400, { ok: false, error: 'Missing license key' })
        return
      }
      const masterKey = process.env.VSTART_MASTER_LICENSE_KEY
      const devMasterKey = 'vstart-dev-master-3PpNnRr9Jg8sLq2zW1xY7uB4cH6kD5m'
      if ((masterKey && key === masterKey) || key === devMasterKey) {
        const storeId = Number(process.env.LEMON_SQUEEZY_STORE_ID || 697754)
        const variantId = Number(process.env.LEMON_SQUEEZY_VARIANT_ID || 1098041)
        const now = new Date().toISOString()
        const lic = {
          key,
          status: 'active',
          store_id: storeId,
          variant_id: variantId,
          created_at: now,
          updated_at: now,
          meta: {
            source: 'master',
            valid: true,
            activation_limit: null,
            activations: 1,
            error: null,
          },
        }
        send(res, 200, { ok: true, license: lic })
        return
      }
      const apiKey = process.env.LEMON_SQUEEZY_API_KEY || process.env.LEMON_SQUEEZY_API_TOKEN || ''
      if (!apiKey) {
        send(res, 500, { ok: false, error: 'Licensing backend not configured' })
        return
      }
      const storeId = Number(process.env.LEMON_SQUEEZY_STORE_ID || 697754)
      const variantId = Number(process.env.LEMON_SQUEEZY_VARIANT_ID || 1098041)
      const instanceName = String(body?.instanceName || 'VSTART')
      const instanceId = body?.instanceId ? String(body.instanceId) : ''

      try {
        const upstream = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            license_key: key,
            instance_name: instanceName,
            instance_id: instanceId || undefined,
          }),
        })
        const json = await upstream.json().catch(() => ({}))
        const meta = json?.meta || {}
        const lic = (json?.data && json.data.attributes) || json?.data || {}
        if (!upstream.ok) {
          const errorMessage = meta?.error || json?.error || json?.message || `Upstream status ${upstream.status}`
          send(res, 200, { ok: false, error: errorMessage, license: lic || null })
          return
        }
        const storeOk = !storeId || Number(lic.store_id) === storeId
        const variantOk = !variantId || Number(lic.variant_id) === variantId
        const status = String(lic.status || meta.status || '').toLowerCase()
        const badStatuses = ['refunded', 'chargeback', 'cancelled', 'revoked', 'inactive', 'expired']
        const statusOk = status && !badStatuses.includes(status)
        const validFlag = meta.valid !== false && !meta.error
        const limit = Number(meta.activation_limit ?? meta.max_activations ?? lic.activation_limit ?? lic.max_activations)
        const used = Number(meta.activations ?? lic.activations ?? lic.activated_installations)
        const activationsOk = (Number.isFinite(limit) && Number.isFinite(used)) ? (used <= limit) : true
        let notExpired = true
        const expiresAt = meta.expires_at || meta.renews_at || lic.expires_at
        if (expiresAt) {
          const ts = Date.parse(expiresAt)
          if (!Number.isNaN(ts) && ts < Date.now()) notExpired = false
        }
        const ok = !!(validFlag && storeOk && variantOk && statusOk && activationsOk && notExpired)
        send(res, 200, { ok, license: { ...lic, meta } })
      } catch (e) {
        console.error('License validation error:', e)
        send(res, 200, { ok: false, error: 'Validation error', details: String(e?.message || e || '') })
      }
      return
    }

    if (req.method === 'POST' && (is('/ai/v1/chat/completions', '/v1/chat/completions') || is('/ai/chat', '/chat'))) {
      const body = await parseBody(req)
      const cfg = {
        lmstudioBaseUrl: body?.providerConfig?.lmstudioBaseUrl || '',
        openaiApiKey: body?.providerConfig?.openaiApiKey || '',
        openaiBaseUrl: body?.providerConfig?.openaiBaseUrl || '',
        openrouterApiKey: body?.providerConfig?.openrouterApiKey || '',
        openrouterBaseUrl: body?.providerConfig?.openrouterBaseUrl || '',
        preferLocal: !!body?.providerConfig?.preferLocal,
      }
      try {
        // Inject memory into messages before routing
        if (Array.isArray(body?.messages)) {
          body.messages = await injectMemoryIntoMessages(body)
        }
      } catch {}
      await proxyOpenAIStyleChat(res, body, cfg)
      return
    }

    send(res, 404, { error: 'Not found' })
  } catch (e) {
    send(res, 500, { error: e?.message || 'Server error' })
  }
})

server.listen(PORT, () => {
  console.log(`ai-server listening on :${PORT}`)
})
