import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { motion } from 'framer-motion'
import { 
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from './ui/context-menu'
import { ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from './ui/context-menu'
import { Layers, Home, Grid2X2, AppWindow, LayoutList, Plus, Trash2, Edit3 } from 'lucide-react'
import { createThemeTokenResolver } from '../lib/theme-tokens'

// Minimal helpers for color handling (keep local to avoid cross-import churn)
function stripAlphaFromHexLocal(hex) {
  if (!hex || typeof hex !== 'string') return '#ffffff'
  const clean = hex.trim()
  if (clean.startsWith('#')) {
    const withoutHash = clean.slice(1)
    if (withoutHash.length >= 6) {
      return '#' + withoutHash.slice(0, 6)
    }
  }
  return hex
}

function hexToRgbaLocal(hex, alpha = 1) {
  try {
    const h = stripAlphaFromHexLocal(hex).replace('#', '')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = Math.max(0, Math.min(1, Number(alpha)))
    return `rgba(${r}, ${g}, ${b}, ${a})`
  } catch {
    return hex
  }
}

const ICONS = [Home, Layers, Grid2X2, AppWindow, LayoutList]
const ICON_NAMES = ['Home','Layers','Grid2X2','AppWindow','LayoutList']

const WorkspaceStrip = ({ items, activeId, onSelect, onDoubleSelect, onAdd, onRemove, onReorder, onRename, onChangeIcon, wsButtonStyle = { background: true, shadow: true, blur: true, matchDialBlur: false }, onHoverChange, anchoredWorkspaceId = null, onAnchor, settings }) => {
  const [dragState, setDragState] = useState({ isDragging: false, id: null, dropIndex: null })
  const containerRef = useRef(null)

  const SIZE = 36
  const GAP = 8
  const dialBlurPx = Number.isFinite(Number(settings?.speedDial?.blurPx)) ? Math.max(0, Number(settings.speedDial.blurPx)) : 0
  const matchDialBlur = !!(wsButtonStyle?.matchDialBlur)

  const iconByName = (name) => {
    const map = { Home, Layers, Grid2X2, AppWindow, LayoutList }
    return map[name] || Layers
  }

  const onMouseDown = (e, id) => {
    e.preventDefault()
    setDragState({ isDragging: true, id, dropIndex: null })
  }

  const onMouseMove = useCallback((e) => {
    if (!dragState.isDragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const y = e.clientY - rect.top
    const index = Math.max(0, Math.floor(y / (SIZE + GAP)))
    setDragState(prev => ({ ...prev, dropIndex: index }))
  }, [dragState.isDragging])

  const onMouseUp = useCallback(() => {
    if (dragState.isDragging && dragState.dropIndex !== null) {
      const arr = [...items]
      const from = arr.findIndex(i => i.id === dragState.id)
      if (from !== -1) {
        const [moved] = arr.splice(from, 1)
        const to = Math.min(Math.max(dragState.dropIndex, 0), arr.length)
        arr.splice(to, 0, moved)
        onReorder?.(arr.map((i, idx) => ({ ...i, position: idx })))
      }
    }
    setDragState({ isDragging: false, id: null, dropIndex: null })
  }, [dragState])

  useEffect(() => {
    if (dragState.isDragging) {
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      return () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }
    }
  }, [dragState.isDragging, onMouseMove, onMouseUp])

  const addWorkspace = () => onAdd?.()
  const removeWorkspace = (id) => onRemove?.(id)

  // Scroll to change workspace functionality
  const scrollToChangeWorkspace = !!(settings?.general?.scrollToChangeWorkspace)
  const scrollToChangeWorkspaceIncludeSpeedDial = !!(settings?.general?.scrollToChangeWorkspaceIncludeSpeedDial)
  const scrollToChangeWorkspaceIncludeWholeColumn = !!(settings?.general?.scrollToChangeWorkspaceIncludeWholeColumn)
  const scrollToChangeWorkspaceResistance = !!(settings?.general?.scrollToChangeWorkspaceResistance)
  const scrollToChangeWorkspaceResistanceIntensity = Number(settings?.general?.scrollToChangeWorkspaceResistanceIntensity ?? 100)
  const scrollTimeoutRef = useRef(null)
  const lastScrollTimeRef = useRef(0)
  const isMouseOverRef = useRef(false)
  const scrollAccumulatorRef = useRef(0) // For resistance scrolling

  const handleWheel = useCallback((e) => {
    // If includeWholeColumn is enabled (and speed dial is included), allow scrolling even when not directly over buttons
    const shouldAllowScroll = scrollToChangeWorkspaceIncludeSpeedDial && scrollToChangeWorkspaceIncludeWholeColumn
    if (!scrollToChangeWorkspace || !containerRef.current || items.length === 0 || (!shouldAllowScroll && !isMouseOverRef.current)) return

    // Throttle scroll events (max once per 150ms)
    const now = Date.now()
    if (now - lastScrollTimeRef.current < 150) {
      e.preventDefault()
      return
    }
    lastScrollTimeRef.current = now

    // Determine scroll direction and delta
    const deltaY = e.deltaY

    // Resistance scrolling: accumulate scroll delta before changing workspace
    if (scrollToChangeWorkspaceResistance) {
      scrollAccumulatorRef.current += Math.abs(deltaY)
      const RESISTANCE_THRESHOLD = Math.max(50, Math.min(500, scrollToChangeWorkspaceResistanceIntensity))
      if (scrollAccumulatorRef.current < RESISTANCE_THRESHOLD) {
        e.preventDefault()
        return
      }
      scrollAccumulatorRef.current = 0 // Reset accumulator
    }

    // Prevent default scroll behavior
    e.preventDefault()
    e.stopPropagation()

    // Clear any pending timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // Determine scroll direction
    const scrollDown = deltaY > 0

    // Find current workspace index
    const currentIndex = items.findIndex(ws => ws.id === activeId)
    if (currentIndex === -1) return

    // Calculate next workspace index
    let nextIndex
    if (scrollDown) {
      nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0
    } else {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1
    }

    // Change workspace immediately (no delay needed since we're throttling)
    const nextWorkspace = items[nextIndex]
    if (nextWorkspace && nextWorkspace.id !== activeId) {
      onSelect?.(nextWorkspace.id)
    }
  }, [scrollToChangeWorkspace, scrollToChangeWorkspaceIncludeSpeedDial, scrollToChangeWorkspaceIncludeWholeColumn, scrollToChangeWorkspaceResistance, scrollToChangeWorkspaceResistanceIntensity, items, activeId, onSelect])

  useEffect(() => {
    if (!scrollToChangeWorkspace || !containerRef.current) return

    const container = containerRef.current
    
    const handleMouseEnter = () => {
      isMouseOverRef.current = true
      scrollAccumulatorRef.current = 0 // Reset on mouse enter
    }
    
    const handleMouseLeave = () => {
      isMouseOverRef.current = false
      scrollAccumulatorRef.current = 0 // Reset on mouse leave
    }
    
    container.addEventListener('mouseenter', handleMouseEnter)
    container.addEventListener('mouseleave', handleMouseLeave)
    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      container.removeEventListener('mouseenter', handleMouseEnter)
      container.removeEventListener('mouseleave', handleMouseLeave)
      container.removeEventListener('wheel', handleWheel)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [scrollToChangeWorkspace, handleWheel])

  // Resolve a single header color consistent with Speed Dial logic
  const currentPath = useMemo(() => {
    try { return (window.location.pathname || '').replace(/\/+$/, '') || '/' } catch { return '/' }
  }, [])
  const headerResolver = useMemo(() => createThemeTokenResolver(settings, items, currentPath), [settings, items, currentPath])
  const headerColorForActive = useMemo(() => {
    try {
      const tokens = headerResolver.resolveTokens(activeId || null)
      return tokens?.headerColor || null
    } catch { return null }
  }, [headerResolver, activeId])
  const useHeaderColor = !!(settings?.speedDial?.matchHeaderColor && headerColorForActive)

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center"
      data-role="workspace-tabs"
      style={{ width: 40 }}
      onMouseLeave={() => onHoverChange?.(null)}
    >
      {items.map((ws, idx) => {
        const Icon = iconByName(ws.icon)
        const isDrop = dragState.dropIndex === idx && dragState.isDragging
        const isAnchored = anchoredWorkspaceId === ws.id
        const isActive = activeId === ws.id
        const blurValue = (wsButtonStyle.blur && isActive)
          ? `blur(${matchDialBlur ? dialBlurPx : 12}px)`
          : undefined
        return (
          <ContextMenu key={ws.id}>
            <ContextMenuTrigger asChild>
              <motion.button
                className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
                  (wsButtonStyle.shadow ? 'shadow-md ' : 'shadow-none ') +
                  (wsButtonStyle.background
                    ? (isActive
                      ? 'bg-white/10'
                      : 'bg-white/5 hover:bg-white/10 ')
                    : 'bg-transparent ')
                } ${isDrop ? 'scale-105' : ''}`}
                style={{
                  marginBottom: GAP,
                  backdropFilter: blurValue,
                  WebkitBackdropFilter: blurValue
                }}
                onMouseDown={(e) => onMouseDown(e, ws.id)}
                onClick={() => onSelect?.(ws.id)}
                onDoubleClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDoubleSelect?.(ws.id)
                }}
                onMouseEnter={() => onHoverChange?.(ws.id)}
                onMouseLeave={() => onHoverChange?.(null)}
                title={isAnchored ? `${ws.name} (Anchored)` : ws.name}
              >
                {(() => {
                  const active = activeId === ws.id
                  const style = useHeaderColor
                    ? { color: active ? stripAlphaFromHexLocal(headerColorForActive) : hexToRgbaLocal(headerColorForActive, 0.7) }
                    : undefined
                  const cls = useHeaderColor
                    ? 'w-5 h-5'
                    : `w-5 h-5 ${active ? 'text-white' : 'text-white/60'}`
                  return <Icon className={cls} style={style} />
                })()}
              </motion.button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() => onAnchor?.(ws.id)}
                className={isAnchored ? 'bg-white text-black font-semibold' : ''}
              >
                Anchor
              </ContextMenuItem>
              <ContextMenuItem onClick={addWorkspace}><Plus className="w-4 h-4" /> New Workspace</ContextMenuItem>
              <ContextMenuItem onClick={() => onRename?.(ws.id)}><Edit3 className="w-4 h-4" /> Rename</ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>Change Icon</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {ICON_NAMES.map(name => {
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
              <ContextMenuItem onClick={() => removeWorkspace(ws.id)} variant="destructive"><Trash2 className="w-4 h-4" /> Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}

export default memo(WorkspaceStrip)
