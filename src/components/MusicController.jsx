import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Play, Pause, SkipForward, Music2 } from 'lucide-react'

// CSS for button hover effects
const buttonHoverStyles = `
  .music-button {
    transition: all 0.2s ease-in-out;
  }
  .music-button:not(:disabled):hover {
    transform: scale(1.05);
  }
  .music-button:not(:disabled):active {
    transform: scale(0.95);
  }
`

const toRgba = (hex, alpha = 1) => {
  try {
    if (!hex) return `rgba(255,255,255,${alpha})`
    if (hex.startsWith('rgba')) return hex
    let h = hex.startsWith('#') ? hex.slice(1) : hex
    let r, g, b, baseAlpha = 1
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16)
      g = parseInt(h[1] + h[1], 16)
      b = parseInt(h[2] + h[2], 16)
    } else if (h.length === 4) {
      r = parseInt(h[0] + h[0], 16)
      g = parseInt(h[1] + h[1], 16)
      b = parseInt(h[2] + h[2], 16)
      baseAlpha = parseInt(h[3] + h[3], 16) / 255
    } else if (h.length >= 6) {
      const full = h.padEnd(8, 'F')
      r = parseInt(full.slice(0, 2), 16)
      g = parseInt(full.slice(2, 4), 16)
      b = parseInt(full.slice(4, 6), 16)
      if (full.length >= 8) {
        baseAlpha = parseInt(full.slice(6, 8), 16) / 255
      }
    } else {
      return `rgba(255,255,255,${alpha})`
    }
    const finalAlpha = Math.max(0, Math.min(1, baseAlpha * alpha))
    return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`
  } catch {
    return `rgba(255,255,255,${alpha})`
  }
}

// Format seconds to MM:SS
function formatTime(seconds) {
  if (!seconds || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function resolveUrl(base, path = '') {
  try {
    if (!base) return path
    // Normalize /music -> /music/api/v1 if /api is missing
    let b = base
    if (b.startsWith('/music') && !/\/api\//.test(b)) {
      b = b.replace(/\/?$/, '') + '/api/v1'
    }
    if (/^https?:/i.test(b)) return new URL(path.replace(/^\//,''), b.endsWith('/') ? b : (b + '/')).toString()
    // relative: attach to origin
    const rel = b.startsWith('/') ? b : ('/' + b)
    return rel.replace(/\/$/, '') + (path.startsWith('/') ? path : ('/' + path))
  } catch { return path }
}

function extractArtUrl(data) {
  if (!data || typeof data !== 'object') return ''
  const candidates = [
    data.cover,
    data.coverUrl,
    data.artUrl,
    data.art,
    data.artwork,
    data.albumArt,
    data.image,
    data.thumbnail,
    data?.song?.cover,
    data?.song?.art,
    data?.song?.artUrl,
    data?.song?.image,
    data?.song?.thumbnail,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

const MusicController = ({ backendBase = '/music/api/v1', token = '', primaryColor = '#ffffff', accentColor = '#00ffff', styleConfig = {} }) => {
  const [nowPlaying, setNowPlaying] = useState({ title: '', artist: '', album: '', isPlaying: false, artUrl: '' })
  const [connected, setConnected] = useState(false)
  const [shuffleOn, setShuffleOn] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingKind, setLoadingKind] = useState(null)
  const wsRef = useRef(null)
  const [error, setError] = useState('')
  const titleRef = useRef(null)
  const [shouldScroll, setShouldScroll] = useState(false)
  const [trackProgress, setTrackProgress] = useState({ position: 0, duration: 0 })
  const lastNowPlayingUpdateIdRef = useRef(0)

  const wsUrls = useMemo(() => {
    const origin = window.location.origin
    const isHttps = origin.startsWith('https')
    const proto = isHttps ? 'wss' : 'ws'
    const baseAbs = /^https?:/i.test(backendBase) ? backendBase : origin + resolveUrl('', backendBase)
    const u = new URL(baseAbs, origin)
    const wsBase = `${proto}://${u.host}${u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname}`
    // API v1 websocket is typically /api/v1/ws
    return [ `${wsBase}/ws`, `${wsBase.replace(/\/api\/v1$/, '')}/api/v1/ws` ]
  }, [backendBase, token])

  const fetchShuffleState = useCallback(async () => {
    try {
      const r = await fetch(resolveUrl(backendBase, '/shuffle'), { credentials: 'include', headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
      if (r.ok) {
        const d = await r.json().catch(() => ({}))
        if (typeof d.state === 'boolean') setShuffleOn(!!d.state)
      }
    } catch {}
  }, [backendBase, token])

  const inferIsPlaying = (d) => {
    try {
      if (d == null || typeof d !== 'object') return null
      // Common boolean conventions
      if (typeof d.isPlaying === 'boolean') return d.isPlaying
      if (typeof d.playing === 'boolean') return d.playing
      if (typeof d.is_playing === 'boolean') return d.is_playing
      if (typeof d.paused === 'boolean') return d.paused === false
      if (typeof d.is_paused === 'boolean') return d.is_paused === false
      if (typeof d.pause === 'boolean') return d.pause === false
      if (typeof d.stopped === 'boolean') return d.stopped === false
      // Numeric conventions (1/0 or codes)
      if (typeof d.isPlaying === 'number') return d.isPlaying !== 0
      if (typeof d.playState === 'number') {
        // Heuristic: non-zero often indicates active/playing
        return d.playState !== 0
      }
      // String-based states
      const s = String(d.state || d.status || d.player_state || d.playback_state || d.playbackState || '').toLowerCase().trim()
      if (s) {
        const positive = ['play', 'playing', 'resume', 'started']
        const negative = ['pause', 'paused', 'stop', 'stopped']
        const hasPos = positive.some(x => s.includes(x))
        const hasNeg = negative.some(x => s.includes(x))
        if (hasPos && !hasNeg) return true
        if (!hasPos && hasNeg) return false
        // ambiguous -> unknown
        return null
      }
      return null
    } catch { return null }
  }

  const applyNowPlayingUpdate = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') return
    const updateId = ++lastNowPlayingUpdateIdRef.current
    const newIsPlaying = inferIsPlaying(payload)
    const artUrl = extractArtUrl(payload)
    const title = payload.title || payload.track || payload.name || payload?.song?.title || ''
    const artist = payload.artist || payload.author || payload.by || payload?.song?.artist || ''
    const album = payload.album || ''
    setNowPlaying(prev => {
      // Skip if a newer update has already been scheduled
      if (updateId < lastNowPlayingUpdateIdRef.current) return prev
      const nextIsPlaying = (newIsPlaying === null ? prev.isPlaying : newIsPlaying)
      return {
        title,
        artist,
        album,
        isPlaying: nextIsPlaying,
        artUrl: artUrl || prev.artUrl
      }
    })
    const duration = payload.duration || payload.length || payload.totalTime || payload?.song?.duration || 0
    const rawPosition = payload.position || payload.currentTime || payload.progress || payload?.song?.position || 0
    const position = Number.isFinite(Number(rawPosition)) ? Number(rawPosition) : 0
    if (duration > 0) {
      setTrackProgress({ position, duration })
    } else {
      setTrackProgress({ position: 0, duration: 0 })
    }
  }, [])

  const fetchNowPlaying = useCallback(async () => {
    setError('')
    // Prefer /song per swagger; fallback to /song-info
    const url = resolveUrl(backendBase, '/song')
    try {
      let r = await fetch(url, { credentials: 'include', headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
      if (r.status === 404) {
        r = await fetch(resolveUrl(backendBase, '/song-info'), { credentials: 'include', headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json().catch(() => ({}))
      applyNowPlayingUpdate(data)
    } catch (e) {
      // Suppress noisy backend unreachable text; treat as silently offline
      try { setConnected(false) } catch {}
    }
  }, [backendBase, token, applyNowPlayingUpdate])

  const action = useCallback(async (kind) => {
    setError('')
    // Optimistic UI: immediately reflect state changes for snappy UX
    const wasPlaying = nowPlaying.isPlaying
    if (kind === 'toggle-play') {
      setNowPlaying(prev => ({ ...prev, isPlaying: !prev.isPlaying }))
    } else if (kind === 'next' || kind === 'previous') {
      // Assume playback continues after track change
      setNowPlaying(prev => ({ ...prev, isPlaying: true }))
    } else if (kind === 'shuffle') {
      setShuffleOn(prev => !prev)
    }

    setIsLoading(true)
    setLoadingKind(kind)
    const url = resolveUrl(backendBase, `/${kind}`)
    try {
      let r = await fetch(url, { method: 'POST', credentials: 'include', headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
      if (!r.ok) {
        // fall back to GET
        r = await fetch(url, { method: 'GET', credentials: 'include', headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
      }
      if (!r.ok && kind === 'toggle-play') {
        // Fallback to explicit /play or /pause endpoints when toggle is unsupported
        const wantPlay = !wasPlaying
        const alt = resolveUrl(backendBase, wantPlay ? '/play' : '/pause')
        r = await fetch(alt, { method: 'POST', credentials: 'include', headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
        if (!r.ok) {
          r = await fetch(alt, { method: 'GET', credentials: 'include', headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
        }
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      // For next/previous, many backends return the new track as JSON immediately.
      // Use that payload when available, but always follow up with a short-delayed refresh
      // so the title can never get stuck one song behind.
      const isSkip = (kind === 'next' || kind === 'previous')
      const ctype = String(r.headers.get('content-type') || '').toLowerCase()
      if (isSkip && ctype.includes('application/json')) {
        try {
          const body = await r.json().catch(() => null)
          const d = (body && (body.nowPlaying || body)) || null
          if (d && typeof d === 'object') {
            applyNowPlayingUpdate(d)
          }
        } catch {
          // Ignore JSON parse errors; the follow-up refresh will reconcile state.
        }
      } else if (!isSkip && kind !== 'toggle-play') {
        // Non-skip, non-toggle commands: refresh immediately from backend
        fetchNowPlaying()
      }
      if (isSkip || kind === 'toggle-play') {
        // Always do delayed refreshes after user-driven playback changes to ensure
        // we see the updated state even if the backend updates /song slightly late.
        setTimeout(() => { fetchNowPlaying() }, 250)
        setTimeout(() => { fetchNowPlaying() }, 1000)
      }
      if (kind === 'shuffle') fetchShuffleState()
    } catch (e) {
      setError('Command failed')
      // Revert optimistic toggle on failure
      if (kind === 'toggle-play') {
        setNowPlaying(prev => ({ ...prev, isPlaying: !prev.isPlaying }))
      } else if (kind === 'shuffle') {
        setShuffleOn(prev => !prev)
      }
    } finally {
      setIsLoading(false)
      setLoadingKind(null)
    }
  }, [backendBase, fetchNowPlaying, fetchShuffleState, token, nowPlaying.isPlaying, applyNowPlayingUpdate])

  // Fetch initial state on mount, then re-check shortly after and periodically
  useEffect(() => {
    fetchNowPlaying()
    fetchShuffleState()
    // Re-check about a second after load in case the backend
    // updates slightly after our initial fetch.
    const t1 = setTimeout(() => {
      fetchNowPlaying()
      fetchShuffleState()
    }, 1000)
    // Periodically poll so external controls (main player UI)
    // stay in sync with this mini controller even when WS misses events.
    const intervalMs = 15000
    const interval = setInterval(() => {
      fetchNowPlaying()
      fetchShuffleState()
    }, intervalMs)
    return () => {
      clearTimeout(t1)
      clearInterval(interval)
    }
  }, [fetchNowPlaying, fetchShuffleState])

  useEffect(() => {
    // Try WebSocket, fall back to polling
    let closed = false
    let pollTimer
    const tryConnect = () => {
      if (closed) return
      let tried = 0
      const connectNext = () => {
        if (tried >= wsUrls.length) {
          setConnected(false)
          // Start polling
          fetchNowPlaying(); fetchShuffleState()
          pollTimer = setInterval(() => { fetchNowPlaying(); fetchShuffleState() }, 1500)
          return
        }
        const wsUrl = wsUrls[tried]
        const sep = wsUrl.includes('?') ? '&' : '?'
        // Some servers accept token via query param for WS
        const ws = new WebSocket(token ? `${wsUrl}${sep}token=${encodeURIComponent(token)}` : wsUrl)
        wsRef.current = ws
        ws.onopen = () => {
          setConnected(true)
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
        }
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data)
            if (data && (data.nowPlaying || data.title || data.track || data.status || data.state)) {
              const d = data.nowPlaying || data
              applyNowPlayingUpdate(d)
            }
          } catch {}
        }
        ws.onclose = () => {
          setConnected(false)
          tried += 1
          connectNext()
        }
        ws.onerror = () => {
          try { ws.close() } catch {}
        }
      }
      connectNext()
    }
    tryConnect()
    return () => {
      closed = true
      if (wsRef.current) try { wsRef.current.close() } catch {}
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [wsUrls, fetchNowPlaying, fetchShuffleState, applyNowPlayingUpdate])

  const displayTitle = nowPlaying.title || 'Not playing'
  const displayArtist = nowPlaying.artist || ''

  // Theme-aware styling
  const musicCfg = styleConfig || {}
  const matchWorkspaceText = !!musicCfg.matchWorkspaceTextColor
  const resolvedPrimary = matchWorkspaceText ? musicCfg.resolvedTextColor : undefined
  const resolvedAccent = matchWorkspaceText ? musicCfg.resolvedAccentColor : undefined
  const baseColor = resolvedPrimary || primaryColor || '#ffffff'
  const accent = resolvedAccent || accentColor || '#00ffff'
  // Use resolved glow color for glow shadows (workspace-specific or default for anchored workspace)
  const glowColorForShadow = musicCfg.glowColor || styleConfig?.glowColor || '#00ffff66'
  const surfaceBg = toRgba(baseColor, 0.08)
  const borderColor = toRgba(baseColor, 0.28)
  const subText = toRgba(baseColor, 0.6)
  const accentSoft = toRgba(accent, 0.18)
  const accentGlow = toRgba(glowColorForShadow, 0.35)

  const musicBlurPx = Number.isFinite(Number(musicCfg.blurPx)) ? Number(musicCfg.blurPx) : 12
  const removeBg = !!musicCfg.removeBackground
  const removeOutline = !!musicCfg.removeOutline
  const useShadows = musicCfg.useShadows !== false
  const glowShadow = musicCfg.glowShadow !== false
  const disableButtonBackgrounds = !!musicCfg.disableButtonBackgrounds

  const buttonBaseStyle = {
    borderColor: toRgba(baseColor, 0.35),
    color: toRgba(baseColor, 0.75),
    backgroundColor: disableButtonBackgrounds ? 'transparent' : toRgba(baseColor, 0.08),
    transition: 'all 0.2s ease-in-out',
    cursor: 'pointer'
  }

  const activeButtonExtra = {
    borderColor: accent,
    color: accent,
    backgroundColor: disableButtonBackgrounds ? 'transparent' : accentSoft,
    boxShadow: disableButtonBackgrounds ? `0 0 8px ${accentGlow}` : `0 0 12px ${accentGlow}`
  }

  // Inject hover styles
  useEffect(() => {
    const styleId = 'music-button-hover-styles'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = buttonHoverStyles
      document.head.appendChild(style)
    }
  }, [])

  return (
    <div
      className={`rounded-xl p-3 ${removeOutline ? '' : 'border'} ${(useShadows && !glowShadow) ? 'shadow-2xl shadow-black/40' : ''}`}
      style={{
        borderColor,
        backgroundColor: removeBg ? 'transparent' : surfaceBg,
        color: baseColor,
        backdropFilter: `blur(${musicBlurPx}px)`,
        WebkitBackdropFilter: `blur(${musicBlurPx}px)`,
        boxShadow: glowShadow ? `0 22px 55px -35px ${accentGlow}` : undefined
      }}
    >
      {error ? (
        <div className="flex justify-end mb-2" style={{ color: baseColor }}>
          <span className="text-xs" style={{ color: toRgba('#f87171', 0.85) }}>{error}</span>
        </div>
      ) : null}
      <div className="flex items-center gap-3 mt-2">
        <div
          className="w-10 h-10 rounded-lg border border-white/15 overflow-hidden bg-black/40 flex items-center justify-center"
          style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.35)' }}
        >
          {nowPlaying.artUrl ? (
            <img src={nowPlaying.artUrl} alt="cover" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            // When connected and no cover art, tint placeholder to the active button (accent) color
            <Music2 className="w-5 h-5" style={{ color: connected ? accent : subText }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate" style={{ color: baseColor }}>{displayTitle}</div>
          {displayArtist && (<div className="text-xs truncate" style={{ color: subText }}>{displayArtist}</div>)}
        </div>
      </div>

      {trackProgress.duration > 0 && (
        <div className="mt-2">
          <input
            type="range"
            min={0}
            max={trackProgress.duration}
            value={Math.max(0, Math.min(trackProgress.duration, trackProgress.position))}
            readOnly
            className="w-full"
            style={{ accentColor: accent }}
          />
          <div className="flex justify-between text-xs mt-1" style={{ color: toRgba(baseColor, 0.5) }}>
            <span>{formatTime(trackProgress.position)}</span>
            <span>{formatTime(trackProgress.duration)}</span>
          </div>
        </div>
      )}
      
      <div className="flex items-center gap-2 mt-3">
        {[
          { k: 'previous', title: 'Previous', render: () => '◀' },
          {
            k: 'toggle-play',
            title: nowPlaying.isPlaying ? 'Pause' : 'Play',
            render: () => (
              <div className="relative">
                {nowPlaying.isPlaying ? <Pause className="w-4 h-4"/> : <Play className="w-4 h-4"/>}
                {isLoading && loadingKind === 'toggle-play' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-3 h-3 border-2 border-white/40 border-t-white/70 rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
            )
          },
          { k: 'next', title: 'Next', render: () => (
            <div className="relative">
              <SkipForward className="w-4 h-4"/>
              {isLoading && loadingKind === 'next' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-3 h-3 border-2 border-white/40 border-t-white/70 rounded-full animate-spin"></div>
                </div>
              )}
            </div>
          ) },
          { k: 'shuffle', title: `Shuffle ${shuffleOn ? '(On)' : '(Off)'}`, render: () => (
            <div className="relative">
              <span>⤮</span>
              {isLoading && loadingKind === 'shuffle' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-3 h-3 border-2 border-white/40 border-t-white/70 rounded-full animate-spin"></div>
                </div>
              )}
            </div>
          ) }
        ].map(btn => {
          const isActive = (btn.k === 'toggle-play' && nowPlaying.isPlaying) || (btn.k === 'shuffle' && shuffleOn)
          const hoverBgColor = disableButtonBackgrounds 
            ? (isActive ? toRgba(accent, 0.15) : toRgba(baseColor, 0.12))
            : (isActive ? toRgba(accent, 0.25) : toRgba(baseColor, 0.15))
          const hoverBorderColor = isActive ? accent : toRgba(baseColor, 0.5)
          const hoverColor = isActive ? accent : toRgba(baseColor, 0.9)
          const hoverShadow = isActive ? `0 0 16px ${accentGlow}` : 'none'
          
          return (
          <button
            key={btn.k}
            onClick={() => action(btn.k)}
            disabled={isLoading}
            className={`music-button h-8 w-8 flex items-center justify-center rounded-md ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            style={{
              ...buttonBaseStyle,
              ...(isActive ? activeButtonExtra : {}),
              ...(isLoading ? { boxShadow: 'none', cursor: 'not-allowed' } : {}),
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.backgroundColor = hoverBgColor
                e.currentTarget.style.borderColor = hoverBorderColor
                e.currentTarget.style.color = hoverColor
                if (hoverShadow !== 'none') {
                  e.currentTarget.style.boxShadow = hoverShadow
                }
              }
            }}
            onMouseLeave={(e) => {
              if (!isLoading) {
                e.currentTarget.style.backgroundColor = buttonBaseStyle.backgroundColor
                e.currentTarget.style.borderColor = isActive ? activeButtonExtra.borderColor : buttonBaseStyle.borderColor
                e.currentTarget.style.color = isActive ? activeButtonExtra.color : buttonBaseStyle.color
                e.currentTarget.style.boxShadow = isActive ? activeButtonExtra.boxShadow : 'none'
              }
            }}
            title={btn.title}
          >
            {btn.render()}
          </button>
        )})}
      </div>
    </div>
  )
}

export default MusicController
