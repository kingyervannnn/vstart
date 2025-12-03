import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Folder, FolderPlus, Upload, Image, Trash2, ExternalLink as LinkIcon, ChevronLeft, Layers, Home, Grid2X2, AppWindow, LayoutList, Plus, Edit3, Copy } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from './ui/context-menu'
import { ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from './ui/context-menu'
import { normalizeIconSource } from '../lib/image-normalize'
import { HeaderColorContextMenu } from './ui/HeaderColorContextMenu'
import { createThemeTokenResolver, WORKSPACE_FONT_PRESETS } from '../lib/theme-tokens'
import { trySaveIconToProject } from '../lib/icon-storage'
import { useGlowSystem, glowTransitionStyles } from '../lib/glow-system'
import { createSpeedDialGlow, createTabGlow, enhancedGlowTransitions, applySoftSwitchGlow } from '../lib/speed-dial-glow'
import { isSettingsOpen } from '../lib/settings-visibility'
import './classic-buttons.css'
import './banner-scroll.css'
import './tight-tabs.css'

const DEFAULT_GLOW_KEY = '__default__'

// URL helpers
function normalizeUrl(input) {
  if (!input) return null
  try { return new URL(input) } catch { }
  try { return new URL(`https://${input}`) } catch { }
  return null
}
function getFaviconKey(input) {
  const u = normalizeUrl(input)
  return u ? (u.hostname || input) : input
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(src)
      img.onerror = () => reject(new Error('img-error'))
      img.src = src
    } catch (e) {
      reject(e)
    }
  })
}

function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string') return `rgba(255,255,255,${alpha})`
  let normalized = hex.trim()
  if (normalized.startsWith('#')) normalized = normalized.slice(1)
  if (normalized.length === 3) {
    normalized = normalized.split('').map(ch => ch + ch).join('')
  }
  if (normalized.length < 6) {
    return `rgba(255,255,255,${alpha})`
  }
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${Number.isFinite(r) ? r : 255},${Number.isFinite(g) ? g : 255},${Number.isFinite(b) ? b : 255},${alpha})`
}

function colorWithAlpha(color, alpha = 1) {
  if (!color || typeof color !== 'string') return `rgba(255,255,255,${alpha})`
  const normalized = color.trim()
  const rgbaMatch = normalized.match(/^rgba?\(([^)]+)\)$/i)
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map(part => part.trim())
    if (parts.length >= 3) {
      const [r, g, b] = parts
      return `rgba(${r},${g},${b},${alpha})`
    }
  }
  if (normalized.startsWith('#')) {
    return hexToRgba(normalized, alpha)
  }
  return normalized
}

function stripAlphaFromHex(hex) {
  if (!hex || typeof hex !== 'string') return '#ffffff'
  const clean = hex.trim()
  if (!clean.startsWith('#')) return clean
  const body = clean.slice(1)
  if (body.length >= 6) {
    return `#${body.slice(0, 6)}`
  }
  return clean
}

// Match the search bar transient pulse length so glow timing stays in sync
const TRANSIENT_PULSE_MS = 3000
const SPEED_DIAL_HOLD_BOOST_MS = 990
const SPEED_DIAL_LOAD_FADE_POWER = 2.6
const TRANSIENT_BANNER_DURATION_MS = 4000
const DEFAULT_DC_FLASH_COLOR = 'rgba(34,211,238,0.95)'

const VivaldiSpeedDial = ({
  settings,
  layoutMode: layoutModeProp = 'modern',
  tiles = [],
  title = 'Speed Dial',
  onTitleChange,
  // Experimental workspace layers API (optional)
  workspaces,
  activeWorkspaceId,
  onWorkspaceSelect,
  onWorkspaceDoubleSelect,
  onToggleAutoUrlDoubleClick,
  onWorkspaceAdd,
  onWorkspaceRemove,
  onWorkspaceReorder,
  onWorkspaceRename,
  onWorkspaceChangeIcon,
  allSpeedDials,
  onTilesChangeByWorkspace,
  hoveredWorkspaceId,
  onWorkspaceHoverChange,
  hardWorkspaceId,
  bannerDirection = 1,
  lastInFallbackWorkspaceId = null,
  onWorkspaceAnchor,
  onDialLayoutChange,
  appearanceWorkspacesEnabled = false,
  workspaceThemingEnabled = true,
}) => {
  // Experimental mode flag retained for conditional UI paths
  const isExperimental = true
  if (isExperimental) {
    return (
      <ExperimentalDial
        settings={settings}
        layoutMode={layoutModeProp}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onWorkspaceSelect={onWorkspaceSelect}
        onWorkspaceDoubleSelect={onWorkspaceDoubleSelect}
        onToggleAutoUrlDoubleClick={onToggleAutoUrlDoubleClick}
        onWorkspaceAdd={onWorkspaceAdd}
        onWorkspaceRemove={onWorkspaceRemove}
        onWorkspaceReorder={onWorkspaceReorder}
        onWorkspaceRename={onWorkspaceRename}
        onWorkspaceChangeIcon={onWorkspaceChangeIcon}
        allSpeedDials={allSpeedDials}
        onTilesChangeByWorkspace={onTilesChangeByWorkspace}
        hoveredWorkspaceId={hoveredWorkspaceId}
        onWorkspaceHoverChange={onWorkspaceHoverChange}
        hardWorkspaceId={hardWorkspaceId}
        bannerDirection={bannerDirection}
        lastInFallbackWorkspaceId={lastInFallbackWorkspaceId}
        onWorkspaceAnchor={onWorkspaceAnchor}
        onDialLayoutChange={onDialLayoutChange}
        appearanceWorkspacesEnabled={appearanceWorkspacesEnabled}
      />
    )
  }
  const effectiveHardWorkspaceId = hardWorkspaceId || lastInFallbackWorkspaceId || null
  const isLastInFallbackActive = !hardWorkspaceId && !!lastInFallbackWorkspaceId

  const [dragState, setDragState] = useState({
    isDragging: false,
    draggedTile: null,
    dragOffset: { x: 0, y: 0 },
    dropPosition: null,
    source: 'root', // 'root' | 'folder'
    dropOutside: false
  })

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newTileData, setNewTileData] = useState({ url: '', title: '', customIcon: null })
  const [faviconCache, setFaviconCache] = useState({})
  const [editIconTarget, setEditIconTarget] = useState(null)
  const editIconRef = useRef(null)
  // Shove state for delayed push during folder edit
  const shoveTimer = useRef(null)
  const [shoveState, setShoveState] = useState({ key: null, dir: 0 })
  const [openFolder, setOpenFolder] = useState(null)
  const [folderBlur, setFolderBlur] = useState(false)
  const backButtonRef = useRef(null)
  const [folderPage, setFolderPage] = useState(0)
  const syncOpenFolderState = useCallback((folder) => {
    if (!folder) return
    setOpenFolder(folder)
    const totalChildren = Array.isArray(folder.children) ? folder.children.length : 0
    const maxPageIndex = Math.max(0, Math.ceil(totalChildren / Math.max(1, FOLDER_PAGE_CAPACITY)) - 1)
    setFolderPage(prev => Math.min(prev, maxPageIndex))
  }, [FOLDER_PAGE_CAPACITY])

  const containerRef = useRef(null)
  const fileInputRef = useRef(null)

  // Grid layout: adaptive columns and fixed tile size
  const DEFAULT_COLS = 5
  const TILE_SIZE = 56
  const TILE_GAP = 28
  const [cols, setCols] = useState(DEFAULT_COLS)
  const hasWorkspaceTabs = isExperimental && Array.isArray(workspaces) && workspaces.length > 0
  const iconByName = (name) => {
    const map = { Home, Layers, Grid2X2, AppWindow, LayoutList }
    return map[name] || Layers
  }

  // Workspace font resolver using same presets as Appearance
  const presetFontMap = {
    system: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, sans-serif',
    modern: 'Inter, system-ui, Arial, sans-serif',
    roboto: 'Roboto, system-ui, Arial, sans-serif',
    bauhaus: 'Josefin Sans, system-ui, Arial, sans-serif',
    industrial: 'Noto Sans JP, Inter, system-ui, sans-serif',
    terminal: 'Fira Code, Menlo, Monaco, Consolas, "Courier New", monospace',
    minecraft: 'Press Start 2P, VT323, monospace',
    orbitron: 'Orbitron, Inter, system-ui, sans-serif',
  }
  const resolveWorkspaceFont = (wsId) => {
    // If workspace theming is disabled, don't resolve workspace-specific fonts
    if (!workspaceThemingEnabled) return undefined
    const sel = (settings?.speedDial?.workspaceTextFonts || {})[wsId]
    if (!sel) return undefined
    const key = String(sel).trim().toLowerCase()
    if (presetFontMap[key]) return presetFontMap[key]
    return sel
  }

  // Vivaldi-style favicon fetching with multiple fallbacks
  const fetchFavicon = useCallback(async (url) => {
    const key = getFaviconKey(url)
    if (!key) return null
    if (faviconCache[key]) return faviconCache[key]
    try {
      const host = key
      const labels = host.split('.')
      const apex = labels.length >= 2 ? labels.slice(-2).join('.') : host
      const candidates = Array.from(new Set([host, apex, `www.${apex}`]))
      const sources = []
      for (const d of candidates) {
        const targetUrl = `https://${d}`
        sources.push(
          `https://www.google.com/s2/favicons?domain=${d}&sz=64`,
          `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(targetUrl)}`,
          `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(targetUrl)}&size=64`,
          `https://${d}/favicon.ico`,
          `https://${d}/apple-touch-icon.png`,
          `https://${d}/favicon-32x32.png`,
          `https://icons.duckduckgo.com/ip3/${d}.ico`
        )
      }
      for (const src of sources) {
        try {
          const okSrc = await loadImage(src)
          if (okSrc) {
            setFaviconCache(prev => ({ ...prev, [key]: okSrc }))
            return okSrc
          }
        } catch { }
      }
      const fb = generateFallbackIcon(url)
      setFaviconCache(prev => ({ ...prev, [key]: fb }))
      return fb
    } catch {
      const fb = generateFallbackIcon(url)
      setFaviconCache(prev => ({ ...prev, [key]: fb }))
      return fb
    }
  }, [faviconCache])

  // Generate fallback icon similar to Vivaldi's approach
  const generateFallbackIcon = (url) => {
    try {
      const domain = getFaviconKey(url) || 'site'
      const letter = domain.charAt(0).toUpperCase()
      const hue = domain.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360

      return `data:image/svg+xml;base64,${btoa(`
        <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:hsl(${hue}, 70%, 50%);stop-opacity:1" />
              <stop offset="100%" style="stop-color:hsl(${hue + 30}, 70%, 40%);stop-opacity:1" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="8" fill="url(#grad)"/>
          <text x="32" y="40" font-family="Arial, sans-serif" font-size="24" font-weight="bold" text-anchor="middle" fill="white">${letter}</text>
        </svg>
      `)}`
    } catch {
      return `data:image/svg+xml;base64,${btoa(`
        <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="64" rx="8" fill="#666"/>
          <text x="32" y="40" font-family="Arial, sans-serif" font-size="24" font-weight="bold" text-anchor="middle" fill="white">?</text>
        </svg>
      `)}`
    }
  }

  // Load favicons for all tiles
  useEffect(() => {
    tiles.forEach(tile => {
      const key = getFaviconKey(tile.url)
      if (!tile.favicon && key && !faviconCache[key]) {
        fetchFavicon(tile.url).then(favicon => {
          const next = tiles.map(t => t.id === tile.id ? { ...t, favicon } : t)
          commitActiveTiles(next)
        })
      }
    })
  }, [tiles, fetchFavicon, faviconCache])

  // Vivaldi-style drag and drop implementation
  const handleTileMouseDown = (e, tile) => {
    if (tile?.back) return // don't drag the back tile
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()

    setDragState({
      isDragging: true,
      draggedTile: tile,
      dragOffset: {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      },
      dropPosition: null,
      source: openFolder ? 'folder' : 'root',
      dropOutside: false
    })
  }

  const handleMouseMove = useCallback((e) => {
    if (!dragState.isDragging || !containerRef.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - containerRect.left
    const y = e.clientY - containerRect.top
    const inside = x >= 0 && y >= 0 && x <= containerRect.width && y <= containerRect.height
    // When a folder is open, also treat dropping over the Back button as "outside"
    let overBack = false
    if (openFolder && backButtonRef.current) {
      const r = backButtonRef.current.getBoundingClientRect()
      overBack = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    }

    // Calculate grid position (left-aligned grid)
    const col = Math.floor(x / (TILE_SIZE + TILE_GAP))
    const row = Math.floor(y / (TILE_SIZE + TILE_GAP))
    const position = row * cols + col

    setDragState(prev => ({
      ...prev,
      dropPosition: (inside && col >= 0 && col < cols && position >= 0) ? position : null,
      dropOutside: prev.source === 'folder' ? (!inside || overBack) : false
    }))
  }, [dragState.isDragging, cols, openFolder])

  const handleMouseUp = useCallback(() => {
    if (dragState.isDragging && dragState.draggedTile) {
      const draggedTile = dragState.draggedTile

      if (dragState.source === 'folder' && openFolder) {
        // Drop outside the folder: move tile back to root
        if (dragState.dropOutside) {
          const folderIndex = tiles.findIndex(t => t.id === openFolder.id)
          if (folderIndex !== -1) {
            const updatedFolder = {
              ...openFolder,
              children: (openFolder.children || []).filter(c => c.id !== draggedTile.id)
            }
            const rootWithoutFolder = tiles.slice(0, folderIndex)
              .concat(updatedFolder)
              .concat(tiles.slice(folderIndex + 1))

            const next = [...rootWithoutFolder, { ...draggedTile }].map((t, idx) => ({ ...t, position: idx }))
            commitActiveTiles(next)
          }
        } else if (dragState.dropPosition !== null) {
          // Reorder inside the folder (account for back tile at index 0)
          const children = [...(openFolder.children || [])]
          const from = children.findIndex(c => c.id === draggedTile.id)
          const targetIndexRaw = Math.max(0, dragState.dropPosition - 1)
          if (from !== -1) {
            const [moved] = children.splice(from, 1)
            const to = Math.min(Math.max(targetIndexRaw, 0), children.length)
            children.splice(to, 0, moved)
            // write back into tiles
            const next = tiles.map(t => t.id === openFolder.id ? { ...openFolder, children } : t)
            commitActiveTiles(next.map((t, idx) => ({ ...t, position: idx })))
          }
        }
      } else if (dragState.dropPosition !== null) {
        // Root-level behavior
        const arr = [...tiles]
        const draggedIndex = arr.findIndex(t => t.id === draggedTile.id)
        const targetIndex = dragState.dropPosition
        const byPosition = (list) => list.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        const arrPos = byPosition(arr)
        const targetTile = arrPos.find(t => (t.position ?? 0) === targetIndex)
        if (draggedIndex !== -1 && targetTile && targetTile.id !== draggedTile.id) {
          // Remove dragged and target from list
          const remaining = arr.filter(t => t.id !== draggedTile.id && t.id !== targetTile.id)
          const draggedChildren = Array.isArray(draggedTile.children) ? draggedTile.children : [draggedTile]
          let folderTile
          if (Array.isArray(targetTile.children) && targetTile.children.length > 0) {
            // Merge into existing folder; flatten to avoid nested folders
            folderTile = { ...targetTile, children: [...targetTile.children, ...draggedChildren] }
          } else {
            // Create a new folder; place target first, then dragged (flattened)
            folderTile = { id: 'folder-' + Date.now(), title: 'Folder', type: 'folder', children: [targetTile, ...draggedChildren] }
          }
          const placed = byPosition(remaining)
          // insert folder at the target position index
          const before = placed.filter(t => (t.position ?? 0) < targetIndex)
          const after = placed.filter(t => (t.position ?? 0) > targetIndex)
          const next = [...before, folderTile, ...after].map((t, idx) => ({ ...t, position: idx }))
          commitActiveTiles(next)
        } else {
          // Reposition tile into empty slot (especially for experimental placeholders)
          if (draggedIndex !== -1) {
            const remaining = arr.filter(t => t.id !== draggedTile.id)
            const placed = byPosition(remaining)
            // Build map and insert dragged at targetIndex
            let next = []
            let inserted = false
            for (let idx = 0; idx <= placed.length; idx++) {
              if (!inserted && idx === targetIndex) {
                next.push({ ...draggedTile })
                inserted = true
              }
              if (idx < placed.length) next.push(placed[idx])
            }
            // If target beyond current length, pad by pushing dragged at end
            if (!inserted) next.push({ ...draggedTile })
            commitActiveTiles(next.map((t, idx) => ({ ...t, position: idx })))
          }
        }
      }
    }

    setDragState({
      isDragging: false,
      draggedTile: null,
      dragOffset: { x: 0, y: 0 },
      dropPosition: null,
      source: 'root',
      dropOutside: false
    })
  }, [dragState, tiles, openFolder])

  // Global mouse events for drag and drop
  useEffect(() => {
    if (dragState.isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)

      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [dragState.isDragging, handleMouseMove, handleMouseUp])

  // Adaptive columns based on available width
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const compute = () => {
      const width = el.clientWidth || el.getBoundingClientRect().width || 0
      const cell = TILE_SIZE + TILE_GAP
      // add gap once so exact multiples work out
      const next = Math.max(1, Math.floor((width + TILE_GAP) / cell))
      setCols(next || DEFAULT_COLS)
    }
    compute()
    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => compute())
      ro.observe(el)
    } else {
      // fallback: window resize listener
      window.addEventListener('resize', compute)
    }
    return () => {
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', compute)
    }
  }, [])

  // Add new tile
  const handleAddTile = () => {
    if (!newTileData.url || !newTileData.title) return
    const norm = normalizeUrl(newTileData.url)
    const finalUrl = norm ? norm.href : newTileData.url
    let position = tiles.length
    const newTile = {
      id: Date.now().toString(), url: finalUrl, title: newTileData.title,
      favicon: newTileData.customIcon, position
    }
    const next = [...tiles, newTile]
    commitActiveTiles(next.map((t, idx) => (typeof t.position === 'number' ? t : { ...t, position: idx })))
    setNewTileData({ url: '', title: '', customIcon: null })
    setShowAddDialog(false)
  }

  // Remove tile
  const handleRemoveTile = (tileId) => {
    commitActiveTiles(tiles.filter(t => t.id !== tileId).map((t, idx) => ({ ...t, position: idx })))
  }

  // Handle custom icon upload (normalize + save to project storage if available)
  const handleIconUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !file.type?.startsWith('image/')) return
    try {
      const { dataUrl } = await normalizeIconSource(file, { size: 96 })
      const savedUrl = await trySaveIconToProject(dataUrl, file.name || 'icon')
      setNewTileData(prev => ({ ...prev, customIcon: savedUrl || dataUrl }))
    } catch {
      // Fallback to raw dataUrl if normalization fails
      const reader = new FileReader()
      reader.onload = (ev) => setNewTileData(prev => ({ ...prev, customIcon: ev.target.result }))
      reader.readAsDataURL(file)
    }
  }

  // Rename a single non-folder tile
  const renameTile = (tileId) => {
    const t = tiles.find(x => x.id === tileId)
    const name = prompt('Rename shortcut', t?.title || '')
    if (name != null) {
      commitActiveTiles(tiles.map(x => x.id === tileId ? { ...x, title: name || 'Shortcut' } : x))
    }
  }

  // Edit icon for an existing tile
  const [iconEditTarget, setIconEditTarget] = useState(null)
  const editIconInputRef = useRef(null)
  const handleEditIconFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !iconEditTarget) { setIconEditTarget(null); return }
    if (!file.type?.startsWith('image/')) { setIconEditTarget(null); return }
    try {
      const { dataUrl } = await normalizeIconSource(file, { size: 96 })
      const savedUrl = await trySaveIconToProject(dataUrl, file.name || 'icon')
      const finalUrl = savedUrl || dataUrl
      commitActiveTiles(tiles.map(t => t.id === iconEditTarget ? { ...t, favicon: finalUrl } : t))
      setIconEditTarget(null)
    } catch {
      // Fallback to direct Data URL
      const reader = new FileReader()
      reader.onload = (ev) => {
        const src = ev.target.result
        commitActiveTiles(tiles.map(t => t.id === iconEditTarget ? { ...t, favicon: src } : t))
        setIconEditTarget(null)
      }
      reader.readAsDataURL(file)
    }
  }

  // Fixed sizing (no responsive resize to prevent layout jitter)

  const renameFolder = (tileId) => {
    const folder = tiles.find(t => t.id === tileId)
    const current = folder?.title || 'Folder'
    const name = prompt('Rename folder', current)
    if (name != null) {
      const next = tiles.map(t => t.id === tileId ? { ...t, title: name || 'Folder' } : t)
      commitActiveTiles(next)
    }
  }

  const renderTile = (tile, index) => {
    const isDragged = dragState.draggedTile?.id === tile.id
    const isDropTarget = dragState.dropPosition === index && dragState.isDragging

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <motion.div
            data-role="tile"
            key={tile.id}
            className={`
          relative cursor-pointer group
          ${isDragged ? 'opacity-50 z-50' : ''}
          ${isDropTarget ? 'scale-110' : ''}
        `}
            style={{
              width: TILE_SIZE,
              height: TILE_SIZE,
            }}
            title={tile.title || (Array.isArray(tile.children) ? 'Folder' : '')}
            whileHover={{ scale: isDragged ? 1 : 1.05 }}
            whileTap={{ scale: isDragged ? 1 : 0.95 }}
            onMouseDown={(e) => handleTileMouseDown(e, tile)}
            onClick={() => {
              if (dragState.isDragging) return
              if (Array.isArray(tile.children) && tile.children.length > 0) {
                setOpenFolder(tile)
                setFolderBlur(true)
                setTimeout(() => setFolderBlur(false), 250)
              } else if (tile.url) {
                const nu = normalizeUrl(tile.url)
                const href = nu ? nu.href : tile.url
                if (settings?.general?.openInNewTab) {
                  window.open(href, '_blank', 'noopener,noreferrer')
                } else {
                  window.location.href = href
                }
              }
            }}
          >
            <div className="w-full h-full rounded-lg overflow-hidden">
              {Array.isArray(tile.children) && tile.children.length > 0 ? (
                <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-0.5 p-0.5 bg-white/5 rounded">
                  {tile.children.slice(0, 4).map((child, i) => (
                    <img key={i} src={child.favicon || faviconCache[getFaviconKey(child.url)] || generateFallbackIcon(child.url)} alt={child.title}
                      className="w-full h-full object-cover rounded"
                      style={{ filter: settings?.iconTheming?.enabled ? 'url(#icon-theme-filter)' : 'none' }}
                    />
                  ))}
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center p-1.5">
                  {tile.favicon || faviconCache[getFaviconKey(tile.url)] ? (
                    <img
                      src={tile.favicon || faviconCache[getFaviconKey(tile.url)]}
                      alt={tile.title}
                      className="w-full h-full object-contain"
                      onError={(e) => { e.target.src = generateFallbackIcon(tile.url) }}
                      style={{ filter: settings?.iconTheming?.enabled ? 'url(#icon-theme-filter)' : 'none' }}
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                      <span className="text-white font-bold text-xs">
                        {tile.title.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Hover label (name): bold, no background, only on hover */}
            <div className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-white/90 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
              {Array.isArray(tile.children) && tile.children.length > 0 ? (tile.title || 'Folder') : (tile.title || '')}
            </div>

            {/* Drop indicator */}
            {isDropTarget && (
              <div className="absolute inset-0 border-2 border-dashed border-cyan-400 rounded-xl bg-cyan-400/20" />
            )}
          </motion.div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => {
            const targetUrl = Array.isArray(tile.children) && tile.children.length > 0 ? tile.children[0].url : tile.url
            const nu = normalizeUrl(targetUrl)
            const href = nu ? nu.href : targetUrl
            const target = settings?.general?.openInNewTab ? '_blank' : '_self'
            window.open(href, target)
          }}>
            <LinkIcon className="w-4 h-4" /> Open
          </ContextMenuItem>
          {!Array.isArray(tile.children) && (
            <ContextMenuItem onClick={() => renameTile(tile.id)}>
              <Edit3 className="w-4 h-4" /> Rename
            </ContextMenuItem>
          )}
          {Array.isArray(tile.children) && tile.children.length > 0 && (
            <ContextMenuItem onClick={() => renameFolder(tile.id)}>
              Rename Folder
            </ContextMenuItem>
          )}
          {!Array.isArray(tile.children) && (
            <>
              <ContextMenuItem onClick={() => { setIconEditTarget(tile.id); editIconInputRef.current?.click() }}>
                <Upload className="w-4 h-4" /> Change Icon
              </ContextMenuItem>
              <ContextMenuItem onClick={() => commitActiveTiles(tiles.map(t => t.id === tile.id ? { ...t, favicon: null } : t))}>
                <Image className="w-4 h-4" /> Reset Icon
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => handleRemoveTile(tile.id)}>
            <Trash2 className="w-4 h-4" /> Delete Shortcut
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  const renderEmptySlot = (index) => (
    <div key={`slot-${index}`} style={{ width: TILE_SIZE, height: TILE_SIZE }} />
  )

  const renderBackTile = () => {
    return (
      <motion.div
        key="__back"
        className="relative cursor-pointer group"
        style={{ width: TILE_SIZE, height: TILE_SIZE }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpenFolder(null)}
      >
        <div className="w-full h-full rounded-lg overflow-hidden flex items-center justify-center bg-white/10 border border-white/20">
          <ChevronLeft className="w-6 h-6 text-white/80" />
        </div>
      </motion.div>
    )
  }

  const [editingTitle, setEditingTitle] = useState(false)
  const [tempTitle, setTempTitle] = useState(title)
  useEffect(() => setTempTitle(title), [title])

  // Build slot map for experimental mode (7 rows of predefined spaces)
  const gridRows = isExperimental ? 7 : Math.ceil((tiles?.length || 1) / Math.max(cols, 1)) || 1
  const gridCount = Math.max(1, gridRows * Math.max(cols, 1))
  const positioned = Array.isArray(tiles) ? tiles.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : []
  const slots = new Array(gridCount).fill(null)
  positioned.forEach((t) => {
    const p = Math.max(0, Math.min(gridCount - 1, t.position ?? 0))
    if (!slots[p]) slots[p] = t
    else {
      // collision: place in next free slot
      let np = p + 1
      while (np < gridCount && slots[np]) np++
      if (np < gridCount) slots[np] = t
    }
  })

  // Resolve workspace-specific blur (similar to how glow colors work)
  // Note: This is in the unused non-experimental path, but kept for consistency
  const workspaceBlurOverrides = settings?.speedDial?.workspaceBlurOverrides || {};
  const effectiveBlurPx = (() => {
    // When appearance workspaces are disabled, ignore workspace-specific blur overrides
    // and always use the master blur value
    if (!appearanceWorkspacesEnabled) {
      return Math.max(0, Number(settings?.speedDial?.blurPx ?? 0));
    }
    // Use hardWorkspaceId if available, otherwise fall back to activeWorkspaceId
    const workspaceIdToCheck = hardWorkspaceId || activeWorkspaceId;
    
    if (workspaceIdToCheck && workspaceBlurOverrides[workspaceIdToCheck] !== undefined) {
      const override = Number(workspaceBlurOverrides[workspaceIdToCheck]);
      if (Number.isFinite(override)) {
        return Math.max(0, override);
      }
    }
    return Math.max(0, Number(settings?.speedDial?.blurPx ?? 0));
  })();

  return (
    <div className="w-full">
      {/* Speed Dial Wrapper applying blur (now includes title at top) */}
      <div
        style={{
          position: 'relative',
          backdropFilter: `blur(${effectiveBlurPx * (openFolder ? 1.35 : 1)}px)`,
          WebkitBackdropFilter: `blur(${effectiveBlurPx * (openFolder ? 1.35 : 1)}px)`,
          borderRadius: '12px',
          border: isExperimental ? '2px solid rgba(255,255,255,0.2)' : 'none',
          boxShadow: isExperimental ? '0 20px 60px rgba(0,0,0,0.35)' : 'none',
          overflow: 'visible',
          paddingBottom: hasWorkspaceTabs ? 26 : 12,
        }}
        className={isExperimental ? 'bg-white/10' : ''}
      >
        {/* Title row inside the layer */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          {openFolder ? (
            <h2 className="text-base font-semibold text-white/90">
              {(title || 'Home')} — {(openFolder.title || 'Folder')}
            </h2>
          ) : (
            !editingTitle ? (
              <h2 className="text-base font-semibold text-white/90 cursor-text" onClick={() => setEditingTitle(true)}>
                {title}
              </h2>
            ) : (
              <input
                autoFocus
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                onBlur={() => { setEditingTitle(false); onTitleChange?.(tempTitle || 'Speed Dial') }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
                className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white outline-none"
              />
            )
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (openFolder?.id) {
                  startAddTile({
                    wsId: activeWorkspaceId,
                    folderId: openFolder.id,
                    folderPage
                  })
                } else {
                  startAddTile({
                    wsId: activeWorkspaceId,
                    page: getActivePageForWorkspace(activeWorkspaceId)
                  })
                }
              }}
              className="px-3 py-1.5 rounded-md border border-white/20 bg-white/10 text-xs font-medium text-white/80 hover:bg-white/20 transition-colors"
            >
              {openFolder ? 'Add Shortcut' : 'Add Tile'}
            </button>
          </div>
        </div>
        {/* Speed Dial Grid */}
        <div
          ref={containerRef}
          className="rounded-xl px-2 pb-3"
          onDoubleClick={() => { /* handled by experimental dial */ }}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, ${TILE_SIZE}px)`,
            gap: TILE_GAP,
            justifyContent: 'start',
            gridAutoRows: `${TILE_SIZE}px`,
            minHeight: isExperimental ? `${(TILE_SIZE + TILE_GAP) * 7 - TILE_GAP}px` : undefined
          }}
        >
          {(openFolder
            ? openFolder.children
            : (isExperimental ? slots : positioned)
          ).map((tile, index) => (
            tile && tile.back ? renderBackTile() : (tile ? renderTile(tile, index) : renderEmptySlot(index))
          ))}
        </div>

        {/* Brief internal blur overlay only inside the dial during folder open transition */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: folderBlur ? 1 : 0,
            transition: 'opacity 250ms ease',
            backdropFilter: folderBlur ? 'blur(8px) brightness(0.95)' : 'none',
            WebkitBackdropFilter: folderBlur ? 'blur(8px) brightness(0.95)' : 'none',
            zIndex: 4,
          }}
        />

        {/* Back button when folder open (bottom center) */}
        {openFolder && (
          <div className="absolute left-0 right-0" style={{ bottom: 8 }}>
            <div className="w-full flex justify-center">
              <button
                ref={backButtonRef}
                className="px-3 py-1 rounded-md text-white/90 hover:text-white transition-colors"
                onClick={() => setOpenFolder(null)}
                title="Back"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Classic workspace tabs (bottom-right, attached) */}
        {hasWorkspaceTabs && (
          <ClassicWorkspaceTabs
            items={workspaces}
            activeId={activeWorkspaceId}
            onSelect={onWorkspaceSelect}
            onAdd={onWorkspaceAdd}
            onRemove={onWorkspaceRemove}
            onReorder={onWorkspaceReorder}
            onRename={onWorkspaceRename}
            onChangeIcon={onWorkspaceChangeIcon}
            iconByName={iconByName}
            attachToLayer
            wsButtonStyle={settings?.speedDial?.wsButtons || { background: true, shadow: true, blur: true, matchDialBlur: false }}
            outerGlow={effectiveGlow}
            settings={settings}
          />
        )}
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleIconUpload}
        className="hidden"
      />

      {/* Add Tile Dialog */}
      <AnimatePresence>
        {showAddDialog && (
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-black/80 backdrop-blur-md rounded-xl p-6 border border-white/20 max-w-md w-full mx-4"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-white">Add Speed Dial Tile</h3>
                <button
                  onClick={() => setShowAddDialog(false)}
                  className="text-white/60 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    Title
                  </label>
                  <input
                    type="text"
                    value={newTileData.title}
                    onChange={(e) => setNewTileData(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                    placeholder="Enter title"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    URL
                  </label>
                  <input
                    type="url"
                    value={newTileData.url}
                    onChange={(e) => setNewTileData(prev => ({ ...prev, url: e.target.value }))}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                    placeholder="https://example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    Custom Icon (optional)
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        try {
                          if (fileInputRef.current) {
                            fileInputRef.current.setAttribute('data-directory-hint', '/uploads/icons')
                          }
                        } catch { }
                        fileInputRef.current?.click()
                      }}
                      className="px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white/80 transition-colors flex items-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      Upload Icon
                    </button>
                    {newTileData.customIcon && (
                      <img
                        src={newTileData.customIcon}
                        alt="Custom icon"
                        className="w-8 h-8 rounded object-contain"
                      />
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    onClick={handleAddTile}
                    disabled={!newTileData.url || !newTileData.title}
                    className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
                  >
                    Add Tile
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden input for editing tile icon */}
      <input
        ref={editIconInputRef}
        type="file"
        accept="image/*"
        onChange={handleEditIconFile}
        className="hidden"
      />

      {/* Drag instructions */}
      {dragState.isDragging && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-black/80 backdrop-blur-md rounded-lg px-4 py-2 border border-white/20 z-50">
          <span className="text-sm text-white/80">
            Drag to rearrange tiles
          </span>
        </div>
      )}
    </div>
  )
}

// Classic workspace tabs component
const ClassicWorkspaceTabs = ({ items, activeId, onSelect, onAdd, onRemove, onReorder, onRename, onChangeIcon, iconByName, attachToLayer = false, wsButtonStyle = { background: true, shadow: true, blur: true, matchDialBlur: false }, outerGlow, settings }) => {
  const containerRef = useRef(null)
  const [drag, setDrag] = useState({ dragging: false, id: null, overIndex: null })

  const onMouseDown = (e, id) => {
    e.preventDefault()
    setDrag({ dragging: true, id, overIndex: null })
  }

  const onMouseMove = useCallback((e) => {
    if (!drag.dragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    // each tab approx 40px width + 8 gap
    const TAB_W = 40, GAP = 8
    const index = Math.max(0, Math.floor(x / (TAB_W + GAP)))
    setDrag(prev => ({ ...prev, overIndex: index }))
  }, [drag.dragging])

  const onMouseUp = useCallback(() => {
    if (drag.dragging && drag.overIndex != null) {
      const arr = [...items]
      const from = arr.findIndex(i => i.id === drag.id)
      if (from !== -1) {
        const [moved] = arr.splice(from, 1)
        const to = Math.min(Math.max(drag.overIndex, 0), arr.length)
        arr.splice(to, 0, moved)
        onReorder?.(arr.map((i, idx) => ({ ...i, position: idx })))
      }
    }
    setDrag({ dragging: false, id: null, overIndex: null })
  }, [drag, items, onReorder])

  useEffect(() => {
    if (drag.dragging) {
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      return () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }
    }
  }, [drag.dragging, onMouseMove, onMouseUp])

  useEffect(() => {
    if (!drag.justDropped) return
    const timer = setTimeout(() => {
      setDrag(prev => prev.justDropped ? { ...prev, justDropped: false } : prev)
    }, 0)
    return () => clearTimeout(timer)
  }, [drag.justDropped])

  const dialBlurPx = effectiveBlurPx
  const matchDialBlur = !!(wsButtonStyle?.matchDialBlur)
  const activeTabBlurPx = matchDialBlur ? dialBlurPx : 12
  const inactiveTabBlurPx = 4


  return (
    <div
      ref={containerRef}
      className={`absolute ${attachToLayer ? 'right-3 -bottom-3' : '-bottom-5 right-3'} flex items-end gap-2`}
      style={{ pointerEvents: 'auto' }}
    >
      {items.map((ws, idx) => {
        const Icon = iconByName(ws.icon)
        const isActive = ws.id === activeId
        const isOver = drag.dragging && drag.overIndex === idx
        const blurValue = wsButtonStyle.blur ? `blur(${isActive ? activeTabBlurPx : inactiveTabBlurPx}px)` : undefined
        return (
          <ContextMenu key={ws.id}>
            <ContextMenuTrigger asChild>
              <button
                onMouseDown={(e) => onMouseDown(e, ws.id)}
                onClick={() => onSelect?.(ws.id)}
                className={`relative flex items-center justify-center rounded-t-lg classic-workspace-button ${isActive
                    ? `${wsButtonStyle.background ? 'bg-white/15 ' : 'bg-transparent '} -mb-[2px] classic-active`
                    : `${wsButtonStyle.background ? 'bg-white/8 hover:bg-white/12 ' : 'bg-transparent hover:bg-white/5 '} translate-y-[6px] hover:translate-y-[2px] classic-inactive`
                  } ${isOver ? 'ring-2 ring-cyan-400/60' : ''} ${drag.dragging && drag.id === ws.id ? 'dragging' : ''} transition-all duration-200 ease-out`}
                style={{
                  width: 44,
                  height: 28,
                  backdropFilter: blurValue,
                  WebkitBackdropFilter: blurValue,
                  filter: isActive ? 'brightness(1.15) saturate(1.1)' : 'brightness(1)',
                  ...glowTransitionStyles,
                  boxShadow: [
                    // Enhanced shadow system for modern look
                    (isActive && wsButtonStyle.shadow ? '0 -8px 24px rgba(0,0,0,0.3), 0 -2px 8px rgba(0,0,0,0.2), 0 2px 12px rgba(0,0,0,0.15)' : ''),
                    (!isActive && wsButtonStyle.shadow ? '0 2px 8px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.05)' : ''),
                    // Enhanced glow integration
                    (isActive && outerGlow ? outerGlow : ''),
                    // Subtle inner highlight for active state
                    (isActive ? 'inset 0 1px 0 rgba(255,255,255,0.1)' : ''),
                  ].filter(Boolean).join(', '),
                  // Modern border styling
                  borderColor: isActive ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)',
                  // Subtle gradient overlay
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)'
                    : 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)'
                }}
                title={ws.name}
              >
                <Icon className={`w-4 h-4 transition-all duration-200 ${isActive ? 'text-white drop-shadow-sm' : 'text-white/70 hover:text-white/85'}`} />
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={onAdd}><Plus className="w-4 h-4" /> New Workspace</ContextMenuItem>
              <ContextMenuItem onClick={() => onRename?.(ws.id)}><Edit3 className="w-4 h-4" /> Rename</ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>Change Icon</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {['Home', 'Layers', 'Grid2X2', 'AppWindow', 'LayoutList'].map(name => {
                    const Ico = iconByName(name)
                    return (
                      <ContextMenuItem key={name} onClick={() => onChangeIcon?.(ws.id, name)}>
                        <Ico className="w-4 h-4" /> {name}
                      </ContextMenuItem>
                    )
                  })}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onRemove?.(ws.id)} variant="destructive"><Trash2 className="w-4 h-4" /> Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      {/* Add workspace tab */}
      <button
        onClick={() => onAdd?.()}
        className="flex items-center justify-center rounded-t-lg bg-white/10 border border-white/20 text-white/70 hover:text-white translate-y-[6px] hover:translate-y-[2px]"
        style={{ width: 44, height: 28 }}
        title="Add Workspace"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}

export default memo(VivaldiSpeedDial)

// New experimental dial with invisible grid, layered per-workspace, and protruding tabs
function ExperimentalDial({
  settings,
  layoutMode: layoutModeProp = 'modern',
  workspaces = [],
  activeWorkspaceId,
  onWorkspaceSelect,
  onWorkspaceDoubleSelect,
  onToggleAutoUrlDoubleClick,
  onWorkspaceAdd,
  onWorkspaceRemove,
  onWorkspaceReorder,
  onWorkspaceRename,
  onWorkspaceChangeIcon,
  allSpeedDials = {},
  onTilesChangeByWorkspace,
  hoveredWorkspaceId,
  onWorkspaceHoverChange,
  hardWorkspaceId,
  bannerDirection = 1,
  lastInFallbackWorkspaceId = null,
  onWorkspaceAnchor,
  onDialLayoutChange,
  appearanceWorkspacesEnabled = false,
  workspaceThemingEnabled = true,
}) {
  const effectiveHardWorkspaceId = hardWorkspaceId || lastInFallbackWorkspaceId || null
  const isLastInFallbackActive = !hardWorkspaceId && !!lastInFallbackWorkspaceId
  const containerRef = useRef(null)
  const gridRef = useRef(null)
  const TILE_SIZE = 56
  const TILE_GAP = 28
  const CELL = TILE_SIZE + TILE_GAP
  const HEADER_H = 48
  const HEADER_CONTENT_SHIFT = -6
  const PAD = 12
  const TAB_W = 44
  const TAB_GAP = 8
  const TAB_H = 28
  const masterLayoutMode = (String(layoutModeProp || settings?.appearance?.masterLayout || 'modern').toLowerCase() === 'classic') ? 'classic' : 'modern'
  const isClassicMasterLayout = masterLayoutMode === 'classic'
  const layoutKey = isClassicMasterLayout ? 'classic' : 'modern'
  
  // Resolve workspace-specific blur (similar to how glow colors work)
  const workspaceBlurOverrides = settings?.speedDial?.workspaceBlurOverrides || {};
  const effectiveBlurPx = (() => {
    // When appearance workspaces are disabled, ignore workspace-specific blur overrides
    // and always use the master blur value
    if (!appearanceWorkspacesEnabled) {
      return Math.max(0, Number(settings?.speedDial?.blurPx ?? 0));
    }
    // Use effectiveHardWorkspaceId (from URL) for blur lookup to match the actual workspace being viewed
    const workspaceIdToCheck = effectiveHardWorkspaceId || activeWorkspaceId;
    
    if (workspaceIdToCheck && workspaceBlurOverrides[workspaceIdToCheck] !== undefined) {
      const override = Number(workspaceBlurOverrides[workspaceIdToCheck]);
      if (Number.isFinite(override)) {
        return Math.max(0, override);
      }
    }
    return Math.max(0, Number(settings?.speedDial?.blurPx ?? 0));
  })();
  const swapClassicTabsWithPageSwitcher = !!settings?.appearance?.swapClassicTabsWithPageSwitcher
  const swapModernTabsWithPageSwitcher = !!settings?.appearance?.swapModernTabsWithPageSwitcher
  const swapTabsWithPageSwitcher = isClassicMasterLayout ? swapClassicTabsWithPageSwitcher : swapModernTabsWithPageSwitcher
  const MIN_CLASSIC_COLS = 8
  const MAX_CLASSIC_COLS = 14
  const CLASSIC_ROWS = 5
  const MODERN_COLS = 5
  const MODERN_ROWS = 7
  const DEFAULT_CLASSIC_COLS = MIN_CLASSIC_COLS
  const [classicColumnCount, setClassicColumnCount] = useState(DEFAULT_CLASSIC_COLS)
  const [classicLayoutReady, setClassicLayoutReady] = useState(false)
  useEffect(() => {
    if (!isClassicMasterLayout) {
      setClassicLayoutReady(false)
    }
  }, [isClassicMasterLayout])
  const activeCols = isClassicMasterLayout ? classicColumnCount : MODERN_COLS
  const activeRows = isClassicMasterLayout ? CLASSIC_ROWS : MODERN_ROWS
  const GRID_W = (activeCols * CELL) - TILE_GAP
  const GRID_H = (activeRows * CELL) - TILE_GAP
  const PAGE_CAPACITY = Math.max(1, activeCols * activeRows)
  // Folder view uses one less row (and paginates on overflow)
  const FOLDER_ROWS = Math.max(1, activeRows - 1)
  const FOLDER_GRID_H = (FOLDER_ROWS * CELL) - TILE_GAP
  const FOLDER_CAPACITY = activeCols * FOLDER_ROWS
  const FOLDER_PAGE_CAPACITY = Math.max(1, FOLDER_CAPACITY || 0)
  const folderSlotIndexForChild = (child) => {
    if (!child) return Number.POSITIVE_INFINITY
    const page = clampPage(child.page ?? 0)
    const gx = clampGX(typeof child.gridX === 'number' ? child.gridX : 0)
    const gy = clampGYFolder(typeof child.gridY === 'number' ? child.gridY : 0)
    return (page * FOLDER_PAGE_CAPACITY) + (gy * activeCols) + gx
  }
  const sortChildrenBySlot = (children) => {
    if (!Array.isArray(children)) return []
    return children
      .map((child, idx) => ({
        child,
        idx,
        slot: folderSlotIndexForChild(child)
      }))
      .sort((a, b) => {
        if (a.slot === b.slot) return a.idx - b.idx
        return a.slot - b.slot
      })
      .map(entry => entry.child)
  }
  const assignFolderSlotsSequential = (children) => {
    if (!Array.isArray(children) || children.length === 0) return []
    const capacity = FOLDER_PAGE_CAPACITY
    return children.map((child, index) => {
      const page = Math.floor(index / capacity)
      const within = index % capacity
      const gy = Math.floor(within / activeCols)
      const gx = within % activeCols
      return {
        ...child,
        gridX: clampGX(gx),
        gridY: clampGYFolder(gy),
        page: clampPage(page)
      }
    })
  }
  const insertChildIntoFolder = (children, newChild, preferredPage = 0) => {
    const sorted = sortChildrenBySlot(children)
    const normalized = assignFolderSlotsSequential(sorted)
    const capacity = FOLDER_PAGE_CAPACITY
    const safePage = clampPage(preferredPage)
    const occupancyOnPage = normalized.filter(child => clampPage(child.page ?? 0) === safePage).length
    const pageFull = occupancyOnPage >= capacity
    const maxExistingPage = normalized.length > 0 ? clampPage(normalized[normalized.length - 1].page ?? 0) : -1
    const insertPage = pageFull ? Math.max(safePage + 1, maxExistingPage + 1) : safePage
    const working = normalized.map(child => ({ ...child }))
    const insertIndex = pageFull
      ? working.length
      : Math.min(insertPage * capacity + occupancyOnPage, working.length)
    working.splice(insertIndex, 0, { ...newChild })
    const childrenWithSlots = assignFolderSlotsSequential(working)
    const createdNewPage = insertPage > maxExistingPage
    return {
      children: childrenWithSlots,
      insertedPage: insertPage,
      createdNewPage
    }
  }
  const removeChildFromFolder = (children, tileId) => {
    const sorted = sortChildrenBySlot(children)
    const filtered = sorted.filter(child => child.id !== tileId)
    if (filtered.length === sorted.length) {
      return { children, removed: false }
    }
    return {
      children: assignFolderSlotsSequential(filtered),
      removed: true
    }
  }
  const moveChildWithinFolder = (children, tileId, targetSlotIndex) => {
    const sorted = sortChildrenBySlot(children)
    const normalized = assignFolderSlotsSequential(sorted)
    const currentIndex = normalized.findIndex(child => child.id === tileId)
    if (currentIndex === -1) {
      return { children, moved: false }
    }
    const working = normalized.map(child => ({ ...child }))
    const [item] = working.splice(currentIndex, 1)
    const safeIndex = Math.max(0, Math.min(targetSlotIndex, working.length))
    working.splice(safeIndex, 0, item)
    return {
      children: assignFolderSlotsSequential(working),
      moved: safeIndex !== currentIndex
    }
  }
  const clampFolderSlotIndex = (page, gx, gy) => {
    const slotPage = clampPage(page)
    const slotGX = clampGX(gx)
    const slotGY = clampGYFolder(gy)
    return (slotPage * FOLDER_PAGE_CAPACITY) + (slotGY * activeCols) + slotGX
  }
  const [drag, setDrag] = useState({
    dragging: false,
    wsId: null,
    tile: null,
    offset: { x: 0, y: 0 },
    drop: { gx: null, gy: null, page: 0, back: false },
    origin: null,
    mergeIntent: false,
    justDropped: false,
    originFolderId: null,
  })
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [pendingCell, setPendingCell] = useState({
    gx: 0,
    gy: 0,
    page: 0,
    wsId: activeWorkspaceId,
    folderId: null,
    folderPage: 0
  })
  const [newTileData, setNewTileData] = useState({ url: '', title: '', customIcon: null, altFavicon: '' })
  const fileInputRef = useRef(null)
  const gridContextCellRef = useRef(null)
  const [faviconCache, setFaviconCache] = useState({})
  const [folderDeleteDialog, setFolderDeleteDialog] = useState({ open: false, wsId: null, folderId: null, folderTitle: '', deleteChildren: false })
  const [activePagesByLayout, setActivePagesByLayout] = useState({ modern: {}, classic: {} })
  useLayoutEffect(() => {
    if (!isClassicMasterLayout) return
    const el = containerRef.current
    if (!el) return
    const compute = (width) => {
      if (!width || width <= 0) {
        return
      }
      const effective = Math.max(width - (PAD * 2), 0)
      let raw = Math.floor((effective + TILE_GAP) / CELL)
      if (!Number.isFinite(raw) || raw <= 0) raw = DEFAULT_CLASSIC_COLS
      let next = Math.max(MIN_CLASSIC_COLS, Math.min(MAX_CLASSIC_COLS, raw))
      if (next > MIN_CLASSIC_COLS && next % 2 !== 0) {
        next = Math.min(MAX_CLASSIC_COLS, next + 1)
      }
      setClassicColumnCount(prev => (prev === next ? prev : next))
      setClassicLayoutReady(true)
    }
    compute(el.clientWidth || el.offsetWidth || 0)
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect?.width || el.clientWidth || el.offsetWidth || 0
          compute(width)
        }
      })
      observer.observe(el)
      return () => observer.disconnect()
    }
    const handleResize = () => compute(el.clientWidth || el.offsetWidth || 0)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isClassicMasterLayout, CELL, PAD, TILE_GAP])
  // Tabs drag state
  const tabsContainerRef = useRef(null)
  const [tabsDrag, setTabsDrag] = useState({ dragging: false, id: null, overIndex: null })
  const [hoveredTabId, setHoveredTabId] = useState(null)
  const [tabsReorderEnabled, setTabsReorderEnabled] = useState(false)
  const getActivePageForWorkspace = useCallback((wsId) => {
    const layoutPages = activePagesByLayout[layoutKey] || {}
    const page = layoutPages[wsId]
    return (typeof page === 'number' && page >= 0) ? page : 0
  }, [activePagesByLayout, layoutKey])
  const setActivePageForWorkspace = useCallback((wsId, page) => {
    const safePage = Math.max(0, Number.isFinite(page) ? page : 0)
    setActivePagesByLayout(prev => {
      const nextLayoutMap = { ...(prev[layoutKey] || {}) }
      nextLayoutMap[wsId] = safePage
      return { ...prev, [layoutKey]: nextLayoutMap }
    })
  }, [layoutKey])
  useEffect(() => {
    setPendingCell(prev => ({
      ...prev,
      wsId: activeWorkspaceId,
      page: getActivePageForWorkspace(activeWorkspaceId),
      folderId: null,
      folderPage: 0
    }))
  }, [activeWorkspaceId, getActivePageForWorkspace])
  // Simple edit mode to stabilize drag/drop interactions
  const [editMode, setEditMode] = useState(false)
  const setEditModeAndReorder = useCallback((next) => {
    setEditMode(next)
    setTabsReorderEnabled(next)
  }, [setTabsReorderEnabled])
  const toggleEditModeAndReorder = useCallback(() => {
    setEditMode(prev => {
      const next = !prev
      setTabsReorderEnabled(next)
      return next
    })
  }, [setTabsReorderEnabled])
  // Brief visual cue when toggling double-click mode via anchored tab
  const [dcFlash, setDcFlash] = useState(false)
  const [dcFlashColor, setDcFlashColor] = useState(null)
  const dcFlashTimerRef = useRef(null)
  // Enhanced glow system
  const glowManager = useGlowSystem(settings)
  const [currentGlow, setCurrentGlow] = useState('')
  const [transientGlow, setTransientGlow] = useState('')
  const [hoverGlow, setHoverGlow] = useState('')
  const [isDialHovered, setIsDialHovered] = useState(false)
  const [tabTransientGlows, setTabTransientGlows] = useState({})
  const updateTabTransientGlow = useCallback((workspaceId, glowValue) => {
    if (!workspaceId) return
    setTabTransientGlows(prev => {
      const existing = prev[workspaceId] || ''
      if (!glowValue) {
        if (!existing) return prev
        const next = { ...prev }
        delete next[workspaceId]
        return next
      }
      if (existing === glowValue) return prev
      return { ...prev, [workspaceId]: glowValue }
    })
  }, [])
  const prevWorkspaceRef = useRef(activeWorkspaceId)
  const [headerScrollTick, setHeaderScrollTick] = useState(0)
  const bannerGroupRef = useRef(null)
  const [bannerGroupWidth, setBannerGroupWidth] = useState(0)
  const [transientActive, setTransientActive] = useState(false)
  const transientTimerRef = useRef(null)
  const activeTabPulseRef = useRef(null)
  const [openFolder, setOpenFolder] = useState(null)
  const [folderBlur, setFolderBlur] = useState(false)
  const backButtonRef = useRef(null)
  const [folderPage, setFolderPage] = useState(0)
  const lastMouse = useRef({ x: 0, y: 0 })
  const prevHoverRef = useRef(null)
  const syncOpenFolderState = useCallback((folder) => {
    if (!folder) return
    setOpenFolder(folder)
    const totalChildren = Array.isArray(folder.children) ? folder.children.length : 0
    const maxPageIndex = Math.max(0, Math.ceil(totalChildren / Math.max(1, FOLDER_PAGE_CAPACITY)) - 1)
    setFolderPage(prev => Math.min(prev, maxPageIndex))
  }, [FOLDER_PAGE_CAPACITY])
  // Edit icon state (per experimental workspace context)
  const [editIconTarget, setEditIconTarget] = useState(null)
  const editIconRef = useRef(null)
  const currentTabsMode = settings?.speedDial?.tabsMode || 'tabs'
  const cyberTabsEnabled = currentTabsMode === 'cyber'
  const tightTabsEnabled = currentTabsMode === 'tight'
  const tightTabzEnabled = currentTabsMode === 'tight-tabz'
  const tabsModeIsTabs = currentTabsMode === 'tabs'
  const tightFamilyEnabled = tightTabsEnabled || tightTabzEnabled
  const dialBlurAmount = effectiveBlurPx
  const dialSurfaceColor = settings?.speedDial?.transparentBg ? 'rgba(23,27,40,0.55)' : 'rgba(255,255,255,0.10)'

  // Header color/font globals for use outside the inner render scope
  const currentPathStr = (window.location.pathname || '').replace(/\/+$/, '') || '/'
  const headerResolverGlobal = useMemo(() => createThemeTokenResolver(settings, workspaces, currentPathStr), [settings, workspaces, currentPathStr])
  const effectiveHeaderColorGlobal = useMemo(() => {
    try { return headerResolverGlobal.resolveTokens(activeWorkspaceId || null)?.headerColor } catch { return null }
  }, [headerResolverGlobal, activeWorkspaceId])
  const bannerFontFamilyGlobal = useMemo(() => {
    const enabled = !!settings?.speedDial?.headerBannerFontOverrideEnabled
    const name = String(settings?.speedDial?.headerBannerFont || '').trim()
    if (!enabled || !name) return undefined
    const normalized = name.toLowerCase()
    const preset = WORKSPACE_FONT_PRESETS[normalized]
    return preset || `${name}, Inter, system-ui, sans-serif`
  }, [settings?.speedDial?.headerBannerFontOverrideEnabled, settings?.speedDial?.headerBannerFont])
  const presetFontMapLocal = WORKSPACE_FONT_PRESETS
  const resolveWorkspaceFontLocal = useCallback((wsId) => {
    // If workspace theming is disabled, don't resolve workspace-specific fonts
    if (!workspaceThemingEnabled) return undefined
    const sel = (settings?.speedDial?.workspaceTextFonts || {})[wsId]
    if (!sel) return undefined
    const key = String(sel).trim().toLowerCase()
    if (presetFontMapLocal[key]) return presetFontMapLocal[key]
    return sel
  }, [settings?.speedDial?.workspaceTextFonts, workspaceThemingEnabled])
  const resolveFontGlobal = useMemo(() => resolveWorkspaceFontLocal(activeWorkspaceId), [activeWorkspaceId, resolveWorkspaceFontLocal])

  const onTabMouseDown = (e, id) => {
    e.preventDefault()
    if (!tabsReorderEnabled) return
    setTabsDrag({ dragging: true, id, overIndex: null })
  }

  const onTabsMouseMove = useCallback((e) => {
    if (!tabsDrag.dragging || !tabsContainerRef.current) return
    const rect = tabsContainerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const index = Math.max(0, Math.floor(x / (TAB_W + TAB_GAP)))
    setTabsDrag(prev => ({ ...prev, overIndex: index }))
  }, [tabsDrag.dragging])

  const onTabsMouseUp = useCallback(() => {
    if (tabsDrag.dragging && tabsDrag.overIndex != null) {
      const arr = [...workspaces]
      const from = arr.findIndex(i => i.id === tabsDrag.id)
      if (from !== -1) {
        const [moved] = arr.splice(from, 1)
        const to = Math.min(Math.max(tabsDrag.overIndex, 0), arr.length)
        arr.splice(to, 0, moved)
        onWorkspaceReorder?.(arr.map((i, idx) => ({ ...i, position: idx })))
      }
    }
    setTabsDrag({ dragging: false, id: null, overIndex: null })
  }, [tabsDrag, workspaces, onWorkspaceReorder])

  useEffect(() => {
    if (tabsDrag.dragging) {
      document.addEventListener('mousemove', onTabsMouseMove)
      document.addEventListener('mouseup', onTabsMouseUp)
      return () => {
        document.removeEventListener('mousemove', onTabsMouseMove)
        document.removeEventListener('mouseup', onTabsMouseUp)
      }
    }
  }, [tabsDrag.dragging, onTabsMouseMove, onTabsMouseUp])

  useEffect(() => () => {
    if (dcFlashTimerRef.current) {
      clearTimeout(dcFlashTimerRef.current)
      dcFlashTimerRef.current = null
    }
  }, [])

  // Ensure folder children have unique grid positions when a folder opens,
  // defaulting to start at (0,0) and flow left-to-right, top-to-bottom (no overlap),
  // and skipping the reserved back tile at (0, activeRows-1).
  useEffect(() => {
    if (!openFolder) return
    const wsId = activeWorkspaceId
    const BACK_GX = 0, BACK_GY = activeRows - 1
    const isReserved = (gx, gy) => (gx === BACK_GX && gy === BACK_GY)
    let updatedFolderRef = null
    upsertTiles(wsId, (list) => {
      const idx = list.findIndex(t => t.id === openFolder.id)
      if (idx === -1) return list
      const folder = list[idx]
      const children = (folder.children || []).slice()
      const used = new Set()
      const takeNext = (() => {
        let y = 0, x = 0
        return () => {
          while (y < FOLDER_ROWS) {
            const gx = x
            const gy = y
            x++
            if (x >= activeCols) { x = 0; y++ }
            const key = `${gx},${gy}`
            if (isReserved(gx, gy) || used.has(key)) continue
            return { gx, gy, key }
          }
          return { gx: 0, gy: 0, key: '0,0' }
        }
      })()
      const nextChildren = children.map((c) => {
        const rawGX = typeof c.gridX === 'number' ? c.gridX : null
        const rawGY = typeof c.gridY === 'number' ? c.gridY : null
        let gx = rawGX != null ? clampGX(rawGX) : null
        let gy = rawGY != null ? clampGYFolder(rawGY) : null
        let key = (gx != null && gy != null) ? `${gx},${gy}` : ''
        const invalid = !(Number.isFinite(gx) && Number.isFinite(gy))
        const reserved = (rawGX != null && rawGY != null) ? isReserved(rawGX, rawGY) : false
        if (invalid || used.has(key) || reserved) {
          const spot = takeNext()
          gx = spot.gx; gy = spot.gy; key = spot.key
        }
        used.add(key)
        return { ...c, gridX: gx, gridY: gy }
      })
      const next = list.slice()
      const refreshedFolder = { ...folder, children: nextChildren }
      next[idx] = refreshedFolder
      updatedFolderRef = refreshedFolder
      return next
    })
    if (updatedFolderRef) {
      syncOpenFolderState(updatedFolderRef)
    }
  }, [openFolder?.id, activeRows, activeCols, FOLDER_ROWS, syncOpenFolderState])

  // Reset folder pagination when folder changes/opens
  useEffect(() => {
    setFolderPage(0)
  }, [openFolder?.id])

  // Enhanced glow computation with new system
  const workspaceGlowColors = effectiveHardWorkspaceId ? (settings?.speedDial?.workspaceGlowColors || {}) : {}
  const workspaceGlowColorMap = settings?.speedDial?.workspaceGlowColors || {}
  const anchoredWorkspaceId = settings?.speedDial?.anchoredWorkspaceId || null
  const defaultTextColor = stripAlphaFromHex(settings?.theme?.colors?.primary || '#ffffff')
  const defaultAccentColor = stripAlphaFromHex(settings?.theme?.colors?.accent || '#ff00ff')
  const fallbackGlowColor = settings?.speedDial?.glowColor || defaultAccentColor
  const useWorkspaceGlowOnDoubleClick = !!settings?.speedDial?.glowWorkspaceColorOnDoubleClick
  const getDoubleClickGlowColor = (workspaceId) => {
    if (!useWorkspaceGlowOnDoubleClick) {
      return DEFAULT_DC_FLASH_COLOR
    }
    if (workspaceId && workspaceId === anchoredWorkspaceId) {
      // Anchored workspace: always use the Default outer glow color
      return fallbackGlowColor
    }
    if (workspaceId) {
      return workspaceGlowColorMap[workspaceId] || fallbackGlowColor
    }
    return DEFAULT_DC_FLASH_COLOR
  }
  const headerAlign = settings?.speedDial?.headerAlign || 'center'
  const headerEffectMode = (() => {
    const val = (settings?.speedDial?.headerEffectMode || 'off').toString().toLowerCase()
    return ['off', 'transient', 'sustained'].includes(val) ? val : 'off'
  })()
  const doubleClickUrlEnabled = !!settings?.general?.autoUrlDoubleClick
  const slugDrivenTransientMode = doubleClickUrlEnabled
  const transientWorkspaceId = slugDrivenTransientMode ? (effectiveHardWorkspaceId || activeWorkspaceId) : activeWorkspaceId
  const transientWorkspaceKey = `${slugDrivenTransientMode ? 'hard' : 'soft'}:${transientWorkspaceId || 'none'}`
  const transientModeActive = !!settings?.speedDial?.glowTransient
  const glowHoverEnabled = transientModeActive && !!settings?.speedDial?.glowHover
  useEffect(() => {
    if (!glowHoverEnabled || !transientModeActive) {
      setIsDialHovered(false)
      setHoverGlow('')
    }
  }, [glowHoverEnabled, transientModeActive])

  useEffect(() => {
    if (!glowHoverEnabled || !isDialHovered || !transientModeActive) {
      setHoverGlow('')
      return
    }
    const sourceId = transientWorkspaceId || activeWorkspaceId || DEFAULT_GLOW_KEY
    const sustainedGlow = glowManager.createSustainedGlow(sourceId)
    setHoverGlow(sustainedGlow || '')
  }, [glowHoverEnabled, isDialHovered, transientModeActive, transientWorkspaceId, activeWorkspaceId, glowManager])
  const headerDividerEnabled = false
  const hoverPreviewEnabled = !!settings?.speedDial?.workspaceHoverPreview
  const colorlessPreview = !!settings?.speedDial?.colorlessPreview
  const headerBannerMatchWorkspaceColor = !!settings?.speedDial?.headerBannerMatchWorkspaceColor
  const headerBannerStatic = !!settings?.speedDial?.headerBannerStatic
  const headerBannerOverscan = settings?.speedDial?.headerBannerOverscan !== false
  const headerBannerScale = Number(settings?.speedDial?.headerBannerScale ?? 1)
  const headerBannerBold = !!settings?.speedDial?.headerBannerBold
  const headerBannerScrollSeconds = (() => {
    const v = Number(settings?.speedDial?.headerBannerScrollSeconds ?? 24)
    if (!Number.isFinite(v)) return 24
    return Math.max(4, Math.min(120, v))
  })()
  const bannerDirectionSign = bannerDirection < 0 ? -1 : 1
  const matchWorkspaceFonts = !!settings?.appearance?.matchWorkspaceFonts
  const matchWorkspaceTextColor = !!settings?.appearance?.matchWorkspaceTextColor
  const baseHeaderWidthPx = GRID_W + (PAD * 2)
  const effectiveHeaderWidthPx = isClassicMasterLayout
    ? Math.max(bannerGroupWidth || 0, baseHeaderWidthPx)
    : baseHeaderWidthPx
  const headerWidthStyleValue = isClassicMasterLayout ? '100%' : `${baseHeaderWidthPx}px`

  const triggerSpeedDialTransientPulse = useCallback((reason = 'auto') => {
    if (!transientModeActive) return
    const pulseTargetId = transientWorkspaceId || activeWorkspaceId || DEFAULT_GLOW_KEY
    if (!pulseTargetId) return
    const tabPulseId = slugDrivenTransientMode ? (transientWorkspaceId || activeWorkspaceId) : activeWorkspaceId
    const pulseOptions = { holdBoostMs: SPEED_DIAL_HOLD_BOOST_MS }
    if (reason === 'auto') {
      pulseOptions.fadeEasePower = SPEED_DIAL_LOAD_FADE_POWER
    }
    glowManager.createTransientGlow(pulseTargetId, TRANSIENT_PULSE_MS, (glow) => {
      setTransientGlow(glow)
      if (tabPulseId) {
        updateTabTransientGlow(tabPulseId, glow)
      }
    }, pulseOptions)
  }, [
    transientModeActive,
    transientWorkspaceId,
    activeWorkspaceId,
    slugDrivenTransientMode,
    glowManager,
    updateTabTransientGlow
  ])

  // URL-aware helpers
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
  const pathMatchesActive = (() => {
    if (effectiveHardWorkspaceId) return effectiveHardWorkspaceId === activeWorkspaceId
    const ws = workspaces.find(w => w.id === activeWorkspaceId)
    const slug = slugify(ws?.name || '')
    const path = (window.location.pathname || '').replace(/\/+$/, '')
    return path === `/${slug}`
  })()
  // Compute the current header color consistent with header rendering logic
  const currentHeaderColorGlobal = useMemo(() => {
    try {
      // Determine which workspace drives header styling
      const selectedWorkspaceId = effectiveHardWorkspaceId || activeWorkspaceId
      const previewWorkspace = (hoverPreviewEnabled && hoveredWorkspaceId && hoveredWorkspaceId !== selectedWorkspaceId)
        ? (workspaces.find(w => w.id === hoveredWorkspaceId) || null)
        : null
      let stylingWorkspaceId = null
      if (previewWorkspace && !colorlessPreview) {
        stylingWorkspaceId = previewWorkspace.id
      } else if (settings?.speedDial?.workspaceTextByUrl) {
        if (effectiveHardWorkspaceId) stylingWorkspaceId = effectiveHardWorkspaceId
        else stylingWorkspaceId = pathMatchesActive ? activeWorkspaceId : null
      } else {
        stylingWorkspaceId = activeWorkspaceId
      }
      const tokens = headerResolverGlobal.resolveTokens(stylingWorkspaceId || null)
      return tokens?.headerColor || null
    } catch { return null }
  }, [
    headerResolverGlobal,
    hoverPreviewEnabled,
    hoveredWorkspaceId,
    activeWorkspaceId,
    effectiveHardWorkspaceId,
    settings?.speedDial?.workspaceTextByUrl,
    pathMatchesActive,
    workspaces
  ])
  const prevPathRef = useRef((window.location.pathname || ''))
  const [pathTick, setPathTick] = useState(0)
  useEffect(() => {
    const onPop = () => setPathTick((v) => v + 1)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Enhanced glow system integration
  const transientStackGlow = hoverGlow || transientGlow
  const effectiveGlow = transientStackGlow || (!transientModeActive ? currentGlow : '')

  useEffect(() => {
    if (headerEffectMode === 'sustained') {
      setHeaderScrollTick((v) => (v === 0 ? 1 : v))
      setTransientActive(false)
      if (transientTimerRef.current) {
        clearTimeout(transientTimerRef.current)
        transientTimerRef.current = null
      }
    } else if (headerEffectMode === 'off') {
      setHeaderScrollTick(0)
      setTransientActive(false)
      if (transientTimerRef.current) {
        clearTimeout(transientTimerRef.current)
        transientTimerRef.current = null
      }
    } else if (headerEffectMode === 'transient') {
      setHeaderScrollTick((v) => (v === 0 ? 1 : v + 1))
    }
  }, [headerEffectMode])

  // Enhanced glow system effects
  useEffect(() => {
    const prevWorkspaceId = prevWorkspaceRef.current

    if (prevWorkspaceId !== activeWorkspaceId) {
      // Workspace changed - handle glow transition
      const switchType = effectiveHardWorkspaceId ? 'hard' : 'soft'

      // Set sustained glow
      const sustainedGlow = glowManager.handleWorkspaceSwitch(
        prevWorkspaceId,
        activeWorkspaceId,
        switchType
      )
      setCurrentGlow(sustainedGlow)

      prevWorkspaceRef.current = activeWorkspaceId
    } else {
      // Same workspace - just update sustained glow
      const sustainedGlow = glowManager.createSustainedGlow(activeWorkspaceId)
      setCurrentGlow(sustainedGlow)
    }
  }, [activeWorkspaceId, effectiveHardWorkspaceId, settings, glowManager])

  useEffect(() => {
    if (!transientModeActive) return
    if (glowHoverEnabled && isDialHovered) return
    triggerSpeedDialTransientPulse('auto')
  }, [transientModeActive, transientWorkspaceKey, triggerSpeedDialTransientPulse, glowHoverEnabled, isDialHovered])

  useEffect(() => {
    if (transientModeActive) return
    setTransientGlow('')
    setTabTransientGlows({})
    if (activeTabPulseRef.current) {
      glowManager.clearTransientGlow(activeTabPulseRef.current, `tab-focus-${activeTabPulseRef.current}`)
      activeTabPulseRef.current = null
    }
  }, [transientModeActive])

  const triggerTabFocusPulse = useCallback((workspaceId) => {
    if (!settings?.speedDial?.glowTransient) return
    if (!workspaceId) return

    const doubleClickEnabled = !!settings?.general?.autoUrlDoubleClick
    const hasHardWorkspace = !!effectiveHardWorkspaceId
    const mode = settings?.speedDial?.softSwitchGlowBehavior || 'noGlow'

    const focusWorkspaceId = (doubleClickEnabled && hasHardWorkspace) ? effectiveHardWorkspaceId : workspaceId
    if (!focusWorkspaceId) return

    let colorSourceId = null

    if (!doubleClickEnabled || !hasHardWorkspace) {
      if (focusWorkspaceId === activeWorkspaceId) {
        colorSourceId = focusWorkspaceId || DEFAULT_GLOW_KEY
      }
    } else if (mode === 'pinnedGlow') {
      colorSourceId = effectiveHardWorkspaceId
    } else if (mode === 'glowFollows') {
      if (focusWorkspaceId === activeWorkspaceId) {
        colorSourceId = effectiveHardWorkspaceId || activeWorkspaceId
      } else if (focusWorkspaceId === effectiveHardWorkspaceId) {
        colorSourceId = effectiveHardWorkspaceId
      }
    } else {
      if (focusWorkspaceId === activeWorkspaceId) {
        colorSourceId = activeWorkspaceId
      } else if (focusWorkspaceId === effectiveHardWorkspaceId && activeWorkspaceId === effectiveHardWorkspaceId) {
        colorSourceId = effectiveHardWorkspaceId
      }
    }

    if (!colorSourceId) return

    const previousPulse = activeTabPulseRef.current
    if (previousPulse && previousPulse !== focusWorkspaceId) {
      glowManager.clearTransientGlow(previousPulse, `tab-focus-${previousPulse}`)
      updateTabTransientGlow(previousPulse, '')
    }

    const contextKey = `tab-focus-${focusWorkspaceId}`
    glowManager.clearTransientGlow(focusWorkspaceId, contextKey)
    glowManager.createTransientGlow(colorSourceId, TRANSIENT_PULSE_MS, (glow) => {
      updateTabTransientGlow(focusWorkspaceId, glow)
    }, { contextKey, holdBoostMs: SPEED_DIAL_HOLD_BOOST_MS })
    activeTabPulseRef.current = focusWorkspaceId
  }, [
    settings?.speedDial?.glowTransient,
    settings?.general?.autoUrlDoubleClick,
    settings?.speedDial?.softSwitchGlowBehavior,
    activeWorkspaceId,
    effectiveHardWorkspaceId,
    glowManager,
    updateTabTransientGlow
  ])

  useEffect(() => {
    if (!transientModeActive) return
    if (!activeWorkspaceId) return
    triggerTabFocusPulse(activeWorkspaceId)
  }, [transientModeActive, activeWorkspaceId, triggerTabFocusPulse])

  const handleDialMouseDownCapture = useCallback((event) => {
    if (!transientModeActive) return
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('[data-role="workspace-tabs"]')) return
    if (event.defaultPrevented) return
    triggerSpeedDialTransientPulse('click')
  }, [transientModeActive, triggerSpeedDialTransientPulse])

  const dialWrapperRef = useRef(null)

  const handleDialMouseEnter = useCallback((event) => {
    if (!transientModeActive || !glowHoverEnabled) return
    const currentTarget = dialWrapperRef.current
    if (!currentTarget) return
    const related = event?.relatedTarget
    if (related && currentTarget.contains(related)) return
    setIsDialHovered(true)
  }, [transientModeActive, glowHoverEnabled])

  const handleDialMouseLeave = useCallback((event) => {
    if (!transientModeActive || !glowHoverEnabled) return
    const currentTarget = dialWrapperRef.current
    if (currentTarget) {
      const related = event?.relatedTarget
      if (related && currentTarget.contains(related)) return
    }
    setIsDialHovered(false)
    setHoverGlow('')
    setTransientGlow('')
    setTabTransientGlows((prev) => (prev && Object.keys(prev).length ? {} : prev))
  }, [transientModeActive, glowHoverEnabled])

  // Scroll to change workspace functionality for speed dial
  const scrollToChangeWorkspace = !!(settings?.general?.scrollToChangeWorkspace)
  const scrollToChangeWorkspaceIncludeSpeedDial = !!(settings?.general?.scrollToChangeWorkspaceIncludeSpeedDial)
  const scrollToChangeWorkspaceIncludeWholeColumn = !!(settings?.general?.scrollToChangeWorkspaceIncludeWholeColumn)
  const scrollToChangeWorkspaceResistance = !!(settings?.general?.scrollToChangeWorkspaceResistance)
  const scrollToChangeWorkspaceResistanceIntensity = Number(settings?.general?.scrollToChangeWorkspaceResistanceIntensity ?? 100)
  const speedDialScrollEnabled = scrollToChangeWorkspace
  const speedDialScrollTimeoutRef = useRef(null)
  const speedDialLastScrollTimeRef = useRef(0)
  const speedDialIsMouseOverRef = useRef(false)
  const speedDialScrollAccumulatorRef = useRef(0) // For resistance scrolling

  const handleSpeedDialWheel = useCallback((e) => {
    // Disable scroll-to-change-workspace when settings panel is open
    if (isSettingsOpen()) {
      return;
    }
    if (!speedDialScrollEnabled || !dialWrapperRef.current || !workspaces || workspaces.length === 0) return

    // If includeWholeColumn is enabled, let the column-level handler take care of it
    if (scrollToChangeWorkspaceIncludeWholeColumn) {
      return; // Let the column handler in App.jsx handle it
    }

    const container = dialWrapperRef.current
    const rect = container.getBoundingClientRect()
    const mouseY = e.clientY

    if (!scrollToChangeWorkspaceIncludeSpeedDial) {
      // If includeSpeedDial is false, only allow scrolling in bottom 20% of speed dial
      const bottomThreshold = rect.top + (rect.height * 0.8) // Bottom 20%
      if (mouseY < bottomThreshold) {
        return // Not in bottom area, ignore scroll
      }
    } else {
      // If includeSpeedDial is true but whole column is false, check if mouse is over container
      if (!speedDialIsMouseOverRef.current) return
    }

    // Throttle scroll events (max once per 150ms)
    const now = Date.now()
    if (now - speedDialLastScrollTimeRef.current < 150) {
      e.preventDefault()
      return
    }
    speedDialLastScrollTimeRef.current = now

    // Determine scroll direction and delta
    const deltaY = e.deltaY

    // Resistance scrolling: accumulate scroll delta before changing workspace
    if (scrollToChangeWorkspaceResistance) {
      speedDialScrollAccumulatorRef.current += Math.abs(deltaY)
      const RESISTANCE_THRESHOLD = Math.max(50, Math.min(500, scrollToChangeWorkspaceResistanceIntensity))
      if (speedDialScrollAccumulatorRef.current < RESISTANCE_THRESHOLD) {
        e.preventDefault()
        return
      }
      speedDialScrollAccumulatorRef.current = 0 // Reset accumulator
    }

    // Prevent default scroll behavior
    e.preventDefault()
    e.stopPropagation()

    // Clear any pending timeout
    if (speedDialScrollTimeoutRef.current) {
      clearTimeout(speedDialScrollTimeoutRef.current)
    }

    // Determine scroll direction
    const scrollDown = deltaY > 0

    // Find current workspace index
    const currentIndex = workspaces.findIndex(ws => ws.id === activeWorkspaceId)
    if (currentIndex === -1) return

    // Calculate next workspace index
    let nextIndex
    if (scrollDown) {
      nextIndex = currentIndex < workspaces.length - 1 ? currentIndex + 1 : 0
    } else {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : workspaces.length - 1
    }

    // Change workspace immediately
    const nextWorkspace = workspaces[nextIndex]
    if (nextWorkspace && nextWorkspace.id !== activeWorkspaceId) {
      onWorkspaceSelect?.(nextWorkspace.id)
    }
  }, [speedDialScrollEnabled, scrollToChangeWorkspaceIncludeSpeedDial, scrollToChangeWorkspaceIncludeWholeColumn, scrollToChangeWorkspaceResistance, scrollToChangeWorkspaceResistanceIntensity, workspaces, activeWorkspaceId, onWorkspaceSelect])

  useEffect(() => {
    if (!speedDialScrollEnabled || !dialWrapperRef.current) return

    const container = dialWrapperRef.current
    
    const handleMouseEnter = () => {
      speedDialIsMouseOverRef.current = true
      speedDialScrollAccumulatorRef.current = 0 // Reset on mouse enter
    }
    
    const handleMouseLeave = () => {
      speedDialIsMouseOverRef.current = false
      speedDialScrollAccumulatorRef.current = 0 // Reset on mouse leave
    }
    
    if (scrollToChangeWorkspaceIncludeSpeedDial) {
      container.addEventListener('mouseenter', handleMouseEnter)
      container.addEventListener('mouseleave', handleMouseLeave)
    }
    container.addEventListener('wheel', handleSpeedDialWheel, { passive: false })

    return () => {
      if (scrollToChangeWorkspaceIncludeSpeedDial) {
        container.removeEventListener('mouseenter', handleMouseEnter)
        container.removeEventListener('mouseleave', handleMouseLeave)
      }
      container.removeEventListener('wheel', handleSpeedDialWheel)
      if (speedDialScrollTimeoutRef.current) {
        clearTimeout(speedDialScrollTimeoutRef.current)
      }
    }
  }, [speedDialScrollEnabled, scrollToChangeWorkspaceIncludeSpeedDial, handleSpeedDialWheel])

  // Handle header transient effect when URL changes (glow handled separately above)
  useEffect(() => {
    const curr = window.location.pathname || ''
    if (curr !== prevPathRef.current) {
      prevPathRef.current = curr
      if (headerEffectMode === 'transient') {
        setHeaderScrollTick((v) => v + 1)
      }
    }
  }, [activeWorkspaceId, pathTick, headerEffectMode])

  useEffect(() => {
    if (headerEffectMode !== 'transient' || headerScrollTick === 0) return undefined
    setTransientActive(true)
    if (transientTimerRef.current) {
      clearTimeout(transientTimerRef.current)
    }
    const timer = setTimeout(() => {
      setTransientActive(false)
      transientTimerRef.current = null
    }, TRANSIENT_BANNER_DURATION_MS)
    transientTimerRef.current = timer
    return () => clearTimeout(timer)
  }, [headerEffectMode, headerScrollTick])

  useEffect(() => () => {
    if (transientTimerRef.current) {
      clearTimeout(transientTimerRef.current)
      transientTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!hoverPreviewEnabled) {
      prevHoverRef.current = null
      return
    }
    if (headerEffectMode === 'off') {
      prevHoverRef.current = hoveredWorkspaceId || null
      return
    }
    if (hoveredWorkspaceId !== prevHoverRef.current) {
      prevHoverRef.current = hoveredWorkspaceId || null
      if (headerEffectMode === 'transient') {
        setHeaderScrollTick((v) => v + 1)
      }
    }
  }, [hoveredWorkspaceId, hoverPreviewEnabled, headerEffectMode])

  // Helper: clamp into fixed grid bounds
  const clampGX = (gx) => Math.max(0, Math.min(Math.max(activeCols - 1, 0), gx | 0))
  const clampGY = (gy) => Math.max(0, Math.min(Math.max(activeRows - 1, 0), gy | 0))
  const clampGYFolder = (gy) => Math.max(0, Math.min(FOLDER_ROWS - 1, gy | 0))
  const clampPage = (page) => {
    if (typeof page !== 'number' || !Number.isFinite(page)) return 0
    return Math.max(0, page | 0)
  }
  const layoutOverrides = settings?.speedDial?.dialLayoutOverrides || {}

  // Ensure Classic layout has independent overrides so Modern changes do not leak into Classic.
  useEffect(() => {
    if (!isClassicMasterLayout) return
    if (!classicLayoutReady) return
    if (!onDialLayoutChange) return

    const clampColumn = (value) => {
      const max = Math.max(activeCols - 1, 0)
      return Math.max(0, Math.min(max, value | 0))
    }
    const clampRow = (value) => {
      const max = Math.max(activeRows - 1, 0)
      return Math.max(0, Math.min(max, value | 0))
    }
    const clampClassicPage = (value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 0
      return Math.max(0, value | 0)
    }

    workspaces.forEach(ws => {
      const baseTiles = Array.isArray(allSpeedDials?.[ws.id]) ? allSpeedDials[ws.id] : []
      if (baseTiles.length === 0) return

      const existing = Array.isArray(layoutOverrides?.[ws.id]?.classic)
        ? layoutOverrides[ws.id].classic
        : []
      const existingById = new Map(existing.map(entry => [entry.id, entry]))

      let needsUpdate = false
      const nextEntries = baseTiles.map(tile => {
        const fallbackGX = clampColumn(typeof tile.gridX === 'number' ? tile.gridX : 0)
        const fallbackGY = clampRow(typeof tile.gridY === 'number' ? tile.gridY : 0)
        const fallbackPage = clampClassicPage(typeof tile.page === 'number' ? tile.page : 0)
        const prev = existingById.get(tile.id)
        existingById.delete(tile.id)

        if (prev) {
          const normalized = {
            id: tile.id,
            gridX: clampColumn(typeof prev.gridX === 'number' ? prev.gridX : fallbackGX),
            gridY: clampRow(typeof prev.gridY === 'number' ? prev.gridY : fallbackGY),
            page: clampClassicPage(typeof prev.page === 'number' ? prev.page : fallbackPage)
          }
          if (
            normalized.gridX !== prev.gridX ||
            normalized.gridY !== prev.gridY ||
            normalized.page !== prev.page
          ) {
            needsUpdate = true
          }
          return normalized
        }

        needsUpdate = true
        return {
          id: tile.id,
          gridX: fallbackGX,
          gridY: fallbackGY,
          page: fallbackPage
        }
      })

      if (existingById.size > 0) {
        needsUpdate = true
      }

      if (needsUpdate) {
        onDialLayoutChange(ws.id, 'classic', nextEntries)
      }
    })
  }, [isClassicMasterLayout, classicLayoutReady, activeCols, activeRows, workspaces, allSpeedDials, layoutOverrides, onDialLayoutChange])
  const tilesOf = (wsId) => {
    const baseTiles = Array.isArray(allSpeedDials?.[wsId]) ? allSpeedDials[wsId] : []
    const overrideEntries = layoutOverrides?.[wsId]?.[layoutKey]
    const overrideMap = Array.isArray(overrideEntries)
      ? new Map(overrideEntries.map(entry => [entry.id, entry]))
      : null
    return baseTiles.map(tile => {
      const overridePos = overrideMap?.get(tile.id)
      const sourceGX = overridePos && typeof overridePos.gridX === 'number'
        ? overridePos.gridX
        : (typeof tile.gridX === 'number' ? tile.gridX : 0)
      const sourceGY = overridePos && typeof overridePos.gridY === 'number'
        ? overridePos.gridY
        : (typeof tile.gridY === 'number' ? tile.gridY : 0)
      const sourcePage = overridePos && typeof overridePos.page === 'number'
        ? overridePos.page
        : (typeof tile.page === 'number' ? tile.page : 0)
      return {
        ...tile,
        gridX: clampGX(sourceGX),
        gridY: clampGY(sourceGY),
        page: clampPage(sourcePage),
      }
    })
  }
  const occupantAt = (wsId, gx, gy, page = null) => tilesOf(wsId).find(t => {
    const samePage = page == null ? true : clampPage(t.page ?? 0) === clampPage(page)
    return samePage && clampGX(t.gridX ?? 0) === clampGX(gx) && clampGY(t.gridY ?? 0) === clampGY(gy)
  })
  const nearestFree = (wsId, gx, gy, options = {}) => {
    const startPage = clampPage(typeof options.page === 'number' ? options.page : getActivePageForWorkspace(wsId))
    const maxRadius = typeof options.maxRadius === 'number' ? options.maxRadius : 6
    const tiles = tilesOf(wsId)
    const findFirstFree = (occupiedSet) => {
      for (let y = 0; y < activeRows; y++) {
        for (let x = 0; x < activeCols; x++) {
          const key = `${x},${y}`
          if (!occupiedSet.has(key)) {
            return { gx: x, gy: y }
          }
        }
      }
      return { gx: clampGX(gx), gy: clampGY(gy) }
    }
    const resolveForPage = (page) => {
      const pageTiles = tiles.filter(t => clampPage(t.page ?? 0) === page)
      const occ = new Set(pageTiles.map(t => `${clampGX(t.gridX ?? 0)},${clampGY(t.gridY ?? 0)}`))
      const targetGX = clampGX(gx)
      const targetGY = clampGY(gy)
      if (occ.size >= PAGE_CAPACITY) {
        return null
      }
      if (!occ.has(`${targetGX},${targetGY}`)) {
        return { gx: targetGX, gy: targetGY, page, createdNewPage: false }
      }
      for (let r = 1; r <= maxRadius; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = clampGX(targetGX + dx)
            const y = clampGY(targetGY + dy)
            const key = `${x},${y}`
            if (!occ.has(key)) {
              return { gx: x, gy: y, page, createdNewPage: false }
            }
          }
        }
      }
      const fallback = findFirstFree(occ)
      return { gx: fallback.gx, gy: fallback.gy, page, createdNewPage: false }
    }

    let page = startPage
    let attempt = resolveForPage(page)
    while (!attempt) {
      page += 1
      const pageTiles = tiles.filter(t => clampPage(t.page ?? 0) === page)
      const occ = new Set(pageTiles.map(t => `${clampGX(t.gridX ?? 0)},${clampGY(t.gridY ?? 0)}`))
      if (occ.size < PAGE_CAPACITY) {
        const fallback = findFirstFree(occ)
        return { gx: fallback.gx, gy: fallback.gy, page, createdNewPage: true }
      }
    }
    return attempt || { gx: clampGX(gx), gy: clampGY(gy), page: startPage, createdNewPage: false }
  }
  useEffect(() => {
    const layoutPages = activePagesByLayout[layoutKey] || {}
    const updates = {}
    workspaces.forEach(ws => {
      const tiles = tilesOf(ws.id)
      let maxPage = 0
      if (tiles.length > 0) {
        maxPage = tiles.reduce((acc, tile) => Math.max(acc, clampPage(tile.page ?? 0)), 0)
      }
      const totalPages = Math.max(1, maxPage + 1)
      const current = layoutPages[ws.id] ?? 0
      if (current >= totalPages) {
        updates[ws.id] = totalPages - 1
      }
    })
    const updateKeys = Object.keys(updates)
    if (updateKeys.length > 0) {
      setActivePagesByLayout(prev => {
        const next = { ...prev }
        const layoutState = { ...(next[layoutKey] || {}) }
        updateKeys.forEach((wsId) => {
          layoutState[wsId] = updates[wsId]
        })
        next[layoutKey] = layoutState
        return next
      })
    }
  }, [workspaces, layoutKey, activePagesByLayout, allSpeedDials, layoutOverrides, activeCols, activeRows])

  const cloneTileDeep = (tile) => {
    if (!tile || typeof tile !== 'object') return tile
    const cloned = { ...tile }
    if (Array.isArray(tile.children)) {
      cloned.children = tile.children.map(cloneTileDeep)
    }
    return cloned
  }

  const upsertTiles = (wsId, update) => {
    // Effective view for the current layout (includes overrides when present)
    const sourceTiles = tilesOf(wsId)
    const beforeEffective = sourceTiles.map(cloneTileDeep)
    const effectiveList = beforeEffective.map(cloneTileDeep)

    // Normalize result and compact page indices to remove empties/gaps for this layout
    const compactPages = (arr) => {
      const usedPages = Array.from(new Set(arr.map(t => clampPage(t.page ?? 0)))).sort((a, b) => a - b)
      const map = new Map()
      usedPages.forEach((p, idx) => map.set(p, idx))
      const normalized = arr.map(t => ({
        ...t,
        gridX: clampGX(typeof t.gridX === 'number' ? t.gridX : 0),
        gridY: clampGY(typeof t.gridY === 'number' ? t.gridY : 0),
        page: clampPage(map.has(clampPage(t.page ?? 0)) ? map.get(clampPage(t.page ?? 0)) : 0)
      }))
      // Clamp active page for this workspace to last available for this layout
      const maxPage = Math.max(0, (usedPages.length || 1) - 1)
      setActivePageForWorkspace(wsId, Math.min(getActivePageForWorkspace(wsId), maxPage))
      return normalized
    }

    const nextEffective = compactPages(update(effectiveList))
    const beforeById = new Map(beforeEffective.map(t => [t.id, t]))
    const afterById = new Map(nextEffective.map(t => [t.id, t]))

    let structuralChange = false
    if (beforeEffective.length !== nextEffective.length) {
      structuralChange = true
    } else {
      for (const [id, before] of beforeById.entries()) {
        const after = afterById.get(id)
        if (!after) {
          structuralChange = true
          break
        }
        const metaFields = ['url', 'title', 'favicon']
        if (metaFields.some((key) => (before[key] || '') !== (after[key] || ''))) {
          structuralChange = true
          break
        }
        const beforeIsFolder = Array.isArray(before.children)
        const afterIsFolder = Array.isArray(after.children)
        if (beforeIsFolder !== afterIsFolder) {
          structuralChange = true
          break
        }
        if (beforeIsFolder && afterIsFolder) {
          if (before.children.length !== after.children.length) {
            structuralChange = true
            break
          }
          for (let i = 0; i < before.children.length; i += 1) {
            const bChild = before.children[i]
            const aChild = after.children[i]
            if (!aChild) {
              structuralChange = true
              break
            }
            const childMeta = ['id', 'url', 'title', 'favicon']
            if (childMeta.some((key) => (bChild?.[key] || '') !== (aChild?.[key] || ''))) {
              structuralChange = true
              break
            }
          }
          if (structuralChange) break
        }
      }
    }


    const shouldUpdateBase = (layoutKey === 'modern') || structuralChange

    // Always sync structural and metadata changes to the base list (shared across layouts)
    if (shouldUpdateBase && onTilesChangeByWorkspace) {
      const baseList = Array.isArray(allSpeedDials?.[wsId]) ? allSpeedDials[wsId] : []
      const baseById = new Map(baseList.map(t => [t.id, t]))
      const nextById = new Map(nextEffective.map(t => [t.id, t]))

      const normalizeBasePositions = (tiles) => {
        const clampGXModern = (value) => Math.max(0, Math.min(MODERN_COLS - 1, value | 0))
        const clampGYModern = (value) => Math.max(0, Math.min(MODERN_ROWS - 1, value | 0))
        const pageSlots = new Map()
        const tryPlace = (page, gx, gy) => {
          if (gx == null || gy == null) return null
          const key = `${gx},${gy}`
          const bucket = pageSlots.get(page)
          if (bucket && bucket.has(key)) return null
          if (gx < 0 || gx >= MODERN_COLS || gy < 0 || gy >= MODERN_ROWS) return null
          if (!bucket) pageSlots.set(page, new Set([key]))
          else bucket.add(key)
          return { page, gx, gy }
        }
        const ensurePlacement = (startPage, prefGX, prefGY) => {
          let page = clampPage(startPage)
          while (true) {
            if (!pageSlots.has(page)) pageSlots.set(page, new Set())
            if (prefGX != null && prefGY != null) {
              const candidate = tryPlace(page, clampGXModern(prefGX), clampGYModern(prefGY))
              if (candidate) return candidate
            }
            const used = pageSlots.get(page)
            if (used.size < MODERN_COLS * MODERN_ROWS) {
              for (let idx = 0; idx < MODERN_COLS * MODERN_ROWS; idx += 1) {
                const gx = idx % MODERN_COLS
                const gy = Math.floor(idx / MODERN_COLS)
                if (!used.has(`${gx},${gy}`)) {
                  used.add(`${gx},${gy}`)
                  return { page, gx, gy }
                }
              }
            }
            page += 1
          }
        }
        return tiles.map((tile) => {
          const preferredPage = clampPage(tile.page ?? 0)
          const preferredGX = Number.isFinite(tile.gridX) ? tile.gridX : null
          const preferredGY = Number.isFinite(tile.gridY) ? tile.gridY : null
          const placement = ensurePlacement(preferredPage, preferredGX, preferredGY)
          return {
            ...tile,
            gridX: placement.gx,
            gridY: placement.gy,
            page: placement.page
          }
        }).map((tile, idx) => ({ ...tile, position: idx }))
      }

      // Build next base list: preserve modern arrangement in base; keep classic arrangement in overrides only
      const nextBase = (() => {
        const result = []
        // Keep tiles that still exist, remove those that don't
        baseList.forEach(baseTile => {
          if (!nextById.has(baseTile.id)) return // removed
          const nextTile = nextById.get(baseTile.id)
          // Sync metadata fields
          const merged = {
            ...baseTile,
            url: nextTile.url,
            title: nextTile.title,
            favicon: nextTile.favicon,
            children: Array.isArray(nextTile.children) ? nextTile.children : baseTile.children
          }
          // Only update base positions if we're editing in the Modern layout
          if (layoutKey === 'modern') {
            merged.gridX = clampGX(typeof nextTile.gridX === 'number' ? nextTile.gridX : (typeof baseTile.gridX === 'number' ? baseTile.gridX : 0))
            merged.gridY = clampGY(typeof nextTile.gridY === 'number' ? nextTile.gridY : (typeof baseTile.gridY === 'number' ? baseTile.gridY : 0))
            merged.page = clampPage(typeof nextTile.page === 'number' ? nextTile.page : (typeof baseTile.page === 'number' ? baseTile.page : 0))
          }
          result.push(merged)
        })
        // Add new tiles that are present in nextEffective but not in base
        nextEffective.forEach(nextTile => {
          if (baseById.has(nextTile.id)) return
          result.push({
            ...nextTile,
            // If adding from Classic, avoid leaking Classic arrangement into base
            gridX: layoutKey === 'modern' ? clampGX(nextTile.gridX ?? 0) : 0,
            gridY: layoutKey === 'modern' ? clampGY(nextTile.gridY ?? 0) : 0,
            page: layoutKey === 'modern' ? clampPage(nextTile.page ?? 0) : 0,
          })
        })
        return result
      })()

      const normalizedBase = normalizeBasePositions(nextBase)
      onTilesChangeByWorkspace(wsId, normalizedBase)

      if (layoutKey === 'modern' && onDialLayoutChange) {
        const prevClassicEntries = Array.isArray(layoutOverrides?.[wsId]?.classic)
          ? layoutOverrides[wsId].classic
          : []
        const prevById = new Map(prevClassicEntries.map(entry => [entry.id, entry]))
        const colsForClassic = Math.max(
          MIN_CLASSIC_COLS,
          Math.min(MAX_CLASSIC_COLS, classicColumnCount || DEFAULT_CLASSIC_COLS)
        )
        const clampClassicGX = (value) => Math.max(0, Math.min(colsForClassic - 1, value | 0))
        const clampClassicGY = (value) => Math.max(0, Math.min(CLASSIC_ROWS - 1, value | 0))
        const clampClassicPage = (value) => {
          if (typeof value !== 'number' || !Number.isFinite(value)) return 0
          return Math.max(0, value | 0)
        }
        const usedSlots = new Set()
        const claimSlot = (gx, gy, page) => {
          let px = clampClassicPage(page)
          let cx = clampClassicGX(gx)
          let cy = clampClassicGY(gy)
          const maxIterations = Math.max(16, colsForClassic * CLASSIC_ROWS * 8)
          let attempts = 0
          while (attempts < maxIterations) {
            const key = `${px}:${cx},${cy}`
            if (!usedSlots.has(key)) {
              usedSlots.add(key)
              return { gridX: cx, gridY: cy, page: px }
            }
            cx += 1
            if (cx >= colsForClassic) {
              cx = 0
              cy += 1
            }
            if (cy >= CLASSIC_ROWS) {
              cy = 0
              px += 1
            }
            attempts += 1
          }
          return {
            gridX: clampClassicGX(cx),
            gridY: clampClassicGY(cy),
            page: clampClassicPage(px)
          }
        }

        const nextClassicEntries = normalizedBase.map((tile) => {
          const prev = prevById.get(tile.id)
          const desiredGX = prev?.gridX ?? tile.gridX ?? 0
          const desiredGY = prev?.gridY ?? tile.gridY ?? 0
          const desiredPage = prev?.page ?? tile.page ?? 0
          const slot = claimSlot(desiredGX, desiredGY, desiredPage)
          prevById.delete(tile.id)
          return {
            id: tile.id,
            gridX: slot.gridX,
            gridY: slot.gridY,
            page: slot.page
          }
        })

        const prevNormalized = prevClassicEntries.map(entry => ({
          id: entry.id,
          gridX: clampClassicGX(entry.gridX ?? 0),
          gridY: clampClassicGY(entry.gridY ?? 0),
          page: clampClassicPage(entry.page ?? 0)
        }))

        let classicChanged = prevNormalized.length !== nextClassicEntries.length
        if (!classicChanged) {
          for (let i = 0; i < prevNormalized.length; i += 1) {
            const a = prevNormalized[i]
            const b = nextClassicEntries[i]
            if (!b || a.id !== b.id || a.gridX !== b.gridX || a.gridY !== b.gridY || a.page !== b.page) {
              classicChanged = true
              break
            }
          }
        }

        if (classicChanged) {
          onDialLayoutChange(wsId, 'classic', nextClassicEntries)
        }
      }
    }

    // Persist arrangement for the active layout
    if (layoutKey === 'modern') {
      // Modern arrangement already written to base via nextBase
    } else {
      // Classic arrangement goes into overrides only
      const serialized = nextEffective.map(t => ({
        id: t.id,
        gridX: clampGX(typeof t.gridX === 'number' ? t.gridX : 0),
        gridY: clampGY(typeof t.gridY === 'number' ? t.gridY : 0),
        page: clampPage(typeof t.page === 'number' ? t.page : 0)
      }))
      onDialLayoutChange?.(wsId, layoutKey, serialized)
    }
  }

  // Reflow legacy folder children positions into the folder grid bounds when a folder opens
  useEffect(() => {
    if (!openFolder || !openFolder.id || !activeWorkspaceId) return
    const wsId = activeWorkspaceId
    const clampChildGX = (gx) => {
      if (typeof gx !== 'number' || !Number.isFinite(gx)) return 0
      const max = Math.max(activeCols - 1, 0)
      return Math.max(0, Math.min(max, gx | 0))
    }
    const clampChildGY = (gy) => {
      if (typeof gy !== 'number' || !Number.isFinite(gy)) return 0
      const max = Math.max(FOLDER_ROWS - 1, 0)
      return Math.max(0, Math.min(max, gy | 0))
    }
    let updatedFolder = null
    upsertTiles(wsId, (list) => {
      const idx = list.findIndex(t => t.id === openFolder.id)
      if (idx === -1) return list
      const folder = list[idx]
      const children = Array.isArray(folder.children) ? folder.children.slice() : []
      if (children.length === 0) return list
      const used = new Set()
      const nextSlot = (() => {
        let x = 0
        let y = 0
        return () => {
          while (y < FOLDER_ROWS) {
            const gx = clampChildGX(x)
            const gy = clampChildGY(y)
            x += 1
            if (x >= activeCols) { x = 0; y += 1 }
            const key = `${gx},${gy}`
            if (used.has(key)) continue
            used.add(key)
            return { gx, gy, key }
          }
          return { gx: 0, gy: 0, key: '0,0' }
        }
      })()
      let changed = false
      const nextChildren = children.map(child => {
        const rawGX = typeof child.gridX === 'number' ? child.gridX : null
        const rawGY = typeof child.gridY === 'number' ? child.gridY : null
        let gx = rawGX != null ? clampChildGX(rawGX) : null
        let gy = rawGY != null ? clampChildGY(rawGY) : null
        let key = (gx != null && gy != null) ? `${gx},${gy}` : ''
        const invalid = !(Number.isFinite(gx) && Number.isFinite(gy))
        if (invalid || used.has(key)) {
          const slot = nextSlot()
          gx = slot.gx
          gy = slot.gy
          key = slot.key
          changed = true
        } else if (gx !== rawGX || gy !== rawGY) {
          used.add(key)
          changed = true
        } else {
          used.add(key)
        }
        return { ...child, gridX: gx, gridY: gy }
      })
      if (!changed) return list
      const updated = { ...folder, children: nextChildren }
      const next = list.slice()
      next[idx] = updated
      updatedFolder = updated
      return next
    })
    if (updatedFolder) {
      syncOpenFolderState(updatedFolder)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFolder?.id, activeWorkspaceId, activeCols, FOLDER_ROWS, syncOpenFolderState])

  function commitActiveTiles(next) {
    upsertTiles(activeWorkspaceId, (list) => {
      const resolved = typeof next === 'function' ? next(list) : next
      if (!Array.isArray(resolved)) return list
      return resolved.map(cloneTileDeep)
    })
  }

  const posFromEvent = (wsId, e) => {
    const el = gridRef.current
    const currentPage = getActivePageForWorkspace(wsId)
    if (!el) return { gx: 0, gy: 0, page: currentPage }
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const gx = clampGX(Math.floor(x / CELL))
    const gy = clampGY(Math.floor((y - HEADER_H) / CELL))
    return { gx, gy, page: currentPage }
  }

  const startDrag = (wsId, tile, e) => {
    // Only editable when in edit mode (folder or homepage)
    if (!editMode) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const initialGX = clampGX(typeof tile.gridX === 'number' ? tile.gridX : 0)
    const initialGY = openFolder ? clampGYFolder(typeof tile.gridY === 'number' ? tile.gridY : 0) : clampGY(typeof tile.gridY === 'number' ? tile.gridY : 0)
    const initialPage = clampPage(typeof tile.page === 'number' ? tile.page : getActivePageForWorkspace(wsId))
    setDrag({
      dragging: true,
      wsId,
      tile,
      offset: { x: e.clientX - r.left, y: e.clientY - r.top },
      drop: { gx: initialGX, gy: initialGY, page: initialPage, back: false },
      origin: { gridX: initialGX, gridY: initialGY, page: initialPage },
      mergeIntent: false,
      justDropped: false,
      originFolderId: openFolder?.id || null,
    })
  }

  const onMouseMove = useCallback((e) => {
    if (!drag.dragging) return
    lastMouse.current = { x: e.clientX, y: e.clientY }
    const wantsMerge = !!(e.altKey || e.metaKey)
    if (openFolder) {
      const el = gridRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const gxRaw = Math.floor(x / CELL)
      const gyRaw = Math.floor((y - HEADER_H) / CELL)
      const gx = clampGX(gxRaw)
      const gy = clampGYFolder(gyRaw)
      const BACK_GX = 0
      const BACK_GY = activeRows - 1
      const overBackCell = (gxRaw === BACK_GX && gyRaw === BACK_GY)
      setDrag(prev => ({
        ...prev,
        drop: {
          gx,
          gy,
          page: prev.drop?.page ?? clampPage(prev.tile?.page ?? getActivePageForWorkspace(prev.wsId || activeWorkspaceId)),
          back: overBackCell
        },
        mergeIntent: false
      }))
    } else {
      const { gx, gy, page } = posFromEvent(drag.wsId || activeWorkspaceId, e)
      setDrag(prev => ({
        ...prev,
        drop: { gx: clampGX(gx), gy: clampGY(gy), page, back: false },
        mergeIntent: wantsMerge
      }))
    }
  }, [drag.dragging, openFolder])

  const onMouseUp = useCallback(() => {
    if (!drag.dragging || !drag.tile || !drag.wsId) return
    const { wsId, tile } = drag
    if (openFolder) {
      // Dropped while a folder is open
      const el = gridRef.current
      let outside = true
      let overBack = false
      if (el) {
        const r = el.getBoundingClientRect()
        outside = !(lastMouse.current.x >= r.left && lastMouse.current.x <= r.right && lastMouse.current.y >= r.top && lastMouse.current.y <= r.bottom)
      }
      if (backButtonRef.current) {
        const br = backButtonRef.current.getBoundingClientRect()
        overBack = lastMouse.current.x >= br.left && lastMouse.current.x <= br.right && lastMouse.current.y >= br.top && lastMouse.current.y <= br.bottom
      }
      const BACK_GX = 0
      const BACK_GY = activeRows - 1
      const dropOnBackCell = (drag.drop?.back === true) || ((drag.drop?.gx === BACK_GX) && (drag.drop?.gy === BACK_GY))
      if (outside || overBack || dropOnBackCell) {
        // Move child tile back to root of ws; if folder reduces to 0 or 1 child, collapse it.
        upsertTiles(wsId, (list) => {
          const idx = list.findIndex(t => t.id === openFolder.id)
          if (idx === -1) return list
          const folder = list[idx]
          const remaining = (folder.children || []).filter(c => c.id !== tile.id)
          const before = list.slice(0, idx)
          const after = list.slice(idx + 1)
          // Place dragged child
          const folderPage = clampPage(openFolder.page ?? getActivePageForWorkspace(wsId))
          const spot1 = nearestFree(wsId, 0, 0, { page: folderPage })
          if (spot1.createdNewPage) {
            setActivePageForWorkspace(wsId, spot1.page)
          }
          const movedOut = { ...tile, gridX: spot1.gx, gridY: spot1.gy, page: spot1.page }
          if (remaining.length === 0) {
            // Remove folder entirely
            return [...before, movedOut, ...after]
          } else if (remaining.length === 1) {
            // Move last remaining out and remove folder
            const last = remaining[0]
            // Find a second free cell distinct from spot1
            let spot2 = nearestFree(wsId, spot1.gx + 1, spot1.gy, { page: folderPage })
            if (spot2.gx === spot1.gx && spot2.gy === spot1.gy) {
              spot2 = nearestFree(wsId, spot1.gx + 2, spot1.gy, { page: folderPage })
            }
            if (spot2.createdNewPage) {
              setActivePageForWorkspace(wsId, spot2.page)
            }
            const movedLast = { ...last, gridX: spot2.gx, gridY: spot2.gy, page: spot2.page }
            return [...before, movedOut, movedLast, ...after]
          }
          // Keep folder with updated children
          const reflowed = assignFolderSlotsSequential(sortChildrenBySlot(remaining))
          return [...before, { ...folder, children: reflowed }, movedOut, ...after]
        })
        setOpenFolder(null)
      } else {
        // Reorder within folder by sticky grid (swap if target occupied)
        const gx = clampGX(drag.drop?.gx ?? (tile.gridX ?? 0))
        const gy = clampGYFolder(drag.drop?.gy ?? (tile.gridY ?? 0))
        // Block explicit drop on the back cell
        if (drag.drop?.back) {
          setDrag({
            dragging: false,
            wsId: null,
            tile: null,
            offset: { x: 0, y: 0 },
            drop: { gx: null, gy: null, page: 0, back: false },
            origin: null,
            mergeIntent: false,
            justDropped: false,
            originFolderId: null,
          })
          return
        }
        let updatedFolder = null
        upsertTiles(wsId, (list) => {
          const idx = list.findIndex(t => t.id === openFolder.id)
          if (idx === -1) return list
          const folder = list[idx]
          const targetPage = clampPage(drag.drop?.page ?? tile.page ?? folderPage)
          const targetSlot = clampFolderSlotIndex(targetPage, gx, gy)
          const { children: nextChildren, moved } = moveChildWithinFolder(folder.children || [], tile.id, targetSlot)
          if (!moved) return list
          const nextFolder = { ...folder, children: nextChildren }
          updatedFolder = nextFolder
          const nextList = list.slice()
          nextList[idx] = nextFolder
          return nextList
        })
        if (updatedFolder && openFolder?.id === updatedFolder.id) {
          syncOpenFolderState(updatedFolder)
        }
      }
    } else {
      const dropGX = clampGX(drag.drop.gx ?? 0)
      const dropGY = clampGY(drag.drop.gy ?? 0)
      const dropPage = clampPage(drag.drop.page ?? tile.page ?? getActivePageForWorkspace(wsId))
      const originGX = clampGX(drag.origin?.gridX ?? tile.gridX ?? 0)
      const originGY = clampGY(drag.origin?.gridY ?? tile.gridY ?? 0)
      const originPage = clampPage(drag.origin?.page ?? tile.page ?? getActivePageForWorkspace(wsId))
      const allowFolderMerge = !drag.originFolderId
      upsertTiles(wsId, (list) => {
        const currentTile = list.find(t => t.id === tile.id) || tile
        const others = list.filter(t => t.id !== tile.id)
        const target = others.find(t =>
          clampPage(t.page ?? 0) === dropPage &&
          clampGX(t.gridX ?? 0) === dropGX &&
          clampGY(t.gridY ?? 0) === dropGY
        )
        const movingIsFolder = Array.isArray(currentTile.children) || currentTile.type === 'folder'
        const targetIsFolder = target && (Array.isArray(target.children) || target.type === 'folder')
        const wantsMerge = allowFolderMerge && (drag.mergeIntent || (!movingIsFolder && !targetIsFolder))

        if (target && movingIsFolder && targetIsFolder) {
          return list
        }

        if (target && movingIsFolder) {
          return list
        }

        if (target && !movingIsFolder && !targetIsFolder && !wantsMerge) {
          const swappedTarget = { ...target, gridX: originGX, gridY: originGY, page: originPage }
          const moved = { ...currentTile, gridX: dropGX, gridY: dropGY, page: dropPage }
          const remapped = others.map(t => (t.id === target.id ? swappedTarget : t))
          return [...remapped, moved]
        }

        const moved = { ...currentTile, gridX: dropGX, gridY: dropGY, page: dropPage }
        if (allowFolderMerge && target && (wantsMerge || movingIsFolder || targetIsFolder)) {
          const withoutTarget = others.filter(t => t.id !== target.id)
          // If dropping onto an existing folder, insert the tile into that folder using
          // the same slotting logic (gravity) used everywhere else.
          if (targetIsFolder) {
            const baseChildren = Array.isArray(target.children) ? target.children : []
            const { children: nextChildren } = insertChildIntoFolder(baseChildren, { ...moved }, target.page ?? dropPage)
            const folder = { ...target, page: dropPage, children: nextChildren }
            return [...withoutTarget, folder]
          }
          // Otherwise, merge two stand‑alone tiles into a new folder.
          let folder
          if (Array.isArray(target.children) && target.children.length > 0) {
            const baseChildren = target.children
            const { children: nextChildren } = insertChildIntoFolder(baseChildren, { ...moved }, target.page ?? dropPage)
            folder = { ...target, page: dropPage, children: nextChildren }
          } else {
            const childA = { ...target, gridX: 0, gridY: 0, page: 0 }
            const childB = { ...moved, gridX: 1, gridY: 0, page: 0 }
            const { children: slotted } = insertChildIntoFolder([], childA, 0)
            const { children: finalChildren } = insertChildIntoFolder(slotted, childB, 0)
            folder = {
              id: 'folder-' + Date.now(),
              title: 'Folder',
              type: 'folder',
              children: finalChildren,
              gridX: dropGX,
              gridY: dropGY,
              page: dropPage
            }
          }
          return [...withoutTarget, folder]
        }

        const filtered = others.filter(t =>
          !(clampPage(t.page ?? 0) === dropPage &&
            clampGX(t.gridX ?? 0) === dropGX &&
            clampGY(t.gridY ?? 0) === dropGY)
        )
        return [...filtered, moved]
      })
    }
    setDrag({
      dragging: false,
      wsId: null,
      tile: null,
      offset: { x: 0, y: 0 },
      drop: { gx: null, gy: null, page: 0, back: false },
      origin: null,
      mergeIntent: false,
      justDropped: true,
      originFolderId: null,
    })
  }, [drag, openFolder])

  useEffect(() => {
    if (drag.dragging) {
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      return () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }
    }
  }, [drag.dragging, onMouseMove, onMouseUp])

  useEffect(() => {
    if (!drag.justDropped) return
    const timer = setTimeout(() => {
      setDrag(prev => prev.justDropped ? { ...prev, justDropped: false } : prev)
    }, 0)
    return () => clearTimeout(timer)
  }, [drag.justDropped])

  const [titleTouched, setTitleTouched] = useState(false)
  const deriveTitleFromUrl = (url) => {
    try {
      const u = normalizeUrl(url)
      const host = (u?.hostname || '').toLowerCase()
      const parts = host.split('.').filter(Boolean)
      if (parts.length >= 2) return parts[parts.length - 2]
      return parts[0] || 'Site'
    } catch { return 'Site' }
  }

  const shouldIgnoreAddTileDoubleClick = (target) => {
    if (!target || typeof target.closest !== 'function') return false
    return !!target.closest('[data-role="tile"], button, a, input, textarea, select, [contenteditable="true"], [data-prevent-add-tile]')
  }

  const devDebug = (...args) => { try { if (import.meta?.env?.DEV) console.debug(...args) } catch { } }

  const startAddTile = useCallback((options = {}) => {
    devDebug('[SpeedDial] startAddTile invoked', options)
    const wsId = options.wsId || activeWorkspaceId
    const page = typeof options.page === 'number' ? options.page : getActivePageForWorkspace(wsId)
    const gx = typeof options.gx === 'number' ? options.gx : 0
    const gy = typeof options.gy === 'number' ? options.gy : 0
    const folderId = options.folderId || null
    const folderPage = typeof options.folderPage === 'number' ? options.folderPage : 0
    setPendingCell({
      wsId,
      gx,
      gy,
      page,
      folderId,
      folderPage
    })
    setNewTileData({ url: '', title: '', customIcon: null, altFavicon: '' })
    setTitleTouched(false)
    setShowAddDialog(true)
    devDebug('[SpeedDial] showAddDialog = true')
  }, [activeWorkspaceId, getActivePageForWorkspace])

  const addTile = async () => {
    const {
      wsId = activeWorkspaceId,
      gx,
      gy,
      page,
      folderId = null,
      folderPage = 0
    } = pendingCell
    const norm = normalizeUrl(newTileData.url)
    let assignedFavicon = newTileData.customIcon || null
    if (!assignedFavicon && newTileData.altFavicon) {
      try {
        const { dataUrl } = await normalizeIconSource(newTileData.altFavicon, { size: 96 })
        const savedUrl = await trySaveIconToProject(dataUrl, 'icon')
        assignedFavicon = savedUrl || dataUrl
      } catch {
        try { assignedFavicon = await fetchFavicon(newTileData.altFavicon) } catch { }
      }
    }
    const baseTile = {
      id: Date.now().toString(),
      url: norm ? norm.href : newTileData.url,
      title: newTileData.title || deriveTitleFromUrl(newTileData.url),
      favicon: assignedFavicon
    }

    if (folderId) {
      let updatedFolder = null
      let insertedPage = clampPage(folderPage)
      let createdNewFolderPage = false
      upsertTiles(wsId, (list) => {
        const idx = list.findIndex(t => t.id === folderId)
        if (idx === -1) return list
        const folder = list[idx]
        const children = Array.isArray(folder.children) ? folder.children : []
        const { children: nextChildren, insertedPage: pageUsed, createdNewPage } = insertChildIntoFolder(children, baseTile, folderPage)
        const updated = { ...folder, children: nextChildren }
        updatedFolder = updated
        insertedPage = pageUsed
        createdNewFolderPage = createdNewPage
        const nextList = list.slice()
        nextList[idx] = updated
        return nextList
      })
      if (updatedFolder && openFolder?.id === folderId) {
        if (createdNewFolderPage) {
          setFolderPage(insertedPage)
        }
        syncOpenFolderState(updatedFolder)
      }
    } else {
      const place = nearestFree(wsId, gx, gy, { page })
      if (place.createdNewPage) {
        setActivePageForWorkspace(wsId, place.page)
      }
      const nextTile = {
        ...baseTile,
        gridX: place.gx,
        gridY: place.gy,
        page: place.page
      }
      upsertTiles(wsId, (list) => [...list, nextTile])
    }
    setShowAddDialog(false)
    setNewTileData({ url: '', title: '', customIcon: null, altFavicon: '' })
    setTitleTouched(false)
    setPendingCell(prev => ({
      ...prev,
      wsId: activeWorkspaceId,
      page: getActivePageForWorkspace(activeWorkspaceId),
      gx: 0,
      gy: 0,
      folderId: null,
      folderPage: 0
    }))
  }

  const DOUBLE_CLICK_TAB_BUFFER = 72

  const onGridDoubleClick = (wsId, e) => {
    devDebug('[SpeedDial] onGridDoubleClick')
    e?.preventDefault?.()
    e?.stopPropagation?.()
    if (shouldIgnoreAddTileDoubleClick(e?.target)) return
    const el = gridRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      if (e?.clientY != null && e.clientY > rect.bottom - DOUBLE_CLICK_TAB_BUFFER) return
    }
    const { gx, gy, page } = posFromEvent(wsId, e)
    if (openFolder?.id) {
      startAddTile({
        wsId,
        gx,
        gy,
        page,
        folderId: openFolder.id,
        folderPage
      })
    } else {
      startAddTile({ wsId, gx, gy, page })
    }
  }

  const iconByName = (name) => {
    const map = { Home, Layers, Grid2X2, AppWindow, LayoutList }
    return map[name] || Layers
  }

  const moveTileToWorkspace = (fromWorkspaceId, toWorkspaceId, tile) => {
    if (!tile || !tile.id || fromWorkspaceId === toWorkspaceId) return
    upsertTiles(fromWorkspaceId, (list) => list.filter(t => t.id !== tile.id))
    upsertTiles(toWorkspaceId, (list) => {
      const nextList = Array.isArray(list) ? list.slice() : []
      const place = nearestFree(toWorkspaceId, tile.gridX ?? 0, tile.gridY ?? 0, { page: getActivePageForWorkspace(toWorkspaceId) })
      if (place.createdNewPage) {
        setActivePageForWorkspace(toWorkspaceId, place.page)
      }
      nextList.push({ ...tile, gridX: place.gx, gridY: place.gy, page: place.page })
      return nextList
    })
  }
  const duplicateTile = (wsId, tile) => {
    if (!tile || !wsId) return
    const duplicate = { ...cloneTileDeep(tile), id: `${tile.id}-${Date.now()}` }
    upsertTiles(wsId, (list) => {
      const nextList = Array.isArray(list) ? list.slice() : []
      const place = nearestFree(wsId, (tile.gridX ?? 0) + 1, tile.gridY ?? 0, { page: tile.page ?? getActivePageForWorkspace(wsId) })
      if (place.createdNewPage) {
        setActivePageForWorkspace(wsId, place.page)
      }
      duplicate.gridX = place.gx
      duplicate.gridY = place.gy
      duplicate.page = place.page
      nextList.push(duplicate)
      return nextList
    })
  }

  // Move to a specific workspace and page (page may be an existing index or a new one)
  const moveTileToWorkspaceAndPage = (fromWorkspaceId, toWorkspaceId, tile, pageIndex) => {
    if (!tile || !tile.id) return
    upsertTiles(fromWorkspaceId, (list) => list.filter(t => t.id !== tile.id))
    upsertTiles(toWorkspaceId, (list) => {
      const nextList = Array.isArray(list) ? list.slice() : []
      const place = nearestFree(toWorkspaceId, tile.gridX ?? 0, tile.gridY ?? 0, { page: clampPage(pageIndex) })
      if (place.createdNewPage) {
        setActivePageForWorkspace(toWorkspaceId, place.page)
      }
      nextList.push({ ...tile, gridX: place.gx, gridY: place.gy, page: place.page })
      return nextList
    })
  }

  // Workspace font resolver using the same preset database as Appearance
  const presetFontMap = {
    system: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, sans-serif',
    modern: 'Inter, system-ui, Arial, sans-serif',
    roboto: 'Roboto, system-ui, Arial, sans-serif',
    bauhaus: 'Josefin Sans, system-ui, Arial, sans-serif',
    industrial: 'Noto Sans JP, Inter, system-ui, sans-serif',
    terminal: 'Fira Code, Menlo, Monaco, Consolas, "Courier New", monospace',
    minecraft: 'Press Start 2P, VT323, monospace',
    orbitron: 'Orbitron, Inter, system-ui, sans-serif',
  }
  const resolveWorkspaceFont = (wsId) => {
    // If workspace theming is disabled, don't resolve workspace-specific fonts
    if (!workspaceThemingEnabled) return undefined
    const sel = (settings?.speedDial?.workspaceTextFonts || {})[wsId]
    if (!sel) return undefined
    const key = String(sel).trim().toLowerCase()
    return presetFontMap[key] || sel
  }

  // Favicon fetching with fallbacks (ensures icons show in experimental dial)
  const fetchFavicon = useCallback(async (url) => {
    if (!url) return null
    const key = getFaviconKey(url)
    if (!key) return null
    if (faviconCache[key]) return faviconCache[key]
    try {
      const host = key || ''
      const labels = host.split('.')
      const apex = labels.length >= 2 ? labels.slice(-2).join('.') : host
      const candidates = Array.from(new Set([
        host,
        apex,
        `www.${apex}`
      ]))
      const sources = []
      for (const d of candidates) {
        const targetUrl = `https://${d}`
        sources.push(
          `https://www.google.com/s2/favicons?domain=${d}&sz=64`,
          `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(targetUrl)}`,
          `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(targetUrl)}&size=64`,
          `https://${d}/favicon.ico`,
          `https://${d}/apple-touch-icon.png`,
          `https://${d}/favicon-32x32.png`,
          `https://icons.duckduckgo.com/ip3/${d}.ico`
        )
      }
      for (const src of sources) {
        try {
          const res = await fetch(src, { mode: 'no-cors' })
          if (res.ok || res.type === 'opaque') {
            setFaviconCache(prev => ({ ...prev, [key]: src }))
            return src
          }
        } catch { /* try next */ }
      }
      const fb = generateFallbackIcon(url)
      setFaviconCache(prev => ({ ...prev, [key]: fb }))
      return fb
    } catch {
      const fb = generateFallbackIcon(url)
      setFaviconCache(prev => ({ ...prev, [key]: fb }))
      return fb
    }
  }, [faviconCache])

  const generateFallbackIcon = (url) => {
    try {
      const domain = getFaviconKey(url) || 'site'
      const letter = domain.charAt(0).toUpperCase()
      const hue = domain.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
      const svg = `
        <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:hsl(${hue},70%,50%);stop-opacity:1" />
              <stop offset="100%" style="stop-color:hsl(${(hue + 30) % 360},70%,40%);stop-opacity:1" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="8" fill="url(#g)"/>
          <text x="32" y="40" font-family="Arial, sans-serif" font-size="24" font-weight="bold" text-anchor="middle" fill="white">${letter}</text>
        </svg>`
      return `data:image/svg+xml;base64,${btoa(svg)}`
    } catch {
      const svg = `
        <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="64" rx="8" fill="#666"/>
          <text x="32" y="40" font-family="Arial, sans-serif" font-size="24" font-weight="bold" text-anchor="middle" fill="white">?</text>
        </svg>`
      return `data:image/svg+xml;base64,${btoa(svg)}`
    }
  }

  // Ensure favicons are loaded for visible tiles in active workspace
  useEffect(() => {
    const ws = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0]
    if (!ws) return
    const list = tilesOf(ws.id)
    list.forEach(tile => {
      const key = getFaviconKey(tile.url)
      if (!tile.favicon && tile.url && key && !faviconCache[key]) {
        fetchFavicon(tile.url).then(icon => {
          if (!icon) return
          upsertTiles(ws.id, (arr) => arr.map(t => t.id === tile.id ? { ...t, favicon: icon } : t))
        })
      }
    })
  }, [activeWorkspaceId, workspaces, allSpeedDials, fetchFavicon, faviconCache])

  const updateTileIcon = (wsId, tileId, { folderId = null, favicon } = {}) => {
    let updatedFolder = null
    upsertTiles(wsId, (list) => {
      let changed = false
      const nextList = list.map(tile => {
        if (!folderId && tile.id === tileId) {
          if ((tile.favicon || null) === (favicon ?? null)) return tile
          changed = true
          return { ...tile, favicon: favicon ?? null }
        }
        if (folderId && tile.id === folderId && Array.isArray(tile.children)) {
          let childChanged = false
          const nextChildren = tile.children.map(child => {
            if (child.id !== tileId) return child
            if ((child.favicon || null) === (favicon ?? null)) return child
            childChanged = true
            return { ...child, favicon: favicon ?? null }
          })
          if (!childChanged) return tile
          changed = true
          const nextFolder = { ...tile, children: nextChildren }
          updatedFolder = nextFolder
          return nextFolder
        }
        return tile
      })
      if (!changed) return list
      return nextList
    })
    if (folderId && updatedFolder && openFolder?.id === folderId) {
      syncOpenFolderState(updatedFolder)
    }
  }

  const createFolderAtCell = (cell) => {
    const nameInput = prompt('Folder name', 'Folder')
    if (nameInput == null) return
    const folderTitle = nameInput.trim() || 'Folder'
    const targetWsId = cell?.wsId || activeWorkspaceId
    const startPage = clampPage(typeof cell?.page === 'number' ? cell.page : getActivePageForWorkspace(targetWsId))
    const startGX = clampGX(typeof cell?.gx === 'number' ? cell.gx : 0)
    const startGY = clampGY(typeof cell?.gy === 'number' ? cell.gy : 0)
    const spot = nearestFree(targetWsId, startGX, startGY, { page: startPage })
    if (spot.createdNewPage) {
      setActivePageForWorkspace(targetWsId, spot.page)
    }
    const folderId = `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const newFolder = {
      id: folderId,
      title: folderTitle,
      type: 'folder',
      children: [],
      gridX: spot.gx,
      gridY: spot.gy,
      page: spot.page
    }
    upsertTiles(targetWsId, (list) => [...list, newFolder])
  }

  const deleteFolderById = useCallback((wsId, folderId, { deleteChildren = false } = {}) => {
    if (!wsId || !folderId) return
    let removedFolder = null
    upsertTiles(wsId, (list) => {
      const folderIndex = list.findIndex(item => item.id === folderId)
      if (folderIndex === -1) return list
      const folder = list[folderIndex]
      removedFolder = folder
      const before = list.slice(0, folderIndex)
      const after = list.slice(folderIndex + 1)
      if (deleteChildren || !Array.isArray(folder.children) || folder.children.length === 0) {
        return [...before, ...after]
      }

      const baseTiles = [...before, ...after]
      const occ = new Set(baseTiles.map(tile => `${clampPage(tile.page ?? 0)}:${clampGX(tile.gridX ?? 0)}:${clampGY(tile.gridY ?? 0)}`))
      const maxExistingPage = baseTiles.reduce((acc, tile) => Math.max(acc, clampPage(tile.page ?? 0)), 0)
      let highestPlacementPage = maxExistingPage

      const claimSlot = (preferred) => {
        const tryPosition = (page, gx, gy) => {
          const key = `${page}:${gx}:${gy}`
          if (!occ.has(key)) {
            occ.add(key)
            highestPlacementPage = Math.max(highestPlacementPage, page)
            return { page, gx, gy }
          }
          return null
        }

        if (preferred) {
          const attempt = tryPosition(clampPage(preferred.page ?? 0), clampGX(preferred.gx ?? 0), clampGY(preferred.gy ?? 0))
          if (attempt) return attempt
        }

        let page = clampPage(preferred?.page ?? getActivePageForWorkspace(wsId))
        const totalSlots = activeCols * activeRows
        // scan preferred page first
        for (let idx = 0; idx < totalSlots; idx += 1) {
          const gx = idx % activeCols
          const gy = Math.floor(idx / activeCols)
          const candidate = tryPosition(page, gx, gy)
          if (candidate) return candidate
        }
        // expand to subsequent pages
        while (true) {
          page += 1
          for (let idx = 0; idx < totalSlots; idx += 1) {
            const gx = idx % activeCols
            const gy = Math.floor(idx / activeCols)
            const candidate = tryPosition(page, gx, gy)
            if (candidate) return candidate
          }
        }
      }

      const nextTiles = [...baseTiles]
      const preferredCell = {
        page: clampPage(folder.page ?? getActivePageForWorkspace(wsId)),
        gx: clampGX(folder.gridX ?? 0),
        gy: clampGY(folder.gridY ?? 0)
      }

      folder.children.forEach((child, idx) => {
        const placement = claimSlot(idx === 0 ? preferredCell : { page: clampPage(child.page ?? preferredCell.page) })
        nextTiles.push({
          ...child,
          gridX: placement.gx,
          gridY: placement.gy,
          page: placement.page
        })
      })

      if (highestPlacementPage > maxExistingPage) {
        setActivePageForWorkspace(wsId, highestPlacementPage)
      }
      return nextTiles
    })

    if (removedFolder && openFolder?.id === folderId) {
      setOpenFolder(null)
      setFolderPage(0)
    }
  }, [upsertTiles, clampPage, clampGX, clampGY, activeCols, activeRows, getActivePageForWorkspace, setActivePageForWorkspace, openFolder])

  const closeFolderDeleteDialog = useCallback(() => {
    setFolderDeleteDialog({ open: false, wsId: null, folderId: null, folderTitle: '', deleteChildren: false })
  }, [])

  const confirmFolderDelete = useCallback(() => {
    if (!folderDeleteDialog.open || !folderDeleteDialog.wsId || !folderDeleteDialog.folderId) {
      closeFolderDeleteDialog()
      return
    }
    deleteFolderById(folderDeleteDialog.wsId, folderDeleteDialog.folderId, { deleteChildren: folderDeleteDialog.deleteChildren })
    closeFolderDeleteDialog()
  }, [folderDeleteDialog, deleteFolderById, closeFolderDeleteDialog])

  // Tile removal helpers
  const removeTile = (wsId, tileId) => {
    let updatedFolder = null
    let removedOpenFolder = false
    upsertTiles(wsId, (list) => {
      const nextList = []
      let changed = false
      list.forEach((item) => {
        if (item.id === tileId && !Array.isArray(item.children)) {
          changed = true
          return
        }
        if (item.id === tileId && Array.isArray(item.children)) {
          changed = true
          if (openFolder?.id === item.id) {
            removedOpenFolder = true
          }
          return
        }
        if (Array.isArray(item.children) && item.children.length > 0) {
          const { children: nextChildren, removed } = removeChildFromFolder(item.children, tileId)
          if (!removed) {
            nextList.push(item)
            return
          }
          changed = true
          if (nextChildren.length === 0) {
            if (openFolder?.id === item.id) {
              removedOpenFolder = true
            }
            return
          }
          const nextFolder = { ...item, children: nextChildren }
          if (openFolder?.id === item.id) {
            updatedFolder = nextFolder
          }
          nextList.push(nextFolder)
          return
        }
        nextList.push(item)
      })
      if (!changed) return list
      return nextList
    })
    if (removedOpenFolder && (!updatedFolder || updatedFolder.children.length === 0)) {
      setOpenFolder(null)
      setFolderPage(0)
    } else if (updatedFolder && openFolder?.id === updatedFolder.id) {
      syncOpenFolderState(updatedFolder)
    }
  }
  const renameTile = (wsId, tileId) => {
    const list = tilesOf(wsId)
    const t = list.find(x => x.id === tileId)
    const name = prompt('Rename shortcut', t?.title || '')
    if (name != null) {
      upsertTiles(wsId, (l) => l.map(x => x.id === tileId ? { ...x, title: name || 'Shortcut' } : x))
    }
  }
  const renameFolder = (wsId, tile) => {
    const name = prompt('Rename folder', tile?.title || 'Folder')
    if (name != null) {
      upsertTiles(wsId, (list) => list.map(t => t.id === tile.id ? { ...t, title: name || 'Folder' } : t))
    }
  }

  return (
    <div
      ref={containerRef}
      className="w-full relative"
      style={{ overflow: 'visible' }}
    >
      {(() => {
        const ws = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0]
        if (!ws) return null
        const selectedWorkspaceId = effectiveHardWorkspaceId || activeWorkspaceId
        const previewWorkspace = (hoverPreviewEnabled && hoveredWorkspaceId && hoveredWorkspaceId !== selectedWorkspaceId)
          ? workspaces.find(w => w.id === hoveredWorkspaceId)
          : null
        const displayWorkspace = previewWorkspace || ws
        const wsTiles = tilesOf(ws.id)
        const pageCounts = wsTiles.reduce((acc, tile) => {
          const page = clampPage(tile.page ?? 0)
          acc.set(page, (acc.get(page) || 0) + 1)
          return acc
        }, new Map())
        const pageKeys = Array.from(pageCounts.keys())
        const highestPage = pageKeys.length > 0 ? Math.max(...pageKeys) : 0
        const totalPages = Math.max(1, highestPage + 1)
        const rawActivePage = getActivePageForWorkspace(ws.id)
        const activePage = Math.min(rawActivePage, totalPages - 1)
        const tilesOnPage = wsTiles.filter(t => clampPage(t.page ?? 0) === activePage)
        const tilesToRender = openFolder ? (openFolder.children || []) : tilesOnPage
        const headerFollowsUrlSlug = !!(settings?.speedDial?.headerFollowsUrlSlug)
        const urlSlugEnabled = !!(settings?.general?.autoUrlDoubleClick)
        // Choose which workspace provides the header text
        // Priority: hover preview workspace > URL slug selection > displayWorkspace
        let headerNameWorkspace = displayWorkspace
        if (previewWorkspace) {
          headerNameWorkspace = previewWorkspace
        } else if (headerFollowsUrlSlug && urlSlugEnabled) {
          const slugWsId = effectiveHardWorkspaceId || null
          if (slugWsId) {
            const slugWs = workspaces.find(w => w.id === slugWsId) || null
            if (slugWs) headerNameWorkspace = slugWs
          }
        }
        const baseName = headerNameWorkspace?.name || 'Workspace'
        const folderSuffix = (!previewWorkspace && openFolder) ? ` — ${openFolder.title || 'Folder'}` : ''
        const headerPrimaryText = `${baseName}${folderSuffix}`
        // Do not show "— Preview" while hover previewing; keep Edit indicator only
        const statusLabel = previewWorkspace ? '' : (editMode ? 'Edit' : '')
        const headerBannerText = statusLabel ? `${headerPrimaryText} — ${statusLabel}` : headerPrimaryText
        const alignmentClass = headerAlign === 'left' ? 'justify-start' : headerAlign === 'right' ? 'justify-end' : 'justify-center'
        const headerTextAlignClass = headerAlign === 'left' ? 'text-left' : headerAlign === 'right' ? 'text-right' : 'text-center'
        const workspaceTextColors = settings?.speedDial?.workspaceTextColors || {}
        // Resolve which workspace's text color/font to use
        // Priority: if preview is active, use preview workspace.
        // Otherwise, if URL-aware is enabled, use slug/hardWorkspace selection.
        let stylingWorkspaceId = (() => {
          if (previewWorkspace && !colorlessPreview) return previewWorkspace.id
          if (settings?.speedDial?.workspaceTextByUrl) {
            if (effectiveHardWorkspaceId) return effectiveHardWorkspaceId
            return pathMatchesActive ? activeWorkspaceId : null
          }
          return activeWorkspaceId
        })()
        if (!stylingWorkspaceId) {
          const lastInConfig = settings?.theme?.lastIn || {}
          const lastInEnabled = typeof lastInConfig.enabled === 'boolean' ? lastInConfig.enabled : true
          const lastInIncludeGlow = typeof lastInConfig.includeGlow === 'boolean' ? lastInConfig.includeGlow : true
          const lastInIncludeTypography = typeof lastInConfig.includeTypography === 'boolean' ? lastInConfig.includeTypography : true
          const normalizedPath = (() => {
            try {
              const raw = (window.location?.pathname || '').replace(/\/+$/, '')
              return raw === '' ? '/' : raw
            } catch {
              return '/'
            }
          })()
          const isDefaultPath = normalizedPath === '/' || normalizedPath === '/index.html'
          const canApplyLastIn = lastInEnabled && isDefaultPath && !hardWorkspaceId && !isLastInFallbackActive && !!activeWorkspaceId && (!anchoredWorkspaceId || anchoredWorkspaceId !== activeWorkspaceId) && (lastInIncludeGlow || lastInIncludeTypography)
          if (canApplyLastIn) {
            stylingWorkspaceId = activeWorkspaceId
          }
        }
        const isStylingAnchored = anchoredWorkspaceId && stylingWorkspaceId === anchoredWorkspaceId
        const canUseWorkspaceColor = matchWorkspaceTextColor && !isStylingAnchored && stylingWorkspaceId
        const resolveColor = canUseWorkspaceColor
          ? stripAlphaFromHex(workspaceTextColors[stylingWorkspaceId] || defaultTextColor)
          : defaultTextColor

        // Header color mode + tokens
        const headerModeMap = settings?.speedDial?.workspaceHeaderColorMode || {};
        const headerModeKey = stylingWorkspaceId || '__base__';
        const selectedHeaderMode = headerModeMap[headerModeKey] || 'text';
        const currentPathStr = (window.location.pathname || '').replace(/\/+$/, '') || '/';
        const headerResolver = useMemo(() => createThemeTokenResolver(settings, workspaces, currentPathStr), [settings, workspaces, currentPathStr]);
        const headerTokens = useMemo(() => headerResolver.resolveTokens(stylingWorkspaceId || null), [headerResolver, stylingWorkspaceId]);
        const effectiveHeaderColor = headerTokens.headerColor;
        // Use font from headerTokens (which respects workspaceThemingEnabled) when available,
        // otherwise fall back to resolveWorkspaceFont (which also checks workspaceThemingEnabled)
        const resolveFont = (matchWorkspaceFonts && !isStylingAnchored && stylingWorkspaceId)
          ? (headerTokens.fontFamily || resolveWorkspaceFont(stylingWorkspaceId))
          : undefined
        const handleHeaderModeChange = (mode) => {
          const nextMode = String(mode || 'text');
          if (nextMode === selectedHeaderMode) return;
          try {
            window.dispatchEvent(new CustomEvent('app-set-header-color-mode', { detail: { workspaceId: headerModeKey, mode: nextMode } }));
          } catch { }
        };
        // Ensure banner shows during hover preview even if transient not currently active
        const bannerPreviewActive = !!previewWorkspace
        const shouldRenderBanner = headerEffectMode === 'sustained' || (headerEffectMode === 'transient' && (transientActive || bannerPreviewActive))
        const showStaticTitle = headerEffectMode === 'off' || (headerEffectMode === 'transient' && !(transientActive || bannerPreviewActive))
        const accessibleLabel = statusLabel ? `${headerPrimaryText} — ${statusLabel}` : headerPrimaryText
        const visibleTitleText = headerPrimaryText
        const bannerWorkspaceId = previewWorkspace?.id || effectiveHardWorkspaceId || ws.id
        const bannerKey = headerEffectMode === 'sustained'
          ? `sustained-${bannerWorkspaceId}-${bannerDirectionSign}`
          : `transient-${bannerWorkspaceId}-${bannerDirectionSign}-${headerScrollTick}`
        const bannerMask = 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 6%, rgba(0,0,0,1) 20%, rgba(0,0,0,1) 80%, rgba(0,0,0,0.55) 94%, rgba(0,0,0,0) 100%)'
        const wrapEnhancement = !!settings?.speedDial?.headerBannerEnhancedWrap && headerBannerOverscan
        const bannerInnerStyle = {
          // Subtle arc/blur when wrap enhancement is enabled
          ...(wrapEnhancement
            ? {
              filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.25)) blur(0.35px)',
              transform: 'perspective(1200px) rotateX(1.5deg)',
            }
            : {}),
        }
        const baseBannerColor = effectiveHeaderColor || resolveColor || defaultTextColor
        const bannerColor = headerBannerMatchWorkspaceColor
          ? colorWithAlpha(baseBannerColor, 0.48)
          : colorWithAlpha(baseBannerColor, 0.32)
        const bannerFontOverrideEnabled = !!settings?.speedDial?.headerBannerFontOverrideEnabled
        const headerBannerFont = String(settings?.speedDial?.headerBannerFont || '').trim()
        const bannerFontMap = {
          'Bebas Neue': 'Bebas Neue, Inter, system-ui, sans-serif',
          'Exo 2': 'Exo 2, Inter, system-ui, sans-serif',
          'Audiowide': 'Audiowide, Inter, system-ui, sans-serif',
          'Saira': 'Saira, Inter, system-ui, sans-serif',
          'Kanit': 'Kanit, Inter, system-ui, sans-serif',
          'Lexend': 'Lexend, Inter, system-ui, sans-serif',
          'Montserrat': 'Montserrat, Inter, system-ui, sans-serif',
          'Josefin Sans': 'Josefin Sans, Inter, system-ui, sans-serif',
          'Space Grotesk': 'Space Grotesk, Inter, system-ui, sans-serif',
          'Manrope': 'Manrope, Inter, system-ui, sans-serif',
        }
        const bannerFontFamily = bannerFontOverrideEnabled && headerBannerFont
          ? (bannerFontMap[headerBannerFont] || `${headerBannerFont}, Inter, system-ui, sans-serif`)
          : undefined
        // Give overscan a wider spread past the viewport edges and wrap text slightly around the dial
        const overscanOffset = headerBannerOverscan ? (wrapEnhancement ? 2.6 : 2.35) : 0.56
        const bannerTextSize = 'text-[12px] md:text-[13px]'
        const viewportWidthPx = effectiveHeaderWidthPx + (overscanOffset * 2 * 16)
        const baseSegments = headerEffectMode === 'sustained' ? 12 : 8
        const fontSizePx = Math.max(0.94 * 16 * headerBannerScale, 1)
        const approxCharWidth = Math.max(fontSizePx * 0.68, 7)
        const approxLetterSpacing = fontSizePx * 0.35
        const approxSegmentWidth = (Math.max(headerBannerText.length, 1) * (approxCharWidth + approxLetterSpacing)) + 24
        const minGroupWidthPx = Math.max(viewportWidthPx * 1.1, viewportWidthPx + 160)
        const approxSegmentsNeeded = Math.ceil(minGroupWidthPx / Math.max(approxSegmentWidth, 1))
        const bannerSegments = Math.min(96, Math.max(baseSegments, approxSegmentsNeeded))
        const approxGroupWidth = bannerSegments * approxSegmentWidth
        const renderBannerGroup = (groupIndex, withRef = false, hidden = false) => (
          <div
            key={`banner-group-${groupIndex}`}
            ref={withRef ? bannerGroupRef : null}
            className={`flex items-center gap-6 whitespace-nowrap uppercase tracking-[0.4em] ${bannerTextSize} flex-shrink-0 ${bannerFontFamily ? 'speed-dial-banner-override' : ''}`.trim()}
            style={{
              ...bannerInnerStyle,
              fontWeight: headerBannerBold ? 700 : 500,
              fontSize: `calc(0.94rem * ${headerBannerScale})`,
              paddingRight: '1.5rem',
              ...(bannerFontFamily ? { ['--banner-font-family']: bannerFontFamily } : {})
            }}
            aria-hidden={hidden || undefined}
          >
            {Array.from({ length: bannerSegments }).map((_, idx) => (
              <span
                key={`banner-segment-${groupIndex}-${idx}`}
                className="whitespace-nowrap"
              // Removed scaleX transform
              >
                {headerBannerText}
              </span>
            ))}
          </div>
        )
        const measuredGroupWidth = bannerGroupWidth || 0
        const hasMeasuredWidth = measuredGroupWidth > 0
        const activeGroupWidth = hasMeasuredWidth ? measuredGroupWidth : approxGroupWidth
        // Calculate how many copies we need to fill viewport + one full scroll distance
        // This ensures we always have content visible during the entire animation
        const minCopiesNeeded = Math.ceil((viewportWidthPx * 2) / Math.max(activeGroupWidth, 1))
        const bannerCopies = shouldRenderBanner
          ? Math.max(6, minCopiesNeeded + 3)
          : 0
        const scrollDistance = activeGroupWidth
        useLayoutEffect(() => {
          if (!shouldRenderBanner) {
            if (bannerGroupWidth !== 0) setBannerGroupWidth(0)
            return
          }
          const node = bannerGroupRef.current
          if (!node) return
          const update = () => {
            const width = node.getBoundingClientRect().width
            if (!Number.isFinite(width)) return
            setBannerGroupWidth(prev => (Math.abs(prev - width) > 0.5 ? width : prev))
          }
          update()
          if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(update)
            observer.observe(node)
            return () => observer.disconnect()
          }
          return undefined
        }, [
          shouldRenderBanner,
          bannerKey,
          headerBannerText,
          headerBannerScale,
          headerBannerBold,
          bannerSegments,
          overscanOffset,
          bannerGroupWidth,
          approxGroupWidth
        ])
        const transientSpan = activeGroupWidth > 0 ? Math.min(activeGroupWidth, viewportWidthPx * 0.8) : 0
        const sustainedMotion = activeGroupWidth > 0
          ? {
            initial: { x: bannerDirectionSign < 0 ? -activeGroupWidth : 0 },
            animate: { x: bannerDirectionSign < 0 ? 0 : -activeGroupWidth },
            transition: { duration: headerBannerScrollSeconds, ease: 'linear', repeat: Infinity, repeatType: 'loop' }
          }
          : {
            initial: { x: 0 },
            animate: { x: 0 }
          }
        const transientMotion = activeGroupWidth > 0 && transientSpan > 0
          ? {
            initial: { x: bannerDirectionSign < 0 ? -transientSpan : 0 },
            animate: { x: bannerDirectionSign < 0 ? [-transientSpan, 0, -transientSpan] : [0, -transientSpan, 0] },
            transition: { duration: TRANSIENT_BANNER_DURATION_MS / 1000, ease: 'linear', times: [0, 0.85, 1] }
          }
          : {
            initial: { x: 0 },
            animate: { x: 0 }
          }
        const bannerMotionProps = headerEffectMode === 'sustained' ? sustainedMotion : transientMotion
        const dialGlowShadow = effectiveGlow
          ? (transientModeActive
            ? effectiveGlow
            : applySoftSwitchGlow(settings, activeWorkspaceId, effectiveHardWorkspaceId, 'speed-dial'))
          : ''

        return (
          <div
            className={`${(settings?.speedDial?.outline ?? true) ? 'border border-white/20' : 'border-0'} rounded-xl speed-dial-scope ${transientGlow ? 'workspace-switching' : ''}`}
            style={{
              position: 'relative',
              background: (settings?.speedDial?.transparentBg ? 'transparent' : 'rgba(255,255,255,0.10)'),
              backdropFilter: `blur(${openFolder ? 20 : effectiveBlurPx}px)`,
              WebkitBackdropFilter: `blur(${openFolder ? 20 : effectiveBlurPx}px)`,
              boxShadow: [
                (settings?.speedDial?.shadow ? '0 20px 60px rgba(0,0,0,0.35), 0 8px 32px rgba(0,0,0,0.25)' : ''),
                dialGlowShadow,
              ].filter(Boolean).join(', '),
              ...enhancedGlowTransitions,
              ['--speed-dial-font']: (settings?.speedDial?.matchHeaderFont ? (bannerFontFamily || resolveFont) : resolveFont) || undefined,
            }}
            ref={dialWrapperRef}
            onMouseEnter={handleDialMouseEnter}
            onMouseLeave={handleDialMouseLeave}
            onMouseDownCapture={handleDialMouseDownCapture}
            onDoubleClickCapture={(e) => {
              devDebug('[SpeedDial] double-click capture')
              if (shouldIgnoreAddTileDoubleClick(e.target)) return
              const el = gridRef.current
              if (!el) return
              const r = el.getBoundingClientRect()
              const x = e.clientX
              const y = e.clientY
              if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom - DOUBLE_CLICK_TAB_BUFFER) {
                onGridDoubleClick(ws.id, e)
              }
            }}
          >
            {/* dblclick capture will be added on the wrapper below */}
            {/* Title (click to toggle edit mode) */}
            <div className="pt-3 flex justify-center" style={{ height: HEADER_H }}>
              <div className="relative h-full" style={{ width: headerWidthStyleValue, padding: `0 ${PAD}px` }}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div
                      className={`relative z-10 flex items-center w-full h-full ${alignmentClass}`}
                      style={{ transform: `translateY(${HEADER_CONTENT_SHIFT}px)` }}
                    >
                      <button
                        type="button"
                        onClick={toggleEditModeAndReorder}
                        className="flex items-center gap-2 w-full"
                        aria-pressed={editMode}
                        aria-label={accessibleLabel}
                        style={{
                          color: effectiveHeaderColor || resolveColor || defaultTextColor,
                          // Apply Banner font override to static heading as well
                          fontFamily: (bannerFontFamily || resolveFont || undefined),
                          opacity: showStaticTitle ? 1 : 0,
                          transition: 'opacity 0.3s ease',
                          justifyContent:
                            headerAlign === 'left' ? 'flex-start' : headerAlign === 'right' ? 'flex-end' : 'center'
                        }}
                        title={previewWorkspace ? 'Previewing workspace' : (editMode ? 'Click to exit edit & reorder mode' : 'Click to enter edit & reorder mode')}
                      >
                        <span className={showStaticTitle ? `block max-w-full truncate ${headerTextAlignClass}` : 'sr-only'} aria-live="polite">
                          {visibleTitleText}
                        </span>
                        {statusLabel && showStaticTitle && (
                          <span className="text-[11px] uppercase tracking-[0.3em] text-white/50">{statusLabel}</span>
                        )}
                      </button>
                      {shouldRenderBanner && (
                        <div
                          className="absolute inset-0 flex items-center overflow-hidden cursor-pointer select-none"
                          role="button"
                          tabIndex={0}
                          onClick={toggleEditModeAndReorder}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              toggleEditModeAndReorder()
                            }
                          }}
                          title={previewWorkspace ? 'Previewing workspace' : (editMode ? 'Click to exit edit & reorder mode' : 'Click to enter edit & reorder mode')}
                          style={{
                            pointerEvents: 'auto',
                            maskImage: bannerMask,
                            WebkitMaskImage: bannerMask,
                            clipPath: 'polygon(0% 0%, 100% 0%, 96% 100%, 0% 100%)',
                            WebkitClipPath: 'polygon(0% 0%, 100% 0%, 96% 100%, 0% 100%)',
                            left: `${-overscanOffset}rem`,
                            right: `${-overscanOffset}rem`,
                            transform: `translateY(calc(${HEADER_CONTENT_SHIFT}px - 0.025rem + 3px))`
                          }}
                        >
                          <motion.div
                            key={bannerKey}
                            className="flex"
                            style={{
                              color: bannerColor,
                              display: 'flex',
                              flexDirection: 'row',
                              flexWrap: 'nowrap',
                              willChange: 'transform'
                            }}
                            {...bannerMotionProps}
                          >
                            {renderBannerGroup(0, false, false)}
                            {renderBannerGroup(1, false, false)}
                          </motion.div>
                          {headerBannerStatic && (
                            <motion.div
                              className="pointer-events-none absolute inset-0 mix-blend-screen"
                              style={{
                                opacity: 0.16,
                                backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0px, rgba(255,255,255,0.12) 1px, transparent 1px, transparent 3px)'
                              }}
                              animate={{ backgroundPosition: ['0% 0%', '140% 0%'] }}
                              transition={{ duration: 1.4, ease: 'linear', repeat: Infinity }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <HeaderColorContextMenu
                      workspaceId={stylingWorkspaceId || null}
                      workspaceName={stylingWorkspaceId ? (workspaces.find(w => w.id === stylingWorkspaceId)?.name || 'Workspace') : 'Base'}
                      selectedMode={selectedHeaderMode}
                      onModeChange={handleHeaderModeChange}
                    />
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            </div>
            {headerDividerEnabled && (
              <div style={{ width: headerWidthStyleValue, margin: '0 auto', padding: `0 ${PAD}px` }}>
                <div className="h-px w-full bg-white/15" />
              </div>
            )}

            {/* Grid area */}
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  ref={gridRef}
                  className="relative"
                  style={{
                    padding: PAD,
                    // Center fixed grid inside glassy background
                    width: `${GRID_W}px`,
                    height: `${HEADER_H + GRID_H}px`,
                    margin: '0 auto',
                    // Ensure grid does not sit above inside tabs (clickable)
                  }}
                  onDoubleClick={(e) => onGridDoubleClick(ws.id, e)}
                  onContextMenu={(e) => {
                    if (e?.target?.closest?.('[data-role=\"tile\"]')) return
                    const { gx, gy, page } = posFromEvent(ws.id, e)
                    gridContextCellRef.current = {
                      wsId: ws.id,
                      gx,
                      gy,
                      page,
                      folderId: openFolder?.id || null,
                      folderPage,
                    }
                  }}
                >
                  {(openFolder ? (openFolder.children || []) : tilesToRender).map((t, absoluteIdx) => {
                    // Position: experimental sticky grid for root; folder uses child gridX/gridY fallback to index layout excluding reserved back slot
                    let left = 0, top = 0
                    if (openFolder) {
                      const fallbackSlot = (() => {
                        // Compute nth slot within the folder grid area
                        let n = 0
                        for (let gy = 0; gy < FOLDER_ROWS; gy++) {
                          for (let gx = 0; gx < activeCols; gx++) {
                            if (n === absoluteIdx) return { gx, gy }
                            n++
                          }
                        }
                        return { gx: 1, gy: 0 }
                      })()
                      const gx = clampGX(typeof t.gridX === 'number' ? t.gridX : fallbackSlot.gx)
                      const gy = clampGYFolder(typeof t.gridY === 'number' ? t.gridY : fallbackSlot.gy)
                      left = gx * CELL
                      top = gy * CELL
                    } else {
                      const gx = clampGX(typeof t.gridX === 'number' ? t.gridX : 0)
                      const gy = clampGY(typeof t.gridY === 'number' ? t.gridY : 0)
                      left = gx * CELL
                      top = gy * CELL
                    }
                    const isDragging = drag.dragging && drag.tile?.id === t.id
                    let dropLeft = left, dropTop = top
                    if (openFolder) {
                      const gx = clampGX(drag.drop?.gx ?? 0)
                      const gy = clampGYFolder(drag.drop?.gy ?? 0)
                      dropLeft = gx * CELL
                      dropTop = gy * CELL
                    } else {
                      const gx = clampGX(drag.drop.gx ?? 0)
                      const gy = clampGY(drag.drop.gy ?? 0)
                      dropLeft = gx * CELL
                      dropTop = gy * CELL
                    }
                    const isFolder = Array.isArray(t.children)
                    const hasChildren = isFolder && t.children.length > 0
                    const textColorsMap = settings?.speedDial?.workspaceTextColors || {}
                    const previewColor = previewWorkspace ? textColorsMap[previewWorkspace.id] : undefined
                    const hoverLabelColor = (() => {
                      if (settings?.speedDial?.matchHeaderColor && effectiveHeaderColor) {
                        return stripAlphaFromHex(effectiveHeaderColor)
                      }
                      if (previewColor) {
                        return stripAlphaFromHex(previewColor)
                      }
                      if (settings?.speedDial?.workspaceTextByUrl) {
                        if (pathMatchesActive) {
                          const col = textColorsMap[activeWorkspaceId]
                          return col ? stripAlphaFromHex(col) : defaultTextColor
                        }
                        return defaultTextColor
                      }
                      const col = textColorsMap[activeWorkspaceId]
                      return col ? stripAlphaFromHex(col) : defaultTextColor
                    })()
                    const hoverLabelFont = (() => {
                      if (settings?.speedDial?.matchHeaderFont && bannerFontFamily) return bannerFontFamily
                      if (previewWorkspace) return resolveWorkspaceFont(previewWorkspace.id)
                      if (settings?.speedDial?.workspaceTextByUrl) {
                        return pathMatchesActive ? resolveWorkspaceFont(activeWorkspaceId) : undefined
                      }
                      return resolveWorkspaceFont(activeWorkspaceId)
                    })()

                    return (
                      <ContextMenu key={t.id}>
                        <ContextMenuTrigger asChild>
                          <motion.div
                            data-role="tile"
                            className={`absolute cursor-pointer group ${settings?.speedDial?.glowTransient ? 'glow-transient' : ''}`}
                            style={{
                              width: TILE_SIZE,
                              height: TILE_SIZE,
                              left: isDragging ? dropLeft : left,
                              top: isDragging ? dropTop : top,
                              ...glowTransitionStyles,
                              zIndex: isDragging ? 9 : 5
                            }}
                            onMouseDown={(e) => startDrag(ws.id, t, e)}
                            onFocus={() => {
                              if (openFolder) return
                              if (settings?.speedDial?.glowTransient) {
                                const pulseWorkspaceId = effectiveHardWorkspaceId || DEFAULT_GLOW_KEY
                                glowManager.createTransientGlow(pulseWorkspaceId, 200, (glow) => {
                                  setTransientGlow(glow)
                                })
                              }
                            }}
                            tabIndex={0}
                            onClick={() => {
                              if (drag.dragging || drag.justDropped) {
                                if (drag.justDropped) {
                                  setDrag(prev => prev.justDropped ? { ...prev, justDropped: false } : prev)
                                }
                                return
                              }
                              if (openFolder) {
                                // In-folder: clicking opens shortcut
                                if (t.url) {
                                  const nu = normalizeUrl(t.url)
                                  const href = nu ? nu.href : t.url
                                  if (settings?.general?.openInNewTab) window.open(href, '_blank', 'noopener,noreferrer')
                                  else window.location.href = href
                                }
                                return
                              }
                              // Allow folder navigation in edit mode (edit mode persists)
                              if (isFolder) {
                                setOpenFolder(t)
                                setFolderPage(0)
                                setFolderBlur(true)
                                setTimeout(() => setFolderBlur(false), 250)
                              } else if (!editMode && t.url) {
                                const nu = normalizeUrl(t.url)
                                const href = nu ? nu.href : t.url
                                if (settings?.general?.openInNewTab) window.open(href, '_blank', 'noopener,noreferrer')
                                else window.location.href = href
                              }
                            }}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.97 }}
                          >
                            <div className={`w-full h-full rounded-lg overflow-hidden flex items-center justify-center ${isFolder && hasChildren ? 'bg-white/10' : 'bg-transparent'}`}>
                              {isFolder ? (
                                hasChildren ? (
                                  <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-0.5 p-0.5 bg-white/5 rounded">
                                    {t.children.slice(0, 4).map((child, i) => (
                                      <img key={i} src={child.favicon || (child.url ? (faviconCache[getFaviconKey(child.url)] || '') : '')} alt={child.title}
                                        className="w-full h-full object-cover rounded" onError={(e) => { e.currentTarget.src = child.url ? generateFallbackIcon(child.url) : '' }}
                                        style={{ filter: settings?.iconTheming?.enabled ? 'url(#icon-theme-filter)' : 'none' }}
                                      />
                                    ))}
                                  </div>
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-white/10 rounded">
                                    <Folder className="w-5 h-5 text-white/65" />
                                  </div>
                                )
                              ) : (
                                (t.favicon || (t.url ? faviconCache[getFaviconKey(t.url)] : '')) ? (
                                  <img src={t.favicon || faviconCache[getFaviconKey(t.url)]} alt={t.title} className="w-full h-full object-contain" onError={(e) => { if (t.url) e.currentTarget.src = generateFallbackIcon(t.url) }}
                                    style={{ filter: settings?.iconTheming?.enabled ? 'url(#icon-theme-filter)' : 'none' }}
                                  />
                                ) : (
                                  <span className="text-white/80 text-xs font-semibold" style={{ color: settings?.speedDial?.matchHeaderColor && effectiveHeaderColor ? stripAlphaFromHex(effectiveHeaderColor) : undefined }}>
                                    {(t.title || '?').slice(0, 2)}
                                  </span>
                                )
                              )}
                            </div>
                            {/* Hover label: bold, no background, appears on hover */}
                            <div
                              className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 text-[10px] font-semibold opacity-0 group-hover:opacity-100"
                              style={{
                                color: hoverLabelColor,
                                fontFamily: hoverLabelFont || undefined,
                              }}
                            >
                              {isFolder ? (t.title || 'Folder') : (t.title || '')}
                            </div>
                          </motion.div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => {
                            if (editMode) return
                            if (isFolder) {
                              setOpenFolder(t)
                              setFolderPage(0)
                              setFolderBlur(true)
                              setTimeout(() => setFolderBlur(false), 250)
                              return
                            }
                            const targetUrl = t.url
                            const nu = normalizeUrl(targetUrl)
                            const href = nu ? nu.href : targetUrl
                            const target = settings?.general?.openInNewTab ? '_blank' : '_self'
                            window.open(href, target)
                          }}>
                            <LinkIcon className="w-4 h-4" /> Open
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => setEditModeAndReorder(!editMode)}>
                            <Edit3 className="w-4 h-4" /> {editMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                          </ContextMenuItem>
                          {/* Move back to root when inside an open folder */}
                          {openFolder && !Array.isArray(t.children) && (
                            <ContextMenuItem onClick={() => {
                              const wsId = ws.id
                              const child = t
                              upsertTiles(wsId, (list) => {
                                const idx = list.findIndex(it => it.id === openFolder.id)
                                if (idx === -1) return list
                                const folder = list[idx]
                                const remaining = (folder.children || []).filter(c => c.id !== child.id)
                                const before = list.slice(0, idx)
                                const after = list.slice(idx + 1)
                                const folderPage = clampPage(openFolder.page ?? getActivePageForWorkspace(wsId))
                                const spot1 = nearestFree(wsId, 0, 0, { page: folderPage })
                                if (spot1.createdNewPage) {
                                  setActivePageForWorkspace(wsId, spot1.page)
                                }
                                const movedOut = { ...child, gridX: spot1.gx, gridY: spot1.gy, page: spot1.page }
                                if (remaining.length === 0) {
                                  return [...before, movedOut, ...after]
                                }
                                if (remaining.length === 1) {
                                  const last = remaining[0]
                                  let spot2 = nearestFree(wsId, spot1.gx + 1, spot1.gy, { page: folderPage })
                                  if (spot2.gx === spot1.gx && spot2.gy === spot1.gy) {
                                    spot2 = nearestFree(wsId, spot1.gx + 2, spot1.gy, { page: folderPage })
                                  }
                                  if (spot2.createdNewPage) {
                                    setActivePageForWorkspace(wsId, spot2.page)
                                  }
                                  const movedLast = { ...last, gridX: spot2.gx, gridY: spot2.gy, page: spot2.page }
                                  return [...before, movedOut, movedLast, ...after]
                                }
                                return [...before, { ...folder, children: remaining }, movedOut, ...after]
                              })
                              setOpenFolder(null)
                            }}>
                              Move back
                            </ContextMenuItem>
                          )}
                          {isFolder ? (
                            <ContextMenuItem onClick={() => renameFolder(ws.id, t)}>Rename Folder</ContextMenuItem>
                          ) : (
                            <ContextMenuItem onClick={() => renameTile(ws.id, t.id)}>
                              <Edit3 className="w-4 h-4" /> Rename
                            </ContextMenuItem>
                          )}
                          {!Array.isArray(t.children) && (
                            <>
                              <ContextMenuItem onClick={() => {
                                setEditIconTarget({ wsId: ws.id, tileId: t.id, folderId: openFolder?.id || null })
                                // try to hint file dialog toward uploads/icons within project
                                try {
                                  if (fileInputRef.current) {
                                    const hint = '/uploads/icons'
                                    fileInputRef.current.setAttribute('data-directory-hint', hint)
                                  }
                                } catch { }
                                editIconRef.current?.click()
                              }}>
                                <Upload className="w-4 h-4" /> Change Icon
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => duplicateTile(ws.id, t)}>
                                <Copy className="w-4 h-4" /> Duplicate Shortcut
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => updateTileIcon(ws.id, t.id, { folderId: openFolder?.id || null, favicon: null })}>
                                <Image className="w-4 h-4" /> Reset Icon
                              </ContextMenuItem>
                            </>
                          )}
                          {/* Move across workspaces and pages (root-level only) */}
                          {!openFolder && (
                            <ContextMenuSub>
                              <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
                              <ContextMenuSubContent>
                                {workspaces.map(dest => {
                                  const wsTiles = tilesOf(dest.id)
                                  const usedPages = Array.from(new Set(wsTiles.map(x => clampPage(x.page ?? 0)))).sort((a, b) => a - b)
                                  const totalPages = Math.max(1, (usedPages.length > 0 ? (Math.max(...usedPages) + 1) : 1))
                                  const pages = Array.from({ length: totalPages })
                                  return (
                                    <ContextMenuSub key={`mv-${dest.id}`}>
                                      <ContextMenuSubTrigger>{dest.name}</ContextMenuSubTrigger>
                                      <ContextMenuSubContent>
                                        {pages.map((_, idx) => (
                                          <ContextMenuItem key={`mv-${dest.id}-p-${idx}`} onClick={() => moveTileToWorkspaceAndPage(ws.id, dest.id, t, idx)}>
                                            Page {idx + 1}
                                          </ContextMenuItem>
                                        ))}
                                        <ContextMenuSeparator />
                                        <ContextMenuItem onClick={() => {
                                          const newPage = totalPages
                                          moveTileToWorkspaceAndPage(ws.id, dest.id, t, newPage)
                                          setActivePageForWorkspace(dest.id, newPage)
                                        }}>
                                          New Page
                                        </ContextMenuItem>
                                      </ContextMenuSubContent>
                                    </ContextMenuSub>
                                  )
                                })}
                              </ContextMenuSubContent>
                            </ContextMenuSub>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            variant="destructive"
                            onClick={() => {
                              if (isFolder) {
                                setFolderDeleteDialog({
                                  open: true,
                                  wsId: ws.id,
                                  folderId: t.id,
                                  folderTitle: t.title || 'Folder',
                                  deleteChildren: false
                                })
                              } else {
                                removeTile(ws.id, t.id)
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" /> Delete {isFolder ? 'Folder…' : 'Shortcut'}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    )
                  })}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {!openFolder && (
                  <ContextMenuItem
                    onSelect={() => {
                      const cell = gridContextCellRef.current
                      const target = (cell && cell.wsId === ws.id)
                        ? cell
                        : {
                          wsId: ws.id,
                          gx: 0,
                          gy: 0,
                          page: getActivePageForWorkspace(ws.id),
                        }
                      createFolderAtCell(target)
                      gridContextCellRef.current = null
                    }}
                  >
                    <FolderPlus className="w-4 h-4" /> Create folder
                  </ContextMenuItem>
                )}
                {openFolder && (
                  <ContextMenuItem
                    onSelect={() => {
                      setFolderDeleteDialog({ open: true, wsId: ws.id, folderId: openFolder.id, folderTitle: openFolder.title || 'Folder', deleteChildren: false })
                    }}
                  >
                    <Trash2 className="w-4 h-4" /> Delete folder…
                  </ContextMenuItem>
                )}
                <ContextMenuItem
                  onSelect={() => {
                    devDebug('[SpeedDial] Context menu: Add Shortcut selected')
                    const cell = gridContextCellRef.current
                    const target = (cell && cell.wsId === ws.id)
                      ? cell
                      : openFolder?.id
                        ? {
                          wsId: ws.id,
                          gx: 0,
                          gy: 0,
                          page: getActivePageForWorkspace(ws.id),
                          folderId: openFolder.id,
                          folderPage,
                        }
                        : {
                          wsId: ws.id,
                          gx: 0,
                          gy: 0,
                          page: getActivePageForWorkspace(ws.id),
                        }
                    setTimeout(() => startAddTile(target), 0)
                    gridContextCellRef.current = null
                  }}
                  onClick={() => {
                    devDebug('[SpeedDial] Context menu: Add Shortcut clicked')
                    const cell = gridContextCellRef.current
                    const target = (cell && cell.wsId === ws.id)
                      ? cell
                      : openFolder?.id
                        ? {
                          wsId: ws.id,
                          gx: 0,
                          gy: 0,
                          page: getActivePageForWorkspace(ws.id),
                          folderId: openFolder.id,
                          folderPage,
                        }
                        : {
                          wsId: ws.id,
                          gx: 0,
                          gy: 0,
                          page: getActivePageForWorkspace(ws.id),
                        }
                    setTimeout(() => startAddTile(target), 0)
                    gridContextCellRef.current = null
                  }}
                >
                  <Plus className="w-4 h-4" /> Add Shortcut
                </ContextMenuItem>
                <ContextMenuItem onClick={() => setEditModeAndReorder(!editMode)}>
                  <Edit3 className="w-4 h-4" /> {editMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            {/* Optional internal tabs bar when rectangular + inside placement (hidden in Classic mode) */}
            {(settings?.speedDial?.tabsMode !== 'classic' && settings?.speedDial?.tabsShape === 'rect' && settings?.speedDial?.tabsPlacement === 'inside') && (
              <div
                className={`absolute ${swapTabsWithPageSwitcher ? 'left-3' : 'right-3'} flex items-end gap-2`}
                style={{ zIndex: 5, bottom: 5, pointerEvents: openFolder ? 'none' : 'auto', filter: openFolder ? 'blur(3px) saturate(0.8)' : 'none', opacity: openFolder ? 0.7 : 1 }}
                ref={tabsContainerRef}
                data-role="workspace-tabs"
              >
                {workspaces.map((w, idx) => {
                  const Icon = iconByName(w.icon)
                  const isActive = w.id === activeWorkspaceId
                  const isOver = tabsDrag.dragging && tabsDrag.overIndex === idx
                  const shapeCls = settings?.speedDial?.tabsShape === 'rect' ? 'rounded-md' : 'rounded-b-lg'
                  const wsBtn = settings?.speedDial?.wsButtons || { background: true, shadow: true, blur: true, matchDialBlur: false }
                  const softSwitchGlow = applySoftSwitchGlow(settings, activeWorkspaceId, effectiveHardWorkspaceId, 'tab', w.id)
                  const tabPulse = tabTransientGlows[w.id] || ''
                  const isAnchored = anchoredWorkspaceId === w.id
                  const doubleClickGlowStyle = dcFlashColor ? `0 0 0 2px ${dcFlashColor}, 0 0 18px ${colorWithAlpha(dcFlashColor, 0.6)}` : ''
                  const blurEnabled = !!(wsBtn.blur ?? true)
                  const matchDialBlur = !!wsBtn.matchDialBlur
                  const dialBlurPx = effectiveBlurPx
                  const activeTabBlur = blurEnabled && isActive ? `blur(${matchDialBlur ? dialBlurPx : 12}px)` : undefined
                  const tabBoxShadowParts = [
                    (isActive && wsBtn.shadow ? '0 0 14px rgba(0,0,0,0.25), 0 -2px 8px rgba(0,0,0,0.15)' : ''),
                    softSwitchGlow,
                    tabPulse,
                    doubleClickGlowStyle,
                  ].filter(Boolean).join(', ')
                  return (
                    <ContextMenu key={w.id}>
                      <ContextMenuTrigger asChild>
                        <button
                          onMouseDown={(e) => onTabMouseDown(e, w.id)}
                          onMouseEnter={() => { setHoveredTabId(w.id); onWorkspaceHoverChange?.(w.id) }}
                          onMouseLeave={() => { setHoveredTabId(null); onWorkspaceHoverChange?.(null) }}
                          onFocus={() => triggerTabFocusPulse(w.id)}
                          onClick={() => {
                            // Handle soft switch glow behavior
                            const doubleClickEnabled = settings?.general?.autoUrlDoubleClick
                            const glowByUrl = settings?.speedDial?.glowByUrl
                            const softSwitchBehavior = settings?.speedDial?.softSwitchGlowBehavior || 'noGlow'

                            if (doubleClickEnabled && glowByUrl) {
                              // In soft switch mode, apply glow behavior
                              if (softSwitchBehavior === 'noGlow') {
                                // Disable glow during soft switches
                                // The glow system will handle this automatically
                              } else if (softSwitchBehavior === 'pinnedGlow') {
                                // Keep glow pinned to active workspace button
                                // The glow system will maintain current glow
                              } else if (softSwitchBehavior === 'glowFollows') {
                                // Move workspace tab glow to follow active workspace
                                // Speed Dial glow stays pinned to hard workspace
                              }
                            }

                            onWorkspaceSelect?.(w.id)
                          }}
                          onDoubleClick={(e) => {
                            e?.preventDefault?.()
                            const glowColor = getDoubleClickGlowColor(w.id)
                            if (dcFlashTimerRef.current) {
                              clearTimeout(dcFlashTimerRef.current)
                            }
                            setDcFlashColor(glowColor)
                            setDcFlash(true)
                            dcFlashTimerRef.current = setTimeout(() => {
                              setDcFlash(false)
                              setDcFlashColor(null)
                              dcFlashTimerRef.current = null
                            }, 600)
                            onWorkspaceDoubleSelect?.(w.id)
                          }}
                          className={`relative flex items-center justify-center ${shapeCls} ${isActive ? '-mt-px' : ''
                            } ${isActive
                              ? `${wsBtn.background ? 'bg-white/10' : 'bg-transparent'}`
                              : `${wsBtn.background ? 'bg-white/10 hover:bg-white/15' : 'bg-transparent'}`
                            } ${isOver ? 'ring-2 ring-cyan-400/60' : ''} text-white/80`}
                          style={{
                            width: TAB_W,
                            height: TAB_H,
                            ...glowTransitionStyles,
                            backdropFilter: activeTabBlur,
                            WebkitBackdropFilter: activeTabBlur,
                            filter: isActive ? 'brightness(1.1)' : undefined,
                            fontFamily: (settings?.speedDial?.matchHeaderFont && (bannerFontFamily || resolveFont)) ? (bannerFontFamily || resolveFont) : undefined,
                            // Enhanced shadow and glow
                            boxShadow: tabBoxShadowParts,
                            backgroundColor: (settings?.speedDial?.tabHoverShade && hoveredTabId === w.id)
                              ? hexToRgba((!workspaceThemingEnabled || anchoredWorkspaceId === w.id)
                                  ? fallbackGlowColor
                                  : (workspaceGlowColors[w.id] || fallbackGlowColor), 0.18)
                              : undefined,
                            zIndex: isActive ? 10 : 1
                          }}
                          title={isAnchored ? `${w.name} (Anchored)` : w.name}
                        >
                          {(() => {
                            const headerCol = (settings?.speedDial?.matchHeaderColor && effectiveHeaderColor) ? stripAlphaFromHex(effectiveHeaderColor) : null
                            const iconStyle = headerCol
                              ? { color: isActive ? headerCol : colorWithAlpha(headerCol, 0.7) }
                              : undefined
                            return (
                              <Icon
                                className={`w-4 h-4 transition-all duration-200 ${isActive ? 'drop-shadow-sm' : ''}`}
                                style={iconStyle}
                              />
                            )
                          })()}
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => setEditModeAndReorder(!(editMode || tabsReorderEnabled))}>
                          <Edit3 className="w-4 h-4" /> {(editMode || tabsReorderEnabled) ? 'Disable Edit Mode' : 'Enable Edit Mode'}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onWorkspaceRename?.(w.id)}><Edit3 className="w-4 h-4" /> Rename</ContextMenuItem>
                        <ContextMenuSub>
                          <ContextMenuSubTrigger>Change Icon</ContextMenuSubTrigger>
                          <ContextMenuSubContent>
                            {['Home', 'Layers', 'Grid2X2', 'AppWindow', 'LayoutList'].map(name => {
                              const Ico = iconByName(name)
                              return (
                                <ContextMenuItem key={name} onClick={() => onWorkspaceChangeIcon?.(w.id, name)}>
                                  <Ico className="w-4 h-4" /> {name}
                                </ContextMenuItem>
                              )
                            })}
                          </ContextMenuSubContent>
                        </ContextMenuSub>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={onWorkspaceAdd}><Plus className="w-4 h-4" /> New Workspace</ContextMenuItem>
                        <ContextMenuItem onClick={() => onWorkspaceRemove?.(w.id)} variant="destructive"><Trash2 className="w-4 h-4" /> Delete</ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
              </div>
            )}
            {settings?.speedDial?.tabsShape === 'rect' && settings?.speedDial?.tabsPlacement === 'inside' && settings?.speedDial?.tabsDivider && (
              <div
                className="absolute left-3 right-3"
                style={{ bottom: (TAB_H + 6), height: 2, background: 'rgba(255,255,255,0.2)' }}
              />
            )}

            {!openFolder && totalPages > 1 && (
              <div
                className="absolute flex items-center gap-2"
                style={{
                  bottom: PAD,
                  zIndex: 7,
                  ...(swapTabsWithPageSwitcher
                    ? { right: PAD, left: 'auto' }
                    : { left: PAD, right: 'auto' })
                }}
              >
                <button
                  onClick={() => setActivePageForWorkspace(ws.id, Math.max(0, activePage - 1))}
                  className="p-1.5 rounded-full flex items-center justify-center text-white/70 hover:text-white transition disabled:opacity-35 disabled:hover:text-white/70"
                  disabled={activePage === 0}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4 text-white/80" />
                </button>
                <span className="text-white/70 text-[11px] font-medium">
                  {activePage + 1}/{totalPages}
                </span>
                <button
                  onClick={() => setActivePageForWorkspace(ws.id, Math.min(totalPages - 1, activePage + 1))}
                  className="p-1.5 rounded-full flex items-center justify-center text-white/70 hover:text-white transition disabled:opacity-35 disabled:hover:text-white/70"
                  disabled={activePage >= totalPages - 1}
                  aria-label="Next page"
                >
                  <ChevronLeft className="w-4 h-4 text-white/80 rotate-180" />
                </button>
              </div>
            )}

            {/* Internal blur under folder when open (and brief pulse on open) */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                opacity: (openFolder || folderBlur) ? 1 : 0,
                transition: 'opacity 250ms ease',
                backdropFilter: (openFolder || folderBlur) ? 'blur(20px) brightness(0.95)' : 'none',
                WebkitBackdropFilter: (openFolder || folderBlur) ? 'blur(20px) brightness(0.95)' : 'none',
                backgroundColor: (openFolder || folderBlur) ? 'rgba(0,0,0,0.001)' : 'transparent',
                zIndex: 2,
              }}
            />
            {/* Back button tile inside grid (bottom-left, fixed) */}
            {openFolder && (
              <button
                ref={backButtonRef}
                className="absolute rounded-lg text-white/90 flex items-center justify-center cursor-pointer transition-all duration-150 hover:scale-110 active:scale-95"
                style={{ width: TILE_SIZE, height: TILE_SIZE, left: 6, top: (activeRows - 1) * CELL + 6, zIndex: 7, pointerEvents: 'auto', background: 'transparent', border: 'none' }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setOpenFolder(null) }}
                onDoubleClick={(e) => { e.stopPropagation(); setOpenFolder(null) }}
                title="Back"
                aria-label="Back"
              >
                <ChevronLeft className="w-7 h-7 text-white/90" />
              </button>
            )}

            {/* Folder pagination controls (only when folder open and overflow) */}
            {openFolder && ((openFolder.children?.length || 0) > FOLDER_CAPACITY) && (
              <>
                {/* Page dots */}
                <div className="absolute left-0 right-0 flex justify-center gap-1" style={{ bottom: 38, zIndex: 7 }}>
                  {Array.from({ length: Math.ceil((openFolder.children?.length || 0) / FOLDER_CAPACITY) }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setFolderPage(i)}
                      className={`w-2 h-2 rounded-full ${folderPage === i ? 'bg-white/90' : 'bg-white/40'}`}
                      aria-label={`Go to page ${i + 1}`}
                    />
                  ))}
                </div>
                {/* Left/Right chevrons */}
                <button
                  onClick={() => setFolderPage(p => Math.max(0, p - 1))}
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full w-7 h-7 flex items-center justify-center"
                  style={{ zIndex: 7 }}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4 text-white/80" />
                </button>
                <button
                  onClick={() => setFolderPage(p => Math.min(Math.ceil((openFolder.children?.length || 0) / FOLDER_CAPACITY) - 1, p + 1))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full w-7 h-7 flex items-center justify-center"
                  style={{ zIndex: 7 }}
                  aria-label="Next page"
                >
                  <ChevronLeft className="w-4 h-4 text-white/80 rotate-180" />
                </button>
              </>
            )}
          </div>
        )
      })()}

      {/* External tabs row directly below the dial, touching the outline (hidden in Classic mode) */}
      {(settings?.speedDial?.tabsMode !== 'classic' && !(settings?.speedDial?.tabsShape === 'rect' && settings?.speedDial?.tabsPlacement === 'inside')) && (
        <div
          ref={tabsContainerRef}
          data-tight-lite={cyberTabsEnabled ? 'true' : undefined}
          data-role="workspace-tabs"
          className={`w-full ${cyberTabsEnabled ? 'tight-tabs-lite-container' : ''}`}
          style={{
            width: `${GRID_W}px`,
            margin: '0 auto',
            display: 'flex',
            justifyContent: swapTabsWithPageSwitcher ? 'flex-start' : 'flex-end',
            gap: `${TAB_GAP}px`,
            pointerEvents: openFolder ? 'none' : 'auto',
            filter: openFolder ? 'blur(3px) saturate(0.8)' : 'none',
            opacity: openFolder ? 0.7 : 1,
          }}
        >
          {workspaces.map((w, idx) => {
            const Icon = iconByName(w.icon)
            const isActive = w.id === activeWorkspaceId
            const isOver = tabsDrag.dragging && tabsDrag.overIndex === idx
            const shapeCls = settings?.speedDial?.tabsShape === 'rect' ? 'rounded-md' : 'rounded-b-lg'
            const wsBtn = settings?.speedDial?.wsButtons || { background: true, shadow: true, blur: true, matchDialBlur: false }
            const softSwitchGlow = applySoftSwitchGlow(settings, activeWorkspaceId, effectiveHardWorkspaceId, 'tab', w.id)
            const tabPulse = tabTransientGlows[w.id] || ''
            const isAnchored = anchoredWorkspaceId === w.id
            // When workspace theming is disabled, use master glow color instead of workspace-specific colors
            const accentBase = (!workspaceThemingEnabled || anchoredWorkspaceId === w.id)
              ? fallbackGlowColor
              : (workspaceGlowColors[w.id] || fallbackGlowColor)
            const backgroundEnabled = !!(wsBtn.background ?? true)
            const shadowEnabled = !!(wsBtn.shadow ?? true)
            const blurEnabled = !!(wsBtn.blur ?? true)
            const matchDialBlur = !!wsBtn.matchDialBlur
            const dialBlurPx = effectiveBlurPx
            const hoverStyleRaw = settings?.speedDial?.tabHoverStyle || (settings?.speedDial?.tabHoverShade ? 'shade-color' : 'none')
            const hoverStyle = hoverStyleRaw
            const isHovered = hoveredTabId === w.id
            const cyberTabDynamicVars = cyberTabsEnabled
              ? {
                '--cyber-tab-accent': colorWithAlpha(accentBase, 0.35),
                '--cyber-tab-accent-strong': colorWithAlpha(accentBase, 0.55),
                '--cyber-tab-outline': colorWithAlpha(accentBase, 0.24),
              }
              : {}
            const tabBackgroundClass = tightTabzEnabled
              ? 'bg-transparent'
              : cyberTabsEnabled
                ? ''
                : backgroundEnabled
                  ? (isActive ? 'bg-white/10' : 'bg-white/10 hover:bg-white/15')
                  : 'bg-transparent'
            const baseTabClasses = [
              'relative flex items-center justify-center transition-all duration-200 text-white/80',
              shapeCls,
              tabBackgroundClass,
              isOver ? 'ring-2 ring-cyan-400/60' : '',
              cyberTabsEnabled ? 'tight-tab-lite' : '',
              cyberTabsEnabled ? (isActive ? 'tight-tab-lite--active' : 'tight-tab-lite--inactive') : '',
              tightTabsEnabled ? 'tight-tab-basic' : '',
              tightTabsEnabled ? (isActive ? 'tight-tab-basic--active' : 'tight-tab-basic--inactive') : '',
              tightTabzEnabled ? 'tight-tabz' : '',
              tightTabzEnabled ? (isActive ? 'tight-tabz--active' : 'tight-tabz--inactive') : '',
            ].filter(Boolean).join(' ')
            let surfaceBackground = undefined
            if (cyberTabsEnabled && backgroundEnabled) {
              surfaceBackground = isActive ? dialSurfaceColor : 'rgba(255,255,255,0.08)'
            } else if (tightTabsEnabled && backgroundEnabled) {
              surfaceBackground = 'transparent'
            } else if (tightTabzEnabled && backgroundEnabled) {
              surfaceBackground = 'transparent'
            }
            const hoverTint = colorWithAlpha(accentBase, 0.18)
            const neutralTint = 'rgba(255,255,255,0.08)'
            if (isHovered && hoverStyle !== 'none') {
              if (hoverStyle === 'shade') {
                surfaceBackground = neutralTint
              } else if (hoverStyle === 'shade-color') {
                surfaceBackground = hoverTint
              } else if (hoverStyle === 'blur') {
                surfaceBackground = neutralTint
              } else if (hoverStyle === 'blur-color') {
                surfaceBackground = hoverTint
              }
            }
            const activeTabBlurPx = matchDialBlur ? dialBlurPx : 8
            const tabBlur = (blurEnabled && isActive) ? `blur(${activeTabBlurPx}px)` : undefined
            const hoverBlur = (hoverStyle === 'blur' || hoverStyle === 'blur-color') && isHovered ? 'blur(10px)' : undefined
            const tabBoxShadowParts = []
            if (shadowEnabled) {
              if (cyberTabsEnabled) {
                tabBoxShadowParts.push(isActive
                  ? '0 18px 38px rgba(8,10,18,0.55), 0 8px 20px rgba(0,0,0,0.35)'
                  : '0 6px 16px rgba(8,10,18,0.32)')
              } else if (tightTabsEnabled) {
                // Downward-only shadows to avoid top glow seams
                tabBoxShadowParts.push(isActive
                  ? '0 12px 22px rgba(8,10,18,0.32), 0 8px 16px rgba(0,0,0,0.26)'
                  : '0 8px 14px rgba(8,10,18,0.22)')
              } else if (tightTabzEnabled) {
                tabBoxShadowParts.push(isActive
                  ? '0 18px 32px rgba(8,10,18,0.4), 0 12px 24px rgba(0,0,0,0.3)'
                  : '0 10px 20px rgba(8,10,18,0.28)')
              } else if (isActive) {
                tabBoxShadowParts.push('0 1px 18px rgba(0,0,0,0.26), 0 4px 12px rgba(0,0,0,0.2)')
              }
            }
            const translateGlowDown = (glow) => {
              const shouldTranslate = tightTabsEnabled || tabsModeIsTabs
              if (!glow || !shouldTranslate) return glow
              const offsetPx = tightTabsEnabled ? 5 : 2.5
              return glow.split(',').map(part => part.trim()).map(part => {
                const pieces = part.split(/\s+/)
                if (pieces.length >= 3) {
                  pieces[0] = '0'
                  pieces[1] = `${offsetPx}px`
                }
                return pieces.join(' ')
              }).join(', ')
            }
            const adjustedSoftGlow = translateGlowDown(softSwitchGlow)
            const adjustedPulseGlow = translateGlowDown(tabPulse)
            if (adjustedSoftGlow) tabBoxShadowParts.push(adjustedSoftGlow)
            if (adjustedPulseGlow) tabBoxShadowParts.push(adjustedPulseGlow)
            if (dcFlash) {
              const flashColor = dcFlashColor || DEFAULT_DC_FLASH_COLOR
              const haloColor = colorWithAlpha(flashColor, 0.65)
              if (tightTabsEnabled || tabsModeIsTabs) {
                tabBoxShadowParts.push(`0 0 0 2px ${flashColor}`)
                tabBoxShadowParts.push(`0 0 18px ${haloColor}`)
              } else {
                tabBoxShadowParts.push(`0 0 0 2px ${flashColor}, 0 0 18px ${colorWithAlpha(flashColor, 0.6)}`)
              }
            }
            const tabBoxShadow = tabBoxShadowParts.filter(Boolean).join(', ') || undefined
            const tabFontFamily = (settings?.speedDial?.matchHeaderFont && (bannerFontFamilyGlobal || resolveFontGlobal))
              ? (bannerFontFamilyGlobal || resolveFontGlobal)
              : undefined
            const tabBorderColor = cyberTabsEnabled
              ? (backgroundEnabled ? (isActive ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)') : 'rgba(255,255,255,0.04)')
              : tightFamilyEnabled ? 'transparent' : undefined
            const tightTabVars = tightTabsEnabled
              ? {
                '--tight-basic-accent': colorWithAlpha(accentBase, isActive ? 0.32 : 0.16),
                '--tight-basic-soft': colorWithAlpha(accentBase, isActive ? 0.18 : 0.08),
                '--tight-basic-strength': isActive ? '1' : '0.45',
              }
              : {}
            const tightTabzVars = tightTabzEnabled
              ? {
                '--tight-tabz-surface': colorWithAlpha(accentBase, isActive ? 0.55 : 0.22),
                '--tight-tabz-ambient': colorWithAlpha(accentBase, isActive ? 0.32 : 0.12),
                '--tight-tabz-outline': colorWithAlpha(accentBase, isActive ? 0.5 : 0.25)
              }
              : {}
            const tightTabzBackground = tightTabzEnabled
              ? (isActive ? colorWithAlpha(accentBase, 0.24) : 'rgba(255,255,255,0.04)')
              : undefined
            return (
              <ContextMenu key={w.id}>
                <ContextMenuTrigger asChild>
                  <button
                    onMouseDown={(e) => onTabMouseDown(e, w.id)}
                    onMouseEnter={() => { setHoveredTabId(w.id); onWorkspaceHoverChange?.(w.id) }}
                    onMouseLeave={() => { setHoveredTabId(null); onWorkspaceHoverChange?.(null) }}
                    onFocus={() => triggerTabFocusPulse(w.id)}
                    onClick={() => { onWorkspaceSelect?.(w.id) }}
                    onDoubleClick={(e) => {
                      e?.preventDefault?.()
                      const glowColor = getDoubleClickGlowColor(w.id)
                      if (dcFlashTimerRef.current) {
                        clearTimeout(dcFlashTimerRef.current)
                      }
                      setDcFlashColor(glowColor)
                      setDcFlash(true)
                      dcFlashTimerRef.current = setTimeout(() => {
                        setDcFlash(false)
                        setDcFlashColor(null)
                        dcFlashTimerRef.current = null
                      }, 600)
                      onWorkspaceDoubleSelect?.(w.id)
                    }}
                    className={baseTabClasses}
                    style={{
                      width: TAB_W,
                      height: TAB_H,
                      ...glowTransitionStyles,
                      backdropFilter: hoverBlur || tabBlur,
                      WebkitBackdropFilter: hoverBlur || tabBlur,
                      fontFamily: tabFontFamily,
                      boxShadow: tabBoxShadow,
                      ...(tightTabzEnabled
                        ? { background: tightTabzBackground }
                        : surfaceBackground !== undefined ? { background: surfaceBackground } : {}),
                      border: tightTabzEnabled
                        ? `1px solid ${colorWithAlpha(accentBase, isActive ? 0.4 : 0.2)}`
                        : (tightTabsEnabled || cyberTabsEnabled)
                          ? `1px solid ${tabBorderColor || 'rgba(255,255,255,0.12)'}`
                          : undefined,
                      marginTop: tightTabsEnabled ? '-1.6px' : (tightTabzEnabled && isActive ? '-2px' : (tabsModeIsTabs ? '-1px' : undefined)),
                      zIndex: isActive ? 10 : 1,
                      ...cyberTabDynamicVars,
                      ...tightTabVars,
                      ...tightTabzVars,
                    }}
                    title={isAnchored ? `${w.name} (Anchored)` : w.name}
                  >
                    {(() => {
                      const headerCol = (settings?.speedDial?.matchHeaderColor && currentHeaderColorGlobal) ? stripAlphaFromHex(currentHeaderColorGlobal) : null
                      const iconStyle = headerCol
                        ? { color: isActive ? headerCol : colorWithAlpha(headerCol, 0.7) }
                        : undefined
                      return (
                        <Icon
                          className={`w-4 h-4 transition-all duration-200 ${isActive ? 'drop-shadow-sm' : ''}`}
                          style={iconStyle}
                        />
                      )
                    })()}
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => setEditModeAndReorder(!(editMode || tabsReorderEnabled))}>
                    <Edit3 className="w-4 h-4" /> {(editMode || tabsReorderEnabled) ? 'Disable Edit Mode' : 'Enable Edit Mode'}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onWorkspaceRename?.(w.id)}><Edit3 className="w-4 h-4" /> Rename</ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>Change Icon</ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {['Home', 'Layers', 'Grid2X2', 'AppWindow', 'LayoutList'].map(name => {
                        const Ico = iconByName(name)
                        return (
                          <ContextMenuItem key={name} onClick={() => onWorkspaceChangeIcon?.(w.id, name)}>
                            <Ico className="w-4 h-4" /> {name}
                          </ContextMenuItem>
                        )
                      })}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={onWorkspaceAdd}><Plus className="w-4 h-4" /> New Workspace</ContextMenuItem>
                  <ContextMenuItem onClick={() => onWorkspaceRemove?.(w.id)} variant="destructive"><Trash2 className="w-4 h-4" /> Delete</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </div>
      )}



      {/* Glass connector removed for stability during redesign */}

      {/* Add Tile Dialog (active workspace) in portal to escape transforms */}
      {createPortal(
        <AnimatePresence>
          {showAddDialog && (
            <motion.div
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100000] settings-force-white"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="bg-black/90 backdrop-blur-md rounded-xl p-6 border border-white/20 max-w-md w-full mx-4 settings-force-white z-[100001]"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: '#fff',
                  fontFamily: 'Inter, system-ui, Arial, sans-serif' // Unchangeable font for Speed Dial popup
                }}
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium" style={{ color: '#fff' }}>Add Speed Dial Tile</h3>
                  <button onClick={() => setShowAddDialog(false)} style={{ color: 'rgba(255,255,255,0.8)' }}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: defaultTextColor }}>Title</label>
                    <input
                      type="text"
                      value={newTileData.title}
                      onChange={(e) => { setTitleTouched(true); setNewTileData(prev => ({ ...prev, title: e.target.value })) }}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                      style={{ color: '#fff' }}
                      placeholder="Enter title"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: defaultTextColor }}>URL</label>
                    <input
                      type="url"
                      value={newTileData.url}
                      onChange={(e) => {
                        const val = e.target.value
                        setNewTileData(prev => ({ ...prev, url: val, title: titleTouched ? prev.title : deriveTitleFromUrl(val) }))
                      }}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                      style={{ color: '#fff' }}
                      placeholder="https://example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: defaultTextColor }}>Alternate favicon URL (optional)</label>
                    <input
                      type="url"
                      value={newTileData.altFavicon || ''}
                      onChange={(e) => setNewTileData(prev => ({ ...prev, altFavicon: e.target.value }))}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                      style={{ color: '#fff' }}
                      placeholder="https://app.example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: defaultTextColor }}>Custom Icon</label>
                    <div
                      onDrop={async (e) => {
                        e.preventDefault()
                        const file = e.dataTransfer.files?.[0]
                        if (file && file.type.startsWith('image/')) {
                          try {
                            const { dataUrl } = await normalizeIconSource(file, { size: 96 })
                            const savedUrl = await trySaveIconToProject(dataUrl, file.name || 'icon')
                            setNewTileData(prev => ({ ...prev, customIcon: savedUrl || dataUrl }))
                          } catch {
                            const reader = new FileReader()
                            reader.onload = (ev) => setNewTileData(prev => ({ ...prev, customIcon: ev.target.result }))
                            reader.readAsDataURL(file)
                          }
                        }
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      className="w-full border border-dashed border-white/30 rounded-lg p-4 flex items-center justify-center gap-3 text-sm"
                      style={{ color: 'rgba(255,255,255,0.85)' }}
                    >
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-2 bg-white/10 rounded-lg border border-white/20"
                        style={{ color: '#fff' }}
                        type="button"
                      >
                        Upload Image
                      </button>
                      <span>or drop an image here</span>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        if (f && f.type.startsWith('image/')) {
                          try {
                            const { dataUrl } = await normalizeIconSource(f, { size: 96 })
                            const savedUrl = await trySaveIconToProject(dataUrl, f.name || 'icon')
                            setNewTileData(prev => ({ ...prev, customIcon: savedUrl || dataUrl }))
                          } catch {
                            const reader = new FileReader()
                            reader.onload = (ev) => setNewTileData(prev => ({ ...prev, customIcon: ev.target.result }))
                            reader.readAsDataURL(f)
                          }
                        }
                        e.target.value = ''
                      }}
                    />
                  </div>
                  <div className="flex justify-end pt-4">
                    <button
                      onClick={addTile}
                      disabled={!newTileData.url}
                      className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
                    >
                      Add Tile
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Hidden input for editing existing tile icon */}
      <input
        ref={editIconRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          const tgt = editIconTarget
          setEditIconTarget(null)
          if (!file || !tgt) return
          if (!file.type?.startsWith('image/')) return
          try {
            const { dataUrl } = await normalizeIconSource(file, { size: 96 })
            const savedUrl = await trySaveIconToProject(dataUrl, file.name || 'icon')
            const finalUrl = savedUrl || dataUrl
            updateTileIcon(tgt.wsId, tgt.tileId, { folderId: tgt.folderId || null, favicon: finalUrl })
          } catch {
            const reader = new FileReader()
            reader.onload = (ev) => {
              const src = ev.target.result
              updateTileIcon(tgt.wsId, tgt.tileId, { folderId: tgt.folderId || null, favicon: src })
            }
            reader.readAsDataURL(file)
          }
        }}
      />

      <AnimatePresence>
        {folderDeleteDialog.open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-md rounded-2xl border border-white/15 bg-black/85 p-6 text-white shadow-2xl"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <h3 className="text-lg font-semibold mb-3">Delete folder</h3>
              <p className="text-sm text-white/70">
                Are you sure you want to delete “{folderDeleteDialog.folderTitle || 'Folder'}”?
              </p>
              <label className="mt-4 flex items-start gap-3 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={folderDeleteDialog.deleteChildren}
                  onChange={(e) => setFolderDeleteDialog(prev => ({ ...prev, deleteChildren: !!e.target.checked }))}
                  className="mt-1"
                />
                <span>Delete shortcuts inside this folder.</span>
              </label>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={closeFolderDeleteDialog}
                  className="px-4 py-2 rounded-lg border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmFolderDelete}
                  className="px-4 py-2 rounded-lg bg-red-500/80 hover:bg-red-500 transition-colors text-white font-semibold"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

//

// GlassBump removed during stabilization
