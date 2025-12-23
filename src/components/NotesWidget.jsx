import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  StickyNote,
  Plus,
  CornerUpLeft,
  ArrowUpRight,
  ArrowUpLeft,
  Layers,
  Home,
  Grid2X2,
  AppWindow,
  LayoutList,
  RotateCw,
  Mail,
  Pin,
  PinOff,
  Trash2
} from 'lucide-react'
import EmailList from './EmailList'

const ICON_MAP = { Home, Layers, Grid2X2, AppWindow, LayoutList }
const URL_PREVIEW_REGEX = /(https?:\/\/[^\s)]+|www\.[^\s)]+)/i
const MD_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|www\.[^\s)]+)\)/

const sanitizeHex = (hex, fallback = '#ffffff') => {
  if (!hex || typeof hex !== 'string') return fallback
  const clean = hex.trim()
  if (!clean.startsWith('#')) return clean
  const body = clean.slice(1)
  if (body.length >= 6) return `#${body.slice(0, 6)}`
  return fallback
}

const hexToRgba = (hex, alpha = 1) => {
  try {
    const normalized = sanitizeHex(hex)
    const body = normalized.replace('#', '')
    const r = parseInt(body.slice(0, 2), 16)
    const g = parseInt(body.slice(2, 4), 16)
    const b = parseInt(body.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  } catch {
    return `rgba(255,255,255,${alpha})`
  }
}

const formatStamp = (value) => {
  if (!value) return 'Just now'
  try {
    const date = typeof value === 'number' ? new Date(value) : new Date(String(value))
    if (Number.isNaN(date.getTime())) return 'Just now'
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  } catch {
    return 'Just now'
  }
}

const renderTextWithLink = (text, opts = {}) => {
  const { workspaceColor, previewUrl } = opts || {}
  if (!text) return text

  const mdMatch = text.match(MD_LINK_REGEX)
  if (mdMatch) {
    const [full, label, urlRaw] = mdMatch
    const before = text.slice(0, mdMatch.index)
    const after = text.slice(mdMatch.index + full.length)
    const handleLinkClickMd = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!urlRaw) return
      let href = urlRaw
      if (!/^https?:\/\//i.test(href)) {
        href = `https://${href}`
      }
      try {
        window.open(href, '_blank', 'noopener,noreferrer')
      } catch {
        // ignore
      }
    }
    return (
      <>
        {before}
        <span
          onClick={handleLinkClickMd}
          onMouseDown={(e) => e.stopPropagation()}
          className="cursor-pointer underline-offset-2 hover:underline"
          style={workspaceColor ? { color: workspaceColor } : undefined}
        >
          {label}
        </span>
        {after}
      </>
    )
  }

  const urlMatch = text.match(URL_PREVIEW_REGEX)
  const url = previewUrl || (urlMatch ? urlMatch[0] : '')
  if (!url) return text
  const idx = text.indexOf(url)
  if (idx === -1) return text
  const before = text.slice(0, idx)
  const after = text.slice(idx + url.length)
  const handleLinkClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    let href = url
    if (!/^https?:\/\//i.test(href)) {
      href = `https://${href}`
    }
    try {
      window.open(href, '_blank', 'noopener,noreferrer')
    } catch {
      // ignore
    }
  }
  return (
    <>
      {before}
      <span
        onClick={handleLinkClick}
        onMouseDown={(e) => e.stopPropagation()}
        className="cursor-pointer underline-offset-2 hover:underline"
        style={workspaceColor ? { color: workspaceColor } : undefined}
      >
        {url}
      </span>
      {after}
    </>
  )
}

const NotesWidget = ({
  settings = {},
  entries = [],
  activeId,
  inlineEditing = false,
  activeNoteTitle = '',
  draftValue = '',
  onDraftChange,
  onTitleChange,
  onCreateInline,
  onCreateCenter,
  onSelectNote,
  onInlineBack,
  onPromoteToCenter,
  onAssignWorkspace,
  onDeleteNote,
  onPinNote,
  activeNoteWorkspaceId = null,
  activeLocation = 'widget',
  className = '',
  listStyle = 'pill',
  filterMode = 'all',
  filterWorkspaceId = null,
  onChangeFilter,
  workspaces = [],
  workspaceMeta = {},
  currentWorkspaceId = null,
  maxLength = 1200,
  linkSpeedDialBlur = false,
  linkedBlurPx = 0,
  enhancedWorkspaceId = false,
  hoverPreviewEnabled = false,
  autoExpandOnHover = false,
  onHoverNote,
  folders = [],
  activeFolder = '',
  pinnedFolder = '',
  onFolderChange,
  onPinFolder,
  onClearPinnedFolder,
  onRefreshNotes,
  emailAccounts = [],
  onComposeEmail,
  onRefreshEmails,
  onPromoteEmailToCenter,
  emailsCenterOpen = false,
  onEmailHover = null,
  onEmailClick = null,
  onWidgetAlternatorToggle = null,
  widgetAlternatorMode = 'none',
  emailWidgetShownIndependently = false
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [emailPinned, setEmailPinned] = useState(false)
  const [autoCollapsedFromEmpty, setAutoCollapsedFromEmpty] = useState(false)
  const [mode, setMode] = useState('notes') // 'notes' | 'email'
  const prevEmailModeRef = useRef(null) // Store previous mode before center opened
  
  // When widget alternator mode is active OR when email widget is shown independently,
  // force notes mode (email is handled by separate EmailWidget)
  useEffect(() => {
    // If alternator mode is active or email widget is shown independently, email is handled separately
    if (widgetAlternatorMode !== 'none' || emailWidgetShownIndependently) {
      if (mode === 'email') {
        prevEmailModeRef.current = 'email'
        setMode('notes')
      }
    }
  }, [widgetAlternatorMode, mode, emailWidgetShownIndependently])
  
  // When center email view opens, temporarily switch to notes mode
  // When it closes, restore previous mode (if it was email)
  useEffect(() => {
    if (emailsCenterOpen && mode === 'email') {
      prevEmailModeRef.current = 'email'
      setMode('notes')
    } else if (!emailsCenterOpen && prevEmailModeRef.current === 'email' && widgetAlternatorMode === 'none') {
      setMode('email')
      prevEmailModeRef.current = null
    }
  }, [emailsCenterOpen, mode, widgetAlternatorMode])
  const [contextNoteId, setContextNoteId] = useState(null)
  const [contextMenuPos, setContextMenuPos] = useState(null)
  const [folderContextPath, setFolderContextPath] = useState(null)
  const [folderContextPos, setFolderContextPos] = useState(null)
  const [isHovering, setIsHovering] = useState(false)
  const [showFolderMenu, setShowFolderMenu] = useState(false)
  const [availableHeight, setAvailableHeight] = useState(null)
  const [hoveredNoteId, setHoveredNoteId] = useState(null)
  const containerRef = useRef(null)

  const colorPrimary = useMemo(
    () => sanitizeHex(settings.colorPrimary, '#ffffff'),
    [settings.colorPrimary]
  )
  const colorAccent = useMemo(
    () => sanitizeHex(settings.colorAccent, '#00ffff'),
    [settings.colorAccent]
  )
  // Use resolved glow color for glow shadows (workspace-specific or default for anchored workspace)
  const glowColorForShadow = useMemo(
    () => sanitizeHex(settings.glowColor || settings.colorAccent, '#00ffff66'),
    [settings.glowColor, settings.colorAccent]
  )
  const removeBackgrounds = settings?.notesRemoveBackground !== false
  const removeOutlines = settings?.notesRemoveOutline !== false
  const simpleButtons = !!settings?.notesSimpleButtons
  const glowShadow = settings?.notesGlowShadow !== false
  const useLinkedBlur = !!linkSpeedDialBlur || settings?.notesLinkSpeedDialBlur
  const rawLinkedBlur = Number.isFinite(Number(linkedBlurPx))
    ? Math.max(0, Number(linkedBlurPx))
    : 0
  const blurEnabled = useLinkedBlur ? true : settings?.notesBlurEnabled !== false
  const manualBlur = Number.isFinite(Number(settings?.notesBlurPx))
    ? Math.max(0, Math.min(40, Number(settings.notesBlurPx)))
    : 18
  const blurBase = useLinkedBlur ? rawLinkedBlur : manualBlur
  const dynamicHeight = settings?.notesDynamicBackground
  const dynamicSizing = settings?.notesDynamicSizing !== false
  const noteCount = entries.length || 0
  const dynamicFactor = dynamicHeight ? 1 + Math.min(noteCount, 6) * 0.08 : 1
  const blurPx = blurEnabled ? blurBase * dynamicFactor : 0
  const glowAlpha = 0.55 + (dynamicHeight ? Math.min(noteCount, 6) * 0.04 : 0)
  const accentGlow = hexToRgba(glowColorForShadow, glowAlpha)
  const inlineCharCount = (draftValue || '').length
  const inlineRows = Math.max(3, Math.ceil(inlineCharCount / 140))
  const inlineMinHeight = Math.min(640, 220 + inlineRows * 18)
  const approxRowHeight = listStyle === 'minimal' ? 34 : 58
  // Sharpened dynamic sizing logic:
  // Reduced base height and per-item height for a tighter fit
  const hoverExpandActive =
    autoExpandOnHover && isCollapsed && isHovering && !inlineEditing
  // When email mode is pinned, prevent collapsing
  const effectiveCollapsed = mode === 'email' && emailPinned 
    ? false 
    : (isCollapsed && !hoverExpandActive)
  const nothingVisible = noteCount === 0 && !inlineEditing && !hoverExpandActive
  // Different min height logic for email vs notes mode
  // Email lists are typically full, so always allow expansion
  // Notes should shrink when there are only 1-2 notes
  const listMinHeight = mode === 'email'
    ? Math.min(520, 120) // Lower minimum for email - encourages expansion
    : (noteCount
      ? Math.min(520, 80 + noteCount * approxRowHeight)
      : 32)
  const desiredMinHeight = inlineEditing ? inlineMinHeight : listMinHeight
  const clampedMinHeight = dynamicSizing
    ? Math.max(nothingVisible ? 32 : 100, desiredMinHeight)
    : 220
  const composerShellMinHeight = dynamicSizing && inlineEditing ? Math.max(220, clampedMinHeight - 12) : null
  const composerTextareaMinHeight = dynamicSizing && inlineEditing ? Math.max(160, clampedMinHeight - 120) : null

  // Measure available space in parent flex container to fill gaps
  useLayoutEffect(() => {
    if (!dynamicSizing || effectiveCollapsed || !containerRef.current) {
      setAvailableHeight(null)
      return
    }
    
    const measure = () => {
      try {
        const widget = containerRef.current
        if (!widget) return
        
        // Find parent flex container (the one with flex-1 min-h-0)
        let parent = widget.parentElement
        while (parent) {
          const style = window.getComputedStyle(parent)
          if (style.display === 'flex' && style.flexDirection === 'column') {
            // Found the flex container, now measure available space
            const parentRect = parent.getBoundingClientRect()
            const parentHeight = parentRect.height
            
            // Sum up heights of sibling elements (music controller, gaps, etc.)
            let siblingHeight = 0
            let widgetIndex = -1
            for (let i = 0; i < parent.children.length; i++) {
              const child = parent.children[i]
              if (child === widget) {
                widgetIndex = i
              } else {
                const childRect = child.getBoundingClientRect()
                siblingHeight += childRect.height
              }
            }
            
            // Account for gaps (gap-4 = 1rem = 16px)
            // Gaps exist between each pair of children
            const gapCount = Math.max(0, parent.children.length - 1)
            const gapHeight = gapCount * 16 // gap-4 = 16px
            
            // Account for parent padding and margins
            const parentStyle = window.getComputedStyle(parent)
            const parentPaddingTop = parseFloat(parentStyle.paddingTop) || 0
            const parentPaddingBottom = parseFloat(parentStyle.paddingBottom) || 0
            const parentMarginTop = parseFloat(parentStyle.marginTop) || 0
            
            // Calculate available space for this widget
            // Subtract sibling heights, gaps, and padding
            const available = parentHeight - siblingHeight - gapHeight - parentPaddingTop - parentPaddingBottom - parentMarginTop
            
            // Different expansion logic for email vs notes mode
            // Email mode: Always expand to fill available space (emails are typically full lists)
            // Notes mode: Only expand if there's meaningful space (at least 100px more than min)
            // IMPORTANT: Reserve space for music player if it exists (estimate ~200px including margins)
            const musicPlayerReserve = 220 // Reserve space for music player + gap + margin
            // Check for music player more reliably - look for mt-auto wrapper or music controller class
            const hasMusicPlayer = Array.from(parent.children).some(child => {
              if (child === widget) return false
              // Check if this child has mt-auto (music player wrapper pattern)
              const childClasses = child.className || ''
              if (childClasses.includes('mt-auto')) return true
              // Check if this child contains a music controller
              if (child.querySelector && child.querySelector('[class*="music"]')) return true
              // Check if child text content or structure suggests music controller
              const text = child.textContent || ''
              if (text.includes('Not playing') || text.includes('Playing')) return true
              return false
            })
            const reservedSpace = hasMusicPlayer ? musicPlayerReserve : 0
            
            if (mode === 'email') {
              // Email mode: More conservative expansion when music player is present
              // Reserve space for music player to prevent pushing it out of view
              const effectiveAvailable = available - reservedSpace
              if (effectiveAvailable > clampedMinHeight + 50) {
                // Cap expansion more aggressively when music player is present
                const maxReasonable = hasMusicPlayer 
                  ? Math.min(clampedMinHeight * 2.5, effectiveAvailable)
                  : clampedMinHeight * 4
                setAvailableHeight(Math.min(effectiveAvailable, maxReasonable))
              } else {
                setAvailableHeight(null)
              }
            } else {
              // Notes mode: Conservative expansion - only if there's significant space
              const effectiveAvailable = available - reservedSpace
              if (effectiveAvailable > clampedMinHeight + 100) {
                // Cap at reasonable maximum to prevent excessive growth
                const maxReasonable = clampedMinHeight * 2.5
                setAvailableHeight(Math.min(effectiveAvailable, maxReasonable))
              } else {
                setAvailableHeight(null)
              }
            }
            break
          }
          parent = parent.parentElement
        }
      } catch (e) {
        console.error('Error measuring available height:', e)
        setAvailableHeight(null)
      }
    }
    
    measure()
    
    // Re-measure on resize - observe parent and siblings
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(measure)
    })
    
    if (containerRef.current?.parentElement) {
      resizeObserver.observe(containerRef.current.parentElement)
      // Also observe sibling elements (like music controller) to recalculate when they resize
      for (let i = 0; i < containerRef.current.parentElement.children.length; i++) {
        const child = containerRef.current.parentElement.children[i]
        if (child !== containerRef.current) {
          resizeObserver.observe(child)
        }
      }
    }
    
    return () => {
      resizeObserver.disconnect()
    }
  }, [dynamicSizing, effectiveCollapsed, clampedMinHeight, mode])

  const containerStyle = {
    background: (removeBackgrounds || isCollapsed)
      ? 'transparent'
      : 'linear-gradient(150deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
    border: (removeOutlines || isCollapsed) ? 'none' : '1px solid rgba(255,255,255,0.18)',
    boxShadow: (!glowShadow || isCollapsed) ? 'none' : `0 22px 55px -35px ${accentGlow}`,
    backdropFilter: blurPx ? `blur(${blurPx}px)` : 'none',
    color: colorPrimary,
    fontFamily: settings.resolvedFontFamily || 'Inter, system-ui, sans-serif',
    marginTop: '24px', // Increased top margin to prevent overlap
    transition: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1.0)',
    paddingBottom: effectiveCollapsed ? '0' : undefined, // Reduce padding when collapsed
    height: effectiveCollapsed ? 'auto' : (dynamicHeight ? 'auto' : undefined),
    minHeight: effectiveCollapsed ? '0' : `${clampedMinHeight}px`,
    maxHeight: availableHeight && dynamicSizing && !effectiveCollapsed 
      ? `${availableHeight}px` 
      : undefined,
    // More conservative flex behavior to prevent pushing music player out of view
    // Only use flex-grow when we have measured available height and it's reasonable
    flex: dynamicSizing && availableHeight && availableHeight > clampedMinHeight + 100 
      ? '1 1 auto' 
      : (dynamicSizing ? '0 0 auto' : undefined),
    // Ensure widget doesn't overflow and cause layout issues
    overflow: 'hidden',
    position: 'relative',
    zIndex: 1
  }

  const buttonBase = simpleButtons
    ? 'w-5 h-5 inline-flex items-center justify-center text-white/60 hover:text-white transition-colors'
    : 'w-6 h-6 inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/70 hover:bg-white/15 hover:text-white hover:border-white/20 transition-all shadow-sm'

  const locationLabel = activeLocation === 'center' ? 'Center column' : 'Widget view'
  const currentWorkspace =
    workspaces.find((ws) => ws.id === currentWorkspaceId) || null

  const folderList = useMemo(
    () =>
      Array.isArray(folders)
        ? Array.from(
          new Set(
            folders
              .filter((f) => typeof f === 'string' && f.trim())
              .map((f) => f.trim()),
          ),
        ).sort((a, b) => a.localeCompare(b))
        : [],
    [folders],
  )
  const effectiveActiveFolder = (() => {
    if (activeFolder && folderList.includes(activeFolder)) return activeFolder
    if (pinnedFolder && folderList.includes(pinnedFolder)) return pinnedFolder
    return ''
  })()
  const hasFolders = folderList.length > 0
  const formatFolderLabel = (path) => {
    if (!path) return 'All notes'
    const parts = String(path).split('/').filter(Boolean)
    return parts[parts.length - 1] || 'Folder'
  }

  const filterValue = (() => {
    if (filterMode === 'perWorkspace') return 'perWorkspace'
    if (filterMode === 'none') return 'none'
    if (filterMode === 'manual' && filterWorkspaceId) return `ws:${filterWorkspaceId}`
    return 'all'
  })()

  const handleCreateInline = (e) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (isCollapsed) setIsCollapsed(false)
    onCreateInline?.()
  }
  const handleCreateCenter = () => onCreateCenter?.()

  const handleHeaderClick = (e) => {
    if (inlineEditing) return
    const target = e.target
    if (target && typeof target.closest === 'function') {
      const interactive = target.closest('button,select,input,textarea,label,[role="button"]')
      if (interactive) return
    }
    // In email mode, toggle pin instead of collapse
    if (mode === 'email') {
      setEmailPinned((prev) => {
        const next = !prev
        // If unpinning and was collapsed, restore collapsed state
        if (!next && isCollapsed) {
          // Keep collapsed state as is
        } else if (next) {
          // When pinning, ensure it's not collapsed
          setIsCollapsed(false)
        }
        return next
      })
      return
    }
    // Normal collapse behavior for notes mode
    setIsCollapsed((prev) => {
      const next = !prev
      if (next) {
        setAutoCollapsedFromEmpty(false)
      }
      return next
    })
  }

  useEffect(() => {
    if (!contextNoteId && !folderContextPath && !showFolderMenu) return
    const handleGlobalClick = () => {
      setContextNoteId(null)
      setContextMenuPos(null)
      setFolderContextPath(null)
      setFolderContextPos(null)
      setShowFolderMenu(false)
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        setContextNoteId(null)
        setContextMenuPos(null)
        setFolderContextPath(null)
        setFolderContextPos(null)
        setShowFolderMenu(false)
      }
    }
    window.addEventListener('click', handleGlobalClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [contextNoteId, folderContextPath, showFolderMenu])

  useEffect(() => {
    if (!inlineEditing && noteCount === 0 && !isCollapsed) {
      setIsCollapsed(true)
      setAutoCollapsedFromEmpty(true)
    } else if (
      !inlineEditing &&
      noteCount > 0 &&
      isCollapsed &&
      autoCollapsedFromEmpty
    ) {
      setIsCollapsed(false)
      setAutoCollapsedFromEmpty(false)
    }
  }, [noteCount, inlineEditing, isCollapsed, autoCollapsedFromEmpty])

  useEffect(() => {
    return () => {
      onHoverNote?.(null)
    }
  }, [onHoverNote])

  const contextNote = contextNoteId
    ? entries.find((n) => n.id === contextNoteId) || null
    : null
  const contextFolderLabel = folderContextPath
    ? formatFolderLabel(folderContextPath)
    : ''

  const handleFilterSelect = (value) => {
    if (value === 'all') onChangeFilter?.('all')
    else if (value === 'perWorkspace') onChangeFilter?.('perWorkspace')
    else if (value === 'none') onChangeFilter?.('none')
    else if (value.startsWith('ws:')) onChangeFilter?.('manual', value.slice(3))
  }

  const renderFolderBar = () => {
    if (!hasFolders || inlineEditing) return null
    const label = formatFolderLabel(effectiveActiveFolder)
    const isRoot = !effectiveActiveFolder
    return (
      <div className={`mt-1 flex items-center justify-between gap-2 text-[10px] leading-tight text-white/55 ${effectiveCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-80'}`}>
        <div className="flex items-center gap-1 min-w-0">
          {!isRoot && (
            <>
              <button
                type="button"
                className="px-1 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onFolderChange?.('')
                }}
              >
                All
              </button>
              <span className="text-white/30">/</span>
            </>
          )}
          <button
            type="button"
            className="px-1 py-0.5 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors truncate max-w-[9rem]"
            title={effectiveActiveFolder || 'All notes'}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!isRoot) {
                onFolderChange?.(effectiveActiveFolder)
              }
            }}
            onContextMenu={(e) => {
              if (!effectiveActiveFolder) return
              e.preventDefault()
              e.stopPropagation()
              setFolderContextPath(effectiveActiveFolder)
              setFolderContextPos({ x: e.clientX, y: e.clientY })
            }}
          >
            {label}
          </button>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {effectiveActiveFolder && typeof onPinFolder === 'function' && (
            <button
              type="button"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white transition-colors"
              title={
                pinnedFolder === effectiveActiveFolder
                  ? 'Unpin folder'
                  : 'Pin folder as default'
              }
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (pinnedFolder === effectiveActiveFolder) {
                  onClearPinnedFolder?.()
                } else {
                  onPinFolder?.(effectiveActiveFolder)
                }
              }}
            >
              {/* small pin glyph */}
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 3l5 5-4 4-2-2-4 4-2-2-4 4-2-2 4-4-2-2 4-4 2 2 4-4z" />
              </svg>
            </button>
          )}
          {hasFolders && (
            <button
              type="button"
              className="inline-flex h-5 px-1 items-center justify-center rounded bg-white/5 hover:bg-white/15 text-white/60 hover:text-white text-[9px] tracking-wide uppercase"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setShowFolderMenu((prev) => !prev)
              }}
              title="Browse folders"
            >
              Folders
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderNoteList = () => (
    <>
      <style>{`
        .notes-scroll-container::-webkit-scrollbar {
          display: none;
        }
        .notes-scroll-container {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
      <div
        className={`${dynamicSizing ? '' : 'flex-1'} flex flex-col mt-2 overflow-y-auto notes-scroll-container w-[calc(100%+1.5rem)] -mx-3 transition-all duration-300 ${effectiveCollapsed ? 'max-h-0 opacity-0 overflow-hidden mt-0' : 'min-h-[120px] opacity-100'}`}
        style={effectiveCollapsed ? {} : { 
          maxHeight: dynamicSizing 
            ? (availableHeight 
                ? `${Math.min(availableHeight - 100, Math.max(400, clampedMinHeight - 80))}px`
                : `${Math.max(400, clampedMinHeight - 80)}px`)
            : '400px' 
        }}
      >
        {hasFolders && !effectiveCollapsed && (
          <div className={`${listStyle === 'minimal' ? 'mb-1' : 'mb-2'} flex flex-col ${listStyle === 'minimal' ? 'gap-1' : 'gap-2'}`}>
            {folderList.map((folderPath) => {
              const isActiveFolderRow = effectiveActiveFolder === folderPath
              const isPinned = pinnedFolder === folderPath
              return (
                <button
                  key={`folder-${folderPath}`}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (isCollapsed) setIsCollapsed(false)
                    onFolderChange?.(folderPath)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setFolderContextPath(folderPath)
                    setFolderContextPos({ x: e.clientX, y: e.clientY })
                  }}
                  className={`text-left w-full transition-all group relative overflow-hidden px-3 shrink-0 ${listStyle === 'minimal'
                    ? `h-[36px] border-b border-white/5 flex items-center ${isActiveFolderRow ? 'text-white' : 'text-white/70 hover:text-white'
                    }`
                    : `h-[48px] flex flex-col justify-center ${isActiveFolderRow
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'bg-transparent text-white/70 hover:bg-white/5 hover:text-white'
                    }`
                    }`}
                  style={{
                    borderColor:
                      isActiveFolderRow && listStyle !== 'minimal'
                        ? colorAccent
                        : isPinned && listStyle !== 'minimal'
                          ? hexToRgba(colorAccent, 0.65)
                          : undefined,
                  }}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-medium w-full">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/5 text-white/70">
                        <LayoutList size={11} />
                      </span>
                      <span className="truncate" title={folderPath}>
                        {formatFolderLabel(folderPath)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 text-[9px] text-white/40">
                      {isPinned && <span>PINNED</span>}
                      {isActiveFolderRow && <span className="text-white/60">OPEN</span>}
                    </div>
                  </div>
                  {listStyle !== 'minimal' && (
                    <div className="mt-0.5 text-[10px] text-white/40 truncate">
                      {folderPath}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
        <div className={`flex flex-col w-full ${listStyle === 'minimal' ? '' : 'gap-[1px]'}`}>
          {entries.map((note) => {
            const isActive = note.id === activeId
            const rawContent = String(note.content || '').trim()
            const linkUrl = String(note.linkUrl || '').trim()
            const isLinkOnly = !!note.linkOnly && !!linkUrl
            const lines = rawContent.split(/\r?\n/).filter(l => l.trim().length > 0)
            const headerText = (note.title || lines[0] || '').trim()
            const bodyText = lines.length > 1 ? lines.slice(1).join(' ').trim() : ''
            const snippet = bodyText || headerText || 'Tap to write…'
            const meta = workspaceMeta?.[note.workspaceId] || null
            const workspaceColor = meta?.color || 'rgba(255,255,255,0.25)'
            const workspaceName = note.workspaceId
              ? (meta?.name || 'Workspace')
              : 'Unassigned'
            const IconComp = meta?.icon && ICON_MAP[meta.icon] ? ICON_MAP[meta.icon] : null
            const contentUrlMatch = rawContent.match(URL_PREVIEW_REGEX)
            const previewUrl = linkUrl || (contentUrlMatch ? contentUrlMatch[0] : '')

            const handleClick = (e) => {
              if (isLinkOnly && linkUrl) {
                e.preventDefault()
                e.stopPropagation()
                try {
                  window.open(linkUrl, '_blank', 'noopener,noreferrer')
                } catch {
                  // ignore
                }
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              const relX = e.clientX - rect.left
              const ratio = rect.width > 0 ? relX / rect.width : 0.5
              const clickedRightHalf = ratio > 0.5
              const isMirror = !!settings.isMirrorLayout
              const centerSide = isMirror ? !clickedRightHalf : clickedRightHalf
              const preferredLocation = centerSide ? 'center' : 'widget'
              onSelectNote?.(note.id, preferredLocation)
            }
            const handleMouseEnter = () => {
              if (hoverPreviewEnabled) {
                onHoverNote?.(note.id)
              }
            }
            const handleMouseLeave = () => {
              if (hoverPreviewEnabled) {
                onHoverNote?.(null)
              }
            }

            const enhancedHighlight =
              enhancedWorkspaceId && workspaceName !== 'Unassigned'
                ? {
                  borderColor:
                    listStyle !== 'minimal'
                      ? hexToRgba(workspaceColor, isActive ? 0.9 : 0.45)
                      : undefined,
                  boxShadow:
                    listStyle !== 'minimal'
                      ? `0 12px 36px -22px ${hexToRgba(workspaceColor, 0.65)}`
                      : undefined,
                  background:
                    listStyle !== 'minimal'
                      ? `linear-gradient(135deg, ${hexToRgba(
                        workspaceColor,
                        isActive ? 0.22 : 0.12,
                      )}, ${hexToRgba(workspaceColor, 0.06)} 60%, transparent 90%)`
                      : undefined,
                }
                : {}

            return (
              <div
                key={note.id}
                className="group relative"
                onMouseEnter={() => setHoveredNoteId(note.id)}
                onMouseLeave={() => setHoveredNoteId(null)}
              >
                <button
                  type="button"
                  onClick={handleClick}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setContextNoteId(note.id)
                    setContextMenuPos({ x: e.clientX, y: e.clientY })
                  }}
                  className={`text-left w-full transition-all relative overflow-hidden px-3 shrink-0 ${listStyle === 'minimal'
                    ? `h-[36px] border-b border-white/5 flex flex-col justify-center ${isActive ? 'text-white' : 'text-white/70 hover:text-white hover:bg-white/5'}`
                    : `h-[64px] flex flex-col justify-center ${isActive ? 'bg-white/10 text-white shadow-sm' : 'bg-transparent text-white/70 hover:bg-white/5 hover:text-white'}`
                    }`}
                  style={{
                    borderColor: isActive && listStyle !== 'minimal' ? workspaceColor : undefined,
                    boxShadow:
                      glowShadow && listStyle !== 'minimal' && isActive
                        ? `0 4px 12px -8px ${workspaceColor}`
                        : undefined,
                    ...enhancedHighlight,
                  }}
                >
                {enhancedWorkspaceId && workspaceName !== 'Unassigned' ? (
                  <span
                    className="absolute inset-y-2 left-1 w-[3px] rounded-full"
                    style={{
                      background: `linear-gradient(180deg, ${hexToRgba(workspaceColor, 0.95)}, ${hexToRgba(workspaceColor, 0.55)})`,
                      boxShadow: `0 0 0 1px ${hexToRgba(workspaceColor, 0.35)}, 0 6px 16px -10px ${hexToRgba(workspaceColor, 0.8)}`
                    }}
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    className="w-1.5 h-1.5 rounded-full shadow-[0_0_4px_rgba(0,0,0,0.5)]"
                    style={{ backgroundColor: workspaceColor, position: 'absolute', left: -9999, top: -9999, opacity: 0 }}
                    aria-hidden="true"
                  />
                )}
                <div className="flex flex-col gap-0.5 w-full">
                  <div className="flex items-center justify-between text-[9px] uppercase tracking-wider font-medium opacity-60 group-hover:opacity-90 transition-opacity w-full">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {IconComp && <IconComp size={9} color={workspaceColor} />}
                      <span style={{ color: isActive ? workspaceColor : 'inherit' }} className="truncate">
                        {workspaceName}
                      </span>
                    </div>
                    <span className="whitespace-nowrap shrink-0">{formatStamp(note.updatedAt)}</span>
                  </div>
                  <div className={`truncate w-full ${listStyle === 'minimal' ? 'text-[11px] font-medium' : 'text-[12px] font-semibold'}`}>
                    {bodyText
                      ? (headerText || 'Untitled')
                      : renderTextWithLink(headerText || 'Untitled', {
                        workspaceColor,
                        previewUrl,
                      })}
                  </div>
                  {bodyText && listStyle !== 'minimal' && (
                    <div className="text-[11px] text-white/50 group-hover:text-white/70 leading-snug truncate transition-colors w-full">
                      {renderTextWithLink(snippet, { workspaceColor, previewUrl })}
                    </div>
                  )}
                </div>
                {/* Hover Menu - Delete, Pin, Reassign */}
                {hoveredNoteId === note.id && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 transition-opacity duration-200 z-10 px-2 py-1.5 rounded-lg backdrop-blur-md bg-black/40 border border-white/10">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteNote?.(note.id)
                      }}
                      className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onPinNote?.(note.id)
                      }}
                      className={`p-1.5 rounded hover:bg-white/10 transition-colors ${note.pinned ? 'text-amber-400 hover:text-amber-300' : 'text-white/70 hover:text-white'}`}
                      title={note.pinned ? "Unpin" : "Pin to top"}
                    >
                      <Pin size={12} className={note.pinned ? 'fill-current' : ''} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setContextNoteId(note.id)
                        setContextMenuPos({ x: e.clientX, y: e.clientY })
                      }}
                      className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                      title="Reassign workspace"
                    >
                      <Layers size={12} />
                    </button>
                  </div>
                )}
              </button>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )

  const renderComposer = () => (
    <div
      className={`flex flex-col ${dynamicSizing ? '' : 'flex-1'} mt-2 w-full animate-in fade-in zoom-in-95 duration-200`}
      style={composerShellMinHeight ? { minHeight: `${composerShellMinHeight}px` } : undefined}
    >
      <div className="flex items-center justify-between text-[10px] text-white/50 mb-1.5 gap-2 px-1">
        <span className="uppercase tracking-wider">Workspace</span>
        <select
          value={activeNoteWorkspaceId || ''}
          onChange={(e) => onAssignWorkspace?.(activeId, e.target.value || null)}
          disabled={!activeId}
          className="flex-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white/80 focus:outline-none hover:bg-white/10 transition-colors"
        >
          <option value="">None</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name || ws.id}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          type="text"
          value={activeNoteTitle || ''}
          onChange={(e) => onTitleChange?.(activeId, e.target.value)}
          disabled={!activeId}
          placeholder="Title (optional)"
          className="w-full bg-black/25 border border-white/10 rounded px-2 py-1 text-[12px] text-white/90 focus:outline-none focus:border-white/30 placeholder:text-white/35"
        />
        <div className="flex-1 rounded-xl border border-white/10 bg-black/20 focus-within:bg-black/40 focus-within:border-white/20 transition-all">
          <textarea
            value={draftValue}
            onChange={(e) => onDraftChange?.(e.target.value)}
            maxLength={maxLength}
            spellCheck={false}
            className="w-full h-full bg-transparent resize-none text-white/90 text-[13px] leading-relaxed p-3 focus:outline-none placeholder:text-white/20"
            placeholder="Write your note…"
            autoFocus
            style={composerTextareaMinHeight ? { minHeight: `${composerTextareaMinHeight}px` } : undefined}
          />
        </div>
        {!!(draftValue || '').trim() && (
          <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 max-h-40 overflow-y-auto text-[12px] leading-relaxed text-white/80 prose prose-invert prose-xs">
            {renderTextWithLink(draftValue)}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-[9px] text-white/30 mt-1.5 px-1">
        <span>Autosaving</span>
        <span>{(draftValue || '').length}/{maxLength}</span>
      </div>
    </div>
  )

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col rounded-2xl px-3 pb-1 pt-2.5 ${className} group/widget`}
      style={containerStyle}
      onMouseEnter={() => {
        if (autoExpandOnHover) setIsHovering(true)
      }}
      onMouseLeave={() => {
        if (autoExpandOnHover) setIsHovering(false)
      }}
    >
      {/* Compact Header */}
      <div
        className={`flex items-center justify-between gap-2 h-7 ${mode === 'email' ? 'cursor-pointer' : ''}`}
        onDoubleClick={(e) => {
          // Don't switch modes if double-clicking on a button (like refresh)
          if (e.target.closest('button')) {
            return
          }
          e.preventDefault()
          e.stopPropagation()
          // If alternator mode is active or email widget is shown independently, use alternator toggle instead
          if (onWidgetAlternatorToggle && (widgetAlternatorMode !== 'none' || emailWidgetShownIndependently)) {
            onWidgetAlternatorToggle()
            return
          }
          // Otherwise, use internal mode switching
          const nextMode = mode === 'notes' ? 'email' : 'notes'
          setMode(nextMode)
          // Reset pinned state when switching modes
          if (nextMode === 'notes') {
            setEmailPinned(false)
          }
        }}
        onClick={handleHeaderClick}
        title={mode === 'email' ? (emailPinned ? 'Click to unpin email list' : 'Click to pin email list') : (onWidgetAlternatorToggle && (widgetAlternatorMode !== 'none' || emailWidgetShownIndependently) ? 'Double-click to toggle widgets' : undefined)}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <div
            className="flex items-center justify-center w-6 h-6 rounded-md bg-white/5 text-white/80 shrink-0 cursor-pointer hover:bg-white/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              // If alternator mode is active or email widget is shown independently, use alternator toggle instead
              if (onWidgetAlternatorToggle && (widgetAlternatorMode !== 'none' || emailWidgetShownIndependently)) {
                onWidgetAlternatorToggle()
                return
              }
              // Otherwise, use internal mode switching (but only if email widget is not shown independently)
              if (!emailWidgetShownIndependently) {
                setMode(prev => prev === 'notes' ? 'email' : 'notes')
              }
            }}
          >
            {mode === 'email' ? (
              <Mail size={13} color={colorAccent} strokeWidth={2} />
            ) : (
              <StickyNote size={13} color={colorAccent} strokeWidth={2} />
            )}
          </div>

          {mode === 'email' ? (
            !inlineEditing && (
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex items-center min-w-0">
                  <select
                    value={filterValue}
                    onChange={(e) => handleFilterSelect(e.target.value)}
                    className="bg-transparent border-none p-0 text-[11px] font-medium text-white/70 focus:outline-none cursor-pointer hover:text-white transition-colors max-w-[120px] truncate appearance-none"
                    title="Filter emails by workspace"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="all">All</option>
                    <option value="perWorkspace">
                      {currentWorkspace ? `${currentWorkspace.name}` : 'Current WS'}
                    </option>
                    {workspaces.length > 0 && (
                      <optgroup label="Workspaces">
                        {workspaces.map((ws) => (
                          <option key={ws.id} value={`ws:${ws.id}`}>
                            {ws.name || ws.id}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {/* Custom chevron for select */}
                  <div className="pointer-events-none text-white/40 ml-0.5">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  </div>
                </div>
                {/* Pin indicator */}
                {emailPinned && (
                  <div className="flex items-center text-white/60" title="Email list is pinned">
                    <Pin size={10} className="shrink-0" />
                  </div>
                )}
              </div>
            )
          ) : (
            !inlineEditing && (
              <div className="flex items-center min-w-0">
                <select
                  value={filterValue}
                  onChange={(e) => handleFilterSelect(e.target.value)}
                  className="bg-transparent border-none p-0 text-[11px] font-medium text-white/70 focus:outline-none cursor-pointer hover:text-white transition-colors max-w-[120px] truncate appearance-none"
                  title="Filter notes"
                >
                  <option value="all">All Notes</option>
                  <option value="perWorkspace">
                    {currentWorkspace ? `${currentWorkspace.name}` : 'Current WS'}
                  </option>
                  <option value="none">Unassigned</option>
                  {workspaces.length > 0 && (
                    <optgroup label="Workspaces">
                      {workspaces.map((ws) => (
                        <option key={ws.id} value={`ws:${ws.id}`}>
                          {ws.name || ws.id}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {/* Custom chevron for select */}
                <div className="pointer-events-none text-white/40 ml-0.5">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </div>
              </div>
            )
          )}

          {inlineEditing && (
            <span className="text-[11px] font-medium text-white/90 truncate">Editing</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {mode === 'email' ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onComposeEmail?.()
                }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/90 text-[11px] font-medium transition-colors shrink-0"
                title="Compose email"
              >
                <Mail size={11} />
                <span>Compose</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onRefreshEmails?.()
                }}
                className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                title="Refresh emails"
              >
                <RotateCw size={12} />
              </button>
              {typeof onPromoteEmailToCenter === 'function' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onPromoteEmailToCenter?.()
                  }}
                  className={buttonBase}
                  title="Open email list in center column"
                >
                  {settings?.isMirrorLayout ? (
                    <ArrowUpLeft size={11} />
                  ) : (
                    <ArrowUpRight size={11} />
                  )}
                </button>
              )}
            </>
          ) : inlineEditing ? (
            <>
              <button
                type="button"
                onClick={onInlineBack}
                className={buttonBase}
                title="Back to list"
              >
                <CornerUpLeft size={11} />
              </button>
              {typeof onPromoteToCenter === 'function' && (
                <button
                  type="button"
                  onClick={onPromoteToCenter}
                  className={buttonBase}
                  title="Open in center column"
                >
                  <ArrowUpRight size={11} />
                </button>
              )}
            </>
          ) : (
            <>
              {typeof onRefreshNotes === 'function' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onRefreshNotes()
                  }}
                  className={buttonBase}
                  title="Refresh from vault"
                >
                  <RotateCw size={11} />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleCreateInline(e)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleCreateCenter()
                }}
                className={buttonBase}
                title="New note"
              >
                <Plus size={12} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className={`${buttonBase} ${isCollapsed ? 'rotate-180' : ''} transition-transform duration-300`}
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content Area */}
      {!effectiveCollapsed && (
        mode === 'email' ? (
          <div 
            className={`mt-2 flex flex-col ${dynamicSizing ? '' : 'flex-1'} transition-all duration-300 ${effectiveCollapsed ? 'max-h-0 opacity-0 overflow-hidden mt-0' : 'min-h-[200px] opacity-100'}`}
            style={effectiveCollapsed ? {} : {
              maxHeight: dynamicSizing
                ? (availableHeight 
                    ? `${Math.min(availableHeight - 120, Math.max(300, Math.min(480, clampedMinHeight - 60)))}px`
                    : `${Math.max(300, Math.min(480, clampedMinHeight - 60))}px`)
                : '400px',
              overflow: 'visible', // Allow EmailList to handle its own scrolling
              minHeight: 0 // Important for flex children to respect maxHeight
            }}
          >
            <EmailList
              onEmailClick={onEmailClick}
              onEmailHover={onEmailHover}
              settings={settings}
              accounts={emailAccounts}
              onCompose={onComposeEmail}
              filterMode={filterMode}
              filterWorkspaceId={filterWorkspaceId}
              onChangeFilter={onChangeFilter}
              workspaces={workspaces}
              currentWorkspaceId={currentWorkspaceId}
            />
          </div>
        ) : (
          <>
            {renderFolderBar()}
            {inlineEditing ? renderComposer() : renderNoteList()}
          </>
        )
      )}
      {showFolderMenu && hasFolders && (
        <div className="absolute z-[30] top-8 right-2 mt-1 min-w-[140px] rounded-lg border border-white/20 bg-black/90 text-[11px] text-white/80 shadow-lg py-1">
          {folderList.map((folderPath) => (
            <button
              key={folderPath}
              type="button"
              className="flex w-full items-center justify-between px-2 py-0.5 hover:bg-white/10"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onFolderChange?.(folderPath)
                setShowFolderMenu(false)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setFolderContextPath(folderPath)
                setFolderContextPos({ x: e.clientX, y: e.clientY })
                setShowFolderMenu(false)
              }}
            >
              <span className="truncate max-w-[120px]" title={folderPath}>
                {formatFolderLabel(folderPath)}
              </span>
              {pinnedFolder === folderPath && (
                <span className="ml-1 text-[9px] text-white/50">PIN</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Global context menu rendered via portal so it isn't clipped by the widget */}
      {typeof document !== 'undefined' && contextNote && contextMenuPos && createPortal(
        <div
          className="fixed z-[9999] rounded-lg border border-white/20 bg-black/90 text-[11px] text-white/80 shadow-lg px-2 py-1.5 space-y-1"
          style={{
            top: contextMenuPos.y + 4,
            left: contextMenuPos.x + 4,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="block w-full text-left px-1 py-0.5 rounded hover:bg-white/10"
            onClick={() => {
              onPinNote?.(contextNote.id)
              setContextNoteId(null)
              setContextMenuPos(null)
            }}
          >
            {contextNote.pinned ? 'Unpin note' : 'Pin to top'}
          </button>
          <button
            type="button"
            className="block w-full text-left px-1 py-0.5 rounded hover:bg-white/10"
            onClick={() => {
              onDeleteNote?.(contextNote.id)
              setContextNoteId(null)
              setContextMenuPos(null)
            }}
          >
            Delete note
          </button>
          <div className="mt-1 pt-1 border-t border-white/15">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-1">
              Assign workspace
            </div>
            <button
              type="button"
              className="block w-full text-left px-1 py-0.5 rounded hover:bg-white/10"
              onClick={() => {
                onAssignWorkspace?.(contextNote.id, null)
                setContextNoteId(null)
                setContextMenuPos(null)
              }}
            >
              None
            </button>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                className="block w-full text-left px-1 py-0.5 rounded hover:bg-white/10"
                onClick={() => {
                  onAssignWorkspace?.(contextNote.id, ws.id)
                  setContextNoteId(null)
                  setContextMenuPos(null)
                }}
              >
                {ws.name || ws.id}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      {typeof document !== 'undefined' && folderContextPath && folderContextPos && createPortal(
        <div
          className="fixed z-[9999] rounded-lg border border-white/20 bg-black/90 text-[11px] text-white/80 shadow-lg px-2 py-1.5 space-y-1"
          style={{
            top: folderContextPos.y + 4,
            left: folderContextPos.x + 4,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-1">
            {contextFolderLabel || 'Folder'}
          </div>
          <button
            type="button"
            className="block w-full text-left px-1 py-0.5 rounded hover:bg-white/10"
            onClick={() => {
              onFolderChange?.(folderContextPath)
              setFolderContextPath(null)
              setFolderContextPos(null)
            }}
          >
            Open folder
          </button>
          {typeof onPinFolder === 'function' && (
            <button
              type="button"
              className="block w-full text-left px-1 py-0.5 rounded hover:bg-white/10"
              onClick={() => {
                if (pinnedFolder === folderContextPath) {
                  onClearPinnedFolder?.()
                } else {
                  onPinFolder?.(folderContextPath)
                }
                setFolderContextPath(null)
                setFolderContextPos(null)
              }}
            >
              {pinnedFolder === folderContextPath ? 'Unpin folder' : 'Pin folder as default'}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

export default NotesWidget
