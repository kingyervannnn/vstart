import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo, useImperativeHandle, forwardRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Globe, ExternalLink, X, Bot, Check, Mic, Square, List, Link2, ChevronRight, ChevronDown, Brain, Sparkles, ArrowUp, ArrowDown, Pin, PinOff, Trash2, Plus, Copy, Pencil, Image as ImageIcon } from 'lucide-react'
import { createPortal } from 'react-dom'
import { resolveSearchBarBlurPx } from '../lib/blur-utils'
// Lazy-load the transcriber only when voice is used to reduce initial bundle size
let __transcriberMod = null
async function lazyTranscribeAudioBlob(blob, opts) {
  if (!__transcriberMod) {
    __transcriberMod = await import('@/lib/voice/transcriber')
  }
  return __transcriberMod.transcribeAudioBlob(blob, opts)
}

const CHAT_STORAGE_KEY = 'aiChatSessions'
const CHAT_ACTIVE_KEY = 'aiChatActiveId'
const DEFAULT_CHAT_TITLE = 'New Chat'

const makeUuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0
  const v = c === 'x' ? r : (r & 0x3 | 0x8)
  return v.toString(16)
})

const ensureArray = (value) => (Array.isArray(value) ? value : [])

const normalizeChatSession = (session) => {
  const now = Date.now()
  return {
    id: typeof session?.id === 'string' && session.id ? session.id : makeUuid(),
    title: typeof session?.title === 'string' && session.title.trim() ? session.title.trim() : DEFAULT_CHAT_TITLE,
    createdAt: Number.isFinite(Number(session?.createdAt)) ? Number(session.createdAt) : now,
    updatedAt: Number.isFinite(Number(session?.updatedAt)) ? Number(session.updatedAt) : now,
    pinned: !!session?.pinned,
    messages: ensureArray(session?.messages)
  }
}

const loadStoredChatSessions = () => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY) || '[]'
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map(normalizeChatSession)
  } catch {
    return []
  }
}

const deriveChatTitle = (messages, fallback = DEFAULT_CHAT_TITLE) => {
  try {
    const firstUser = ensureArray(messages).find(m => (m?.role === 'user') && String(m?.content || '').trim())
    if (!firstUser) return fallback
    const text = String(firstUser.content || '').trim()
    if (!text) return fallback
    const singleLine = text.split('\n').map(line => line.trim()).filter(Boolean)[0] || text
    if (singleLine.length <= 60) return singleLine
    return `${singleLine.slice(0, 57)}…`
  } catch {
    return fallback
  }
}

// Color helpers (hoisted as function declarations to avoid TDZ during render)
function hexToRgba(hex, alphaScale = 1) {
  try {
    let h = String(hex || '').trim()
    if (!h) return `rgba(0, 255, 255, ${Math.max(0, Math.min(1, alphaScale))})`
    if (h.startsWith('#')) h = h.slice(1)
    let baseAlpha = 1
    if (h.length === 3) {
      h = h.split('').map(ch => ch + ch).join('')
    } else if (h.length === 4) {
      baseAlpha = parseInt(h[3] + h[3], 16) / 255
      h = h.slice(0, 3).split('').map(ch => ch + ch).join('')
    } else if (h.length === 8) {
      baseAlpha = parseInt(h.slice(6, 8), 16) / 255
      h = h.slice(0, 6)
    }
    if (h.length !== 6) return `rgba(0, 255, 255, ${Math.max(0, Math.min(1, alphaScale))})`
    const bigint = parseInt(h, 16)
    const r = (bigint >> 16) & 255
    const g = (bigint >> 8) & 255
    const b = bigint & 255
    const alpha = Math.max(0, Math.min(1, (Number.isFinite(baseAlpha) ? baseAlpha : 1) * alphaScale))
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  } catch {
    return `rgba(0, 255, 255, ${Math.max(0, Math.min(1, alphaScale))})`
  }
}

function applyAlphaToColor(color, alphaScale = 1) {
  try {
    const trimmed = String(color || '').trim()
    if (!trimmed) return `rgba(0,0,0,${Math.max(0, Math.min(1, alphaScale))})`
    if (trimmed.startsWith('#')) {
      return hexToRgba(trimmed, alphaScale)
    }
    const match = trimmed.match(/^rgba?\(([^)]+)\)$/i)
    if (match) {
      const parts = match[1].split(',').map(p => p.trim())
      const r = parseFloat(parts[0])
      const g = parseFloat(parts[1])
      const b = parseFloat(parts[2])
      const baseAlpha = parts.length > 3 ? parseFloat(parts[3]) : 1
      const alpha = Math.max(0, Math.min(1, (Number.isFinite(baseAlpha) ? baseAlpha : 1) * alphaScale))
      const toNumber = (val) => (Number.isFinite(val) ? val : 0)
      return `rgba(${toNumber(r)}, ${toNumber(g)}, ${toNumber(b)}, ${alpha})`
    }
    return trimmed
  } catch {
    return `rgba(0,0,0,${Math.max(0, Math.min(1, alphaScale))})`
  }
}

const sanitizeHex = (hex) => {
  if (!hex || typeof hex !== 'string') return '#3b82f6'
  const clean = hex.trim()
  if (!clean.startsWith('#')) return clean
  const body = clean.slice(1)
  if (body.length >= 6) {
    return `#${body.slice(0, 6)}`
  }
  return clean
}

const formatChatTimestamp = (ts) => {
  if (!ts) return ''
  try {
    const date = new Date(Number(ts))
    if (Number.isNaN(date.getTime())) return ''
    const diff = Date.now() - date.getTime()
    const oneDay = 24 * 60 * 60 * 1000
    if (diff < oneDay) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

// Render URLs inside chat text as clickable links
// - Supports http/https, www. domains, and bare domains like example.com
const CHAT_LINK_REGEX = /(https?:\/\/[^\s)]+|www\.[^\s)]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s)]*)?)/gi

const LinkifiedChatText = ({ text }) => {
  if (!text) return null
  const parts = []
  const str = String(text)
  let lastIndex = 0
  let match

  while ((match = CHAT_LINK_REGEX.exec(str)) !== null) {
    const index = match.index
    let value = match[0]
    if (index > lastIndex) {
      parts.push({ type: 'text', value: str.slice(lastIndex, index) })
    }
    // Strip common trailing punctuation from detected URL while keeping it as text
    let trailing = ''
    const punctMatch = value.match(/[.,!?;:]+$/)
    if (punctMatch) {
      trailing = punctMatch[0]
      value = value.slice(0, -trailing.length)
    }
    if (value) {
      parts.push({ type: 'link', value })
    }
    if (trailing) {
      parts.push({ type: 'text', value: trailing })
    }
    lastIndex = index + match[0].length
  }

  if (lastIndex < str.length) {
    parts.push({ type: 'text', value: str.slice(lastIndex) })
  }

  return parts.map((part, i) => {
    if (part.type === 'link') {
      let href = part.value
      if (!/^https?:\/\//i.test(href)) {
        href = `https://${href}`
      }
      return (
        <a
          key={`lnk-${i}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-300 hover:text-cyan-200 underline break-words"
        >
          {part.value}
        </a>
      )
    }
    return <span key={`txt-${i}`}>{part.value}</span>
  })
}

// Mock search suggestions service
function addHistoryEntry(entry) {
  try {
    const raw = localStorage.getItem('historyLinks') || '[]'
    const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : []
    const now = Date.now()
    const item = { title: entry.title || entry.url || entry.text || '', url: entry.url || '', ts: now }
    const dedup = [item, ...arr.filter(e => e.url !== item.url)].slice(0, 100)
    localStorage.setItem('historyLinks', JSON.stringify(dedup))
  } catch {}
}

class SearchSuggestionsService {
  constructor() {
    this.recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]')
    this.historyEntries = JSON.parse(localStorage.getItem('historyLinks') || '[]')
    this.debounceTimeout = null
    this.controller = null
    this.cache = new Map() // key -> { ts, data }
    this.cacheTTL = 30000 // 30s cache for network-backed suggestions
    try { this.stats = JSON.parse(localStorage.getItem('suggestionStats') || '{}') } catch { this.stats = {} }
  }

  addRecentSearch(query) {
    this.recentSearches = [query, ...this.recentSearches.filter(s => s !== query)].slice(0, 10)
    localStorage.setItem('recentSearches', JSON.stringify(this.recentSearches))
    // Update frequency stats
    this.updateStats({ text: query })
  }

  removeRecentSearch(query) {
    try {
      const ql = String(query || '').toLowerCase()
      this.recentSearches = (this.recentSearches || []).filter(s => String(s).toLowerCase() !== ql)
      localStorage.setItem('recentSearches', JSON.stringify(this.recentSearches))
    } catch {}
  }

  removeHistoryByUrl(url) {
    try {
      const target = String(url || '')
      this.historyEntries = (Array.isArray(this.historyEntries) ? this.historyEntries : []).filter(e => (e?.url || '') !== target)
      localStorage.setItem('historyLinks', JSON.stringify(this.historyEntries))
    } catch {}
  }

  removeStatsFor(item) {
    try {
      const key = (item && (item.url ? `url:${item.url}` : `t:${String(item.text||'').toLowerCase()}`))
      if (key && this.stats && this.stats[key]) {
        delete this.stats[key]
        localStorage.setItem('suggestionStats', JSON.stringify(this.stats))
      }
    } catch {}
  }

  addToBlocklist(item) {
    try {
      const raw = localStorage.getItem('suggestionBlocklist') || '[]'
      const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : []
      const set = new Set(arr)
      if (item?.url) {
        try {
          const host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, '')
          set.add(`host:${host}`)
        } catch {}
      } else if (item?.text) {
        set.add(`t:${String(item.text).trim().toLowerCase()}`)
      }
      localStorage.setItem('suggestionBlocklist', JSON.stringify(Array.from(set)))
    } catch {}
  }

  getBlocklist() {
    try {
      const raw = localStorage.getItem('suggestionBlocklist') || '[]'
      const arr = JSON.parse(raw)
      return new Set(Array.isArray(arr) ? arr : [])
    } catch { return new Set() }
  }

  updateStats(item) {
    try {
      const key = (item && (item.url ? `url:${item.url}` : `t:${String(item.text||'').toLowerCase()}`))
      if (!key) return
      const now = Date.now()
      const s = this.stats[key] || { cnt: 0, last: 0 }
      s.cnt += 1
      s.last = now
      this.stats[key] = s
      localStorage.setItem('suggestionStats', JSON.stringify(this.stats))
    } catch {}
  }

  // cancelPendingRequests is defined below

  _now() { return Date.now() }
  _cacheGet(key) {
    const v = this.cache.get(key)
    if (!v) return null
    if ((this._now() - v.ts) > this.cacheTTL) { this.cache.delete(key); return null }
    return v.data
  }
  _cacheSet(key, data) { this.cache.set(key, { ts: this._now(), data }) }

  _withTimeout(promise, ms = 150) {
    let to
    const timeout = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('timeout')), ms) })
    return Promise.race([promise.finally(() => clearTimeout(to)), timeout])
  }

  fetchSuggestionsDebounced(query, callback, options = {}) {
    // Instant update: call immediately without delay
    clearTimeout(this.debounceTimeout)
    this.fetchSuggestions(query, callback, options)
  }

  async fetchSuggestions(query, callback, options = {}) {
    try {
      if (this.controller) this.controller.abort()
      this.controller = new AbortController()

      const q = (query || '').trim().toLowerCase()
      const qStarts = (s) => String(s || '').toLowerCase().startsWith(q)
      const minLen = (q.length <= 1) ? 3 : (q.length + 1)

      // Immediate: show recents + history matches to avoid empty state while network fetch runs
      // Immediate recents & history with strict prefix and dedup
      const immRecentSet = new Set()
      const immediateRecents = this.recentSearches
        .filter(s => {
          const text = String(s || '')
          const ok = text.toLowerCase().startsWith(q) && text.length >= minLen
          const k = `t:${String(s||'').toLowerCase()}`
          if (ok && !immRecentSet.has(k)) { immRecentSet.add(k); return true }
          return false
        })
        .slice(0, 6)
        .map(s => ({ text: s, isRecent: true }))
      const immHistSet = new Set()
      const historyMatches = (Array.isArray(this.historyEntries) ? this.historyEntries : [])
        .filter(e => {
          const tl = String(e.title || '').toLowerCase()
          let host = ''
          try { host = new URL(String(e.url||'')).hostname.toLowerCase().replace(/^www\./,'') } catch {}
          const text = String(e.title || e.url || '')
          const ok = (tl.startsWith(q) || (host && host.startsWith(q))) && text.length >= minLen
          const k = `url:${String(e.url||'').toLowerCase()}`
          if (ok && !immHistSet.has(k)) { immHistSet.add(k); return true }
          return false
        })
        .slice(0, 6)
        .map(e => ({ text: e.title || e.url, url: e.url, source: 'history' }))
      // Apply blocklist for immediate set
      const blImm = this.getBlocklist()
      const immFiltered = [...immediateRecents, ...historyMatches].filter(s => {
        if (s?.url) {
          try { const host = new URL(s.url).hostname.toLowerCase().replace(/^www\./,''); return !blImm.has(`host:${host}`) } catch { return true }
        }
        if (s?.text) return !blImm.has(`t:${String(s.text).trim().toLowerCase()}`)
        return true
      })
      const limImm = Number(options.capAt || 10)
      let immediate = immFiltered.slice(0, limImm)
      if (options.mostRelevantAtBottom) immediate = immediate.slice().reverse()
      if (!options.noImmediate && immediate.length > 0) callback(immediate)

      // Smart URL candidates from popular + speed dial (if allowed)
      let urlCandidates = []
      if (options.allowUrls !== false) {
        const popular = [
          { text: 'youtube.com', url: 'https://www.youtube.com' },
          { text: 'gmail.com', url: 'https://mail.google.com' },
          { text: 'github.com', url: 'https://github.com' },
          { text: 'reddit.com', url: 'https://www.reddit.com' },
          { text: 'twitter.com', url: 'https://twitter.com' },
          { text: 'x.com', url: 'https://x.com' },
          { text: 'facebook.com', url: 'https://facebook.com' },
          { text: 'google.com', url: 'https://www.google.com' },
          { text: 'drive.google.com', url: 'https://drive.google.com' },
          { text: 'docs.google.com', url: 'https://docs.google.com' },
          { text: 'calendar.google.com', url: 'https://calendar.google.com' },
          { text: 'amazon.com', url: 'https://www.amazon.com' },
          { text: 'netflix.com', url: 'https://www.netflix.com' },
          { text: 'stackoverflow.com', url: 'https://stackoverflow.com' },
          { text: 'openai.com', url: 'https://openai.com' },
          { text: 'wikipedia.org', url: 'https://wikipedia.org' }
        ]
        const sdRaw = localStorage.getItem('speedDials')
        if (sdRaw) {
          try {
            const sds = JSON.parse(sdRaw)
            const all = []
            const getHost = (u) => { try { return (u && u.startsWith('http')) ? new URL(u).hostname : (u || '') } catch { return (u || '') } }
            Object.values(sds || {}).forEach(list => {
              if (Array.isArray(list)) list.forEach(t => {
                if (t?.url) all.push({ text: (t.title || getHost(t.url) || t.url), url: t.url })
              })
            })
            popular.push(...all)
          } catch {}
        }
        const seenURL = new Set()
        urlCandidates = []
        for (const p of popular) {
          const text = String(p.text||'').toLowerCase()
          let host = ''
          try { host = new URL(String(p.url||'')).hostname.toLowerCase().replace(/^www\./,'') } catch {}
          if (text.startsWith(q) || (host && host.startsWith(q))) {
            const key = (p.url || p.text).toLowerCase()
            if (!seenURL.has(key)) { seenURL.add(key); urlCandidates.push({ text: p.text || p.url, isUrl: true, url: p.url }) }
            if (urlCandidates.length >= 8) break
          }
        }
      }

      // Fetch SearXNG autocomplete first (150ms budget), then fallback to quick search
      const provider = String(options.provider || 'duckduckgo').toLowerCase()
      const searxngBase = String(options.searxngBase || '/searxng').replace(/\/+$/, '')
      const customBase = String(options.customBaseUrl || '').trim()
      const customMode = String(options.customMode || '').toLowerCase()
      const cacheKey = `sx:${provider}:${searxngBase}:${customBase}:${customMode}:${q}`
      let searxList = this._cacheGet(cacheKey)
      if (!searxList) {
        try {
          let url = ''
          if (provider === 'searxng') {
            url = `${searxngBase}/autocompleter?q=${encodeURIComponent(query)}`
          } else if (provider === 'google') {
            url = `/suggest/google/?client=firefox&q=${encodeURIComponent(query)}`
          } else if (provider === 'brave') {
            url = `/suggest/brave/?q=${encodeURIComponent(query)}`
          } else if (provider === 'custom' && customBase) {
            // Custom provider: base is expected to include any query prefix (e.g., /suggest/custom?q=)
            url = `${customBase}${encodeURIComponent(query)}`
          } else { // duckduckgo default
            url = `/suggest/ddg/?q=${encodeURIComponent(query)}`
          }
          const r = await this._withTimeout(fetch(url, { headers: { 'Accept': 'application/json' }, signal: this.controller.signal }))
          if (r && r.ok) {
            const data = await r.json().catch(() => [])
            const isDdGStyle = provider === 'duckduckgo' || (provider === 'custom' && customMode === 'ddg')
            const isGoogleStyle = provider === 'google' || provider === 'brave' || provider === 'searxng' || (provider === 'custom' && customMode !== 'ddg')
            if (isDdGStyle) {
              // DDG-style returns [{ phrase: "..." }, ...]
              if (Array.isArray(data)) searxList = data.map(x => (x && x.phrase) ? x.phrase : '').filter(Boolean)
            } else if (isGoogleStyle) {
              // Google/Brave/SearXNG-style autocompleter returns [q, [s1, s2, ...]] or a simple array
              if (Array.isArray(data)) {
                if (Array.isArray(data[1])) searxList = data[1]
                else searxList = data
              }
            }
          }
        } catch {}
      }

      if (provider === 'searxng' && (!Array.isArray(searxList) || searxList.length === 0)) {
        try {
          const engines = 'duckduckgo,google,startpage,brave'
          const r2 = await this._withTimeout(fetch(`${searxngBase}/search?format=json&engines=${encodeURIComponent(engines)}&q=${encodeURIComponent(query)}`, {
            headers: { 'Accept': 'application/json' },
            signal: this.controller.signal
          }), 150)
          if (r2 && r2.ok) {
            const sdata = await r2.json().catch(() => ({}))
            const results = Array.isArray(sdata.results) ? sdata.results : []
            searxList = results.slice(0, 8).map(r => r.title || r.url || '')
          }
        } catch {}
      }
      if (!searxList) searxList = []
      this._cacheSet(cacheKey, searxList)

      // Build candidates: only two types -> URL and Search (query)
      const normList = (searxList || [])
        .filter(s => s && String(s).toLowerCase().startsWith(q) && String(s).length >= minLen)
      const searchCandidates = normList.map(text => ({ type: 'search', text, source: 'searx' }))
      // Include the typed query itself only when sufficiently long
      if (q && String(query).length >= minLen) searchCandidates.unshift({ type: 'search', text: query, source: 'typed' })
      const recent = this.recentSearches
        .filter(s => String(s || '').toLowerCase().startsWith(q) && String(s || '').length >= minLen)
        .slice(0, 8)
        .map(s => ({ type: 'search', text: s, source: 'recent' }))
      const history = (Array.isArray(this.historyEntries) ? this.historyEntries : [])
        .filter(e => {
          const tl = String(e.title || '').toLowerCase()
          let host = ''
          try { host = new URL(String(e.url||'')).hostname.toLowerCase().replace(/^www\./,'') } catch {}
          const text = String(e.title || e.url || '')
          return (tl.startsWith(q) || (host && host.startsWith(q))) && text.length >= minLen
        })
        .slice(0, 20)
        .map(e => ({ type: 'url', text: e.title || e.url, url: e.url, source: 'history' }))

      // Popular URLs from curated + speed dial
      const popularUrlItems = (urlCandidates || []).map(u => ({ type: 'url', text: u.text || u.url, url: u.url, source: 'popular' }))

      // Collapse duplicates between popular and past searches
      const seenText = new Set()
      const collate = (arr) => {
        const out = []
        for (const it of arr) {
          const key = (it.type === 'url' ? `url:${(it.url||'').toLowerCase()}` : `t:${String(it.text||'').toLowerCase()}`)
          if (seenText.has(key)) continue
          seenText.add(key)
          out.push(it)
        }
        return out
      }
      let candidates = collate([
        ...searchCandidates,
        ...recent,
        ...history,
        ...popularUrlItems
      ])

      // Helper: extract host early; declared before use to avoid TDZ issues
      const getHost = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./,'') } catch { return '' } }

      // Filter to keep items relevant to the typed query (strict prefix + min length)
      candidates = candidates.filter(it => {
        if (!q) return true
        if (it.type === 'url') {
          const host = getHost(it.url)
          const txt = String(it.text || '').toLowerCase()
          const ok = qStarts(host) || qStarts(txt)
          return ok && String(it.text||'').length >= minLen
        }
        return qStarts(it.text) && String(it.text||'').length >= minLen
      })

      // Ranking function (URL closeness > query closeness > popular > history with workspace boost)
      const now = Date.now()
      const urlCloseness = (u, textOpt) => {
        const host = getHost(u)
        const txt = String(textOpt || '').toLowerCase()
        if (!q) return 0
        if (host === q) return 200
        if (host.startsWith(q)) return 150
        if (txt && txt.startsWith(q)) return 110
        // path prefix is weaker but still counts
        try { const path = new URL(u).pathname.toLowerCase(); if (path.startsWith('/' + q) || path.startsWith(q)) return 70 } catch {}
        return 0
      }
      const textCloseness = (t) => {
        const s = String(t||'').toLowerCase()
        if (!q) return 0
        if (s === q) return 130
        if (s.startsWith(q)) return 100
        return 0
      }

      // Workspace mapping & boost for history items
      const workspaceIdFromUrl = (url) => {
        // Hard-coded mapping by host keyword -> workspace name keyword; then resolve to id from provided workspaces via window
        try {
          const host = getHost(url)
          const rules = {
            dev: ['github.com','gitlab.com','npmjs.com','stackOverflow.com','stackoverflow.com','codeberg.org'],
            research: ['wikipedia.org','arxiv.org','openalex.org','scholar.google.com'],
            media: ['youtube.com','youtu.be','vimeo.com','soundcloud.com'],
            social: ['twitter.com','x.com','reddit.com'],
            shopping: ['amazon.com','ebay.com'],
            mail: ['gmail.com','proton.me','outlook.com']
          }
          let targetName = null
          for (const [name, hosts] of Object.entries(rules)) {
            if (hosts.some(h => host === h || host.endsWith(`.${h}`))) { targetName = name; break }
          }
          if (!targetName) return null
          const ws = (window.__APP_WORKSPACES__ || [])
          const match = ws.find(w => String(w.name||'').toLowerCase().includes(targetName))
          return match ? match.id : null
        } catch { return null }
      }

      const scoreOf = (item) => {
        // Type base: URLs outrank searches
        let base = (item.type === 'url') ? 1000 : 900
        // Closeness by type
        if (item.type === 'url') base += urlCloseness(item.url, item.text)
        else base += textCloseness(item.text)
        // Source priority
        if (item.source === 'popular') base += 20
        if (item.source === 'recent') base += 10
        if (item.source === 'history') {
          base -= 20 // history comes after popular unless boosted
          try {
            const wsId = workspaceIdFromUrl(item.url)
            if (wsId && window.__ACTIVE_WORKSPACE_ID__ && wsId === window.__ACTIVE_WORKSPACE_ID__) base += 80
          } catch {}
        }
        // Frequency & recency boost
        const k = (item.type === 'url' ? `url:${item.url}` : `t:${String(item.text||'').toLowerCase()}`)
        const st = this.stats[k]
        if (st) {
          base += Math.log10((st.cnt||0)+1) * 12
          const hrs = (now - (st.last||0)) / 3600000
          base += Math.max(0, 36 - hrs)
        }
        return base
      }

      // Apply blocklist filtering
      const bl = this.getBlocklist()
      const isBlocked = (s) => {
        if (!s) return false
        if (s.type === 'url') {
          try { const host = getHost(s.url); return bl.has(`host:${host}`) } catch { return false }
        }
        return bl.has(`t:${String(s.text||'').trim().toLowerCase()}`)
      }

      const ranked = candidates
        .filter(x => x && String(x.text||'').trim())
        .filter(x => !isBlocked(x))
        .map(x => ({ ...x, _score: scoreOf(x) }))
        .sort((a,b) => b._score - a._score)

      // Build an even mix of URL and search items
      const mixEven = (list, maxCount) => {
        const urls = list.filter(x => x.type === 'url')
        const searches = list.filter(x => x.type === 'search')
        const out = []
        let i = 0, j = 0
        // target roughly equal split
        while (out.length < maxCount && (i < urls.length || j < searches.length)) {
          if (i < urls.length) out.push(urls[i++])
          if (out.length >= maxCount) break
          if (j < searches.length) out.push(searches[j++])
        }
        // If still short, top up from remaining regardless of type
        for (const rest of [...urls.slice(i), ...searches.slice(j)]) {
          if (out.length >= maxCount) break
          out.push(rest)
        }
        return out
      }

      // Cap logic with even mix: exactly 7 in capped mode; otherwise take up to capAt
      const capAt = Number(options.capAt || 12)
      const capped = (options.exactCap === 7)
        ? mixEven(ranked, 7)
        : mixEven(ranked, capAt)

      const ordered = options.mostRelevantAtBottom ? capped.slice().reverse() : capped
      callback(ordered)
    } catch (error) {
      if (error?.name === 'AbortError') return
      // Fallback to recents only
      const limit = Number(options.capAt || 10)
      let recent = this.recentSearches
        .filter(s => String(s || '').toLowerCase().startsWith((query || '').toLowerCase()))
        .slice(0, Math.min(8, limit))
        .map(s => ({ text: s, isRecent: true }))
      let history = (Array.isArray(this.historyEntries) ? this.historyEntries : [])
        .filter(e => String(e.title || '').toLowerCase().startsWith((query || '').toLowerCase()))
        .slice(0, Math.max(0, limit - recent.length))
        .map(e => ({ text: e.title || e.url, isRecent: true }))
      let out = [...recent, ...history].slice(0, limit)
      if (options.mostRelevantAtBottom) out = out.slice().reverse()
      callback(out)
    }
  }

  cancelPendingRequests() {
    clearTimeout(this.debounceTimeout)
    if (this.controller) this.controller.abort()
  }
}

const SearchBox = forwardRef(({
  settings,
  workspaces = [],
  activeWorkspaceId,
  layoutMode: layoutModeProp = 'modern',
  urlWorkspaceId,
  searchBarBlurPx: searchBarBlurPxOverride,
  suggestionsBlurPx: suggestionsBlurPxOverride,
}, ref) => {
  const [query, setQuery] = useState('')
  const [engine, setEngine] = useState(() => {
    try { return localStorage.getItem('searchEngine') || (settings?.search?.engine || 'google') } catch { return settings?.search?.engine || 'google' }
  })
  const suggestProvider = (() => {
    try { return localStorage.getItem('suggestProvider') || (settings?.search?.suggestProvider || 'duckduckgo') } catch { return settings?.search?.suggestProvider || 'duckduckgo' }
  })()
  const [inlineSearchMode, setInlineSearchMode] = useState(false)
  const [inlineImageSearchEnabled, setInlineImageSearchEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem('inlineImageSearchEnabled')
      return stored === 'true'
    } catch {
      return false
    }
  })
  const [attachedImage, setAttachedImage] = useState(null)
  
  // Determine what icon to show for inline mode button
  const inlineModeIconState = useMemo(() => {
    // If image is attached, show image icon (lit if inline image search enabled, unlit otherwise)
    if (attachedImage?.file) {
      return {
        icon: ImageIcon,
        lit: inlineImageSearchEnabled,
        isImage: true
      }
    }
    // If inline image search is enabled (from right-click on globe), show image icon
    if (inlineImageSearchEnabled && inlineSearchMode) {
      return {
        icon: ImageIcon,
        lit: true,
        isImage: true
      }
    }
    // Otherwise show globe icon
    return {
      icon: Globe,
      lit: false,
      isImage: false
    }
  }, [attachedImage?.file, inlineImageSearchEnabled, inlineSearchMode])
  const [inputFocused, setInputFocused] = useState(false)
  const [isSearchBarHovered, setIsSearchBarHovered] = useState(false)
  const [inputGlowPhase, setInputGlowPhase] = useState('idle') // 'idle' | 'focus' | 'typing'
  const [directionalFocusReady, setDirectionalFocusReady] = useState(false)
  const [directionalBlend, setDirectionalBlend] = useState(0)
  const typingPhaseTimeoutRef = useRef(null)
  const directionalFocusTimeoutRef = useRef(null)
  const directionalBlendRef = useRef(0)
  const directionalBlendTargetRef = useRef(0)
  const directionalBlendFrameRef = useRef(null)
  const lastPublishedDirectionalRef = useRef(0)
  const lastGlowRef = useRef(null)
  const inputRef = useRef(null)
  const allowSpeedDialGlow = !!(settings?.speedDial?.glowEnabled)
  const allowTransientGlow = allowSpeedDialGlow && !!((settings?.appearance?.searchBar||{}).glowTransient)
  const allowFocusGlow = allowSpeedDialGlow && !!((settings?.appearance?.searchBar||{}).refocusByUrl)

  // Search bar appearance config (moved up to avoid TDZ in downstream hooks)
  const sbCfg = (settings?.appearance?.searchBar) || {}
  const sbUseDefaultFont = !!sbCfg.useDefaultFont
  const sbUseDefaultColor = !!sbCfg.useDefaultColor
  const sbDarkerPlaceholder = !!sbCfg.darkerPlaceholder
  const sbBlurPx = (() => {
    if (Number.isFinite(Number(searchBarBlurPxOverride))) {
      return Math.max(0, Number(searchBarBlurPxOverride))
    }
    return resolveSearchBarBlurPx(sbCfg)
  })()
  const suggBlurPx = (() => {
    if (Number.isFinite(Number(suggestionsBlurPxOverride))) {
      return Math.max(0, Number(suggestionsBlurPxOverride))
    }
    if (settings?.appearance?.suggestionsMatchBarBlur) {
      return sbBlurPx
    }
    const fallback = Number(settings?.appearance?.suggestionsBlurPx ?? 10)
    return Math.max(0, Number.isFinite(fallback) ? fallback : 10)
  })()
  const suggStyleCfg = (settings?.appearance?.suggestions) || {}
  const suggMatchBarBlur = !!settings?.appearance?.suggestionsMatchBarBlur
  const suggRemoveBg = !!suggStyleCfg.removeBackground
  const suggRemoveOutline = !!suggStyleCfg.removeOutline
  const suggUseShadows = suggStyleCfg.useShadows !== false
  const suggUseDefaultFont = !!sbCfg.useDefaultFont
  const suggUseDefaultColor = !!sbCfg.useDefaultColor
  const allowedRefocusModes = ['letters', 'pulse', 'steady']
  const refocusMode = (typeof sbCfg.refocusMode === 'string' && allowedRefocusModes.includes(sbCfg.refocusMode)) ? sbCfg.refocusMode : 'letters'
  const trimmedQuery = String(query || '').trim()
  const normalizeSearxngBase = (raw, fallback) => {
    const fb = (fallback == null || String(fallback).trim() === '') ? '/searxng' : String(fallback)
    const v = (raw == null || String(raw).trim() === '') ? fb : String(raw)
    return v.replace(/\/+$/, '')
  }
  const searxngBaseGlobal = normalizeSearxngBase(settings?.search?.searxngBaseUrl, '/searxng')
  const searxngBaseSuggest = normalizeSearxngBase(settings?.search?.suggestSearxngBaseUrl, searxngBaseGlobal)
  const searxngBaseInline = normalizeSearxngBase(settings?.search?.inlineSearxngBaseUrl, searxngBaseGlobal)
  const searxngBaseAiWeb = normalizeSearxngBase(settings?.ai?.webSearxngBaseUrl, searxngBaseGlobal)
  const suggestCustomBaseUrl = String(settings?.search?.suggestCustomBaseUrl || '').trim()
  const suggestCustomMode = String(settings?.search?.suggestCustomMode || 'ddg')
  const inlineCustomBaseUrl = String(settings?.search?.inlineCustomBaseUrl || '').trim()

  // Transient glow color based on workspace URL changes
  const [searchGlow, setSearchGlow] = useState(null)
  const PULSE_MS = 2940

  // Ensure focus glow is transient (<= 5s)
  useEffect(() => {
    if (!inputFocused) {
      if (directionalFocusTimeoutRef.current) {
        clearTimeout(directionalFocusTimeoutRef.current)
        directionalFocusTimeoutRef.current = null
      }
      setDirectionalFocusReady(false)
      return
    }
    const t = setTimeout(() => {
      if (typeof document !== 'undefined' && document.activeElement !== inputRef.current) {
        setInputFocused(false)
      }
    }, 5000)
    return () => clearTimeout(t)
  }, [inputFocused, inputRef])

  useEffect(() => {
    if (inputFocused) {
      setInputGlowPhase(prev => (prev === 'idle' ? 'focus' : prev))
      return
    }
    if (typingPhaseTimeoutRef.current) {
      clearTimeout(typingPhaseTimeoutRef.current)
      typingPhaseTimeoutRef.current = null
    }
    setInputGlowPhase('idle')
  }, [inputFocused])

  useEffect(() => {
    return () => {
      if (typingPhaseTimeoutRef.current) {
        clearTimeout(typingPhaseTimeoutRef.current)
        typingPhaseTimeoutRef.current = null
      }
      if (directionalFocusTimeoutRef.current) {
        clearTimeout(directionalFocusTimeoutRef.current)
        directionalFocusTimeoutRef.current = null
      }
      if (directionalBlendFrameRef.current) {
        cancelAnimationFrame(directionalBlendFrameRef.current)
        directionalBlendFrameRef.current = null
      }
    }
  }, [])

  // Clear any residual search glow when glow is disabled
  useEffect(() => {
    if (!allowSpeedDialGlow || (!allowTransientGlow && !allowFocusGlow)) {
      setSearchGlow(null)
    }
  }, [allowSpeedDialGlow, allowTransientGlow, allowFocusGlow])

  // Global Tab-to-focus behavior: pressing Tab focuses the search input if not already focused
  useEffect(() => {
    const onKeyDownFocusSearch = (e) => {
      try {
        if (e.key !== 'Tab') return
        const t = e.target
        const tag = String(t?.tagName || '').toUpperCase()
        const isEditable = (
          t?.isContentEditable === true ||
          tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        )
        if (isEditable) return
        const el = inputRef.current
        if (el && document.activeElement !== el) {
          e.preventDefault()
          el.focus()
          // Place caret at end if possible
          try {
            const v = String(el.value || '')
            if (typeof el.setSelectionRange === 'function') el.setSelectionRange(v.length, v.length)
          } catch {}
        }
      } catch {}
    }
    document.addEventListener('keydown', onKeyDownFocusSearch)
    return () => document.removeEventListener('keydown', onKeyDownFocusSearch)
  }, [inputRef])

  const [settingsPanelOpen, setSettingsPanelOpen] = useState(() => {
    if (typeof document === 'undefined') return false
    try { return !!document.body?.classList?.contains('settings-panel-open') } catch { return false }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handler = (event) => {
      setSettingsPanelOpen(!!(event?.detail))
    }
    window.addEventListener('app-settings-open', handler)
    if (typeof document !== 'undefined') {
      try {
        const active = !!document.body?.classList?.contains('settings-panel-open')
        setSettingsPanelOpen(prev => (prev === active ? prev : active))
      } catch {}
    }
    return () => window.removeEventListener('app-settings-open', handler)
  }, [])

  // (restored) no special sizing constraints for AI chat overlays
  const [isAIMode, setIsAIMode] = useState(false)
  const [aiWeb, setAiWeb] = useState(() => !!(settings?.ai?.webSearch))
  const [aiResultsCount, setAiResultsCount] = useState(() => Number(settings?.ai?.webResultsCount || 5))
  const lastWebItemsRef = useRef([])
  const previewsAppendedRef = useRef(false)
  const sourcesAppendedRef = useRef(false)
  const [openSources, setOpenSources] = useState({}) // id -> boolean
  const [openPreviews, setOpenPreviews] = useState({}) // id -> boolean
  const [aiIncludeMemory, setAiIncludeMemory] = useState(false)
  const storedChatSessionsSnapshot = loadStoredChatSessions()
  const storedActiveChatId = (() => {
    if (typeof window === 'undefined') return null
    try { return window.localStorage.getItem(CHAT_ACTIVE_KEY) || null } catch { return null }
  })()
  const initialChatSession = (() => {
    if (!storedChatSessionsSnapshot.length) return null
    if (storedActiveChatId) {
      const match = storedChatSessionsSnapshot.find(s => s.id === storedActiveChatId)
      if (match) return match
    }
    return storedChatSessionsSnapshot[0]
  })()
  const [chatSessions, setChatSessions] = useState(storedChatSessionsSnapshot)
  const [activeChatId, setActiveChatId] = useState(() => initialChatSession?.id || null)
  const [aiMessages, setAiMessages] = useState(() => ensureArray(initialChatSession?.messages)) // {role:'user'|'assistant', content, id}
  const [aiStreaming, setAiStreaming] = useState(false)
  const aiAbortRef = useRef(null)
  const stopAIStream = useCallback(() => {
    try { aiAbortRef.current?.abort() } catch {}
    setAiStreaming(false)
    aiAbortRef.current = null
  }, [])
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [imageResults, setImageResults] = useState([])
  const [inlineContentType, setInlineContentType] = useState('web') // 'web' | 'images' | 'article'
  const [articleData, setArticleData] = useState({ title: '', url: '', markdown: '' })
  const [linkMenu, setLinkMenu] = useState({ open: false, x: 0, y: 0, url: '', title: '' })
  const linkMenuRef = useRef(null)
  const [isPinned, setIsPinned] = useState(false)
  const [showInlineResults, setShowInlineResults] = useState(false)
  const [pinnedContainer, setPinnedContainer] = useState(null)
  const [searchContainerEl, setSearchContainerEl] = useState(null)
  const [aiChatHostRect, setAiChatHostRect] = useState(null)
  const [middleRect, setMiddleRect] = useState(null) // { left, right, width, center }
  const [currentSlugPath, setCurrentSlugPath] = useState(() => {
    if (typeof window === 'undefined') return '/'
    try {
      const raw = window.location?.pathname || '/'
      const trimmed = raw.replace(/\/+$/, '')
      return trimmed === '' ? '/' : trimmed
    } catch { return '/' }
  })

  const normalizeSlugPath = useCallback((value) => {
    try {
      const raw = String(value || '/')
      const trimmed = raw.replace(/\/+$/, '')
      return trimmed === '' ? '/' : trimmed
    } catch { return '/' }
  }, [])

  const updateSlugPathFromWindow = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      setCurrentSlugPath(prev => {
        const normalized = normalizeSlugPath(window.location?.pathname || '/')
        return prev === normalized ? prev : normalized
      })
    } catch {}
  }, [normalizeSlugPath])

  const focusSlugColor = useMemo(() => {
    if (!allowFocusGlow) return null
    try {
      const slugifyLocal = (name) => {
        try {
          return String(name || '')
            .trim()
            .toLowerCase()
            .replace(/[_\s]+/g, '-')
            .replace(/[^a-z0-9\-]/g, '')
            .replace(/\-+/g, '-')
            .replace(/^\-+|\-+$/g, '') || 'workspace'
        } catch { return 'workspace' }
      }
      const match = workspaces.find(w => `/${slugifyLocal(w.name||'')}` === currentSlugPath) || null
      const map = settings?.speedDial?.workspaceGlowColors || {}
      return match ? (map[match.id] || settings?.speedDial?.glowColor || '#00ffff66') : null
    } catch { return null }
  }, [allowFocusGlow, workspaces, settings?.speedDial?.workspaceGlowColors, settings?.speedDial?.glowColor, currentSlugPath])

  const focusNonSlugColor = useMemo(() => {
    if (!allowFocusGlow) return null
    try {
      const wsId = activeWorkspaceId
      const anchoredId = settings?.speedDial?.anchoredWorkspaceId || null
      const useFallback = !wsId || (anchoredId && wsId === anchoredId)
      const map = settings?.speedDial?.workspaceGlowColors || {}
      return (!useFallback && map[wsId]) || settings?.speedDial?.glowColor || '#00ffff66'
    } catch { return null }
  }, [allowFocusGlow, activeWorkspaceId, settings?.speedDial?.workspaceGlowColors, settings?.speedDial?.glowColor, settings?.speedDial?.anchoredWorkspaceId])

  const slugModeEnabled = !!(settings?.general?.autoUrlDoubleClick)
  const focusCandidateColor = slugModeEnabled ? focusSlugColor : focusNonSlugColor
  const inputGlowActive = inputGlowPhase !== 'idle'
  const autoButtonGlow = !!settings?.appearance?.searchBar?.inlineAiButtonGlow
  const hoverGlowEnabled = allowFocusGlow && !!sbCfg.hoverGlow

  useEffect(() => {
    if (!autoButtonGlow) return
    if (isAIMode || inlineSearchMode) {
      setInputGlowPhase(prev => (prev === 'idle' ? 'focus' : prev))
      return
    }
    const hasQuery = String(query || '').trim().length > 0
    if (!hasQuery && !inputFocused) {
      setInputGlowPhase(prev => (prev === 'focus' ? 'idle' : prev))
    }
  }, [autoButtonGlow, isAIMode, inlineSearchMode, inputFocused, query])

  useEffect(() => {
    if (!hoverGlowEnabled && isSearchBarHovered) {
      setIsSearchBarHovered(false)
    }
  }, [hoverGlowEnabled, isSearchBarHovered])

  const activeGlow = useMemo(() => {
    if (isAIMode && inputGlowActive) {
      return { type: 'ai', color: 'rgb(59, 130, 246)' }
    }
    if (inlineSearchMode && !isAIMode && inputGlowActive) {
      return { type: 'inline', color: 'rgb(34, 211, 238)' }
    }
    if (!allowSpeedDialGlow) {
      if (allowTransientGlow && searchGlow) {
        return { type: 'transient', color: searchGlow }
      }
      return null
    }
    const hoverGlowActive = hoverGlowEnabled && isSearchBarHovered
    if ((inputGlowActive || hoverGlowActive) && allowFocusGlow && focusCandidateColor) {
      return { type: 'refocus', color: focusCandidateColor }
    }
    if (allowTransientGlow && searchGlow) {
      return { type: 'transient', color: searchGlow }
    }
    return null
  }, [isAIMode, inlineSearchMode, allowSpeedDialGlow, allowFocusGlow, focusCandidateColor, allowTransientGlow, searchGlow, inputGlowActive, hoverGlowEnabled, isSearchBarHovered])
  useEffect(() => {
    const glow = activeGlow || lastGlowRef.current
    let targetDirectionalBlend = 0
    if (glow) {
      const type = glow.type
      if (type !== 'transient') {
        const isEligibleType = (type === 'ai' || type === 'inline' || type === 'refocus')
        if (isEligibleType && (type !== 'refocus' || allowFocusGlow)) {
          const hasLetters = trimmedQuery.length > 0
          if (refocusMode === 'steady') {
            targetDirectionalBlend = 0
          } else if (refocusMode === 'pulse') {
            targetDirectionalBlend = (directionalFocusReady || hasLetters) ? 1 : 0
          } else {
            // 'letters' mode – highlight based on query length
            targetDirectionalBlend = hasLetters ? 1 : 0
          }
        }
      }
    }
    directionalBlendTargetRef.current = targetDirectionalBlend

    const publish = (value, force = false) => {
      directionalBlendRef.current = value
      if (force || Math.abs(lastPublishedDirectionalRef.current - value) > 0.0015) {
        lastPublishedDirectionalRef.current = value
        setDirectionalBlend(value)
      }
    }

    if (directionalBlendFrameRef.current) {
      cancelAnimationFrame(directionalBlendFrameRef.current)
      directionalBlendFrameRef.current = null
    }

    if (Math.abs(directionalBlendRef.current - directionalBlendTargetRef.current) < 0.002) {
      publish(directionalBlendTargetRef.current, true)
      return
    }

    const animate = () => {
      const current = directionalBlendRef.current
      const target = directionalBlendTargetRef.current
      const increasing = current < target
      const rate = increasing ? 0.18 : 0.24
      const next = current + (target - current) * rate
      const epsilon = increasing ? 0.004 : 0.003
      if (Math.abs(next - target) < epsilon) {
        publish(target, true)
        directionalBlendFrameRef.current = null
        return
      }
      publish(next)
      directionalBlendFrameRef.current = requestAnimationFrame(animate)
    }

    directionalBlendFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (directionalBlendFrameRef.current) {
        cancelAnimationFrame(directionalBlendFrameRef.current)
        directionalBlendFrameRef.current = null
      }
    }
  }, [activeGlow, trimmedQuery, refocusMode, directionalFocusReady, allowFocusGlow])
  
  // Chat bubble blur strength (0 = off, 30 = strong)
  const chatBubbleBlurPx = Math.max(0, Math.min(30, Number(settings?.appearance?.chatBubbleBlurPx ?? 12)))
  
  // Measure actual middle column bounds between the left and right columns.
  useLayoutEffect(() => {
    const measure = () => {
      try {
        const lc = document.getElementById('app-left-column')
        const rc = document.getElementById('app-right-column')
        if (!lc || !rc) { setMiddleRect(null); return }
        const lr = lc.getBoundingClientRect()
        const rr = rc.getBoundingClientRect()
        const left = Math.round(lr.right)
        const right = Math.round(rr.left)
        const width = Math.max(100, right - left)
        const center = Math.round((left + right) / 2)
        setMiddleRect(prev => {
          if (prev && prev.left === left && prev.right === right) return prev
          return { left, right, width, center }
        })
      } catch { setMiddleRect(null) }
    }
    measure()
    const onEvt = () => requestAnimationFrame(measure)
    window.addEventListener('resize', onEvt)
    window.addEventListener('scroll', onEvt, true)
    let ro
    try {
      ro = new ResizeObserver(onEvt)
      const lc = document.getElementById('app-left-column')
      const rc = document.getElementById('app-right-column')
      if (lc) ro.observe(lc)
      if (rc) ro.observe(rc)
    } catch {}
    return () => {
      window.removeEventListener('resize', onEvt)
      window.removeEventListener('scroll', onEvt, true)
      try { ro && ro.disconnect() } catch {}
    }
  }, [])

  // Voice capture state
  const [isRecording, setIsRecording] = useState(false)
  const [fullVoiceMode, setFullVoiceMode] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const recorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const rafRef = useRef(null)
  const waveformCanvasRef = useRef(null)
  const recordChunksRef = useRef([])
  const prevQueryRef = useRef('')
  const autoSearchAfterTranscriptionRef = useRef(false)
  // Voice-to-voice: TTS playback handle + latest assistant text for streaming
  const ttsAudioRef = useRef(null)
  const lastAssistantTextRef = useRef('')
  
  // Inline search provider (SearXNG or Firecrawl)
  const inlineProvider = (() => {
    try { return localStorage.getItem('inlineProvider') || (settings?.search?.inlineProvider || 'searxng') } catch { return settings?.search?.inlineProvider || 'searxng' }
  })()
  const [inlineEngineLabel, setInlineEngineLabel] = useState(() => (inlineProvider === 'firecrawl' ? 'Firecrawl' : 'SearXNG'))
  // Search bar appearance (cont.)
  const sbWidthScale = (() => {
    const v = Number(sbCfg.widthScale ?? 1)
    return (Number.isFinite(v) ? Math.max(0.5, Math.min(1, v)) : 1)
  })()
  const sbWidthPercent = `${Math.round(sbWidthScale * 100)}%`
  const sbPositionMode = (() => {
    const raw = String(sbCfg.positionMode || '').toLowerCase()
    if (['bottom', 'center-unfixed', 'center-fixed', 'top-fixed'].includes(raw)) return raw
    if (sbCfg.centered) return sbCfg.trulyFixed ? 'center-fixed' : 'center-unfixed'
    return 'bottom'
  })()
  const isClassicLayout = String(layoutModeProp || '').toLowerCase() === 'classic'
  const isCenterMode = sbPositionMode === 'center-unfixed' || sbPositionMode === 'center-fixed'
  const isCenterFixed = sbPositionMode === 'center-fixed'
  const isTopFixed = sbPositionMode === 'top-fixed'
  const hasUserInput = trimmedQuery.length > 0
  const centerActive = isCenterMode && !isPinned && !isAIMode && (isCenterFixed || !hasUserInput)
  const topActive = isTopFixed && !isPinned && !isAIMode
  const floatingMode = centerActive ? 'center' : (topActive ? 'top' : null)
  const suggestionsDropUp = !((centerActive && isCenterFixed) || topActive)
  const [floatingOffset, setFloatingOffset] = useState(0)
  const pinnedContainerWidth = isClassicLayout
    ? 'min(clamp(760px, 80vw, 1100px), var(--center-column-max-width, 1200px))'
    : 'min(clamp(680px, 70vw, 960px), var(--center-column-width, 100vw))'
  const pinnedContainerMaxWidth = isClassicLayout
    ? 'min(1100px, var(--center-column-max-width, 1200px))'
    : 'var(--center-column-max-width, 1200px)'

  useEffect(() => {
    if (directionalFocusTimeoutRef.current) {
      clearTimeout(directionalFocusTimeoutRef.current)
      directionalFocusTimeoutRef.current = null
    }
    setDirectionalFocusReady(false)
  }, [refocusMode])

  const registerSearchContainer = useCallback((node) => {
    setSearchContainerEl(node || null)
  }, [])

  const handleSearchContainerMouseEnter = useCallback(() => {
    if (!hoverGlowEnabled) return
    setIsSearchBarHovered(true)
  }, [hoverGlowEnabled])

  const handleSearchContainerMouseLeave = useCallback(() => {
    if (!hoverGlowEnabled) return
    setIsSearchBarHovered(false)
  }, [hoverGlowEnabled])

  const recalcFloatingOffset = useCallback(() => {
    if (!floatingMode) return
    if (!searchContainerEl) return
    if (typeof window === 'undefined') return
    try {
      const rect = searchContainerEl.getBoundingClientRect()
      const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
      if (!viewportHeight) return
      let translateY = 0
      try {
        const style = window.getComputedStyle(searchContainerEl)
        const transform = style.transform || style.webkitTransform || style.mozTransform || 'none'
        if (transform && transform !== 'none') {
          const match = transform.match(/matrix(3d)?\(([^)]+)\)/)
          if (match) {
            const values = match[2].split(',').map(v => parseFloat(v.trim()))
            if (match[1] === '3d') {
              if (values.length >= 16 && Number.isFinite(values[13])) translateY = values[13]
            } else if (values.length >= 6 && Number.isFinite(values[5])) {
              translateY = values[5]
            }
          }
        }
      } catch {}
      const baseCenterY = (rect.top - translateY) + (rect.height / 2)
      const searchHalfHeight = rect.height / 2
      let desiredCenterY
      if (floatingMode === 'center') {
        if (isClassicLayout) {
          const anchorRect = document.getElementById('classic-speed-dial-body')?.getBoundingClientRect()
          if (anchorRect) {
            desiredCenterY = anchorRect.bottom + 32 + searchHalfHeight
          }
        }
        if (typeof desiredCenterY !== 'number') {
          desiredCenterY = viewportHeight / 2
        }
      } else if (floatingMode === 'top') {
        if (isClassicLayout) {
          const anchorRect = document.getElementById('classic-speed-dial-body')?.getBoundingClientRect()
          if (anchorRect) {
            desiredCenterY = Math.max(searchHalfHeight + 24, anchorRect.top - 32 - searchHalfHeight)
          }
        }
        if (typeof desiredCenterY !== 'number') {
          desiredCenterY = Math.max(72, viewportHeight * 0.12)
        }
      } else {
        return
      }
      const offset = Math.round(desiredCenterY - baseCenterY)
      setFloatingOffset(prev => (Math.abs(prev - offset) > 0.5 ? offset : prev))
    } catch {}
  }, [floatingMode, searchContainerEl, isClassicLayout])

  useEffect(() => {
    if (!floatingMode) {
      setFloatingOffset(0)
    }
  }, [floatingMode])

  useLayoutEffect(() => {
    if (!floatingMode) return
    if (!searchContainerEl) return
    if (typeof window === 'undefined') return
    recalcFloatingOffset()
    window.addEventListener('resize', recalcFloatingOffset)
    window.addEventListener('orientationchange', recalcFloatingOffset)
    let ro
    try {
      if ('ResizeObserver' in window && searchContainerEl) {
        ro = new ResizeObserver(() => recalcFloatingOffset())
        ro.observe(searchContainerEl)
      }
    } catch {}
    return () => {
      window.removeEventListener('resize', recalcFloatingOffset)
      window.removeEventListener('orientationchange', recalcFloatingOffset)
      try { ro && ro.disconnect() } catch {}
    }
  }, [floatingMode, recalcFloatingOffset, searchContainerEl])

  const [glowStrength, setGlowStrength] = useState(0)
  const glowStrengthRef = useRef(0)
  const lastPublishedGlowRef = useRef(0)
  const glowTargetRef = useRef(0)
  const glowAnimationFrameRef = useRef(null)
  const perIntensity = Number(settings?.speedDial?.glowIntensity ?? 1)
  const sysCap = Number(settings?.appearance?.glowMaxIntensity ?? 1)
  const glowIntensitySetting = Math.max(0, Math.min(2.5, Math.min(perIntensity, sysCap)))
  const activeGlowKey = activeGlow ? `${activeGlow.type}:${activeGlow.color}` : 'none'
  const targetStrength = activeGlow ? ((activeGlow.type === 'refocus' || activeGlow.type === 'transient') ? glowIntensitySetting : 1) : 0

  useEffect(() => {
    if (activeGlow) {
      lastGlowRef.current = activeGlow
    }
  }, [activeGlow])

  useEffect(() => {
    glowTargetRef.current = targetStrength
    const publish = (value, force = false) => {
      glowStrengthRef.current = value
      if (force || Math.abs(lastPublishedGlowRef.current - value) > 0.001) {
        lastPublishedGlowRef.current = value
        setGlowStrength(value)
      } else {
        lastPublishedGlowRef.current = value
      }
    }

    if (Math.abs(glowStrengthRef.current - targetStrength) < 0.002 && glowAnimationFrameRef.current === null) {
      publish(targetStrength, true)
      return
    }

    const animate = () => {
      const current = glowStrengthRef.current
      const target = glowTargetRef.current
      const dimming = current > target
      const lastType = lastGlowRef.current?.type
      const rate = dimming
        ? (lastType === 'transient' ? 0.14 : 0.32)
        : 0.14
      const next = current + (target - current) * rate
      const epsilon = dimming ? 0.005 : 0.002
      if (Math.abs(next - target) < epsilon) {
        publish(target, true)
        glowAnimationFrameRef.current = null
        return
      }
      publish(next)
      glowAnimationFrameRef.current = requestAnimationFrame(animate)
    }

    cancelAnimationFrame(glowAnimationFrameRef.current)
    glowAnimationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (glowAnimationFrameRef.current) {
        cancelAnimationFrame(glowAnimationFrameRef.current)
        glowAnimationFrameRef.current = null
      }
    }
  }, [targetStrength, activeGlowKey])

  const directionalOrientation = useMemo(() => {
    if (typeof window === 'undefined') return { x: -1, y: 1 }
    const el = searchContainerEl
    if (!el) return { x: -1, y: 1 }
    try {
      const rect = el.getBoundingClientRect()
      const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0
      const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      let horizontal = 1
      if (viewportWidth) {
        if (centerX > viewportWidth * 0.56) horizontal = -1
        else if (centerX < viewportWidth * 0.34) horizontal = 1
        else horizontal = 1
        if (Math.abs(centerX - (viewportWidth / 2)) < viewportWidth * 0.08) {
          horizontal = 1
        }
      }
      let vertical = 1
      if (viewportHeight) {
        const topThreshold = viewportHeight * 0.38
        const bottomThreshold = viewportHeight * 0.62
        if (centerY > topThreshold && centerY < bottomThreshold) {
          vertical = -1
        } else {
          vertical = 1
        }
      }
      return { x: horizontal, y: vertical }
    } catch {
      return { x: -1, y: 1 }
    }
  }, [searchContainerEl, floatingMode, isPinned, floatingOffset])

  const highlightShadows = useMemo(() => {
    const strength = Math.max(0, glowStrength)
    if (strength <= 0.001) return []
    const persistedGlow = activeGlow || (strength > 0.002 ? lastGlowRef.current : null)
    if (!persistedGlow) return []
    const clamp01 = Math.min(1, strength)
    const profile = inputGlowPhase === 'typing' ? 'typing' : 'focus'
    const rawX = Math.max(-1, Math.min(1, Number(directionalOrientation.x ?? -1)))
    const rawY = Math.max(-1, Math.min(1, Number(directionalOrientation.y ?? 1)))
    const norm = Math.hypot(rawX, rawY) || 1
    const orientX = rawX / norm
    const orientY = rawY / norm
    const color = (() => {
      if (persistedGlow.type === 'ai') return 'rgba(59, 130, 246, 1)'
      if (persistedGlow.type === 'inline') return 'rgba(34, 211, 238, 1)'
      return persistedGlow.color || '#00ffff66'
    })()

    const buildSymmetricSet = (variant, weight = 1) => {
      const w = Math.max(0, Math.min(1, weight))
      if (w <= 0.001) return []
      const isTyping = variant === 'typing'
      const isPulse = variant === 'transient'
      const mainAlpha = (isTyping ? 0.58 : isPulse ? 0.5 : 0.46) * clamp01 * w
      const softAlpha = (isTyping ? 0.3 : isPulse ? 0.26 : 0.22) * clamp01 * w
      const haloAlpha = 0.14 * clamp01 * w
      const blurMain = Math.round((isTyping ? 20 : isPulse ? 18 : 16) + 8 * clamp01)
      const spreadMain = Math.round((isTyping ? 6 : isPulse ? 5 : 4) + 3 * clamp01)
      const blurSoft = Math.round((isTyping ? 28 : isPulse ? 26 : 24) + 9 * clamp01)
      const spreadSoft = Math.round((isTyping ? 8 : isPulse ? 7 : 6) + 4 * clamp01)
      const blurHalo = Math.round((isTyping ? 15 : isPulse ? 13 : 12) + 5 * clamp01)
      const spreadHalo = Math.max(1, Math.round((isTyping ? 3 : 2) + 2 * clamp01))
      return [
        `0 ${isTyping ? 1 : 0}px ${blurMain}px ${spreadMain}px ${applyAlphaToColor(color, mainAlpha)}`,
        `0 ${isTyping ? 2 : 1}px ${blurSoft}px ${spreadSoft}px ${applyAlphaToColor(color, softAlpha)}`,
        `0 0 ${blurHalo}px ${spreadHalo}px ${applyAlphaToColor(color, haloAlpha)}`
      ]
    }

    const buildDirectionalSet = (variant, weight = 1) => {
      const w = Math.max(0, Math.min(1, weight))
      if (w <= 0.001) return []
      const isTyping = variant === 'typing'
      const basePrimary = 8 + 4 * clamp01
      const typingPrimary = 10 + 6 * clamp01
      const downBias = orientY >= 0 ? 1.25 : 1
      const primaryOffsetX = Math.round(orientX * (isTyping ? typingPrimary : basePrimary) * downBias)
      const primaryOffsetY = Math.round(orientY * (isTyping ? (typingPrimary + 3) : (basePrimary + 2)) * downBias)
      const baseSecondary = 12 + 5 * clamp01
      const typingSecondary = 14 + 6 * clamp01
      const secondaryOffsetX = Math.round(orientX * (isTyping ? typingSecondary * 0.55 : baseSecondary * 0.5) * downBias)
      const secondaryOffsetY = Math.round(orientY * (isTyping ? typingSecondary + 3 : baseSecondary + 2) * downBias)
      const baseCounter = 5 + 3 * clamp01
      const typingCounter = 6 + 4 * clamp01
      const counterScale = orientY >= 0 ? 0.35 : 1
      const counterOffsetX = Math.round(-orientX * (isTyping ? typingCounter : baseCounter) * counterScale)
      const counterOffsetY = Math.round(-orientY * (isTyping ? typingCounter + 2 : baseCounter + 1) * counterScale)
      const mainBlur = Math.round((isTyping ? 28 : 24) + 9 * clamp01)
      const mainSpread = Math.round(3 + 3 * clamp01)
      const trailBlur = Math.round((isTyping ? 34 : 30) + 11 * clamp01)
      const trailSpread = Math.round(4 + 4 * clamp01)
      const rimBlur = Math.round((isTyping ? 20 : 18) + 7 * clamp01)
      const rimSpread = Math.max(1, Math.round(2 + 2 * clamp01))
      const mainColor = applyAlphaToColor(color, (isTyping ? 0.56 : 0.5) * clamp01 * w)
      const trailColor = applyAlphaToColor(color, (isTyping ? 0.32 : 0.26) * clamp01 * w)
      const rimColor = applyAlphaToColor(color, (orientY >= 0 ? 0.1 : 0.14) * clamp01 * w)
      return [
        `${primaryOffsetX}px ${primaryOffsetY}px ${mainBlur}px ${mainSpread}px ${mainColor}`,
        `${secondaryOffsetX}px ${secondaryOffsetY}px ${trailBlur}px ${trailSpread}px ${trailColor}`,
        `${counterOffsetX}px ${counterOffsetY}px ${rimBlur}px ${rimSpread}px ${rimColor}`
      ]
    }

    if (persistedGlow.type === 'transient') {
      return buildSymmetricSet('transient', 1)
    }

    let directionalWeight = Math.max(0, Math.min(1, directionalBlend))
    let symmetricWeight = Math.max(0, 1 - directionalWeight * 0.92)
    const totalWeight = directionalWeight + symmetricWeight
    if (totalWeight > 1) {
      directionalWeight /= totalWeight
      symmetricWeight /= totalWeight
    }

    const shadows = []
    if (symmetricWeight > 0.001) {
      shadows.push(...buildSymmetricSet(profile, symmetricWeight))
    }
    if (directionalWeight > 0.001) {
      shadows.push(...buildDirectionalSet(profile, directionalWeight))
    }
    return shadows
  }, [activeGlow, glowStrength, inputGlowPhase, directionalOrientation, directionalBlend])
  
  // Search suggestions state
  const [suggestions, setSuggestions] = useState([])
  const [ghostSuggestion, setGhostSuggestion] = useState(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1)

  // Lightweight on-demand image labeling via MobileNet (CDN)
  const mobilenetModelRef = useRef(null)
  const loadScript = (src) => new Promise((resolve, reject) => {
    try {
      const s = document.createElement('script')
      s.src = src
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error(`Failed to load ${src}`))
      document.head.appendChild(s)
    } catch (e) { reject(e) }
  })
  const ensureMobilenet = async () => {
    if (mobilenetModelRef.current) return mobilenetModelRef.current
    if (!(window.tf && window.mobilenet)) {
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js')
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.0/dist/mobilenet.min.js')
    }
    const model = await window.mobilenet.load()
    mobilenetModelRef.current = model
    return model
  }
  const readFileToDataURL = (file) => new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    } catch (e) { reject(e) }
  })
  const classifyImageLabels = async (file) => {
    try {
      const model = await ensureMobilenet()
      const dataUrl = await readFileToDataURL(file)
      const img = new Image()
      const labels = await new Promise((resolve) => {
        img.onload = async () => {
          try {
            const preds = await model.classify(img)
            resolve(Array.isArray(preds) ? preds.map(p => String(p.className || '').trim()).filter(Boolean) : [])
          } catch { resolve([]) }
        }
        img.src = dataUrl
      })
      return labels
    } catch { return [] }
  }
  const fetchSearxngImages = async (searchQuery) => {
    const params = new URLSearchParams({ q: searchQuery, format: 'json', categories: 'images' })
    const resp = await fetch(`${searxngBaseInline}/search?${params.toString()}`, { method: 'GET', headers: { 'Accept': 'application/json' } })
    if (!resp.ok) throw new Error(`SearXNG images error: ${resp.status}`)
    const data = await resp.json().catch(() => ({}))
    const results = Array.isArray(data?.results) ? data.results : []
    const toImg = (r) => {
      const link = r?.url || r?.img_src || r?.thumbnail || ''
      const imgSrc = r?.img_src || r?.thumbnail || r?.image || r?.img || r?.img_url || ''
      const url = typeof link === 'string' ? link : ''
      const image = typeof imgSrc === 'string' ? imgSrc : (url || '')
      return image ? ({ image, url: url || image, title: r?.title || extractDomain(url || image), displayUrl: extractDomain(url || image) }) : null
    }
    return results.map(toImg).filter(Boolean)
  }
  const fetchArticleViaFirecrawl = async (url) => {
    try {
      const base = String(settings?.ai?.firecrawlBaseUrl || '/firecrawl').replace(/\/$/, '')
      const body = { url, formats: ['markdown'], includeLinks: false }
      const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', ...(settings?.ai?.firecrawlApiKey ? { 'Authorization': `Bearer ${settings.ai.firecrawlApiKey}` } : {}) }
      const resp = await fetch(`${base}/v1/scrape`, { method: 'POST', headers, body: JSON.stringify(body) })
      if (!resp.ok) throw new Error(`Firecrawl scrape error: ${resp.status}`)
      const data = await resp.json().catch(() => ({}))
      // Firecrawl returns { markdown, metadata:{ title } } pattern
      const md = String(data?.markdown || data?.content || '')
      const title = String(data?.metadata?.title || '')
      return { markdown: md, title }
    } catch (e) {
      console.warn('Inline article fetch failed', e)
      return { markdown: '', title: '' }
    }
  }
  const inlineTheme = settings?.appearance?.inline?.theme || 'terminal'
  const inlineUseSlugTextColor = !!settings?.appearance?.inline?.useWorkspaceSlugTextColor
  const inlineOutlineEnabled = settings?.appearance?.inline?.outline !== false
  const inlinePinnedFull = !!settings?.appearance?.inline?.fullPinnedSearch
  const inlineSystemReturn = !!settings?.appearance?.inline?.systemReturnButton
  const inlineSlugTextColor = useMemo(() => {
    if (!inlineUseSlugTextColor) return null
    try {
      const anchoredId = settings?.speedDial?.anchoredWorkspaceId || null
      const isAnchored = anchoredId && (activeWorkspaceId === anchoredId)
      if (isAnchored) return null
      const slugifyLocal = (name) => {
        try {
          return String(name || '')
            .trim()
            .toLowerCase()
            .replace(/[_\s]+/g, '-')
            .replace(/[^a-z0-9\-]/g, '')
            .replace(/\-+/g, '-')
            .replace(/^\-+|\-+$/g, '') || 'workspace'
        } catch { return 'workspace' }
      }
      const match = workspaces.find(w => `/${slugifyLocal(w.name||'')}` === currentSlugPath) || null
      if (!match) return null
      if (anchoredId && anchoredId === match.id) return null
      const map = settings?.speedDial?.workspaceTextColors || {}
      const col = map?.[match.id]
      return col ? sanitizeHex(col) : null
    } catch { return null }
  }, [inlineUseSlugTextColor, workspaces, currentSlugPath, settings?.speedDial?.workspaceTextColors, settings?.speedDial?.anchoredWorkspaceId, activeWorkspaceId])
  const inlineThemeConfig = useMemo(() => {
    const base = {
      background: 'rgba(0, 0, 0, 0.92)',
      border: inlineOutlineEnabled ? '2px solid #00ffff' : '0px solid transparent',
      accent: inlineSlugTextColor || '#00ffff',
      url: inlineSlugTextColor || '#00cc99',
      foreground: inlineSlugTextColor || '#cccccc',
      muted: inlineSlugTextColor ? applyAlphaToColor(inlineSlugTextColor, 0.75) : 'rgba(204, 255, 255, 0.85)',
      surface: 'rgba(0, 255, 255, 0.05)',
      surfaceHover: 'rgba(0, 255, 255, 0.1)',
      borderStrong: 'rgba(0, 255, 255, 0.25)',
      glow: 'rgba(0, 255, 255, 0.3)',
      fontFamily: `'Courier New', 'Monaco', monospace`,
      containerBackground: 'transparent',
      containerShadow: null,
      containerBackdropFilter: null,
      backdropFilter: null,
      borderVariable: inlineOutlineEnabled ? '2px solid #00ffff' : '0px solid transparent'
    }
    switch (inlineTheme) {
      case 'glassy':
        return {
          background: 'linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.07))',
          border: inlineOutlineEnabled ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.12)',
          accent: inlineSlugTextColor || '#6dd5f2',
          url: inlineSlugTextColor || '#c4e9ff',
          foreground: inlineSlugTextColor || 'rgba(233, 244, 255, 0.95)',
          muted: inlineSlugTextColor ? applyAlphaToColor(inlineSlugTextColor, 0.72) : 'rgba(233, 244, 255, 0.75)',
          surface: 'rgba(255,255,255,0.08)',
          surfaceHover: 'rgba(255,255,255,0.12)',
          borderStrong: 'rgba(255,255,255,0.3)',
          glow: 'rgba(109, 215, 255, 0.4)',
          fontFamily: 'Inter, "SF Pro Display", system-ui, sans-serif',
          containerBackground: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
          containerShadow: '0 28px 65px rgba(0,0,0,0.45)',
          containerBackdropFilter: 'blur(18px)',
          backdropFilter: 'blur(18px)',
          borderVariable: inlineOutlineEnabled ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.12)'
        }
      case 'terminal':
      default:
        return base
    }
  }, [inlineTheme, inlineOutlineEnabled, inlineSlugTextColor])

  const openInlineArticle = async (url, titleHint='') => {
    setIsSearching(true)
    setShowInlineResults(true)
    setIsPinned(true)
    setInlineContentType('article')
    setArticleData({ title: titleHint || extractDomain(url), url, markdown: '' })
    setImageResults([])
    try {
      const { markdown, title } = await fetchArticleViaFirecrawl(url)
      setArticleData({ title: title || titleHint || extractDomain(url), url, markdown: markdown || '(No content available)\n' })
    } finally {
      setIsSearching(false)
    }
  }
  const openLinkContextMenu = (e, url, title='') => {
    if (!url) return
    try { e.preventDefault(); e.stopPropagation() } catch {}
    const panel = document.querySelector('.inline-search-results-container')
    const MENU_WIDTH = 240
    const MENU_HEIGHT = 150
    let left = e.clientX
    let top = e.clientY
    try {
      const rect = panel?.getBoundingClientRect()
      if (rect) {
        const relX = e.clientX - rect.left
        const relY = e.clientY - rect.top
        left = Math.min(rect.width - MENU_WIDTH - 12, Math.max(12, relX - MENU_WIDTH / 2))
        top = Math.min(rect.height - MENU_HEIGHT - 12, Math.max(12, relY - 12))
      } else {
        left = 12
        top = 12
      }
    } catch {}
    setLinkMenu({ open: true, x: left, y: top, url, title })
  }
  const closeLinkMenu = () => setLinkMenu({ open: false, x: 0, y: 0, url: '', title: '' })
  const performInlineImageSearch = async (file) => {
    setIsSearching(true)
    setShowInlineResults(true)
    setIsPinned(true)
    setInlineContentType('images')
    setImageResults([])
    
    const inlineProvider = settings?.search?.imageSearch?.inlineProvider || 'searxng'
    
    try {
      // SearXNG (default and only inline provider)
      setInlineEngineLabel('SearXNG Images')
        const labels = await classifyImageLabels(file)
        // Use top 3-5 labels for better visual similarity matching
        const topLabels = labels.slice(0, 5).filter(Boolean)
        
        let allResults = []
        
        if (topLabels.length > 0) {
          // Use the first label for query display
          const primaryLabel = topLabels[0]
          setQuery(primaryLabel)
          
          // Search with primary label first
          try {
            const primaryResults = await fetchSearxngImages(primaryLabel)
            allResults = [...allResults, ...primaryResults]
          } catch (e) {
            console.warn('Primary label search failed:', e)
          }
          
          // Search with combined labels (top 3) for better visual matches
          if (topLabels.length >= 2) {
            const combinedQuery = topLabels.slice(0, 3).join(' ')
            try {
              const combinedResults = await fetchSearxngImages(combinedQuery)
              // Merge results, avoiding duplicates
              const existingUrls = new Set(allResults.map(r => r.url))
              const uniqueResults = combinedResults.filter(r => !existingUrls.has(r.url))
              allResults = [...allResults, ...uniqueResults]
            } catch (e) {
              console.warn('Combined labels search failed:', e)
            }
          }
          
          // Also try individual secondary labels for more diversity
          if (topLabels.length > 1) {
            for (const label of topLabels.slice(1, 4)) {
              try {
                const labelResults = await fetchSearxngImages(label)
                const existingUrls = new Set(allResults.map(r => r.url))
                const uniqueResults = labelResults.filter(r => !existingUrls.has(r.url))
                allResults = [...allResults, ...uniqueResults.slice(0, 5)] // Limit per label
              } catch (e) {
                console.warn(`Label "${label}" search failed:`, e)
              }
            }
          }
        } else {
          // Fallback: generic similar images search
          const genericResults = await fetchSearxngImages('similar images')
          allResults = genericResults
        }
        
        // Limit total results and remove duplicates by URL
        const seenUrls = new Set()
        const uniqueResults = []
        for (const result of allResults) {
          if (!seenUrls.has(result.url) && uniqueResults.length < 30) {
            seenUrls.add(result.url)
            uniqueResults.push(result)
          }
        }
        
        setImageResults(uniqueResults)
    } catch (e) {
      console.error('Inline image search failed:', e)
      setImageResults([])
    } finally {
      setIsSearching(false)
    }
  }

  useEffect(() => {
    try { setAiResultsCount(Number(settings?.ai?.webResultsCount || 5)) } catch {}
  }, [settings?.ai?.webResultsCount])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const filtered = (chatSessions || []).filter(s => Array.isArray(s.messages) && s.messages.length > 0)
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(filtered))
    } catch {}
  }, [chatSessions])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (activeChatId) window.localStorage.setItem(CHAT_ACTIVE_KEY, activeChatId)
      else window.localStorage.removeItem(CHAT_ACTIVE_KEY)
    } catch {}
  }, [activeChatId])

  useEffect(() => {
    if (chatSessions.length > 0) return
    const now = Date.now()
    const fresh = {
      id: makeUuid(),
      title: DEFAULT_CHAT_TITLE,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      messages: []
    }
    setChatSessions([fresh])
    setActiveChatId(fresh.id)
    setAiMessages([])
  }, [chatSessions.length])

  // Optionally force a fresh chat when AI mode is enabled, based on settings.ai.openNewChatEverytime
  useEffect(() => {
    if (!isAIMode) return
    const shouldOpenNew = !!settings?.ai?.openNewChatEverytime
    if (!shouldOpenNew) return
    setChatSessions(prev => {
      const now = Date.now()
      const fresh = {
        id: makeUuid(),
        title: DEFAULT_CHAT_TITLE,
        createdAt: now,
        updatedAt: now,
        pinned: false,
        messages: []
      }
      setActiveChatId(fresh.id)
      setAiMessages([])
      return [fresh, ...prev]
    })
  }, [isAIMode, settings?.ai?.openNewChatEverytime])

  useEffect(() => {
    if (!activeChatId) return
    setChatSessions(prev => {
      const idx = prev.findIndex(s => s.id === activeChatId)
      const now = Date.now()
      if (idx === -1) {
        const title = deriveChatTitle(aiMessages, DEFAULT_CHAT_TITLE)
        return [
          ...prev,
          {
            id: activeChatId,
            title,
            createdAt: now,
            updatedAt: now,
            pinned: false,
            messages: aiMessages
          }
        ]
      }
      const current = prev[idx]
      const computedTitle = current.title && current.title !== DEFAULT_CHAT_TITLE
        ? current.title
        : deriveChatTitle(aiMessages, current.title || DEFAULT_CHAT_TITLE)
      if (current.messages === aiMessages && current.title === computedTitle) return prev
      const updated = {
        ...current,
        messages: aiMessages,
        updatedAt: now,
        title: computedTitle
      }
      const next = [...prev]
      next[idx] = updated
      return next
    })
  }, [aiMessages, activeChatId])

  const sortedChatSessions = useMemo(() => {
    const pinned = chatSessions.filter(s => s.pinned).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    const rest = chatSessions.filter(s => !s.pinned).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return [...pinned, ...rest]
  }, [chatSessions])
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  // Extension history bridge
  const [extReady, setExtReady] = useState(false)
  const extItemsRef = useRef([])
  const suggestionsScrollRef = useRef(null)
  const inputContainerRef = useRef(null)
  const [suggMaxHeight, setSuggMaxHeight] = useState(0)
  const [suggOverflowing, setSuggOverflowing] = useState(false)
  // AI model menu state
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [aiModels, setAiModels] = useState([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const modelMenuRef = useRef(null)
  const botButtonRef = useRef(null)
  const [showChatLogMenu, setShowChatLogMenu] = useState(false)
  const chatLogMenuRef = useRef(null)
  // Pinned models (persist between reloads)
  const [pinnedModels, setPinnedModels] = useState(() => {
    try { const raw = localStorage.getItem('aiPinnedModels') || '[]'; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.filter(Boolean) : [] } catch { return [] }
  })
  useEffect(() => { try { localStorage.setItem('aiPinnedModels', JSON.stringify(pinnedModels)) } catch {} }, [pinnedModels])
  const isPinnedModel = useCallback((m) => (pinnedModels || []).includes(m), [pinnedModels])
  const togglePinModel = useCallback((m) => {
    setPinnedModels(prev => (prev || []).includes(m) ? prev.filter(x => x !== m) : [...(prev || []), m])
  }, [])
  // Simple context menu for model items
  const [modelCtx, setModelCtx] = useState({ open: false, x: 0, y: 0, name: '' })
  const openModelCtx = useCallback((e, name) => {
    e.preventDefault()
    try {
      const rect = modelMenuRef.current?.getBoundingClientRect()
      const x = rect ? (e.clientX - rect.left) : 8
      const y = rect ? (e.clientY - rect.top) : 8
      setModelCtx({ open: true, x, y, name })
    } catch { setModelCtx({ open: true, x: 8, y: 8, name }) }
  }, [])
  const closeModelCtx = useCallback(() => setModelCtx({ open: false, x: 0, y: 0, name: '' }), [])
  const fileInputRef = useRef(null)
  // Message actions and editing
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  const copyMessage = useCallback(async (text) => {
    try { await navigator.clipboard.writeText(String(text || '')) } catch {}
  }, [])

  const startEditMessage = useCallback((msg) => {
    if (!msg || msg.role !== 'user') return
    setEditingMessageId(msg.id)
    setEditDraft(String(msg.content || ''))
  }, [])

  const cancelEditMessage = useCallback(() => {
    setEditingMessageId(null)
    setEditDraft('')
  }, [])

  const saveEditAndResubmit = useCallback(() => {
    if (!editingMessageId) return
    const idx = aiMessages.findIndex(m => m.id === editingMessageId)
    if (idx === -1) { cancelEditMessage(); return }
    const newContent = String(editDraft || '').trim()
    // Abort any in-flight stream
    try { aiAbortRef.current?.abort() } catch {}
    setAiStreaming(false)
    aiAbortRef.current = null
    // Trim messages to this user message and update its content
    setAiMessages(prev => {
      const before = prev.slice(0, idx)
      const edited = { ...prev[idx], content: newContent }
      return [...before, edited]
    })
    // Close edit UI
    setEditingMessageId(null)
    setEditDraft('')
    // Resubmit using current web-search toggle
    if (newContent) {
      try { streamAIResponse(newContent, { forceWebSearch: aiWeb }) } catch {}
    }
  }, [editingMessageId, aiMessages, editDraft, aiWeb])
  const suggestionsService = useRef(new SearchSuggestionsService())
  const recordingIntentRef = useRef('search')
  const inputRowRef = useRef(null)
  const [baseRowHeight, setBaseRowHeight] = useState(null)

  useEffect(() => {
    if (!settingsPanelOpen) return
    setShowSuggestions(false)
    setShowInlineResults(false)
    setShowChatLogMenu(false)
    setShowModelMenu(false)
    setModelCtx({ open: false, x: 0, y: 0, name: '' })
    setLinkMenu(prev => (prev?.open ? { ...prev, open: false } : prev))
    try { inputRef.current?.blur() } catch {}
  }, [settingsPanelOpen])
  const [inputRowEl, setInputRowEl] = useState(null)
  const handleInputRowRef = useCallback((node) => {
    inputRowRef.current = node
    setInputRowEl(node)
  }, [])

  const handleSelectChatSession = useCallback((id) => {
    const session = chatSessions.find(s => s.id === id)
    if (!session) return
    setActiveChatId(session.id)
    setAiMessages(ensureArray(session.messages))
    setShowChatLogMenu(false)
    try { inputRef.current?.focus() } catch {}
  }, [chatSessions, inputRef, setActiveChatId, setAiMessages, setShowChatLogMenu])

  const createNewChatSession = useCallback(() => {
    const now = Date.now()
    const fresh = {
      id: makeUuid(),
      title: DEFAULT_CHAT_TITLE,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      messages: []
    }
    setChatSessions(prev => [fresh, ...prev])
    setActiveChatId(fresh.id)
    setAiMessages([])
    setShowChatLogMenu(false)
    try { inputRef.current?.focus() } catch {}
  }, [inputRef, setActiveChatId, setAiMessages, setChatSessions, setShowChatLogMenu])

  const togglePinChatSession = useCallback((id) => {
    setChatSessions(prev => prev.map(s => (s.id === id ? { ...s, pinned: !s.pinned } : s)))
  }, [setChatSessions])

  const deleteChatSession = useCallback((id) => {
    setChatSessions(prev => {
      let next = prev.filter(s => s.id !== id)
      if (id === activeChatId) {
        let fallback = next[0]
        if (!fallback) {
          const now = Date.now()
          fallback = {
            id: makeUuid(),
            title: DEFAULT_CHAT_TITLE,
            createdAt: now,
            updatedAt: now,
            pinned: false,
            messages: []
          }
          next = [fallback]
        }
        setActiveChatId(fallback.id)
        setAiMessages(ensureArray(fallback.messages))
      }
      return next
    })
  }, [activeChatId, setActiveChatId, setAiMessages, setChatSessions])

  // Voice: cleanup on unmount
  useEffect(() => {
    return () => {
      try { recorderRef.current?.stop() } catch {}
      try { mediaStreamRef.current?.getTracks()?.forEach(t => t.stop()) } catch {}
      try { cancelAnimationFrame(rafRef.current) } catch {}
      try { audioCtxRef.current?.close() } catch {}
    }
  }, [])

  const startRecording = useCallback(async ({ preferAI = false } = {}) => {
    try {
      // Stop any ongoing TTS playback when user starts speaking (barge-in)
      try {
        if (ttsAudioRef.current) {
          ttsAudioRef.current.pause()
          try { URL.revokeObjectURL(ttsAudioRef.current.src) } catch {}
          ttsAudioRef.current = null
        }
      } catch {}
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone not supported')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      // Pick a supported recording MIME
      const preferMimes = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus', 
        'audio/wav',
        'audio/mp4',
        'audio/webm'
      ]
      let recMime = 'audio/webm' // Fallback default
      for (const m of preferMimes) {
        try {
          if (window.MediaRecorder && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m)) {
            console.log('Using MIME type:', m)
            recMime = m
            break
          }
        } catch {
          console.warn('Failed to check MIME support for:', m)
        }
      }
      const mime = recMime
      const mr = new MediaRecorder(stream, { mimeType: mime })
      recorderRef.current = mr
      recordChunksRef.current = []
      recordingIntentRef.current = preferAI ? 'ai' : 'search'
      autoSearchAfterTranscriptionRef.current = false
      if (preferAI && !isAIMode) setIsAIMode(true)
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        try {
          setVoiceBusy(true)
          // Show immediate feedback while STT runs
          try { prevQueryRef.current = String(query) } catch { prevQueryRef.current = '' }
          setQuery('Transcribing…')
          // Create blob with the correct MIME type
          const blob = new Blob(recordChunksRef.current, { type: recMime })
          
          console.log('[DEBUG] mr.onstop triggered - autoSearchRef:', autoSearchAfterTranscriptionRef.current, 'recordingIntent:', recordingIntentRef.current, 'fullVoiceMode:', fullVoiceMode)
          
          // Skip STT if recording is effectively empty or corrupt
          if (!blob || blob.size < 1024) {  // Increased minimum size threshold
            console.warn('Recording too small:', blob?.size || 0, 'bytes')
            setQuery(prevQueryRef.current || '')
            console.log('[DEBUG] Blob too small, returning early')
            return
          }
          
          // Validate audio data header and content
          try {
            const firstBytes = await blob.slice(0, 16).arrayBuffer()
            const header = new Uint8Array(firstBytes)
            
            // Check for common audio file signatures
            const isWebM = header[0] === 0x1A && header[1] === 0x45 && header[2] === 0xDF && header[3] === 0xA3
            const isOgg = header[0] === 0x4F && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53
            const isWav = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
            
            if (!isWebM && !isOgg && !isWav && header.length < 8) {
              console.warn('Invalid audio header detected')
              setQuery(prevQueryRef.current || '')
              return
            }
            
            // Log audio format details
            console.log('Audio format:', {
              size: blob.size,
              mime: recMime,
              isWebM,
              isOgg, 
              isWav
            })
            
          } catch (e) {
            console.warn('Audio validation failed:', e)
            setQuery(prevQueryRef.current || '')
            return
          }
          const prefer = recordingIntentRef.current === 'ai'
          const shouldAutoSearch = autoSearchAfterTranscriptionRef.current
          console.log('[DEBUG] Before transcribe - prefer:', prefer, 'shouldAutoSearch:', shouldAutoSearch, 'fullVoiceMode:', fullVoiceMode)
          console.log('Sending audio to transcriber, size:', blob.size, 'mime:', mime)
          const result = await lazyTranscribeAudioBlob(blob, { preferAI: prefer, settings, mime })
          console.log('Transcription result:', result)
          const text = result?.text || ''
          console.log('[DEBUG] After transcribe - text:', text, 'text.trim().length:', String(text).trim().length)
          if (text && String(text).trim().length > 0) {
            console.log('Transcription successful, text length:', text.length)
            setQuery(text)
            if (prefer) setIsAIMode(true)
            // If Full Voice Mode is enabled in AI mode, auto-send to LLM
            console.log('[DEBUG] Checking conditions - prefer:', prefer, 'fullVoiceMode:', fullVoiceMode, 'shouldAutoSearch:', shouldAutoSearch)
            if (prefer && fullVoiceMode) {
              console.log('[DEBUG] Condition 1 matched: prefer && fullVoiceMode - calling handleAIQuery')
              // Slight delay to let UI state settle
              setTimeout(() => { 
                try { 
                  console.log('[DEBUG] Executing handleAIQuery from fullVoiceMode condition')
                  handleAIQuery() 
                } catch (err) { 
                  console.error('[DEBUG] Error calling handleAIQuery:', err)
                } 
              }, 10)
            } else if (shouldAutoSearch && prefer) {
              console.log('[DEBUG] Condition 2 matched: shouldAutoSearch && prefer - calling handleAIQuery')
              // Auto-send to AI after transcription if send button was clicked during recording
              setTimeout(() => { 
                try { 
                  console.log('[DEBUG] Executing handleAIQuery from shouldAutoSearch+prefer condition')
                  handleAIQuery() 
                } catch (err) { 
                  console.error('[DEBUG] Error calling handleAIQuery:', err)
                } 
              }, 10)
            } else if (shouldAutoSearch && !prefer) {
              console.log('[DEBUG] Condition 3 matched: shouldAutoSearch && !prefer - calling handleSearch')
              // Auto-search after transcription if search button was clicked during recording
              setTimeout(() => { 
                try { 
                  console.log('[DEBUG] Executing handleSearch from shouldAutoSearch condition')
                  handleSearch() 
                } catch (err) { 
                  console.error('[DEBUG] Error calling handleSearch:', err)
                } 
              }, 10)
            } else {
              console.log('[DEBUG] No auto-send condition met - no auto-action triggered')
            }
            // Focus the input so user can review and manually submit
            try { inputRef.current?.focus() } catch {}
          } else {
            // No speech detected or empty transcript; restore previous input
            console.log('[DEBUG] No text from transcription - restoring previous query')
            setQuery(prevQueryRef.current || "")
          }
        } catch (e) {
          console.warn('Transcription failed', e)
          // Restore previous input on failure
          setQuery(prevQueryRef.current || '')
        } finally {
          console.log('[DEBUG] mr.onstop finally - resetting autoSearchRef and recordingIntent')
          setVoiceBusy(false)
          autoSearchAfterTranscriptionRef.current = false
          recordingIntentRef.current = 'search'
        }
      }
      // Web Audio waveform
      const AC = window.AudioContext || window.webkitAudioContext
      const ctx = new AC()
      audioCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      src.connect(analyser)
      analyserRef.current = analyser
      const draw = () => {
        const canvas = waveformCanvasRef.current
        const an = analyserRef.current
        if (!canvas || !an) { rafRef.current = requestAnimationFrame(draw); return }
        const ctx2d = canvas.getContext('2d')
        if (!ctx2d) { rafRef.current = requestAnimationFrame(draw); return }
        const dpr = window.devicePixelRatio || 1
        const width = canvas.clientWidth * dpr
        const height = canvas.clientHeight * dpr
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        ctx2d.clearRect(0, 0, width, height)
        const bufferLength = an.fftSize
        const dataArray = new Uint8Array(bufferLength)
        an.getByteTimeDomainData(dataArray)
        ctx2d.lineWidth = 2
        ctx2d.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx2d.beginPath()
        const slice = width / bufferLength
        let x = 0
        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0
          const y = (v * height) / 2
          if (i === 0) ctx2d.moveTo(x, y)
          else ctx2d.lineTo(x, y)
          x += slice
        }
        ctx2d.stroke()
        rafRef.current = requestAnimationFrame(draw)
      }
      rafRef.current = requestAnimationFrame(draw)
      mr.start(50)
      setIsRecording(true)
    } catch (e) {
      console.warn('Mic permission/start failed', e)
    }
  }, [isAIMode, setIsAIMode])

  const stopRecording = useCallback((autoSearch = false) => {
    console.log('[DEBUG] stopRecording called - autoSearch:', autoSearch)
    if (autoSearch) {
      autoSearchAfterTranscriptionRef.current = true
      console.log('[DEBUG] Set autoSearchAfterTranscriptionRef to true')
    }
    try { recorderRef.current?.stop() } catch {}
    try { mediaStreamRef.current?.getTracks()?.forEach(t => t.stop()) } catch {}
    try { cancelAnimationFrame(rafRef.current) } catch {}
    try { audioCtxRef.current?.close() } catch {}
    recorderRef.current = null
    mediaStreamRef.current = null
    analyserRef.current = null
    audioCtxRef.current = null
    rafRef.current = null
    setIsRecording(false)
  }, [])

  // Listen for extension availability and history suggestions
  useEffect(() => {
    const onReady = () => setExtReady(true)
    const onExt = (e) => {
      const items = (e && e.detail && Array.isArray(e.detail.items)) ? e.detail.items : []
      // Map extension-provided workspace slug to actual workspace id when possible
      const mapWs = (it) => {
        let wsId = null
        try {
          if (it.workspace) {
            const slug = String(it.workspace).toLowerCase()
            const match = (workspaces || []).find(w => String(w.name||'').toLowerCase().includes(slug))
            if (match) wsId = match.id
          }
          // Fallback: derive from URL using same rules as service
          if (!wsId && it.url) {
            const host = new URL(it.url).hostname.toLowerCase().replace(/^www\./,'')
            const rules = {
              dev: ['github.com','gitlab.com','npmjs.com','stackoverflow.com','codeberg.org'],
              research: ['wikipedia.org','arxiv.org','openalex.org','scholar.google.com'],
              media: ['youtube.com','youtu.be','vimeo.com','soundcloud.com'],
              social: ['twitter.com','x.com','reddit.com'],
              shopping: ['amazon.com','ebay.com'],
              mail: ['gmail.com','proton.me','outlook.com']
            }
            let target = null
            for (const [name, hosts] of Object.entries(rules)) {
              if (hosts.some(h => host === h || host.endsWith(`.${h}`))) { target = name; break }
            }
            if (target) {
              const match2 = (workspaces || []).find(w => String(w.name||'').toLowerCase().includes(target))
              if (match2) wsId = match2.id
            }
          }
        } catch {}
        return { ...it, workspaceId: wsId }
      }
      extItemsRef.current = items.map(mapWs)
      // If suggestions are visible for current query, re-merge
      if (showSuggestions) {
        // Trigger a re-merge using current query state
        mergeAndSetSuggestions((suggestions || []), query)
      }
    }
    window.addEventListener('ext-history-ready', onReady)
    window.addEventListener('ext-history-suggestions', onExt)
    return () => {
      window.removeEventListener('ext-history-ready', onReady)
      window.removeEventListener('ext-history-suggestions', onExt)
    }
  }, [showSuggestions, suggestions, query])

  const requestExtSuggestions = useCallback((q) => {
    try {
      if (!q || !q.trim()) return
      window.dispatchEvent(new CustomEvent('request-history-suggestions', { detail: { query: q } }))
    } catch {}
  }, [settings?.general?.capSuggestions7])

  const mergeAndSetSuggestions = useCallback((baseList, q) => {
    const base = Array.isArray(baseList) ? baseList : []
    const ql = (q || '').toLowerCase()
    const minLen = (ql.length <= 1) ? 3 : (ql.length + 1)
    const capMode = !!settings?.general?.capSuggestions7

    // Build extension URL candidates (history)
    const extHistory = (() => {
      const seen = new Set()
      const out = []
      for (const it of (extItemsRef.current || [])) {
        const tl = String(it.title||'').toLowerCase()
        let host = ''
        try { host = new URL(String(it.url||'')).hostname.toLowerCase().replace(/^www\./,'') } catch {}
        const text = String(it.title || it.url || '')
        const ok = (tl.startsWith(ql) || (host && host.startsWith(ql))) && text.length >= minLen
        const key = `url:${String(it.url||'').toLowerCase()}`
        if (ok && !seen.has(key)) {
          seen.add(key)
          out.push({ type: 'url', text: it.title || it.url, url: it.url, source: 'history', workspaceId: it.workspaceId || null })
        }
        if (out.length >= 30) break
      }
      return out
    })()

    const getHost = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./,'') } catch { return '' } }
    const blRaw = (() => { try { return JSON.parse(localStorage.getItem('suggestionBlocklist')||'[]') } catch { return [] } })()
    const bl = new Set(Array.isArray(blRaw) ? blRaw : [])
    const isBlocked = (s) => {
      if (!s) return false
      if (s.type === 'url') { const h = getHost(s.url); return bl.has(`host:${h}`) }
      return bl.has(`t:${String(s.text||'').trim().toLowerCase()}`)
    }

    // Normalize base (from service) into only URL/search types already
    const normalizedBase = base.map(x => ({
      type: x.url ? 'url' : 'search',
      text: x.text,
      url: x.url,
      source: x.source || (x.url ? 'popular' : 'searx')
    })).filter(x => {
      const tl = String(x.text||'').toLowerCase()
      if (!ql) return true
      if (x.type === 'url') {
        try { const host = getHost(x.url); return (tl.startsWith(ql) || host.startsWith(ql)) && String(x.text||'').length >= minLen } catch { return tl.startsWith(ql) && String(x.text||'').length >= minLen }
      }
      return tl.startsWith(ql) && String(x.text||'').length >= minLen
    })

    // Deduplicate (prefer search type over url when text identical)
    const seen = new Set()
    const merged = []
    for (const it of [...normalizedBase, ...extHistory]) {
      const key = it.type === 'url' ? `url:${(it.url||'').toLowerCase()}` : `t:${String(it.text||'').toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!isBlocked(it)) merged.push(it)
    }

    // Scoring consistent with service
    const urlCloseness = (u, textOpt) => {
      const host = getHost(u)
      const txt = String(textOpt || '').toLowerCase()
      if (!host) return 0
      if (host === ql) return 200
      if (host.startsWith(ql)) return 150
      if (txt && txt.startsWith(ql)) return 110
      try { const path = new URL(u).pathname.toLowerCase(); if (path.startsWith('/' + ql) || path.startsWith(ql)) return 70 } catch {}
      return 0
    }
    const textCloseness = (t) => {
      const s = String(t||'').toLowerCase()
      if (s === ql) return 130
      if (s.startsWith(ql)) return 100
      return 0
    }
    // Map URL -> workspace ID using hard-coded URL rules matched to provided workspaces (by name keyword)
    const workspaceIdFromUrl = (url) => {
      try {
        const host = getHost(url)
        const rules = {
          dev: ['github.com','gitlab.com','npmjs.com','stackoverflow.com','codeberg.org'],
          research: ['wikipedia.org','arxiv.org','openalex.org','scholar.google.com'],
          media: ['youtube.com','youtu.be','vimeo.com','soundcloud.com'],
          social: ['twitter.com','x.com','reddit.com'],
          shopping: ['amazon.com','ebay.com'],
          mail: ['gmail.com','proton.me','outlook.com']
        }
        let target = null
        for (const [name, hosts] of Object.entries(rules)) {
          if (hosts.some(h => host === h || host.endsWith(`.${h}`))) { target = name; break }
        }
        if (!target) return null
        const ws = (workspaces || [])
        const match = ws.find(w => String(w.name||'').toLowerCase().includes(target))
        return match ? match.id : null
      } catch { return null }
    }

    const scoreOf = (item) => {
      let baseScore = (item.type === 'url') ? 1000 : 900
      baseScore += (item.type === 'url') ? urlCloseness(item.url, item.text) : textCloseness(item.text)
      if (item.source === 'popular') baseScore += 20
      if (item.source === 'recent') baseScore += 10
      if (item.source === 'history') {
        baseScore -= 20
        try {
          const wsId = workspaceIdFromUrl(item.url)
          if (wsId && activeWorkspaceId && wsId === activeWorkspaceId) baseScore += 80
        } catch {}
      }
      return baseScore
    }

    const ranked = merged
      .map(x => ({ ...x, _score: scoreOf(x) }))
      .sort((a,b) => b._score - a._score)

    // Even mix of URL and search entries
    const mixEven = (list, maxCount) => {
      const urls = list.filter(x => x.type === 'url')
      const searches = list.filter(x => x.type === 'search')
      const out = []
      let i = 0, j = 0
      while (out.length < maxCount && (i < urls.length || j < searches.length)) {
        if (i < urls.length) out.push(urls[i++])
        if (out.length >= maxCount) break
        if (j < searches.length) out.push(searches[j++])
      }
      for (const rest of [...urls.slice(i), ...searches.slice(j)]) {
        if (out.length >= maxCount) break
        out.push(rest)
      }
      return out
    }

    // Choose ghost candidate favoring prefix match, then substring
    const pref = ranked.find(x => String(x.text||'').toLowerCase().startsWith(ql)) || null

    const finalList = capMode ? mixEven(ranked, 7) : mixEven(ranked, 48)
    const bottomUp = finalList.slice().reverse() // most relevant at bottom
    const shaped = bottomUp.map(it => ({ text: it.text, url: it.url || null, isUrl: it.type === 'url', source: it.source || 'base', workspaceId: it.workspaceId || null }))
    setSuggestions(shaped)
    setSelectedSuggestionIndex(-1)
    // Update ghost suggestion (top-ranked i.e., last element of ranked list)
    try {
      const top = pref || finalList[0]
      const candidate = top && typeof top.text === 'string' ? { text: top.text, url: top.url || null } : null
      setGhostSuggestion(candidate)
    } catch { setGhostSuggestion(null) }
    requestAnimationFrame(() => {
      try {
        if (suggestionsScrollRef.current) suggestionsScrollRef.current.scrollTop = suggestionsScrollRef.current.scrollHeight
      } catch {}
    })
  }, [settings?.general?.capSuggestions7])

  // Force scroll-to-bottom after list mounts/changes
  useEffect(() => {
    if (!showSuggestions || suggestions.length === 0) return
    requestAnimationFrame(() => {
      try { if (suggestionsScrollRef.current) suggestionsScrollRef.current.scrollTop = suggestionsScrollRef.current.scrollHeight } catch {}
    })
  }, [showSuggestions, suggestions.length])

  // Ensure selected suggestion stays in view as user navigates
  useEffect(() => {
    if (!showSuggestions) return
    const idx = selectedSuggestionIndex
    if (idx < 0) return
    try {
      const cont = suggestionsScrollRef.current
      if (!cont) return
      const el = cont.querySelector(`[data-sugg-idx="${idx}"]`)
      if (!el) return
      const top = el.offsetTop
      const bottom = top + el.offsetHeight
      const viewTop = cont.scrollTop
      const viewBottom = viewTop + cont.clientHeight
      if (top < viewTop) cont.scrollTop = top
      else if (bottom > viewBottom) cont.scrollTop = bottom - cont.clientHeight
    } catch {}
  }, [selectedSuggestionIndex, showSuggestions])

  // Compute available height for drop-up suggestions and overflow state
  useEffect(() => {
    const calc = () => {
      try {
        const el = inputContainerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const safe = 16
        const avail = Math.max(100, Math.floor(rect.top - safe))
        setSuggMaxHeight(avail)
        if (suggestionsScrollRef.current) {
          const sc = suggestionsScrollRef.current
          const ov = sc.scrollHeight > sc.clientHeight + 1
          setSuggOverflowing(ov)
        }
      } catch {}
    }
    if (showSuggestions) {
      calc()
      window.addEventListener('resize', calc)
      const t = setInterval(calc, 250)
      return () => { window.removeEventListener('resize', calc); clearInterval(t) }
    }
  }, [showSuggestions])

  const handleInputFocus = useCallback(() => {
    setInputGlowPhase('focus')
    if (directionalFocusTimeoutRef.current) {
      clearTimeout(directionalFocusTimeoutRef.current)
      directionalFocusTimeoutRef.current = null
    }
    if (refocusMode === 'pulse') {
      setDirectionalFocusReady(false)
      directionalFocusTimeoutRef.current = setTimeout(() => {
        setDirectionalFocusReady(true)
        directionalFocusTimeoutRef.current = null
      }, 240)
    } else {
      setDirectionalFocusReady(false)
    }
    // Only show suggestions once user starts typing (first letter), not on focus
    const hasText = (query || '').trim().length > 0
    // Apply workspace glow color on focus if enabled (follows URL slug)
    // Disable suggestions when pinned inline results are shown
    if (isPinned && showInlineResults) {
      setShowSuggestions(false)
      setSuggestions([])
      return
    }
    if (!isAIMode && hasText) {
      setShowSuggestions(true)
      setIsLoadingSuggestions(true)
      suggestionsService.current.fetchSuggestions(query, (fetchedSuggestions) => {
        setIsLoadingSuggestions(false)
        mergeAndSetSuggestions(fetchedSuggestions, query)
      }, {
        provider: suggestProvider,
        allowUrls: !inlineSearchMode,
        speedDialAware: true,
        mostRelevantAtBottom: true,
        capAt: 48,
        exactCap: settings?.general?.capSuggestions7 ? 7 : undefined,
        searxngBase: searxngBaseSuggest,
        customBaseUrl: suggestCustomBaseUrl,
        customMode: suggestCustomMode,
      })
      // Ask extension for history-based suggestions
      requestExtSuggestions(query)
    }
  }, [isAIMode, query, inlineSearchMode, mergeAndSetSuggestions, requestExtSuggestions, settings?.general?.capSuggestions7, suggestProvider, isPinned, showInlineResults, setInputGlowPhase, refocusMode])

  const handleInputBlur = useCallback(() => {
    if (typingPhaseTimeoutRef.current) {
      clearTimeout(typingPhaseTimeoutRef.current)
      typingPhaseTimeoutRef.current = null
    }
    if (directionalFocusTimeoutRef.current) {
      clearTimeout(directionalFocusTimeoutRef.current)
      directionalFocusTimeoutRef.current = null
    }
    setDirectionalFocusReady(false)
    setInputFocused(false)
    setInputGlowPhase('idle')
  }, [setInputFocused, setInputGlowPhase, setDirectionalFocusReady])

  // Toggle a body class when inline results are pinned, so layout can adjust globally
  useEffect(() => {
    const active = isPinned && showInlineResults
    if (active) {
      document.body.classList.add('inline-active')
    } else {
      document.body.classList.remove('inline-active')
    }
    return () => {
      document.body.classList.remove('inline-active')
    }
  }, [isPinned, showInlineResults])

  // Notify app to temporarily use Modern layout when AI or Inline results are active (for Classic layout)
  useEffect(() => {
    const requireModern = !!(isAIMode || (isPinned && showInlineResults))
    try { window.dispatchEvent(new CustomEvent('app-temporary-modern-required', { detail: { required: requireModern } })) } catch {}
  }, [isAIMode, isPinned, showInlineResults])

  useEffect(() => {
    if (!linkMenu.open) return
    const handleClose = (event) => {
      if (linkMenuRef.current && linkMenuRef.current.contains(event.target)) return
      setLinkMenu(prev => (prev.open ? { ...prev, open: false } : prev))
    }
    window.addEventListener('mousedown', handleClose)
    window.addEventListener('contextmenu', handleClose)
    return () => {
      window.removeEventListener('mousedown', handleClose)
      window.removeEventListener('contextmenu', handleClose)
    }
  }, [linkMenu.open])

  // Find or create the pinned search container (attach to scaled root if present)
  useEffect(() => {
    let container = document.getElementById('pinned-search-container')
    if (!container) {
      container = document.createElement('div')
      container.id = 'pinned-search-container'
      const mountAt = document.getElementById('ui-scale-root') || document.body
      mountAt.appendChild(container)
    }
    Object.assign(container.style, {
      position: 'absolute',
      // Nudge up a bit more (visible)
      top: 'calc(clamp(1.5rem, 4vh, 3.5rem) - 24px)',
      left: '50%',
      transform: 'translateX(-50%)',
      marginLeft: '0px',
      width: pinnedContainerWidth,
      maxWidth: pinnedContainerMaxWidth,
      zIndex: '1000',
      minHeight: 'calc(100vh - 3rem - env(safe-area-inset-bottom))',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingLeft: 'var(--center-floating-padding, 1.5rem)',
      paddingRight: 'var(--center-floating-padding, 1.5rem)',
      boxSizing: 'border-box',
      pointerEvents: 'none'
    })
    setPinnedContainer(container)
    
    return () => {
      const existingContainer = document.getElementById('pinned-search-container')
      if (existingContainer && existingContainer.children.length === 0) {
        existingContainer.remove()
      }
    }
  }, [layoutModeProp, pinnedContainerWidth, pinnedContainerMaxWidth])

  // Workspace URL change listener for transient glow
  const slugify = (name) => {
    try {
      return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9\-]/g, '')
        .replace(/\-+/g, '-')
        .replace(/^\-+|\-+$/g, '') || 'workspace'
    } catch { return 'workspace' }
  }
  const assignedGlowFor = (wsId) => {
    const anchoredId = settings?.speedDial?.anchoredWorkspaceId || null
    if (!wsId || (anchoredId && wsId === anchoredId)) {
      return settings?.speedDial?.glowColor || '#00ffff66'
    }
    const map = settings?.speedDial?.workspaceGlowColors || {}
    return map[wsId] || settings?.speedDial?.glowColor || '#00ffff66'
  }
  useEffect(() => {
    const handleCustom = (e) => {
      updateSlugPathFromWindow()
      if (!sbCfg.glowByUrl || !allowTransientGlow) return
      const id = e?.detail?.id
      if (!id) return
      const col = assignedGlowFor(id)
      if (allowTransientGlow) {
        setSearchGlow(col)
        const t = setTimeout(() => setSearchGlow(null), PULSE_MS)
        return () => clearTimeout(t)
      }
    }
    const handlePop = () => {
      updateSlugPathFromWindow()
      if (!sbCfg.glowByUrl || !allowTransientGlow) return
      try {
        const anchoredId = settings?.speedDial?.anchoredWorkspaceId || null
        const normalizedPath = normalizeSlugPath(window.location?.pathname || '/')
        const match = workspaces.find(w => `/${slugify(w.name||'')}` === normalizedPath) || null
        if (match) {
          const col = assignedGlowFor(match.id)
          if (allowTransientGlow) {
            setSearchGlow(col)
            setTimeout(() => setSearchGlow(null), PULSE_MS)
          }
        }
      } catch {}
    }
    window.addEventListener('app-workspace-url-change', handleCustom)
    window.addEventListener('popstate', handlePop)
    updateSlugPathFromWindow()
    return () => {
      window.removeEventListener('app-workspace-url-change', handleCustom)
      window.removeEventListener('popstate', handlePop)
    }
  }, [sbCfg.glowByUrl, allowTransientGlow, settings?.speedDial?.workspaceGlowColors, settings?.speedDial?.glowColor, settings?.speedDial?.anchoredWorkspaceId, workspaces, updateSlugPathFromWindow, normalizeSlugPath])

  // Handle input changes and fetch suggestions
  const handleInputChange = useCallback((value) => {
    setQuery(value)
    setSelectedSuggestionIndex(-1)
    const hasActiveInput = typeof document !== 'undefined' && inputRef.current && document.activeElement === inputRef.current
    if (hasActiveInput) {
      setInputGlowPhase('typing')
      if (typingPhaseTimeoutRef.current) {
        clearTimeout(typingPhaseTimeoutRef.current)
      }
      typingPhaseTimeoutRef.current = setTimeout(() => {
        setInputGlowPhase(prev => (prev === 'idle' ? 'idle' : 'focus'))
        typingPhaseTimeoutRef.current = null
      }, 520)
    }
    
    const hasText = (value || '').trim().length > 0
    if (!hasText) {
      setGhostSuggestion(null)
    }
    if (refocusMode === 'pulse' && hasActiveInput && hasText) {
      if (directionalFocusTimeoutRef.current) {
        clearTimeout(directionalFocusTimeoutRef.current)
        directionalFocusTimeoutRef.current = null
      }
      setDirectionalFocusReady(true)
    }
    // Disable suggestions when pinned inline results are shown
    if (isPinned && showInlineResults) {
      setShowSuggestions(false)
      setSuggestions([])
      setIsLoadingSuggestions(false)
      suggestionsService.current.cancelPendingRequests()
      return
    }
    if (!isAIMode && hasText) {
      setIsLoadingSuggestions(true)
      setShowSuggestions(true)
      suggestionsService.current.fetchSuggestionsDebounced(value, (fetchedSuggestions) => {
        setIsLoadingSuggestions(false)
        mergeAndSetSuggestions(fetchedSuggestions, value)
      }, {
        provider: suggestProvider,
        allowUrls: !inlineSearchMode,
        speedDialAware: true,
        mostRelevantAtBottom: true,
        capAt: 48,
        exactCap: settings?.general?.capSuggestions7 ? 7 : undefined,
        searxngBase: searxngBaseSuggest,
        customBaseUrl: suggestCustomBaseUrl,
        customMode: suggestCustomMode,
      })
      // Ask extension for history suggestions too
      requestExtSuggestions(value)
    } else {
      setShowSuggestions(false)
      setSuggestions([])
      setIsLoadingSuggestions(false)
      suggestionsService.current.cancelPendingRequests()
    }
  }, [isAIMode, inlineSearchMode, mergeAndSetSuggestions, requestExtSuggestions, settings?.general?.capSuggestions7, isPinned, showInlineResults, setInputGlowPhase, typingPhaseTimeoutRef, inputRef, refocusMode])

  // Handle suggestion selection
  const handleSuggestionSelect = useCallback((suggestion) => {
    setQuery(suggestion.text)
    setShowSuggestions(false)
    setSuggestions([])
    setSelectedSuggestionIndex(-1)
    
    // Update stats and recents
    if (!isAIMode) {
      suggestionsService.current.addRecentSearch(suggestion.text)
      suggestionsService.current.updateStats({ text: suggestion.text, url: suggestion.url })
    }
    
    setTimeout(() => {
      if (isAIMode) {
        handleAIQuery()
      } else if (inlineSearchMode) {
        // Inline mode never opens full links; always search
        performInlineSearch(suggestion.text)
      } else if (suggestion.isUrl && suggestion.url) {
        // Direct URL open
        if (settings?.general?.openInNewTab) window.open(suggestion.url, '_blank', 'noopener,noreferrer')
        else window.location.href = suggestion.url
      } else {
        performWebSearch(suggestion.text)
      }
    }, 30)
  }, [isAIMode, inlineSearchMode, settings?.general?.openInNewTab])

  // Separate function for inline search (SearXNG or Firecrawl with fallback)
  const performInlineSearch = async (searchQuery) => {
    setIsSearching(true)
    setShowInlineResults(true)
    setIsPinned(true)
    setInlineContentType('web')
    setImageResults([])
    setArticleData({ title: '', url: '', markdown: '' })
    
    try {
      const withTimeout = async (p, ms = 12000) => {
        let to
        const t = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('timeout')), ms) })
        try { return await Promise.race([p.finally(() => clearTimeout(to)), t]) } finally { clearTimeout(to) }
      }

      const mapResults = (items) => items.slice(0, 20).map(item => ({
        title: item.title || item.url,
        url: item.url,
        snippet: item.snippet || item.content || item.abstract || item.description || '',
        displayUrl: extractDomain(item.url)
      }))

      const fetchSearxng = async () => {
        const params = new URLSearchParams({ q: searchQuery, format: 'json', engines: 'duckduckgo,google,startpage,brave' })
        const resp = await withTimeout(fetch(`${searxngBaseInline}/search?${params.toString()}`, { method: 'GET', headers: { 'Accept': 'application/json' } }), 12000)
        if (!resp.ok) throw new Error(`SearXNG error: ${resp.status}`)
        const data = await resp.json()
        const results = Array.isArray(data.results) ? data.results : []
        return results.map(r => ({ title: r.title || r.url, url: r.url, snippet: r.content || r.abstract || '' }))
      }

      const fetchFirecrawl = async () => {
        const aiEnabled = settings?.ai?.enabled !== false
        const useAI = aiEnabled && (settings?.search?.inlineUseAI !== false) && (settings?.search?.inlineEnabled !== false)
        const base = String(useAI ? (settings?.ai?.firecrawlBaseUrl || '/firecrawl') : (settings?.search?.inlineFirecrawlBaseUrl || '/firecrawl-inline')).replace(/\/$/, '')
        // Inline should be fast: rely on search results only (no scraping)
        const body = { query: searchQuery, limit: 20, scrapeOptions: { formats: [] } }
        const authHeader = useAI
          ? (settings?.ai?.firecrawlApiKey ? { 'Authorization': `Bearer ${settings.ai.firecrawlApiKey}` } : {})
          : (settings?.search?.inlineFirecrawlApiKey ? { 'Authorization': `Bearer ${settings.search.inlineFirecrawlApiKey}` } : {})
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', ...authHeader }
        const resp = await withTimeout(fetch(`${base}/v1/search`, { method: 'POST', headers, body: JSON.stringify(body) }), 15000)
        if (!resp.ok) throw new Error(`Firecrawl error: ${resp.status}`)
        const data = await resp.json()
        const results = Array.isArray(data?.data) ? data.data : []
        return results.map(r => ({ title: r.title || r.url, url: r.url, snippet: r.description || '' }))
      }

      const fetchCustomInline = async () => {
        const base = inlineCustomBaseUrl
        if (!base) throw new Error('Inline custom base URL not configured')
        const url = `${base}${encodeURIComponent(searchQuery)}`
        const resp = await withTimeout(fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } }), 12000)
        if (!resp.ok) throw new Error(`Custom inline provider error: ${resp.status}`)
        const data = await resp.json().catch(() => ({}))
        const raw =
          Array.isArray(data) ? data :
          (Array.isArray(data.results) ? data.results :
          (Array.isArray(data.data) ? data.data : []))
        return raw.map(r => ({
          title: r.title || r.name || r.url || r.link || '',
          url: r.url || r.link || '',
          snippet: r.snippet || r.description || r.content || r.abstract || ''
        })).filter(it => it.url)
      }

      let items = []
      if (inlineProvider === 'firecrawl') {
        try {
          items = await fetchFirecrawl()
          setInlineEngineLabel('Firecrawl')
        } catch (e) {
          console.warn('Inline Firecrawl failed; falling back to SearXNG', e)
          try {
            items = await fetchSearxng()
            setInlineEngineLabel('SearXNG (fallback)')
          } catch (ee) {
            throw ee
          }
        }
      } else if (inlineProvider === 'custom') {
        try {
          items = await fetchCustomInline()
          setInlineEngineLabel('Custom')
        } catch (e) {
          console.warn('Inline custom provider failed; falling back to SearXNG', e)
          try {
            items = await fetchSearxng()
            setInlineEngineLabel('SearXNG (fallback)')
          } catch (ee) {
            throw ee
          }
        }
      } else {
        items = await fetchSearxng()
        setInlineEngineLabel('SearXNG')
      }

      // Fetch images if inline image search is enabled
      if (inlineImageSearchEnabled) {
        try {
          const images = await fetchSearxngImages(searchQuery)
          setImageResults(images)
        } catch (imgError) {
          console.warn('Inline image search failed:', imgError)
          setImageResults([])
        }
      }

      const mapped = mapResults(items)
      if (mapped.length === 0) {
        setSearchResults([
          {
            title: `Search "${searchQuery}" on ${(engine || settings.search?.engine || 'google')}`,
            url: getSearchUrl(searchQuery),
            snippet: `No ${inlineProvider === 'firecrawl' ? 'Firecrawl' : (inlineProvider === 'custom' ? 'custom inline provider' : 'SearXNG')} results. Click to search on ${(engine || settings.search?.engine || 'google')}.`,
            displayUrl: engine || settings.search?.engine || 'google'
          }
        ])
      } else {
        setSearchResults(mapped)
      }
    } catch (error) {
      console.error('Inline search failed:', error)
      setSearchResults([
        {
          title: `Search "${searchQuery}" on ${(engine || settings.search?.engine || 'google')}`,
          url: getSearchUrl(searchQuery),
          snippet: `Click to search for "${searchQuery}" directly on ${(engine || settings.search?.engine || 'google')}.`,
          displayUrl: engine || settings.search?.engine || 'google'
        }
      ])
    } finally {
      setIsSearching(false)
    }
  }

  // Separate function for web search
  const performWebSearch = (searchQuery) => {
    const searchUrl = getSearchUrl(searchQuery)
    if (settings.general?.openInNewTab) {
      window.open(searchUrl, '_blank')
    } else {
      window.location.href = searchUrl
    }
  }

  const toggleAIMode = useCallback(() => {
    const aiFeatureEnabled = settings?.ai?.enabled !== false
    if (!aiFeatureEnabled) return
    // Block entering AI mode when pinned inline results are shown
    if (isPinned && showInlineResults) return
    setIsAIMode(prev => {
      const next = !prev
      if (!prev) {
        setShowSuggestions(false)
        setSuggestions([])
      }
      return next
    })
  }, [isPinned, showInlineResults, settings])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      toggleAIMode()
      return
    }
    if (showSuggestions && suggestions.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedSuggestionIndex(prev => {
            if (prev === -1) return suggestions.length - 1 // start at bottom for down as well
            return prev < suggestions.length - 1 ? prev + 1 : 0
          })
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedSuggestionIndex(prev => {
            if (prev === -1) return suggestions.length - 1 // start from bottom
            return prev > 0 ? prev - 1 : suggestions.length - 1
          })
          break
        case 'Enter':
          e.preventDefault()
          if (selectedSuggestionIndex >= 0) {
            handleSuggestionSelect(suggestions[selectedSuggestionIndex])
          } else {
            // If image is attached and image icon is lit → inline image search
            if (attachedImage?.file && inlineImageSearchEnabled) {
              performInlineImageSearch(attachedImage.file)
            }
            // If image is attached and image icon is unlit → external search (Google Lens)
            else if (attachedImage?.file) {
              handleSearch()
            }
            // If no image but image icon is showing (from right-click) → inline image search with text
            else if (inlineModeIconState.isImage && query.trim()) {
              performInlineSearch(query.trim())
            }
            // Otherwise normal search behavior
            else if (isAIMode) handleAIQuery()
            else handleSearch()
          }
          break
        case 'Escape':
          e.preventDefault()
          setShowSuggestions(false)
          setSuggestions([])
          setSelectedSuggestionIndex(-1)
          break
        default:
          if (e.key === 'Enter') {
            // If image is attached and image icon is lit → inline image search
            if (attachedImage?.file && inlineImageSearchEnabled) {
              performInlineImageSearch(attachedImage.file)
            }
            // If image is attached and image icon is unlit → external search (Google Lens)
            else if (attachedImage?.file) {
              handleSearch()
            }
            // If no image but image icon is showing (from right-click) → inline image search with text
            else if (inlineModeIconState.isImage && query.trim()) {
              performInlineSearch(query.trim())
            }
            // Otherwise normal search behavior
            else if (isAIMode) handleAIQuery()
            else handleSearch()
          }
          break
      }
    } else if (e.key === 'Enter') {
      // If image is attached and image icon is lit → inline image search
      if (attachedImage?.file && inlineImageSearchEnabled) {
        performInlineImageSearch(attachedImage.file)
      }
      // If image is attached and image icon is unlit → external search (Google Lens)
      else if (attachedImage?.file) {
        handleSearch()
      }
      // If no image but image icon is showing (from right-click) → inline image search with text
      else if (inlineModeIconState.isImage && query.trim()) {
        performInlineSearch(query.trim())
      }
      // Otherwise normal search behavior
      else if (isAIMode) handleAIQuery()
      else handleSearch()
    }
  }, [showSuggestions, suggestions, selectedSuggestionIndex, handleSuggestionSelect, toggleAIMode, attachedImage?.file, isAIMode, inlineImageSearchEnabled, inlineModeIconState.isImage, query])

  // Hide suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      const target = event.target
      if (!target.closest('.search-suggestions-container') && 
          !target.closest('.search-input-container')) {
        setShowSuggestions(false)
        setSuggestions([])
        setSelectedSuggestionIndex(-1)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const getSearchUrl = (query) => {
    const eng = (engine || settings.search?.engine || 'google').toLowerCase()
    const encodedQuery = encodeURIComponent(query)
    
    switch (eng) {
      case 'duckduckgo':
        return `https://duckduckgo.com/?q=${encodedQuery}`
      case 'bing':
        return `https://www.bing.com/search?q=${encodedQuery}`
      case 'searxng':
        return `${searxngBaseGlobal}/?q=${encodedQuery}`
      case 'google':
      default:
        return `https://www.google.com/search?q=${encodedQuery}`
    }
  }

  // Function to check if input is a URL
  const isValidUrl = (string) => {
    try {
      const url = new URL(string)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      // Check for common URL patterns without protocol
      const urlPattern = /^(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/
      return urlPattern.test(string)
    }
  }

  // Function to normalize URL (add https if missing)
  const normalizeUrl = (input) => {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return input
    }
    if (input.startsWith('www.')) {
      return `https://${input}`
    }
    return `https://${input}`
  }

  const handleSearch = () => {
    const current = (inputRef.current?.value ?? query ?? '').trim()
    if (!current && !attachedImage?.file) return

    // If an image is attached, handle based on inline image search enabled state
    if (attachedImage?.file) {
      // Only do inline image search if the image icon is lit (inlineImageSearchEnabled is true)
      // Otherwise, use external provider (Google Lens)
      if (inlineImageSearchEnabled) {
        performInlineImageSearch(attachedImage.file)
      } else {
        // Use external provider (Google Lens)
        submitImageToLens(attachedImage.file, current)
        clearAttachedImage()
      }
      return
    }

    // Check if input is a URL
    if (isValidUrl(current)) {
      const url = normalizeUrl(current)
      // Do not learn URLs from search history
      setShowSuggestions(false)
      setSuggestions([])

      // Navigate directly to URL
      if (settings?.general?.openInNewTab) {
        window.open(url, '_blank', 'noopener,noreferrer')
      } else {
        window.location.href = url
      }
      return
    }

    // Do not learn from AI mode input
    if (!isAIMode && current) suggestionsService.current.addRecentSearch(current)
    setShowSuggestions(false)
    setSuggestions([])

    if (isAIMode) {
      handleAIQuery()
    } else if (inlineSearchMode) {
      performInlineSearch(current)
    } else {
      performWebSearch(current)
    }
  }

  const handleInlineSearch = async () => {
    const current = (inputRef.current?.value ?? query ?? '').trim()
    if (!current) return
    await performInlineSearch(current)
  }

  const getAIIds = () => {
    let chatId = localStorage.getItem('ai_chat_id')
    if (!chatId) { chatId = makeUuid(); localStorage.setItem('ai_chat_id', chatId) }
    let sessionId = localStorage.getItem('ai_session_id')
    if (!sessionId) { sessionId = makeUuid(); localStorage.setItem('ai_session_id', sessionId) }
    return { chatId, sessionId }
  }
  const handleAIQuery = async () => {
    const prompt = (inputRef.current?.value ?? query ?? '').trim()
    if (!prompt) return
    // Add user bubble
    const userMsg = { role: 'user', content: prompt, id: makeUuid() }
    setAiMessages(prev => [...prev, userMsg])
    setQuery('')
    // Stream assistant response
    await streamAIResponse(prompt, { forceWebSearch: aiWeb })
  }
  const streamAIResponse = async (prompt, opts = {}) => {
    const { chatId, sessionId } = getAIIds()
    const aiEnabled = settings?.ai?.enabled !== false
    if (!aiEnabled) {
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'AI features are disabled. Enable them in Settings → General → AI.', id: makeUuid() }])
      return
    }
    let model = (settings?.ai?.model || '')
    const explicitModelSelected = !!String(model || '').trim()
    const routingEnabled = settings?.ai?.routingEnabled !== false
    const routingMode = settings?.ai?.routingMode || 'auto'
    if (routingEnabled) {
      const promptOnly = prompt
      const looksCode = /```|function\s|class\s|import\s|def\s|var\s|let\s|const\s|=>|#include|public static void main/.test(promptOnly)
      const isLong = (promptOnly || '').length > 6000
      if (routingMode === 'manual' && !explicitModelSelected) {
        const rm = settings?.ai?.routeModels || {}
        if (looksCode && rm.code) model = rm.code
        else if (isLong && rm.long) model = rm.long
        else if (rm.default) model = rm.default
      }
    }
    if (!model) {
      if (!routingEnabled) {
        try {
          const r = await fetch('/ai/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
              lmstudioBaseUrl: settings?.ai?.lmstudioBaseUrl || '',
              openaiApiKey: settings?.ai?.openaiApiKey || '',
              openrouterApiKey: settings?.ai?.openrouterApiKey || '',
              openrouterBaseUrl: settings?.ai?.openrouterBaseUrl || ''
            })
          })
          const data = await r.json().catch(() => ({}))
          const ids = Array.isArray(data?.models) ? data.models : []
          const filtered = ids.map(x => String(x || '')).filter(Boolean).filter(n => !/embedding|embed|^text-embedding|pipe|arena/i.test(n))
          const order = ['llama', 'llama3', 'llama-3', 'qwen', 'mistral', 'phi', 'gemma', 'deepseek', 'gpt']
          const score = (name) => { const n = name.toLowerCase(); for (let i = 0; i < order.length; i++) if (n.includes(order[i])) return i; return 999 }
          const sorted = filtered.slice().sort((a, b) => score(a) - score(b))
          model = sorted[0] || filtered[0] || ''
        } catch {}
      }
    }
    const webSearch = (typeof opts.forceWebSearch === 'boolean') ? !!opts.forceWebSearch : !!(settings?.ai?.webSearch)
    if (!webSearch) {
      lastWebItemsRef.current = []
      previewsAppendedRef.current = false
      sourcesAppendedRef.current = false
    }
    const webProvider = String(settings?.ai?.webSearchProvider || 'searxng')

    // Fetch external web results for non-openwebui providers (with failover)
    let webContext = ''
    if (webSearch && webProvider !== 'openwebui') {
      const withTimeout = async (p, ms = 8000) => {
        let to
        const t = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('timeout')), ms) })
        try { return await Promise.race([p.finally(() => clearTimeout(to)), t]) } finally { clearTimeout(to) }
      }
      let webItems = []
      const asBlock = (items) => items.map((it, idx) => `(${idx+1}) ${it.title}\n${it.url}\n${it.snippet}`.trim()).join('\n\n')
      const maxItems = Number(aiResultsCount || settings?.ai?.webResultsCount || 5)
      const fetchSearxng = async () => {
        const params = new URLSearchParams({ q: prompt, format: 'json', engines: 'duckduckgo,google,startpage,brave' })
        const r = await withTimeout(fetch(`${searxngBaseAiWeb}/search?${params.toString()}`, { headers: { 'Accept': 'application/json' } }), 8000)
        const j = await r.json().catch(() => ({}))
        const arr = Array.isArray(j?.results) ? j.results : []
        return arr.slice(0, maxItems).map(it => ({
          title: it.title || it.url,
          url: it.url,
          snippet: (it.content || it.abstract || '').toString()
        }))
      }
      const fetchFirecrawl = async () => {
        const base = String(settings?.ai?.firecrawlBaseUrl || '/firecrawl').replace(/\/$/, '')
        const body = { query: prompt, limit: maxItems, scrapeOptions: { formats: ['markdown'] } }
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(settings?.ai?.firecrawlApiKey ? { 'Authorization': `Bearer ${settings.ai.firecrawlApiKey}` } : {})
        }
        const r = await withTimeout(fetch(`${base}/v1/search`, { method: 'POST', headers, body: JSON.stringify(body) }), 12000)
        const j = await r.json().catch(() => ({}))
        const arr = Array.isArray(j?.data) ? j.data : []
        return arr.slice(0, maxItems).map(it => ({
          title: it.title || it.url,
          url: it.url,
          snippet: (it.markdown || it.description || '').toString()
        }))
      }

      try {
        let items = []
        if (webProvider === 'firecrawl') {
          try { items = await fetchFirecrawl() } catch (e) { console.warn('Firecrawl search failed', e) }
          if (!items || items.length === 0) {
            try { items = await fetchSearxng() } catch (e) { console.warn('Fallback SearXNG failed', e) }
          }
        } else if (webProvider === 'searxng') {
          try { items = await fetchSearxng() } catch (e) { console.warn('SearXNG search failed', e) }
        }
        if (items && items.length > 0) {
          webItems = items
          lastWebItemsRef.current = items
          previewsAppendedRef.current = false
          sourcesAppendedRef.current = false
          webContext = asBlock(items)
        }
      } catch (e) {
        console.warn('Web provider fetch failed', e)
      }
    }
    // Prepare both payload styles
    const payloadNative = {
      chat_id: chatId,
      id: makeUuid(),
      session_id: sessionId,
      model,
      model_item: model ? { id: model, object: 'model', owned_by: 'openai', connection_type: 'external' } : undefined,
      messages: (
        webContext && webProvider !== 'openwebui'
          ? [
              { id: makeUuid(), role: 'system', content: 'You may use the following web results as context if relevant. Always cite URLs at the end under a Sources section as markdown links.' },
              { id: makeUuid(), role: 'user', content: `${prompt}\n\n[Web results]\n${webContext}` }
            ]
          : [{ id: makeUuid(), role: 'user', content: prompt }]
      ),
      stream: true,
      web_search: (webProvider === 'openwebui') ? webSearch : false
    }
    const msgs = []
    if (String(settings?.ai?.memoryContent || '').trim().length > 0) {
      msgs.push({ role: 'system', content: `User memory:\n${settings.ai.memoryContent}` })
    }
    if (webContext && webProvider !== 'openwebui') {
      msgs.push({ role: 'system', content: 'You may use the following web results as context if relevant. Always cite URLs at the end under a Sources section as markdown links.' })
      msgs.push({ role: 'user', content: `${prompt}\n\n[Web results]\n${webContext}` })
    } else {
      msgs.push({ role: 'user', content: prompt })
    }
    const payloadOpenAI = {
      model,
      chat_id: chatId,
      session_id: sessionId,
      providerConfig: {
        lmstudioBaseUrl: settings?.ai?.lmstudioBaseUrl || '',
        openaiApiKey: settings?.ai?.openaiApiKey || '',
        openaiBaseUrl: settings?.ai?.openaiBaseUrl || '',
        openrouterApiKey: settings?.ai?.openrouterApiKey || '',
        openrouterBaseUrl: settings?.ai?.openrouterBaseUrl || '',
        preferLocal: !!settings?.ai?.preferLocal
      },
      include_memory: !!aiIncludeMemory,
      memory_turns: Number(settings?.ai?.memoryTurns || 6),
      messages: msgs,
      stream: true,
    }
    // Prepare abort controller and mark as streaming
    const ac = new AbortController()
    aiAbortRef.current = ac
    setAiStreaming(true)
    const tryFetch = async (url, body) => fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache'
      },
      credentials: 'include',
      body: JSON.stringify(body),
      signal: ac.signal
    })
    // Call unified AI backend
    let res = null
    try { res = await tryFetch('/ai/v1/chat/completions', payloadOpenAI) } catch {}
    if (!res) {
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'AI request failed (provider config/model). Check AI settings for LM Studio/OpenAI/OpenRouter.', id: makeUuid() }])
      setAiStreaming(false)
      aiAbortRef.current = null
      return
    }
    const ctype = String(res.headers.get('content-type') || '').toLowerCase()
    // JSON (non-streaming) fallback path
    if (!ctype.includes('text/event-stream')) {
      try {
        const data = await res.json()
        const text = data?.choices?.[0]?.message?.content || data?.message?.content || data?.content || ''
        if (text) {
          const thisId = makeUuid()
          // Attach panels with webItems (if any)
          setAiMessages(prev => [...prev, { role: 'assistant', content: text, id: thisId, panels: (Array.isArray(lastWebItemsRef.current) && lastWebItemsRef.current.length > 0) ? { webItems: lastWebItemsRef.current.slice(0) } : undefined }])
          // Disabled: avoid appending a separate Sources bubble
          // Voice-to-voice: speak final assistant reply if enabled
          try { if (fullVoiceMode) speakText(text) } catch {}
          setAiStreaming(false)
          aiAbortRef.current = null
          return
        }
      } catch {}
      setAiMessages(prev => [...prev, { role: 'assistant', content: '(AI returned no content)', id: makeUuid() }])
      setAiStreaming(false)
      aiAbortRef.current = null
      return
    }
    // SSE streaming path
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let assistantId = makeUuid()
    setAiMessages(prev => [...prev, { role: 'assistant', content: '', id: assistantId }])
    lastAssistantTextRef.current = ''
    let buf = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          const s = line.trim()
          if (!s) continue
          if (s === '[DONE]' || s === 'data: [DONE]') { buf = ''; break }
          const payloadLine = s.startsWith('data:') ? s.slice(5).trim() : s
          try {
            const obj = JSON.parse(payloadLine)
            const delta = obj.delta || obj.choices?.[0]?.delta?.content || obj.choices?.[0]?.message?.content || obj.message?.content || obj.content || ''
            if (typeof delta === 'string' && delta) {
              setAiMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: (m.content + delta) } : m))
              lastAssistantTextRef.current = (lastAssistantTextRef.current || '') + delta
            }
          } catch {}
        }
      }
    } catch (e) {
      // Swallow aborts
    }
    // Flush remainder buffer if any
    if (buf && buf.trim()) {
      try {
        const obj = JSON.parse(buf.trim().startsWith('data:') ? buf.trim().slice(5).trim() : buf.trim())
        const delta = obj.delta || obj.choices?.[0]?.delta?.content || obj.choices?.[0]?.message?.content || obj.message?.content || obj.content || ''
        if (typeof delta === 'string' && delta) {
          setAiMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: (m.content + delta) } : m))
          lastAssistantTextRef.current = (lastAssistantTextRef.current || '') + delta
        }
      } catch {}
    }
    // Attach panels with webItems (if any)
    try {
      if (Array.isArray(lastWebItemsRef.current) && lastWebItemsRef.current.length > 0) {
        setAiMessages(prev => prev.map(m => m.id === assistantId ? { ...m, panels: { webItems: lastWebItemsRef.current.slice(0) } } : m))
        // Disabled: avoid appending a separate Sources bubble
      }
    } catch {}
    // Voice-to-voice: speak final assistant reply if enabled
    try { if (fullVoiceMode) speakText(lastAssistantTextRef.current) } catch {}
    setAiStreaming(false)
    aiAbortRef.current = null
  }

  const toggleInlineSearchMode = (e) => {
    // Right-click: toggle inline image search mode
    if (e?.button === 2 || e?.ctrlKey || e?.metaKey) {
      e?.preventDefault()
      e?.stopPropagation()
      const newValue = !inlineImageSearchEnabled
      setInlineImageSearchEnabled(newValue)
      try {
        localStorage.setItem('inlineImageSearchEnabled', String(newValue))
      } catch {}
      // If right-clicking on globe icon (no image), enable inline mode and show image icon
      if (!attachedImage?.file && !inlineSearchMode && settings?.search?.inlineEnabled !== false) {
        setInlineSearchMode(true)
      }
      return
    }
    
    // Left-click: toggle states only, never perform search
    // If image icon is showing (attached or from right-click), toggle lit state
    if (inlineModeIconState.isImage) {
      const newValue = !inlineImageSearchEnabled
      setInlineImageSearchEnabled(newValue)
      try {
        localStorage.setItem('inlineImageSearchEnabled', String(newValue))
      } catch {}
      return
    }
    
    // Left-click on globe icon: toggle inline search mode
    if (isPinned && showInlineResults) {
      setShowInlineResults(false)
      setIsPinned(false)
      setInlineSearchMode(false)
    } else {
      if (settings?.search?.inlineEnabled === false) {
        return
      }
      setInlineSearchMode(!inlineSearchMode)
      if (showInlineResults) {
        setShowInlineResults(false)
        setIsPinned(false)
      }
    }
  }

  const collapseViaBottomSliver = () => {
    setShowInlineResults(false)
    setIsPinned(false)
    setLinkMenu(prev => (prev.open ? { ...prev, open: false } : prev))
    // Clear any inline query text once the search bar returns
    try {
      handleInputChange('')
    } catch {
      setQuery('')
    }
  }

  const handleWebSearch = () => {
    const current = (inputRef.current?.value ?? query ?? '').trim()
    if (!current) return
    performWebSearch(current)
    setQuery('')
  }

  const handleFileUpload = () => {}

  // Function to attach an image from a File object (exposed via ref)
  const attachImageFromFile = useCallback(async (file) => {
    try {
      if (!file || !(file instanceof File)) return
      if (!/^image\//.test(file.type)) return
      
      const preview = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(file)
      })
      const makeThumb = (src) => new Promise((resolve) => {
        const im = new Image()
        im.onload = () => {
          const max = 56
          const r = Math.min(max / im.width, max / im.height, 1)
          const w = Math.max(1, Math.round(im.width * r))
          const h = Math.max(1, Math.round(im.height * r))
          const c = document.createElement('canvas')
          c.width = w; c.height = h
          const ctx = c.getContext('2d')
          ctx.drawImage(im, 0, 0, w, h)
          resolve(c.toDataURL('image/png'))
        }
        im.src = src
      })
      const thumb = await makeThumb(preview)
      setAttachedImage({ file, preview: thumb })
    } catch (error) {
      console.error('Failed to attach image:', error)
    }
  }, [])

  const onDragOverContainer = (e) => {
    try { if (e?.dataTransfer?.types?.includes('Files')) e.preventDefault() } catch {}
  }
  const onDropContainer = async (e) => {
    try {
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files || [])
      const img = files.find(f => /^image\//.test(f.type))
      if (!img) return
      await attachImageFromFile(img)
      // When image is dropped, enable inline mode if not already enabled
      if (!inlineSearchMode && settings?.search?.inlineEnabled !== false) {
        setInlineSearchMode(true)
      }
    } catch {}
  }

  const clearAttachedImage = () => setAttachedImage(null)
  
  // Expose attachImageFromFile via ref
  useImperativeHandle(ref, () => ({
    attachImage: attachImageFromFile
  }), [attachImageFromFile])

  const submitImageToLens = async (file, queryText) => {
    try {
      let imageFile = file instanceof File ? file : new File([file], 'image.png', { type: 'image/png' })
      
      // Compress/resize large images to reduce upload size
      // For OpenWeb Ninja GET requests, we need very small images to avoid 414 URI too large
      // Base64 encoding increases size by ~33%, so we need to keep original < 50KB for GET requests
      const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB target for POST fallback
      const COMPRESS_THRESHOLD = 50 * 1024 // Compress if > 50KB (very aggressive for GET requests)
      const MAX_DIMENSION = 800 // max width or height (very small to keep base64 < 150KB)
      
      // Always compress if image is large enough and is an image file
      if (imageFile.size > COMPRESS_THRESHOLD && imageFile.type.startsWith('image/')) {
        try {
          const img = new Image()
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          
          const imageUrl = URL.createObjectURL(imageFile)
          await new Promise((resolve, reject) => {
            img.onload = () => {
              try {
                let { width, height } = img
                
                // Resize if too large
                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                  const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
                  width = Math.round(width * ratio)
                  height = Math.round(height * ratio)
                }
                
                canvas.width = width
                canvas.height = height
                ctx.drawImage(img, 0, 0, width, height)
                
                // Progressive quality reduction until we hit target size
                // For OpenWeb Ninja GET requests, we need very small files (< 50KB to keep base64 < 100KB)
                const TARGET_SIZE_FOR_GET = 40 * 1024 // 40KB target (base64 will be ~53KB)
                const tryCompress = (quality, attempts = 0) => {
                  if (attempts > 10) {
                    // Give up after 10 attempts and use the best we have
                    URL.revokeObjectURL(imageUrl)
                    resolve()
                    return
                  }
                  
                  canvas.toBlob((blob) => {
                    try {
                      if (blob) {
                        // Always use compressed version if original was too large, or if compressed is smaller
                        const shouldUseCompressed = imageFile.size > COMPRESS_THRESHOLD || blob.size < imageFile.size
                        
                        if (shouldUseCompressed) {
                          imageFile = new File([blob], (imageFile.name || 'image').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
                          console.log(`Image compressed: ${Math.round(imageFile.size / 1024)}KB (${width}x${height}, quality: ${Math.round(quality * 100)}%)`)
                          
                          // If still too large for GET requests and quality can be reduced further, try again
                          if (imageFile.size > TARGET_SIZE_FOR_GET && quality > 0.3) {
                            const newQuality = Math.max(0.3, quality - 0.1)
                            tryCompress(newQuality, attempts + 1)
                            return
                          }
                          // Also check if still too large for POST fallback
                          if (imageFile.size > MAX_FILE_SIZE && quality > 0.3) {
                            const newQuality = Math.max(0.3, quality - 0.1)
                            tryCompress(newQuality, attempts + 1)
                            return
                          }
                        }
                      }
                      URL.revokeObjectURL(imageUrl)
                      resolve()
                    } catch (err) {
                      URL.revokeObjectURL(imageUrl)
                      reject(err)
                    }
                  }, 'image/jpeg', quality)
                }
                
                // Start with lower quality (0.7) for more aggressive compression
                tryCompress(0.7)
              } catch (err) {
                URL.revokeObjectURL(imageUrl)
                reject(err)
              }
            }
            img.onerror = () => {
              URL.revokeObjectURL(imageUrl)
              reject(new Error('Failed to load image'))
            }
            img.src = imageUrl
          })
        } catch (compressError) {
          console.warn('Image compression failed, using original:', compressError)
          // Continue with original file if compression fails
        }
      }
      
      const externalProvider = settings?.search?.imageSearch?.externalProvider || 'google-lens'
      const searxngBase = normalizeSearxngBase(settings?.search?.searxngBaseUrl, '/searxng')
      
      // Check if using Google Lens
      if (externalProvider === 'google-lens') {
        console.log('submitImageToLens - Using Google Lens, Image size:', Math.round(imageFile.size / 1024), 'KB')
        
        try {
          // Upload image via server (which will try to upload to public hosting)
          const uploadFormData = new FormData()
          uploadFormData.append('image', imageFile)
          // Include imgbb API key if available
          // Try multiple ways to get the API key (in case settings structure is different)
          const imgbbApiKey = settings?.search?.imgbbApiKey || 
                              settings?.imgbbApiKey || 
                              (typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('settings') || '{}')?.search?.imgbbApiKey : '') ||
                              ''
          
          console.log('ImgBB API key check:', { 
            hasKey: !!imgbbApiKey, 
            keyLength: imgbbApiKey ? imgbbApiKey.length : 0,
            keyPrefix: imgbbApiKey ? imgbbApiKey.substring(0, 10) + '...' : 'none',
            fromSettings: !!settings?.search?.imgbbApiKey,
            fromRoot: !!settings?.imgbbApiKey,
            settingsKeys: settings ? Object.keys(settings) : [],
            searchKeys: settings?.search ? Object.keys(settings.search) : []
          })
          
          if (imgbbApiKey && String(imgbbApiKey).trim()) {
            uploadFormData.append('imgbbApiKey', String(imgbbApiKey).trim())
            console.log('✅ Added imgbbApiKey to form data')
          } else {
            console.warn('⚠️ No imgbbApiKey found! Please enter it in Settings → General → Image Search')
          }
          
          console.log('Uploading to /upload-for-lens, API key present:', !!imgbbApiKey && String(imgbbApiKey).trim().length > 0)
          
          // Try direct connection first (bypass Vite proxy if possible)
          let uploadResponse
          try {
            uploadResponse = await fetch('http://127.0.0.1:3300/upload-for-lens', {
              method: 'POST',
              body: uploadFormData,
            })
            console.log('Direct connection to server succeeded')
          } catch (directError) {
            console.log('Direct connection failed, trying Vite proxy:', directError.message)
            // Fallback to Vite proxy
            uploadResponse = await fetch('/upload-for-lens', {
              method: 'POST',
              body: uploadFormData,
            })
          }
          
          console.log('Upload response status:', uploadResponse.status, uploadResponse.statusText)
          
          if (!uploadResponse.ok) {
            throw new Error(`Upload failed: ${uploadResponse.status}`)
          }
          
          const uploadData = await uploadResponse.json()
          
          if (!uploadData.success) {
            throw new Error(uploadData.error || 'Upload failed')
          }
          
          // Check if we got a public URL
          if (uploadData.public && uploadData.url) {
            // Public URL from image hosting service
            const lensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(uploadData.url)}`
            console.log('Opening Google Lens with public URL:', lensUrl)
            
            if (settings?.general?.openInNewTab) {
              window.open(lensUrl, '_blank', 'noopener,noreferrer')
            } else {
              window.location.href = lensUrl
            }
            clearAttachedImage()
            return
          } else if (uploadData.needsPublicUrl) {
            // Server returned local URL - Google Lens can't access it
            throw new Error('Public image hosting not configured. Please set IMGBB_API_KEY environment variable on the server, or upload manually to Google Lens.')
          }
          
          throw new Error('No public URL returned from server')
        } catch (lensError) {
          console.error('Google Lens upload failed:', lensError)
          
          // Final fallback: Open Google Lens with instructions
          const lensUrl = 'https://lens.google.com/'
          if (settings?.general?.openInNewTab) {
            window.open(lensUrl, '_blank', 'noopener,noreferrer')
          } else {
            window.location.href = lensUrl
          }
          
          alert('Google Lens opened. Please upload your image manually:\n1. Click the camera/upload icon\n2. Select your image\n\nReason: ' + lensError.message + '\n\nTip: To enable automatic upload, set IMGBB_API_KEY environment variable on your server.')
          clearAttachedImage()
          return
        }
      }
      
      // Check if using SearXNG for reverse image search
      if (externalProvider === 'searxng') {
        console.log('submitImageToLens - Using SearXNG, Image size:', Math.round(imageFile.size / 1024), 'KB')
        
        try {
          // SearXNG reverse image search: Use image_url parameter with data URL
          // Convert image to data URL for SearXNG
          const imageDataUrl = await readFileToDataURL(imageFile)
          
          // SearXNG reverse image search: GET with image_url parameter
          const params = new URLSearchParams({
            image_url: imageDataUrl,
            format: 'json',
            categories: 'images'
          })
          
          const searxngResponse = await fetch(`${searxngBase}/search?${params.toString()}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
          })
          
          if (!searxngResponse.ok) {
            // If GET fails, try POST with multipart form
            console.log('SearXNG GET failed, trying POST with multipart form')
            const searxngFormData = new FormData()
            searxngFormData.append('file', imageFile)
            searxngFormData.append('format', 'json')
            searxngFormData.append('categories', 'images')
            
            const searxngPostResponse = await fetch(`${searxngBase}/search`, {
              method: 'POST',
              body: searxngFormData,
            })
            
            if (!searxngPostResponse.ok) {
              throw new Error(`SearXNG error: ${searxngPostResponse.status}`)
            }
            
            const searxngData = await searxngPostResponse.json()
            console.log('SearXNG reverse image search response (POST):', searxngData)
            
            // Open SearXNG results page with the image
            const searxngResultsUrl = `${searxngBase}/?image_url=${encodeURIComponent(imageDataUrl)}`
            if (settings?.general?.openInNewTab) {
              window.open(searxngResultsUrl, '_blank', 'noopener,noreferrer')
            } else {
              window.location.href = searxngResultsUrl
            }
            clearAttachedImage()
            return
          }
          
          const searxngData = await searxngResponse.json()
          console.log('SearXNG reverse image search response (GET):', searxngData)
          
          // SearXNG returns results in data.results array
          if (searxngData.results && Array.isArray(searxngData.results) && searxngData.results.length > 0) {
            // Open SearXNG results page with the image
            const searxngResultsUrl = `${searxngBase}/?image_url=${encodeURIComponent(imageDataUrl)}`
            if (settings?.general?.openInNewTab) {
              window.open(searxngResultsUrl, '_blank', 'noopener,noreferrer')
            } else {
              window.location.href = searxngResultsUrl
            }
            clearAttachedImage()
            return
          } else {
            // No results, fall back to direct providers
            console.warn('SearXNG returned no results, falling back to direct provider')
            // Fall through to direct provider logic below
          }
        } catch (searxngError) {
          console.warn('SearXNG reverse image search failed, falling back to direct provider:', searxngError)
          // Fall through to direct provider logic below
        }
      }
      
      // If we get here, SearXNG failed and we don't have a valid provider
      console.error('submitImageToLens - No valid external provider or all providers failed')
      alert('Reverse image search failed. Please try again or check your settings.')
      clearAttachedImage()
      return
      
      const response = await fetch('/image-search/search', {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) {
        let errorMessage = `Server error: ${response.status}`
        if (response.status === 413) {
          errorMessage = 'Image file is too large. Please use an image smaller than 50MB, or compress/resize it before uploading.'
        } else {
          const errorData = await response.json().catch(() => ({ error: errorMessage }))
          errorMessage = errorData.error || errorMessage
        }
        console.error('Image search proxy error:', { status: response.status, error: errorMessage })
        alert(`Reverse image search failed: ${errorMessage}. Check console for details.`)
        clearAttachedImage()
        return
      }
      
      const data = await response.json()
      console.log('Image search proxy response:', data)
      
      if (data.success && data.redirectUrl) {
        // Redirect to the results page
        if (settings?.general?.openInNewTab) {
          window.open(data.redirectUrl, '_blank', 'noopener,noreferrer')
        } else {
          window.location.href = data.redirectUrl
        }
        clearAttachedImage()
      } else if (data.success && data.results && Array.isArray(data.results) && data.results.length > 0) {
        // Future: Display results inline
        // For now, redirect to provider's results page
        const fallbackUrl = data.provider === 'openwebninja' 
          ? 'https://www.openwebninja.com/results'
          : 'https://www.tineye.com/search/'
        
        if (settings?.general?.openInNewTab) {
          window.open(fallbackUrl, '_blank', 'noopener,noreferrer')
        } else {
          window.location.href = fallbackUrl
        }
        clearAttachedImage()
      } else {
        console.error('Image search returned unsuccessful result:', data)
        alert(`Reverse image search failed: ${data.error || 'Unknown error'}. Check console for details.`)
        clearAttachedImage()
      }
    } catch (e) {
      console.error('Reverse image search failed:', e)
      alert(`Reverse image search failed: ${e.message}. Check console for details.`)
      clearAttachedImage()
    }
  }

  const extractDomain = (url) => {
    try {
      if (url.startsWith('http')) {
        return new URL(url).hostname
      }
      return url
    } catch {
      return 'unknown'
    }
  }

  const handleSuggestionDelete = useCallback((s) => {
    try {
      // Remove from recents/history if applicable
      if (s?.isRecent && s?.text) suggestionsService.current.removeRecentSearch(s.text)
      if (s?.url) suggestionsService.current.removeHistoryByUrl(s.url)
      suggestionsService.current.removeStatsFor({ text: s?.text, url: s?.url })
      suggestionsService.current.addToBlocklist(s)
    } catch {}
    // Refresh list without the deleted suggestion
    mergeAndSetSuggestions(suggestions.filter(x => !(x.text === s.text && (!!x.url) === (!!s.url))), query)
  }, [mergeAndSetSuggestions, suggestions, query])

  // Fetch AI models from OpenWebUI-compatible endpoints
  const refreshAiModels = useCallback(async () => {
    setIsLoadingModels(true)
    try {
      const r = await fetch('/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          lmstudioBaseUrl: settings?.ai?.lmstudioBaseUrl || '',
          openaiApiKey: settings?.ai?.openaiApiKey || '',
          openrouterApiKey: settings?.ai?.openrouterApiKey || '',
          openrouterBaseUrl: settings?.ai?.openrouterBaseUrl || ''
        })
      })
      const data = await r.json().catch(() => ({}))
      const names = Array.isArray(data?.models) ? data.models : []
      const filtered = names.map(n => String(n)).filter(Boolean).filter(n => !/embedding|embed|^text-embedding|pipe|arena/i.test(String(n)))
      setAiModels(filtered)
    } catch {
      setAiModels([])
    } finally {
      setIsLoadingModels(false)
    }
  }, [settings?.ai?.lmstudioBaseUrl, settings?.ai?.openaiApiKey, settings?.ai?.openrouterApiKey, settings?.ai?.openrouterBaseUrl])

  // Handle model menu open/close and outside click/ESC
  const toggleModelMenu = useCallback((forceValue) => {
    setShowChatLogMenu(false)
    setShowModelMenu(prev => {
      const next = typeof forceValue === 'boolean' ? forceValue : !prev
      if (next && aiModels.length === 0 && !isLoadingModels) {
        refreshAiModels()
      }
      if (!next) closeModelCtx()
      return next
    })
  }, [aiModels.length, isLoadingModels, refreshAiModels, closeModelCtx, setShowChatLogMenu])

  const toggleChatLogMenu = useCallback(() => {
    setShowModelMenu(false)
    closeModelCtx()
    setShowChatLogMenu(prev => !prev)
  }, [closeModelCtx])

  const handleBotButtonContextMenu = useCallback((e) => {
    e.preventDefault()
    if (aiStreaming) return
    if (showModelMenu) {
      toggleModelMenu(false)
    } else {
      toggleModelMenu(true)
    }
  }, [aiStreaming, showModelMenu, toggleModelMenu])

  useEffect(() => {
    if (!showModelMenu) return
    const onDown = (e) => {
      try {
        const t = e.target
        const inMenu = !!(modelMenuRef.current && modelMenuRef.current.contains(t))
        const inBtn = !!(botButtonRef.current && botButtonRef.current.contains(t))
        if (!inMenu && !inBtn) setShowModelMenu(false)
        // Close context menu on any click outside
        if (!(modelMenuRef.current && modelMenuRef.current.contains(t))) closeModelCtx()
      } catch {}
    }
    const onKey = (e) => { if (e.key === 'Escape') { setShowModelMenu(false); closeModelCtx() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showModelMenu, closeModelCtx])

  useEffect(() => {
    if (!showChatLogMenu) return
    const onDown = (e) => {
      try {
        const t = e.target
        const inMenu = !!(chatLogMenuRef.current && chatLogMenuRef.current.contains(t))
        const inBtn = !!(botButtonRef.current && botButtonRef.current.contains(t))
        if (!inMenu && !inBtn) setShowChatLogMenu(false)
      } catch {}
    }
    const onKey = (e) => { if (e.key === 'Escape') setShowChatLogMenu(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showChatLogMenu])

  // Close model menu when leaving AI mode
  useEffect(() => {
    if (!isAIMode && showModelMenu) setShowModelMenu(false)
  }, [isAIMode, showModelMenu])

  useEffect(() => {
    if (!isAIMode && showChatLogMenu) setShowChatLogMenu(false)
  }, [isAIMode, showChatLogMenu])

  const selectAiModel = useCallback((m) => {
    try { window.dispatchEvent(new CustomEvent('app-ai-change-model', { detail: m })) } catch {}
    setShowModelMenu(false)
    closeModelCtx()
  }, [closeModelCtx])

  const ChatLogMenu = () => {
    const hasChats = sortedChatSessions.length > 0
    return (
      <>
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 sticky top-0 bg-black/70 backdrop-blur-sm">
          <span className="text-[11px] uppercase tracking-[0.16em] text-white/70">Chat History</span>
          <button
            type="button"
            onClick={createNewChatSession}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15 border border-white/15 text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        </div>
        <div className="max-h-[220px] overflow-y-auto no-scrollbar py-1">
          {hasChats ? (
            sortedChatSessions.map(session => (
              <button
                type="button"
                key={session.id}
                onClick={() => handleSelectChatSession(session.id)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-3 ${
                  session.id === activeChatId ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-sm truncate">
                    {session.pinned && (<Pin className="w-3 h-3 text-amber-300 flex-shrink-0" />)}
                    <span className="truncate">{session.title || DEFAULT_CHAT_TITLE}</span>
                  </div>
                  <div className="text-[10px] text-white/40">{formatChatTimestamp(session.updatedAt) || 'Just now'}</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                    title={session.pinned ? 'Unpin chat' : 'Pin chat'}
                    onClick={(e) => { e.stopPropagation(); togglePinChatSession(session.id) }}
                  >
                    {session.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-white/10 text-red-300/80 hover:text-red-200 transition-colors"
                    title="Delete chat"
                    onClick={(e) => { e.stopPropagation(); deleteChatSession(session.id) }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </button>
            ))
          ) : (
            <div className="px-3 py-4 text-sm text-white/60">
              No chats saved yet. Ask something to get started.
            </div>
          )}
        </div>
      </>
    )
  }

  // Model menu UI (shared in both positions)
  const ModelMenuList = ({
    header = 'AI Models'
  }) => {
    // Order models: pinned first (dedup), then the rest
    const pinned = (aiModels || []).filter(m => isPinnedModel(m))
    const rest = (aiModels || []).filter(m => !isPinnedModel(m))
    const hasPinned = pinned.length > 0
    return (
      <>
        <div className="p-2 text-white text-xs border-b border-white/10 sticky top-0 bg-black/60 backdrop-blur-sm">{header}</div>
        <div className="py-1">
          <button
            className={`w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors flex items-center gap-2`}
            onClick={() => selectAiModel('')}
            title="Routing (use settings)"
          >
            <span className="flex-1">Routing (use settings)</span>
            {!settings?.ai?.model && (<Check className="w-4 h-4 text-cyan-300" />)}
          </button>
          {isLoadingModels && (
            <div className="px-3 py-2 text-sm text-white">Loading models…</div>
          )}
          {!isLoadingModels && aiModels.length === 0 && (
            <div className="px-3 py-2 text-sm text-white">No models found</div>
          )}
          {!isLoadingModels && hasPinned && (
            <div className="px-3 py-1 text-xs text-white/70">Pinned</div>
          )}
          {!isLoadingModels && pinned.map((m) => (
            <button
              key={`p-${m}`}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors flex items-center gap-2 text-white`}
              onClick={() => selectAiModel(m)}
              onContextMenu={(e) => openModelCtx(e, m)}
              title={m}
            >
              <span className="flex-1 truncate">{m}</span>
              {(settings?.ai?.model === m) && (<Check className="w-4 h-4 text-cyan-300 flex-shrink-0" />)}
            </button>
          ))}
          {!isLoadingModels && hasPinned && (
            <div className="px-3 py-1 text-xs text-white/50">All models</div>
          )}
          {!isLoadingModels && rest.map((m) => (
            <button
              key={m}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors flex items-center gap-2 text-white`}
              onClick={() => selectAiModel(m)}
              onContextMenu={(e) => openModelCtx(e, m)}
              title={m}
            >
              <span className="flex-1 truncate">{m}</span>
              {(settings?.ai?.model === m) && (<Check className="w-4 h-4 text-cyan-300 flex-shrink-0" />)}
            </button>
          ))}
        </div>
        {/* Context menu */}
        {modelCtx.open && !settingsPanelOpen && (
          <div
            className="absolute z-[10001] border border-white/20 rounded-md bg-black/90 backdrop-blur-md shadow-xl text-white text-sm"
            style={{ left: modelCtx.x, top: modelCtx.y, minWidth: '160px' }}
            onMouseLeave={() => closeModelCtx()}
          >
            <button
              className="block w-full text-left px-3 py-2 hover:bg-white/10"
              onClick={() => selectAiModel(modelCtx.name)}
            >Make default</button>
            {modelCtx.name && (
              <button
                className="block w-full text-left px-3 py-2 hover:bg-white/10"
                onClick={() => { togglePinModel(modelCtx.name); closeModelCtx() }}
              >{isPinnedModel(modelCtx.name) ? 'Unpin model' : 'Pin model'}</button>
            )}
          </div>
        )}
      </>
    )
  }

  // Suggestions dropdown component
  const SuggestionsDropdown = ({ isDropUp = false }) => {
    const BLUR_MAX = 64
    const blurPx = Math.max(0, Number(suggBlurPx) || 0)
    const clampedBlurPx = Math.min(BLUR_MAX, blurPx)
    const blurFilter = clampedBlurPx > 0 ? `blur(${clampedBlurPx}px)` : 'none'
    const blurStrength01 = (() => {
      if (clampedBlurPx <= 0) return 0
      return Math.max(0, Math.min(1, clampedBlurPx / BLUR_MAX))
    })()
    const suggestionsGlassBg = (() => {
      // Tie tint opacity to blur strength so the slider visibly affects the background
      if (blurPx <= 0) return 'transparent'
      const base = suggRemoveBg ? 0.02 : 0.10
      const extra = 0.25 * blurStrength01
      const alpha = Math.max(0, Math.min(0.55, base + extra))
      const darkAlpha = Math.max(0, Math.min(0.65, (suggRemoveBg ? 0.06 : 0.18) + extra))
      return (isPinned && showInlineResults)
        ? `rgba(0,0,0,${darkAlpha})`
        : `rgba(15,23,42,${alpha})`
    })()

    return (
      <AnimatePresence>
        {!settingsPanelOpen && showSuggestions && suggestions.length > 0 && (
          <motion.div
            className={`absolute left-0 right-0 search-suggestions-container ${
              isDropUp ? 'bottom-full mb-2' : 'top-full mt-2'
            } z-[9999]`}
            initial={{ opacity: 0, y: isDropUp ? 10 : -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: isDropUp ? 10 : -10 }}
            transition={{ duration: 0.2 }}
            style={{
              backdropFilter: blurFilter,
              WebkitBackdropFilter: blurFilter
            }}
          >
            <div
              className={`rounded-xl overflow-hidden ${
                (suggRemoveOutline ? '' : (isPinned && showInlineResults ? 'border border-white/30' : 'border border-white/20'))
              } ${
                (suggUseShadows ? (isPinned && showInlineResults ? 'shadow-2xl shadow-black/60' : 'shadow-2xl shadow-black/40') : '')
              } relative`}
              style={{ background: 'transparent' }}
            >
              <div
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: suggestionsGlassBg,
                  backdropFilter: blurFilter,
                  WebkitBackdropFilter: blurFilter
                }}
              />
              {isLoadingSuggestions ? (
                <div className="relative z-10 p-4 text-center text-white/70 text-sm">
                  <div className="inline-flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white/70 rounded-full animate-spin"></div>
                    Loading suggestions...
                  </div>
                </div>
              ) : (
                <div
                  ref={suggestionsScrollRef}
                  className="overflow-y-auto suggestions-scroll-container relative z-10"
                  style={{ maxHeight: suggMaxHeight ? `${suggMaxHeight}px` : undefined }}
                  onWheel={(e) => {
                    try {
                      const el = suggestionsScrollRef.current
                      if (!el) return
                      const atBottom = el.scrollTop >= (el.scrollHeight - el.clientHeight - 1)
                      if (atBottom && e.deltaY > 0) { e.preventDefault(); e.stopPropagation(); }
                    } catch {}
                  }}
                  onScroll={() => {
                    try {
                      const el = suggestionsScrollRef.current
                      if (!el) return
                      const ov = el.scrollHeight > el.clientHeight + 1
                      setSuggOverflowing(ov)
                    } catch {}
                  }}
                >
                {suggOverflowing && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 left-0 right-0"
                    style={{ height: '28px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.28), rgba(0,0,0,0))', filter: 'blur(0.2px)' }}
                  />
                )}
                {suggestions.map((suggestion, index) => (
                    <motion.div
                      key={`${suggestion.text}-${suggestion.source || 'base'}`}
                      className={`px-4 py-3 cursor-pointer transition-all duration-200 ${
                        index === selectedSuggestionIndex
                          ? 'bg-white/25 backdrop-blur-sm'
                          : 'hover:bg-white/15 hover:backdrop-blur-sm'
                      }`}
                      data-sugg-idx={index}
                      onMouseEnter={() => setSelectedSuggestionIndex(index)}
                      onClick={() => handleSuggestionSelect(suggestion)}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <div className="flex items-center gap-3">
                        {suggestion.url ? (
                          <Globe className="w-4 h-4 flex-shrink-0" style={{ color: suggUseDefaultColor ? '#ffffff' : undefined }} />
                        ) : (
                          <Search className="w-4 h-4 flex-shrink-0" style={{ color: suggUseDefaultColor ? '#ffffff' : undefined }} />
                        )}
                        <span
                          className="text-sm flex-1 truncate"
                          style={{
                            color: suggUseDefaultColor ? '#ffffff' : undefined,
                            fontFamily: suggUseDefaultFont ? 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' : undefined
                          }}
                        >
                          {String((suggestion.text || '')).replace(/\(url\)/ig, '').trim()}
                        </span>
                        
                        <button
                          className="ml-2 p-1 text-white/40 hover:text-white/80 transition-colors flex-shrink-0"
                          title={'Hide this suggestion'}
                          onClick={(e) => { e.stopPropagation(); handleSuggestionDelete(suggestion); }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    )
  }

  const chatScrollRef = useRef(null)
  // Auto-scroll to bottom when messages change
  useEffect(() => {
    try {
      const el = chatScrollRef.current
      if (!el) return
      // smooth scroll to bottom
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } catch {}
  }, [aiMessages])

  useLayoutEffect(() => {
    const node = inputRowEl
    if (!node) return

    const updateHeight = (value) => {
      if (!value || Number.isNaN(value)) return
      const rounded = Math.ceil(value)
      if (baseRowHeight === null || (!isAIMode && Math.abs(baseRowHeight - rounded) > 0.5)) {
        setBaseRowHeight(rounded)
      }
    }

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        const measured = entry?.contentRect?.height
        updateHeight(measured)
      })
      observer.observe(node)
      return () => observer.disconnect()
    }

    updateHeight(node.getBoundingClientRect().height)
  }, [isAIMode, baseRowHeight, inputRowEl])

  useLayoutEffect(() => {
    if (!searchContainerEl) {
      setAiChatHostRect(null)
      return
    }

    let frameId = null
    const updateBounds = () => {
      try {
        const rect = searchContainerEl.getBoundingClientRect()
        const left = Math.round(rect.left * 100) / 100
        const top = Math.round(rect.top * 100) / 100
        const width = Math.round(rect.width * 100) / 100
        const center = Math.round((left + width / 2) * 100) / 100
        const vh = (typeof window !== 'undefined' ? window.innerHeight : 0)
        const GAP = 2
        const bottom = Math.max(GAP, Math.round(vh - rect.top + GAP))
        const maxHeight = Math.max(240, Math.round(rect.top - 24) + 160)
        if (!Number.isFinite(left) || !Number.isFinite(width) || !Number.isFinite(top)) return
        setAiChatHostRect(prev => {
          if (
            prev &&
            Math.abs(prev.left - left) < 0.5 &&
            Math.abs(prev.width - width) < 0.5 &&
            Math.abs(prev.center - center) < 0.5 &&
            Math.abs(prev.bottom - bottom) < 0.5 &&
            Math.abs(prev.maxHeight - maxHeight) < 0.5 &&
            Math.abs(prev.top - top) < 0.5
          ) {
            return prev
          }
          return { left, width, center, bottom, maxHeight, top }
        })
      } catch {}
    }

    updateBounds()

    const handleResize = () => {
      if (frameId) cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(updateBounds)
    }

    let observer
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => updateBounds())
      try { observer.observe(searchContainerEl) } catch {}
    }

    let intervalId
    if (!observer) {
      intervalId = setInterval(updateBounds, 400)
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize)
      window.addEventListener('scroll', handleResize, true)
    }

    return () => {
      if (observer) {
        try { observer.disconnect() } catch {}
      }
      if (intervalId) clearInterval(intervalId)
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize)
        window.removeEventListener('scroll', handleResize, true)
      }
      if (frameId) cancelAnimationFrame(frameId)
    }
  }, [searchContainerEl])

  // Double-rAF capture to ensure fonts/icons are loaded before locking baseline
  useEffect(() => {
    if (isAIMode) return
    const node = inputRowEl
    if (!node) return
    let raf1 = 0, raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        try {
          const h = Math.ceil(node.getBoundingClientRect().height)
          setBaseRowHeight(prev => (prev == null ? h : Math.max(prev, h)))
        } catch {}
      })
    })
    return () => {
      try { cancelAnimationFrame(raf1) } catch {}
      try { cancelAnimationFrame(raf2) } catch {}
    }
  }, [isAIMode, inputRowEl])

  // Helper: resolve active workspace AI color (fallback to accent-ish blue)
  const aiBubbleColor = (() => {
    try {
      const anchoredId = settings?.speedDial?.anchoredWorkspaceId || null
      if (anchoredId && activeWorkspaceId === anchoredId) {
        return sanitizeHex(settings?.theme?.colors?.accent || '#3b82f6')
      }
      const map = settings?.speedDial?.workspaceTextColors || {}
      const col = map?.[activeWorkspaceId]
      return sanitizeHex(col || settings?.theme?.colors?.accent || '#3b82f6')
    } catch { return sanitizeHex(settings?.theme?.colors?.accent || '#3b82f6') }
  })()

  const hasTypedQuery = (query || '').trim().length > 0
  const showClearButton = (query || '').length > 0
  const hasAttachedImage = !!attachedImage?.file
  const canSearch = hasTypedQuery || hasAttachedImage
  const actionButtonStyle = isRecording
    ? 'text-cyan-300 hover:text-cyan-200'
    : canSearch
    ? 'text-cyan-300 hover:text-cyan-200'
    : (isAIMode ? 'text-purple-300 hover:text-purple-200' : 'text-white/60 hover:text-white')
  const enforcedRowStyle = useMemo(() => {
    if (!isAIMode) return undefined
    const fallbackHeight = (() => {
      try { return inputRowEl ? inputRowEl.getBoundingClientRect().height : null } catch { return null }
    })()
    const targetHeight = baseRowHeight ?? fallbackHeight ?? 56
    const current = (() => { try { return inputRowEl ? inputRowEl.getBoundingClientRect().height : null } catch { return null } })()
    const forcedHeight = Math.max(Math.ceil(targetHeight), Math.ceil(current || 0), 56)
    const heightValue = `${forcedHeight}px`
    return { minHeight: heightValue, height: heightValue }
  }, [isAIMode, baseRowHeight, inputRowEl])

  const aiChatContainerStyle = useMemo(() => {
    const scale = Number(settings?.appearance?.chatWidthScale ?? 1)
    const rect = aiChatHostRect || null
    const baseCommon = {
      pointerEvents: 'none',
      boxSizing: 'border-box',
      overflow: 'visible',
      paddingLeft: 'var(--center-floating-padding, 1.5rem)',
      paddingRight: 'var(--center-floating-padding, 1.5rem)'
    }
    const measuredWidth = rect ? Math.round(rect.width) : null
    const targetWidth = measuredWidth ? Math.round(measuredWidth * Math.max(1, Math.min(2, scale))) : null
    return {
      ...baseCommon,
      position: 'absolute',
      left: '50%',
      bottom: 'calc(100% + 2px)',
      width: targetWidth ? `min(var(--center-column-width, 100%), ${targetWidth}px)` : (scale > 1 ? `${Math.min(scale, 2) * 100}%` : '100%'),
      maxWidth: 'var(--center-column-width, 100%)'
    }
  }, [settings?.appearance?.chatWidthScale, aiChatHostRect])

  const aiChatTransformTemplate = useCallback((_, generated) => {
    const trimmed = (generated || '').trim()
    if (!trimmed || trimmed === 'none') return 'translateX(-50%)'
    return `translateX(-50%) ${trimmed}`
  }, [])

  const chatMaxHeightPx = useMemo(() => {
    const fallback = 640
    const windowCap = (() => {
      if (typeof window === 'undefined') return null
      try { return Math.max(240, window.innerHeight - 6) } catch { return null }
    })()
    const distanceToTop = (() => {
      const t = Number(aiChatHostRect?.top)
      if (!Number.isFinite(t) || t <= 0) return null
      return Math.max(160, t - 4)
    })()
    const proposed = Number(aiChatHostRect?.maxHeight)
    let base = Number.isFinite(proposed) ? proposed : fallback
    if (Number.isFinite(distanceToTop)) base = Math.min(base, distanceToTop)
    if (windowCap) base = Math.min(base, windowCap)
    return Math.max(200, base)
  }, [aiChatHostRect?.maxHeight, aiChatHostRect?.top])

  // moved to top-level (hoisted) as function declarations

  // Stop TTS when Full Voice Mode is turned off
  useEffect(() => {
    if (!fullVoiceMode) {
      try {
        if (ttsAudioRef.current) {
          ttsAudioRef.current.pause()
          try { URL.revokeObjectURL(ttsAudioRef.current.src) } catch {}
          ttsAudioRef.current = null
        }
      } catch {}
    }
  }, [fullVoiceMode])

  // Voice-to-voice: synthesize via local XTTS proxy and play
  const speakText = useCallback(async (text) => {
    try {
      const t = String(text || '').trim()
      if (!t) return
      // Stop previous
      try { if (ttsAudioRef.current) { ttsAudioRef.current.pause(); URL.revokeObjectURL(ttsAudioRef.current.src); ttsAudioRef.current = null } } catch {}
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, language: 'en', format: 'mp3' })
      })
      if (!r.ok) return
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = new Audio(url)
      ttsAudioRef.current = a
      a.onended = () => {
        try { URL.revokeObjectURL(url) } catch {}
        ttsAudioRef.current = null
        // Auto re-arm listening in full voice mode
        if (fullVoiceMode) {
          setTimeout(() => {
            const p = startRecording({ preferAI: true })
            if (p && typeof p.then === 'function') p.catch(() => setFullVoiceMode(false))
          }, 120)
        }
      }
      a.play().catch(() => {})
    } catch {}
  }, [fullVoiceMode, startRecording])



  return (
    <>
      {/* Render in pinned position when pinned */}
      {isPinned && pinnedContainer && createPortal(
        <div
          className={`w-full relative ${settingsPanelOpen ? 'pointer-events-none' : 'pointer-events-auto'}`}
          style={{ transform: 'translateX(0px)' }}
        >
          
          <motion.div
            className={`
              relative ${sbCfg.transparentBg ? 'bg-transparent' : 'bg-black/20'} rounded-xl transition-all duration-300 search-input-container
              ${(sbCfg.outline ? 'border-2 ' : 'border-0 ')}
              ${isAIMode 
                ? (sbCfg.shadow ? 'border-blue-400/50 shadow-lg shadow-blue-500/20' : 'border-blue-400/50') 
                : inlineSearchMode
                ? (sbCfg.shadow ? 'border-cyan-400/50 shadow-lg shadow-cyan-500/20' : 'border-cyan-400/50')
                : 'border-white/20'
              }
            `}
            initial={{ opacity: 0, y: floatingMode ? floatingOffset : -20 }}
            animate={{
              opacity: settingsPanelOpen ? 0.45 : 1,
              y: floatingMode ? floatingOffset : 0,
              scale: settingsPanelOpen ? 0.96 : 1
            }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{
              backdropFilter: `blur(${sbBlurPx}px)`,
              WebkitBackdropFilter: `blur(${sbBlurPx}px)`,
              boxShadow: [
                (sbCfg.shadow ? '0 20px 60px rgba(0,0,0,0.35)' : ''),
                ...highlightShadows,
              ].filter(Boolean).join(', '),
              transition: 'box-shadow 0.4s ease-in-out, filter 0.25s ease',
              filter: settingsPanelOpen ? 'blur(6px)' : 'blur(0px)',
              pointerEvents: settingsPanelOpen ? 'none' : 'auto',
              zIndex: 1200,
              overflow: 'visible',
              maxWidth: 'var(--center-column-width, 100%)',
              width: '100%',
              marginLeft: 'auto',
              marginRight: 'auto'
            }}
            ref={registerSearchContainer}
            onDragOver={onDragOverContainer}
            onDrop={onDropContainer}
            onMouseEnter={handleSearchContainerMouseEnter}
            onMouseLeave={handleSearchContainerMouseLeave}
          >
            <div ref={handleInputRowRef} className="flex items-center p-3 relative" style={enforcedRowStyle}>
              {/* Controls collapse when recording */}
              <div className={`flex items-center gap-2 flex-1 transition-all duration-200 ${isRecording ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                {/* Mode Indicator / Globe Icon */}
                {isAIMode ? (
                  <div className="relative mr-3">
                    <button
                      ref={botButtonRef}
                      onClick={toggleChatLogMenu}
                      onContextMenu={handleBotButtonContextMenu}
                      className={`p-1 transition-colors ${aiStreaming ? 'text-blue-400/70' : 'text-blue-400 hover:text-blue-300'}`}
                      title={aiStreaming ? 'Left-click for chat history (AI is responding). Right-click to change model.' : 'Left-click for chat history. Right-click to change model.'}
                    >
                      <Bot className="w-5 h-5" />
                    </button>
                    <AnimatePresence>
                      {showChatLogMenu && !settingsPanelOpen && (
                        <motion.div
                          ref={chatLogMenuRef}
                          className="absolute bottom-full left-0 mb-2 z-[10000] min-w-[260px] max-h-[280px] overflow-hidden rounded-xl border border-white/20 shadow-2xl settings-force-white"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.16 }}
                          style={{
                            background: 'rgba(0,0,0,0.85)',
                            backdropFilter: `blur(${suggBlurPx}px)`,
                            WebkitBackdropFilter: `blur(${suggBlurPx}px)`,
                            color: '#fff',
                            '--text-rgb': '255,255,255',
                            fontFamily: 'Inter, system-ui, Arial, sans-serif'
                          }}
                        >
                          <ChatLogMenu />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <AnimatePresence>
                      {showModelMenu && !settingsPanelOpen && (
                        <motion.div
                          ref={modelMenuRef}
                          className="absolute bottom-full left-0 mb-2 z-[10000] min-w-[220px] max-h-[260px] overflow-auto no-scrollbar rounded-xl border border-white/20 shadow-2xl settings-force-white"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.16 }}
                          style={{
                            background: 'rgba(0,0,0,0.80)',
                            backdropFilter: `blur(${suggBlurPx}px)`,
                            WebkitBackdropFilter: `blur(${suggBlurPx}px)`,
                            color: '#fff',
                            '--text-rgb': '255,255,255',
                            fontFamily: 'Inter, system-ui, Arial, sans-serif'
                          }}
                        >
                          <ModelMenuList />
                          <div className="p-2 border-t border-white/10 flex items-center justify-end sticky bottom-0 bg-black/60 backdrop-blur-sm">
                            <button
                              className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15 border border-white/20 text-white"
                              onClick={refreshAiModels}
                            >Refresh</button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <button
                    onClick={(e) => toggleInlineSearchMode(e)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      toggleInlineSearchMode(e)
                    }}
                    className={`p-1 transition-colors ${
                      inlineModeIconState.isImage
                        ? (inlineModeIconState.lit ? 'text-cyan-400 hover:text-cyan-300' : 'text-white/60 hover:text-white/80')
                        : (inlineSearchMode 
                            ? 'text-cyan-400 hover:text-cyan-300' 
                            : 'text-white/60 hover:text-white')
                    }`}
                    title={
                      inlineModeIconState.isImage
                        ? (inlineModeIconState.lit 
                            ? 'Image search enabled - Left-click: reverse image search | Right-click: disable image search'
                            : 'Image attached - Left-click: reverse image search | Right-click: enable image search')
                        : (inlineSearchMode 
                            ? "Inline search mode active - Right-click: enable image search" 
                            : "Click to enable inline search - Right-click: enable image search")
                    }
                  >
                    {inlineModeIconState.isImage ? (
                      <ImageIcon className="w-5 h-5" />
                    ) : (
                      <Globe className="w-5 h-5" />
                    )}
                  </button>
                )}

                {/* Attached image thumbnail (left side) */}
                {attachedImage && (
                  <div className="mr-2 relative flex items-center">
                    <img src={attachedImage.preview} alt="attached" className="w-8 h-8 rounded-md object-cover border border-white/20" />
                    <button
                      className="absolute -top-2 -right-2 bg-black/60 hover:bg-black/80 rounded-full p-0.5 border border-white/20"
                      onClick={clearAttachedImage}
                      title="Remove image"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                )}

                {/* Input with ghost suggestion overlay */}
                <div className="relative flex-1" ref={inputContainerRef}>
                  {ghostSuggestion && (String(ghostSuggestion.text||'').trim().length > 0) && (
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 text-white/30 pointer-events-none select-none text-sm flex items-center"
                      style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {ghostSuggestion.text}
                    </div>
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={(e) => { setInputFocused(true); handleInputFocus() }}
                    onBlur={handleInputBlur}
                    placeholder={
                      isAIMode 
                        ? 'Ask AI…'
                        : inlineSearchMode
                        ? `Search with SearXNG (inline mode active)...`
                        : `Search ${engine || settings.search?.engine || 'google'}...`
                    }
                    className={`w-full bg-transparent text-white outline-none text-sm relative pr-8 ${sbDarkerPlaceholder ? 'placeholder-gray-400/60' : 'placeholder-white/50'}`}
                    style={{ position: 'relative' }}
                  />
                  {showClearButton && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        handleInputChange('')
                        try { inputRef.current?.focus() } catch {}
                      }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors p-1 z-20"
                      aria-label="Clear search"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* AI Web Search toggle (AI mode only) */}
                {isAIMode && (
                  <button
                    onClick={() => { const v = !aiWeb; setAiWeb(v); try { window.dispatchEvent(new CustomEvent('app-ai-toggle-websearch', { detail: v })) } catch {} }}
                    className={`mr-2 p-1 transition-colors ${aiWeb ? 'text-cyan-300 hover:text-cyan-200' : 'text-white/60 hover:text-white'}`}
                    aria-pressed={aiWeb}
                    title={`AI Web Search (${settings?.ai?.webSearchProvider || 'searxng'}) ${aiWeb ? 'On' : 'Off'}`}
                  >
                    <Globe className="w-4 h-4" />
                  </button>
                )}
                {isAIMode && (
                  <button
                    onClick={() => setAiIncludeMemory(v => !v)}
                    className={`mr-2 p-1 transition-colors ${aiIncludeMemory ? 'text-purple-300 hover:text-purple-200' : 'text-white/60 hover:text-white'}`}
                    aria-pressed={aiIncludeMemory}
                    title={`Include conversation memory ${aiIncludeMemory ? 'On' : 'Off'}`}
                  >
                    <Brain className="w-4 h-4" />
                  </button>
                )}
                {isAIMode && (
                  <button
                    onClick={() => {
                      const CYCLE = [3,5,7,10]
                      const idx = CYCLE.indexOf(Number(aiResultsCount||5))
                      const next = CYCLE[(idx+1) % CYCLE.length]
                      setAiResultsCount(next)
                    }}
                    className="mr-2 px-1.5 py-0.5 text-[11px] rounded border border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                    title={`Results count: ${aiResultsCount}`}
                  >{aiResultsCount}</button>
                )}
                {isAIMode && (
                  <button
                    onClick={() => {
                      try {
                        const lastAssistant = [...aiMessages].reverse().find(m => m.role === 'assistant')
                        if (!lastAssistant || !(lastAssistant?.panels?.webItems||[]).length) return
                        setOpenPreviews(prev => ({ ...prev, [lastAssistant.id]: !prev[lastAssistant.id] }))
                      } catch {}
                    }}
                    className="mr-2 p-1 text-white/60 hover:text-white transition-colors"
                    title="Toggle source previews"
                  >
                    <List className="w-4 h-4" />
                  </button>
                )}
                {isAIMode && (
                  <button
                    onClick={() => {
                      try {
                        const lastAssistant = [...aiMessages].reverse().find(m => m.role === 'assistant')
                        if (!lastAssistant || !(lastAssistant?.panels?.webItems||[]).length) return
                        setOpenSources(prev => ({ ...prev, [lastAssistant.id]: !prev[lastAssistant.id] }))
                      } catch {}
                    }}
                    className="mr-2 p-1 text-white/60 hover:text-white transition-colors"
                    title="Toggle sources (links)"
                  >
                    <Link2 className="w-4 h-4" />
                  </button>
                )}
                {isAIMode && (
                  <button
                    onClick={() => {
                      const CYCLE = [3,5,7,10]
                      const idx = CYCLE.indexOf(Number(aiResultsCount||5))
                      const next = CYCLE[(idx+1) % CYCLE.length]
                      setAiResultsCount(next)
                    }}
                    className="mr-2 px-1.5 py-0.5 text-[11px] rounded border border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                    title={`Results count: ${aiResultsCount}`}
                  >{aiResultsCount}</button>
                )}
                {isAIMode && (
                  <button
                    onClick={() => {
                      try {
                        if (previewsAppendedRef.current) return
                        const items = Array.isArray(lastWebItemsRef.current) ? lastWebItemsRef.current : []
                        if (items.length === 0) return
                        const preview = items.map((it, i) => `(${i+1}) ${it.title || it.url}\n${it.snippet}`).join('\n\n')
                        setAiMessages(prev => [...prev, { role: 'assistant', content: `Source previews\n\n${preview}`, id: makeUuid() }])
                        previewsAppendedRef.current = true
                      } catch {}
                    }}
                    className="mr-2 p-1 text-white/60 hover:text-white transition-colors"
                    title="Show source previews"
                  >
                    <List className="w-4 h-4" />
                  </button>
                )}

              </div>

              {isRecording && (
                <div
                  className="absolute inset-y-2 left-3 flex items-center pointer-events-none z-10"
                  style={{ right: '4.5rem' }}
                >
                  <div className="w-full h-11 rounded-xl border border-white/25 bg-black/60 backdrop-blur-md px-4 flex items-center overflow-hidden">
                    <canvas ref={waveformCanvasRef} className="w-full h-full opacity-90" />
                    <div className="absolute inset-0 flex items-center justify-center text-white/75 uppercase tracking-[0.35em] text-xs">
                      Listening…
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 ml-2">
                {!aiStreaming && (
                  <button
                    onClick={() => { if (isRecording) stopRecording(); else startRecording({ preferAI: isAIMode }) }}
                    className={`p-1 transition-colors ${isRecording ? 'text-red-400 hover:text-red-300' : 'text-white/60 hover:text-white'}`}
                    title={isRecording ? 'Stop recording' : (isAIMode ? 'Start voice' : 'Start voice search')}
                  >
                    {isRecording ? (<Square className="w-4 h-4" />) : (<Mic className="w-4 h-4" />)}
                  </button>
                )}
                {aiStreaming ? (
                  <button
                    onClick={stopAIStream}
                    className="p-1 transition-colors text-red-400 hover:text-red-300"
                    title="Stop AI response"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={
                      isRecording
                        ? () => stopRecording(true)
                        : canSearch
                        ? (hasAttachedImage ? handleSearch : (isAIMode ? handleAIQuery : handleSearch))
                        : toggleAIMode
                    }
                    className={`p-1 transition-colors ${actionButtonStyle}`}
                    aria-pressed={canSearch ? undefined : isAIMode}
                    title={
                      isRecording
                        ? (isAIMode ? 'Stop recording and send to AI' : 'Stop recording and search')
                        : canSearch
                        ? (hasAttachedImage ? 'Reverse image search' : (isAIMode ? 'Ask AI' : 'Search'))
                        : (isAIMode ? 'Exit AI mode (Tab)' : 'Enter AI mode (Tab)')
                    }
                  >
                    {isRecording ? (
                      isAIMode ? <ArrowUp className="w-4 h-4" /> : <Search className="w-4 h-4" />
                    ) : canSearch ? (
                      hasAttachedImage ? <Search className="w-4 h-4" /> : (isAIMode ? <ArrowUp className="w-4 h-4" /> : <Search className="w-4 h-4" />)
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Suggestions Dropdown */}
            {!(isPinned && showInlineResults) && (<SuggestionsDropdown isDropUp={suggestionsDropUp} />)}
          </motion.div>

          {/* Inline Search Results */}
          <AnimatePresence>
            {showInlineResults && !settingsPanelOpen && (
              <>
              <motion.div
                className={`w-full inline-search-results-container ${inlinePinnedFull ? 'inline-full-width' : ''}`}
                data-inline-theme={inlineTheme}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  boxSizing: 'border-box',
                  maxWidth: 'var(--center-column-width, 100%)',
                  width: '100%',
                  height: 'calc(100vh - 6rem - env(safe-area-inset-bottom))',
                  maxHeight: 'calc(100vh - 6rem - env(safe-area-inset-bottom))',
                  margin: '12px auto 0 auto',
                  borderRadius: inlinePinnedFull ? '24px' : '20px',
                  boxShadow: inlineThemeConfig.containerShadow || (inlinePinnedFull ? '0 28px 65px rgba(0,0,0,0.4)' : '0 24px 55px rgba(0,0,0,0.38)'),
                  background: inlineThemeConfig.containerBackground ?? 'transparent',
                  overflow: 'hidden',
                  position: 'relative',
                  '--inline-accent': inlineThemeConfig.accent,
                  '--inline-url': inlineThemeConfig.url,
                  '--inline-foreground': inlineThemeConfig.foreground || '#cccccc',
                  '--inline-muted': inlineThemeConfig.muted || 'rgba(204, 255, 255, 0.85)',
                  '--inline-surface': inlineThemeConfig.surface || 'rgba(0, 255, 255, 0.05)',
                  '--inline-surface-hover': inlineThemeConfig.surfaceHover || 'rgba(0, 255, 255, 0.1)',
                  '--inline-border-strong': inlineThemeConfig.borderStrong || 'rgba(0, 255, 255, 0.25)',
                  '--inline-glow': inlineThemeConfig.glow || 'rgba(0, 255, 255, 0.3)',
                  '--inline-font-family': inlineThemeConfig.fontFamily || `'Courier New', 'Monaco', monospace`,
                  '--inline-border': inlineThemeConfig.borderVariable || inlineThemeConfig.border || '0px solid transparent',
                  ...(inlineThemeConfig.containerBackdropFilter ? { backdropFilter: inlineThemeConfig.containerBackdropFilter, WebkitBackdropFilter: inlineThemeConfig.containerBackdropFilter } : {})
                }}
              >
                <div
                  className="retro-search-results"
                  data-inline-theme={inlineTheme}
                  style={{
                    flex: 1,
                    borderRadius: 'inherit',
                    border: inlineThemeConfig.border,
                    background: inlineThemeConfig.background,
                    fontFamily: inlineThemeConfig.fontFamily,
                    ...(inlineThemeConfig.backdropFilter ? { backdropFilter: inlineThemeConfig.backdropFilter, WebkitBackdropFilter: inlineThemeConfig.backdropFilter } : {})
                  }}
                >
                  <div className="results-header">
                    <div className="flex justify-between items-center mb-1 gap-2">
                      <div className="flex items-center gap-3">
                        <div className="retro-query m-0">Query: &quot;{query}&quot;</div>
                        <div className="retro-engine m-0">Engine: {inlineEngineLabel}</div>
                        {inlineContentType === 'images' && attachedImage?.file && (
                          <button
                            onClick={() => submitImageToLens(attachedImage.file, '')}
                            className="ml-2 px-2 py-0.5 text-xs rounded bg-white/10 hover:bg-white/15 border border-white/20 text-white"
                            title="Open full reverse image search in new tab"
                          >Open in Google</button>
                        )}
                      </div>
                      <button
                        onClick={collapseViaBottomSliver}
                        className="text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {isSearching ? (
                    <div className="retro-loading">
                      <div className="loading-bar">
                        <div className="loading-progress"></div>
                      </div>
                      <div className="loading-text">SEARCHING...</div>
                    </div>
                  ) : (
                    inlineContentType === 'images' ? (
                      <div className="results-list-container">
                        <div className="image-grid">
                          {imageResults.map((item, idx) => (
                            <a
                              key={idx}
                              href={item.url}
                              target={settings.general?.openInNewTab ? "_blank" : "_self"}
                              rel={settings.general?.openInNewTab ? "noopener noreferrer" : undefined}
                              className="image-card"
                              onClick={() => addHistoryEntry({ title: item.title, url: item.url })}
                              onContextMenu={(e) => openLinkContextMenu(e, item.url, item.title)}
                              title={item.title}
                            >
                              <img src={item.image} alt={item.title} className="image-thumb" />
                              <div className="image-caption">{item.displayUrl}</div>
                            </a>
                          ))}
                          {imageResults.length === 0 && (
                            <div className="text-white/70 text-sm p-4">No inline image results. Try "Open in Google".</div>
                          )}
                        </div>
                      </div>
                    ) : inlineContentType === 'article' ? (
                      <div className="results-list-container" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                        <div className="result-item">
                          <div className="result-header">
                            <a href={articleData.url} target="_blank" rel="noopener noreferrer" className="result-title">{articleData.title || extractDomain(articleData.url)}</a>
                            <div className="result-url">{extractDomain(articleData.url)}</div>
                          </div>
                          {isSearching ? (
                            <div className="retro-loading"><div className="loading-bar"><div className="loading-progress"></div></div><div className="loading-text">LOADING…</div></div>
                          ) : (
                            <div className="text-white/90 text-sm" style={{ fontFamily: 'Inter, system-ui, Arial, sans-serif' }}>{articleData.markdown || '(No content found)'}</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="results-list-container">
                        {/* Show images grid if images are available and inline image search is enabled */}
                        {inlineImageSearchEnabled && imageResults.length > 0 && (
                          <div className="mb-6">
                            <div className="text-white/80 text-sm mb-3 font-medium">Images</div>
                            <div className="image-grid">
                              {imageResults.slice(0, 20).map((item, idx) => (
                                <a
                                  key={idx}
                                  href={item.url}
                                  target={settings.general?.openInNewTab ? "_blank" : "_self"}
                                  rel={settings.general?.openInNewTab ? "noopener noreferrer" : undefined}
                                  className="image-card"
                                  onClick={() => addHistoryEntry({ title: item.title, url: item.url })}
                                  onContextMenu={(e) => openLinkContextMenu(e, item.url, item.title)}
                                  title={item.title}
                                >
                                  <img src={item.image} alt={item.title} className="image-thumb" />
                                  <div className="image-caption">{item.displayUrl}</div>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Web results */}
                        <div className="results-list">
                          {searchResults.map((result, index) => (
                            <motion.div
                              key={index}
                              className="result-item"
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: index * 0.1 }}
                            >
                              <div className="result-header">
                                <a
                                  href={result.url}
                                  target={settings.general?.openInNewTab ? "_blank" : "_self"}
                                  rel={settings.general?.openInNewTab ? "noopener noreferrer" : undefined}
                                  className="result-title"
                                  onClick={() => addHistoryEntry({ title: result.title, url: result.url })}
                                  onContextMenu={(e) => openLinkContextMenu(e, result.url, result.title)}
                                >
                                  {result.title}
                                  <ExternalLink className="w-3 h-3 ml-1 inline" />
                                </a>
                                <div className="result-url">{result.displayUrl}</div>
                              </div>
                              <div className="result-snippet">{result.snippet}</div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
                {/* Link context menu */}
                {linkMenu.open && !settingsPanelOpen && (
                  <div
                    ref={linkMenuRef}
                    className="inline-link-menu absolute z-[10000] rounded-lg border border-white/20 bg-black/70 text-white text-sm shadow-2xl"
                    style={{ left: linkMenu.x, top: linkMenu.y, width: 240, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
                  >
                    <div className="px-3 py-2 border-b border-white/10 truncate opacity-80">{linkMenu.title || linkMenu.url}</div>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-white/10"
                      onClick={() => {
                        const target = { url: linkMenu.url, title: linkMenu.title }
                        if (!target.url) { closeLinkMenu(); return }
                        closeLinkMenu()
                        openInlineArticle(target.url, target.title)
                      }}
                    >Open here</button>
                    <button className="w-full text-left px-3 py-2 hover:bg-white/10" onClick={() => {
                      const target = linkMenu.url
                      closeLinkMenu()
                      if (!target) return
                      collapseViaBottomSliver()
                      setTimeout(() => {
                        try {
                          setIsAIMode(true)
                          const prompt = `Summarize the main points of the following page in 6 bullets and include key facts and source links if possible.\n\nURL: ${target}`
                          handleInputChange(prompt)
                          setTimeout(() => {
                            try { inputRef.current?.focus() } catch {}
                            handleAIQuery()
                          }, 40)
                        } catch {}
                      }, 60)
                    }}>Summarize with AI</button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); collapseViaBottomSliver() }}
                  className={`return-fab ${inlineSystemReturn ? 'return-fab-ios' : ''}`}
                  title="Return search bar"
                  aria-label="Close inline results"
                  style={{
                    pointerEvents: 'auto',
                    color: inlineSystemReturn ? undefined : inlineThemeConfig.accent,
                    ...(function(){
                      const p = (settings?.appearance?.inline?.returnPos || 'center')
                      if (p === 'left') return { left: '20px', right: 'auto', transform: 'none' }
                      if (p === 'right') return { right: '20px', left: 'auto', transform: 'none' }
                      return { left: '50%', right: 'auto', transform: 'translateX(-50%)' }
                    })()
                  }}
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>,
        pinnedContainer
      )}

      {/* Render in normal position when not pinned */}
      {!isPinned && (
        <div className={`relative w-full max-w-3xl mx-auto ${settingsPanelOpen ? 'pointer-events-none' : ''}`}>
          
          {/* AI chat bubbles rising above search bar */}
          <AnimatePresence>
            {isAIMode && aiMessages.length > 0 && !settingsPanelOpen && (
              <motion.div
                className="absolute ai-chat-container z-50 w-full"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                style={aiChatContainerStyle}
                transformTemplate={aiChatTransformTemplate}
              >
                <div
                  ref={chatScrollRef}
                  className="ai-chat-scroll relative"
                  style={{
                    maxHeight: `${chatMaxHeightPx}px`,
                    overflowY: 'auto',
                    paddingBottom: '2.5rem',
                    paddingTop: '0.85rem',
                    position: 'relative'
                  }}
                >
                  {/* Removed top gradient/mask overlays to eliminate stream fade/blur */}
                  <div className="flex flex-col gap-3 pr-2">
                    {aiMessages.map((m, idx) => {
                      const isUser = m.role === 'user';
                      return (
                        <motion.div
                          key={m.id}
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ duration: 0.25, ease: 'easeOut', delay: idx * 0.03 }}
                          className={`max-w-[85%] sm:max-w-[70%] ${isUser ? 'self-end' : 'self-start'} chat-bubble`}
                          style={{ pointerEvents: 'auto' }}
                        >
                          <div
                            className={`rounded-2xl px-4 py-2.5 border shadow-lg group relative ${isUser
                                ? 'bg-cyan-600/80 text-white border-cyan-500/70 shadow-cyan-500/20'
                                : 'bg-white/5 border-white/10 text-white/95'}`}
                            style={(() => {
                              if (isUser) return {};
                              const blurPx = chatBubbleBlurPx;
                              if (!Number.isFinite(blurPx) || blurPx <= 0) {
                                return { backdropFilter: 'none', WebkitBackdropFilter: 'none' };
                              }
                              const clamped = Math.max(0, Math.min(30, blurPx));
                              return {
                                backdropFilter: `blur(${clamped}px)`,
                                WebkitBackdropFilter: `blur(${clamped}px)`,
                                transition: 'backdrop-filter 0.15s ease-out'
                              };
                            })()}
                          >
                            {editingMessageId === m.id && isUser ? (
                              <div className="flex flex-col gap-2">
                                <textarea
                                  className="w-full text-sm text-white bg-black/30 border border-white/20 rounded-md p-2 focus:outline-none"
                                  rows={Math.min(10, Math.max(2, String(editDraft||'').split('\n').length))}
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                />
                                <div className="flex items-center gap-2 self-end">
                                  <button
                                    className="px-2 py-1 text-xs rounded bg-cyan-500/20 border border-cyan-400 text-white hover:bg-cyan-500/30 transition-colors"
                                    onClick={saveEditAndResubmit}
                                    title="Save and resubmit"
                                  >Save</button>
                                  <button
                                    className="px-2 py-1 text-xs rounded bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 transition-colors"
                                    onClick={cancelEditMessage}
                                    title="Cancel"
                                  >Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap leading-relaxed text-sm font-medium">
                                <LinkifiedChatText text={m.content} />
                              </div>
                            )}
                            <div className="absolute -bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 select-none">
                              <button
                                className="p-0.5 rounded text-white/70 hover:text-white"
                                title="Copy"
                                onClick={() => copyMessage(m.content)}
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                              {isUser && editingMessageId !== m.id && (
                                <button
                                  className="p-0.5 rounded text-white/70 hover:text-white"
                                  title="Edit"
                                  onClick={() => startEditMessage(m)}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            {!isUser && m?.panels?.webItems && Array.isArray(m.panels.webItems) && m.panels.webItems.length > 0 && (
                              <div className="mt-2 text-xs text-white/80" style={{ position: 'relative' }}>
                                {openSources[m.id] && (
                                  <div className="absolute left-0 top-full mt-2 border border-white/15 rounded-lg p-2 bg-black/80 backdrop-blur-md z-[10000] shadow-xl w-[min(90vw,480px)] max-h-[240px] overflow-auto">
                                    <ul className="list-disc list-inside space-y-1">
                                      {m.panels.webItems.map((it, i) => (
                                        <li key={`s-${m.id}-${i}`}>
                                          <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:text-cyan-200">
                                            {it.title || it.url}
                                          </a>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {openPreviews[m.id] && (
                                  <div className="absolute left-0 top-full mt-2 border border-white/15 rounded-lg p-2 bg-black/80 backdrop-blur-md z-[10000] shadow-xl w-[min(90vw,560px)] max-h-[320px] overflow-auto">
                                    <div className="space-y-2 text-white/90">
                                      {m.panels.webItems.map((it, i) => (
                                        <div key={`p-${m.id}-${i}`}>
                                          <div className="font-semibold">{it.title || it.url}</div>
                                          <div className="text-white/70">{it.snippet}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                  
                  {/* Removed bottom gradient overlay to eliminate stream fade */}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search Box */}
          <motion.div
            className={`
              relative ${sbCfg.transparentBg ? 'bg-transparent' : 'bg-white/5'} rounded-xl transition-all duration-300 search-input-container
              ${(sbCfg.outline ? 'border-2 ' : 'border-0 ')}
              ${isAIMode 
                ? (sbCfg.shadow ? 'border-blue-400/50 shadow-lg shadow-blue-500/20' : 'border-blue-400/50') 
                : inlineSearchMode
                ? (sbCfg.shadow ? 'border-cyan-400/50 shadow-lg shadow-cyan-500/20' : 'border-cyan-400/50')
                : 'border-white/20'
              }
            `}
            initial={{ opacity: 0, y: floatingMode ? floatingOffset : 20 }}
            animate={{
              opacity: settingsPanelOpen ? 0.45 : 1,
              y: floatingMode ? floatingOffset : 0,
              scale: settingsPanelOpen ? 0.96 : 1
            }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          style={{
            backdropFilter: `blur(${sbBlurPx}px)`,
            WebkitBackdropFilter: `blur(${sbBlurPx}px)`,
            boxShadow: [
              (sbCfg.shadow ? '0 20px 60px rgba(0,0,0,0.35)' : ''),
              ...highlightShadows,
            ].filter(Boolean).join(', '),
            transition: 'box-shadow 0.4s ease-in-out, filter 0.25s ease',
            filter: settingsPanelOpen ? 'blur(6px)' : 'blur(0px)',
            pointerEvents: settingsPanelOpen ? 'none' : 'auto',
            zIndex: 1200,
            overflow: 'visible',
            marginLeft: 'auto',
            marginRight: 'auto',
            width: sbWidthPercent,
            maxWidth: 'var(--center-column-width, 100%)',
            ...(sbUseDefaultFont ? { fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' } : null),
            ...(sbUseDefaultColor ? { color: '#ffffff', '--text-rgb': '255,255,255' } : null)
          }}
          ref={registerSearchContainer}
          data-search-box="true"
          onDragOver={onDragOverContainer}
          onDrop={onDropContainer}
          onMouseEnter={handleSearchContainerMouseEnter}
          onMouseLeave={handleSearchContainerMouseLeave}
        >
            <div ref={handleInputRowRef} className="flex items-center p-3 relative" style={enforcedRowStyle}>
              <div className={`flex items-center gap-2 flex-1 transition-all duration-200 ${isRecording ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                {isAIMode ? (
                  <div className="relative mr-3">
                    <button
                      ref={botButtonRef}
                      onClick={toggleChatLogMenu}
                      onContextMenu={handleBotButtonContextMenu}
                      className={`p-1 transition-colors ${aiStreaming ? 'text-blue-400/70' : 'text-blue-400 hover:text-blue-300'}`}
                      title={aiStreaming ? 'Left-click for chat history (AI is responding). Right-click to change model.' : 'Left-click for chat history. Right-click to change model.'}
                    >
                      <Bot className="w-5 h-5" />
                    </button>
                    <AnimatePresence>
                      {showChatLogMenu && !settingsPanelOpen && (
                        <motion.div
                          ref={chatLogMenuRef}
                          className="absolute bottom-full left-0 mb-2 z-[10000] min-w-[260px] max-h-[280px] overflow-hidden rounded-xl border border-white/20 shadow-2xl settings-force-white"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.16 }}
                          style={{
                            background: 'rgba(0,0,0,0.85)',
                            backdropFilter: `blur(${suggBlurPx}px)`,
                            WebkitBackdropFilter: `blur(${suggBlurPx}px)`,
                            color: '#fff',
                            '--text-rgb': '255,255,255',
                            fontFamily: 'Inter, system-ui, Arial, sans-serif'
                          }}
                        >
                          <ChatLogMenu />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <AnimatePresence>
                      {showModelMenu && !settingsPanelOpen && (
                        <motion.div
                          ref={modelMenuRef}
                          className="absolute bottom-full left-0 mb-2 z-[10000] min-w-[220px] max-h-[260px] overflow-auto no-scrollbar rounded-xl border border-white/20 shadow-2xl settings-force-white"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.16 }}
                          style={{
                            background: 'rgba(0,0,0,0.80)',
                            backdropFilter: `blur(${suggBlurPx}px)`,
                            WebkitBackdropFilter: `blur(${suggBlurPx}px)`,
                            color: '#fff',
                            '--text-rgb': '255,255,255',
                            fontFamily: 'Inter, system-ui, Arial, sans-serif'
                          }}
                        >
                          <ModelMenuList />
                          <div className="p-2 border-t border-white/10 flex items-center justify-end sticky bottom-0 bg-black/60 backdrop-blur-sm">
                            <button
                              className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15 border border-white/20 text-white"
                              onClick={refreshAiModels}
                            >Refresh</button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <button
                    onClick={(e) => toggleInlineSearchMode(e)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      toggleInlineSearchMode(e)
                    }}
                    className={`p-1 transition-colors ${
                      inlineModeIconState.isImage
                        ? (inlineModeIconState.lit ? 'text-cyan-400 hover:text-cyan-300' : 'text-white/60 hover:text-white/80')
                        : (inlineSearchMode 
                            ? 'text-cyan-400 hover:text-cyan-300' 
                            : 'text-white/60 hover:text-white')
                    }`}
                    title={
                      inlineModeIconState.isImage
                        ? (inlineModeIconState.lit 
                            ? 'Image search enabled - Left-click: reverse image search | Right-click: disable image search'
                            : 'Image attached - Left-click: reverse image search | Right-click: enable image search')
                        : (inlineSearchMode 
                            ? "Inline search mode active - Right-click: enable image search" 
                            : "Click to enable inline search - Right-click: enable image search")
                    }
                  >
                    {inlineModeIconState.isImage ? (
                      <ImageIcon className="w-5 h-5" />
                    ) : (
                      <Globe className="w-5 h-5" />
                    )}
                  </button>
                )}

                {attachedImage && (
                  <div className="mr-2 relative flex items-center">
                    <img src={attachedImage.preview} alt="attached" className="w-8 h-8 rounded-md object-cover border border-white/20" />
                    <button
                      className="absolute -top-2 -right-2 bg-black/60 hover:bg-black/80 rounded-full p-0.5 border border-white/20"
                      onClick={clearAttachedImage}
                      title="Remove image"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                )}

                <div className="relative flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={(e) => { setInputFocused(true); handleInputFocus() }}
                    onBlur={handleInputBlur}
                    placeholder={
                      isAIMode 
                        ? 'Ask AI…'
                        : inlineSearchMode
                        ? `Search with SearXNG (inline mode active)...`
                        : `Search ${engine || settings.search?.engine || 'google'}...`
                    }
                    className={`w-full bg-transparent text-white outline-none text-sm pr-8 ${sbDarkerPlaceholder ? 'placeholder-gray-400/60' : 'placeholder-white/50'}`}
                    style={{
                      color: sbUseDefaultColor ? '#ffffff' : undefined,
                      fontFamily: sbUseDefaultFont ? 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' : undefined
                    }}
                  />
                  {showClearButton && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        handleInputChange('')
                        try { inputRef.current?.focus() } catch {}
                      }}
                      className="absolute right-0 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors p-1"
                      aria-label="Clear search"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {isAIMode && (
                  <button
                    onClick={() => { const v = !aiWeb; setAiWeb(v); try { window.dispatchEvent(new CustomEvent('app-ai-toggle-websearch', { detail: v })) } catch {} }}
                    className={`mr-2 p-1 transition-colors ${aiWeb ? 'text-cyan-300 hover:text-cyan-200' : 'text-white/60 hover:text-white'}`}
                    aria-pressed={aiWeb}
                    title={`AI Web Search (${settings?.ai?.webSearchProvider || 'searxng'}) ${aiWeb ? 'On' : 'Off'}`}
                  >
                    <Globe className="w-4 h-4" />
                  </button>
                )}

              </div>
              {isRecording && (
                <div
                  className="absolute inset-y-2 left-3 flex items-center pointer-events-none z-10"
                  style={{ right: '4.5rem' }}
                >
                  <div className="w-full h-11 rounded-xl border border-white/25 bg-black/60 backdrop-blur-md px-4 flex items-center overflow-hidden">
                    <canvas ref={waveformCanvasRef} className="w-full h-full opacity-90" />
                    <div className="absolute inset-0 flex items-center justify-center text-white/75 uppercase tracking-[0.35em] text-xs">
                      Listening…
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 ml-2">
                {!aiStreaming && (
                  <button
                    onClick={() => { if (isRecording) stopRecording(); else startRecording({ preferAI: isAIMode }) }}
                    className={`p-1 transition-colors ${isRecording ? 'text-red-400 hover:text-red-300' : 'text-white/60 hover:text-white'}`}
                    title={isRecording ? 'Stop recording' : (isAIMode ? 'Start voice' : 'Start voice search')}
                  >
                    {isRecording ? (<Square className="w-4 h-4" />) : (<Mic className="w-4 h-4" />)}
                  </button>
                )}
                {aiStreaming ? (
                  <button
                    onClick={stopAIStream}
                    className="p-1 transition-colors text-red-400 hover:text-red-300"
                    title="Stop AI response"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={
                      isRecording
                        ? () => stopRecording(true)
                        : canSearch
                        ? (hasAttachedImage ? handleSearch : (isAIMode ? handleAIQuery : handleSearch))
                        : toggleAIMode
                    }
                    className={`p-1 transition-colors ${actionButtonStyle}`}
                    aria-pressed={canSearch ? undefined : isAIMode}
                    title={
                      isRecording
                        ? (isAIMode ? 'Stop recording and send to AI' : 'Stop recording and search')
                        : canSearch
                        ? (hasAttachedImage ? 'Reverse image search' : (isAIMode ? 'Ask AI' : 'Search'))
                        : (isAIMode ? 'Exit AI mode (Tab)' : 'Enter AI mode (Tab)')
                    }
                  >
                    {isRecording ? (
                      isAIMode ? <ArrowUp className="w-4 h-4" /> : <Search className="w-4 h-4" />
                    ) : canSearch ? (
                      hasAttachedImage ? <Search className="w-4 h-4" /> : (isAIMode ? <ArrowUp className="w-4 h-4" /> : <Search className="w-4 h-4" />)
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Suggestions Dropdown */}
            {!(isPinned && showInlineResults) && (<SuggestionsDropdown isDropUp={suggestionsDropUp} />)}

            {/* Mode Switch Hint removed */}
          </motion.div>
        </div>
      )}

      {/* Voice-to-Voice: no center bubble (simplified dialogue mode) */}

      <style jsx>{`
        .retro-search-results {
          background: var(--inline-surface, rgba(0, 0, 0, 0.9));
          border: var(--inline-border, 2px solid #00ffff);
          border-radius: inherit;
          padding: 24px;
          padding-bottom: 92px;
          font-family: var(--inline-font-family, 'Courier New', 'Monaco', monospace);
          color: var(--inline-foreground, #cccccc);
          position: relative;
          overflow-y: auto;
          overflow-x: hidden;
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          box-shadow: 
            0 0 20px var(--inline-glow, rgba(0, 255, 255, 0.3)),
            inset 0 0 20px var(--inline-glow, rgba(0, 255, 255, 0.1));
          gap: 12px;
          scroll-padding-bottom: 96px;
        }

        .retro-search-results::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 8px;
          background: 
            repeating-linear-gradient(
              0deg,
              transparent,
              transparent 2px,
              rgba(0, 255, 255, 0.03) 2px,
              rgba(0, 255, 255, 0.03) 4px
            );
          pointer-events: none;
          z-index: 1;
        }

        .retro-search-results > * {
          position: relative;
          z-index: 2;
        }

        .results-header {
          flex-shrink: 0;
          margin-bottom: 16px;
        }

        .results-list-container {
          flex: 1;
          min-height: 0;
        }

        .retro-title {
          font-size: 1.25rem;
          font-weight: bold;
          color: #00ffff;
          text-shadow: 
            0 0 10px #00ffff,
            0 0 20px #00ffff;
          letter-spacing: 0.2em;
          margin-bottom: 8px;
        }

        .retro-query {
          font-size: 0.75rem;
          color: var(--inline-accent, #00cccc);
          text-shadow: 0 0 4px var(--inline-accent, #00cccc);
          letter-spacing: 0.05em;
          margin-bottom: 2px;
        }

        .retro-engine {
          font-size: 0.7rem;
          color: var(--inline-url, #009999);
          text-shadow: 0 0 2px var(--inline-url, #009999);
          letter-spacing: 0.05em;
          margin-bottom: 6px;
        }

        .retro-loading {
          text-align: center;
          padding: 32px;
        }

        .loading-bar {
          width: 100%;
          height: 4px;
          background: rgba(0, 255, 255, 0.2);
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 16px;
        }

        .loading-progress {
          height: 100%;
          background: linear-gradient(90deg, var(--inline-accent, #00ffff), rgba(0, 255, 255, 0.6));
          animation: loading 2s infinite;
          box-shadow: 0 0 10px var(--inline-accent, #00ffff);
        }

        @keyframes loading {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }

        .loading-text {
          color: var(--inline-accent, #00ffff);
          text-shadow: 0 0 10px var(--inline-accent, #00ffff);
          letter-spacing: 0.2em;
          font-weight: bold;
        }

        .results-list {
          space-y: 16px;
        }

        .result-item {
          border: 1px solid var(--inline-border-strong, rgba(0, 255, 255, 0.25));
          border-radius: 4px;
          padding: 16px;
          margin-bottom: 16px;
          background: var(--inline-surface, rgba(0, 255, 255, 0.05));
          transition: all 0.3s ease;
        }

        .result-item:hover {
          background: var(--inline-surface-hover, rgba(0, 255, 255, 0.1));
          border-color: var(--inline-accent, #00ffff);
          box-shadow: 0 0 10px var(--inline-glow, rgba(0, 255, 255, 0.3));
        }

        .result-header {
          margin-bottom: 8px;
        }

        .result-title {
          color: var(--inline-accent, #00ffff);
          text-decoration: none;
          font-weight: bold;
          font-size: 1.1rem;
          text-shadow: 0 0 5px var(--inline-accent, #00ffff);
          display: inline-flex;
          align-items: center;
          transition: all 0.3s ease;
        }

        .result-title:hover {
          color: #ffffff;
          text-shadow: 0 0 10px var(--inline-accent, #00ffff);
        }

        .result-url {
          color: var(--inline-url, #00cc99);
          font-size: 0.875rem;
          margin-top: 4px;
          text-shadow: 0 0 3px var(--inline-url, #00cc99);
        }

        .result-snippet {
          color: var(--inline-foreground, #cccccc);
          line-height: 1.5;
          font-size: 0.875rem;
        }

        .inline-search-results-container[data-inline-theme="glassy"] .retro-search-results {
          background: var(--inline-surface, rgba(255,255,255,0.08));
          box-shadow: 0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.18);
          color: var(--inline-foreground, #e7f3ff);
        }

        .inline-search-results-container[data-inline-theme="glassy"] .retro-search-results::before {
          display: none;
        }

        .inline-search-results-container[data-inline-theme="glassy"] .result-item {
          border-color: var(--inline-border-strong, rgba(255,255,255,0.3));
        }

        .inline-search-results-container[data-inline-theme="glassy"] .result-title {
          text-shadow: 0 0 12px var(--inline-glow, rgba(109, 215, 255, 0.4));
        }

        /* Search suggestions styling */
        .search-suggestions-container {
          z-index: 9999;
        }

        .suggestions-scroll-container {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        
        .suggestions-scroll-container::-webkit-scrollbar {
          display: none;
          width: 0;
          height: 0;
        }

        /* AI chat container styling - hide scrollbars + top blur */
        .ai-chat-container::-webkit-scrollbar { display: none; width: 0; height: 0; }
        .ai-chat-container { -ms-overflow-style: none; scrollbar-width: none; }
        .ai-chat-container * { -ms-overflow-style: none; scrollbar-width: none; }
        .ai-chat-container *::-webkit-scrollbar { display: none; width: 0; height: 0; }

        .ai-chat-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; }
        .ai-chat-scroll { -ms-overflow-style: none; scrollbar-width: none; overscroll-behavior: contain; }

        .ai-chat-top-mask {
          position: sticky;
          top: 0;
          left: 0;
          right: 0;
          height: 84px;
          margin-bottom: -84px;
          pointer-events: none;
          background: linear-gradient(to bottom, rgba(12,20,40,0.35) 0%, rgba(12,20,40,0.25) 40%, rgba(12,20,40,0) 100%);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          mask-image: linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0) 100%);
          -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0) 100%);
          z-index: 5;
        }

        /* Results list container styling - completely hide scrollbars */
        .results-list-container::-webkit-scrollbar { display: none; width: 0; height: 0; }
        .results-list-container { -ms-overflow-style: none; scrollbar-width: none; }
        .results-list-container * { -ms-overflow-style: none; scrollbar-width: none; }
        .results-list-container *::-webkit-scrollbar { display: none; width: 0; height: 0; }

        /* Target the specific inline search results container */
        .retro-search-results::-webkit-scrollbar { display: none; width: 0; height: 0; }
        .retro-search-results { -ms-overflow-style: none; scrollbar-width: none; }
        .retro-search-results * { -ms-overflow-style: none; scrollbar-width: none; }
        .retro-search-results *::-webkit-scrollbar { display: none; width: 0; height: 0; }

        /* Target the motion.div container that has the scrollbar (inline search results) */
        .inline-search-results-container::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
        .inline-search-results-container { -ms-overflow-style: none !important; scrollbar-width: none !important; }
        .inline-search-results-container * { -ms-overflow-style: none !important; scrollbar-width: none !important; }
        .inline-search-results-container *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }

        /* Inline image results grid */
        .image-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 12px;
          padding: 8px 12px 16px 12px;
        }
        .image-card {
          display: flex;
          flex-direction: column;
          background: var(--inline-surface, rgba(255,255,255,0.06));
          border: 1px solid var(--inline-border-strong, rgba(255,255,255,0.15));
          border-radius: 10px;
          overflow: hidden;
          text-decoration: none;
        }
        .image-card:hover {
          background: var(--inline-surface-hover, rgba(255,255,255,0.10));
          border-color: var(--inline-accent, rgba(255,255,255,0.25));
        }
        .inline-search-results-container[data-inline-theme="glassy"] .image-card {
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .image-thumb {
          width: 100%;
          height: 130px;
          object-fit: cover;
          display: block;
          background: #000;
        }
        .image-caption {
          color: var(--inline-muted, #fff);
          font-size: 11px;
          padding: 6px 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          opacity: 0.8;
        }

        .return-fab {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          width: 42px;
          height: 42px;
          border-radius: 9999px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid currentColor;
          background-color: rgba(0,0,0,0.38);
          backdrop-filter: blur(14px);
          color: var(--inline-accent, #e0f9ff);
          transition: transform 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease, backdrop-filter 0.2s ease;
          box-shadow: 0 10px 25px rgba(0,0,0,0.35);
          cursor: pointer;
          z-index: 9999; /* stay above panel content */
          pointer-events: auto;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .return-fab:hover {
          background-color: rgba(0,0,0,0.5);
          backdrop-filter: blur(20px);
          transform: translateX(-50%) translateY(-2px);
          box-shadow: 0 18px 36px rgba(0,0,0,0.45);
        }

        .return-fab:active {
          transform: translateX(-50%) translateY(1px);
        }

        .inline-search-results-container[data-inline-theme="glassy"] .return-fab {
          background-color: rgba(255,255,255,0.24);
          color: rgba(20,28,45,0.85);
          border-color: rgba(255,255,255,0.45);
          box-shadow: 0 14px 32px rgba(0,0,0,0.35);
        }

        .inline-search-results-container[data-inline-theme="glassy"] .return-fab:hover {
          background-color: rgba(255,255,255,0.32);
        }

        .return-fab-ios {
          background: rgba(255,255,255,0.14);
          color: rgba(20,20,20,0.85);
          border: 1px solid rgba(255,255,255,0.35);
          backdrop-filter: blur(20px);
          box-shadow: 0 18px 36px rgba(0,0,0,0.35);
        }

        .return-fab-ios:hover {
          background: rgba(255,255,255,0.26);
          backdrop-filter: blur(26px);
        }

      `}</style>
    </>
  )
})

SearchBox.displayName = 'SearchBox'

export default SearchBox
