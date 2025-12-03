import React, { useMemo, useState, useRef, useLayoutEffect } from 'react'
import { Mail, RefreshCw, Pin, PinOff } from 'lucide-react'
import EmailList from './EmailList'

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

const EmailWidget = ({
  settings = {},
  emailAccounts = [],
  onComposeEmail,
  onRefreshEmails,
  onPromoteEmailToCenter,
  emailsCenterOpen = false,
  onEmailClick = null,
  filterMode = 'all',
  filterWorkspaceId = null,
  onChangeFilter,
  workspaces = [],
  currentWorkspaceId = null,
  className = '',
  onWidgetAlternatorToggle = null,
  widgetAlternatorMode = 'none',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [availableHeight, setAvailableHeight] = useState(null)
  const containerRef = useRef(null)

  const colorPrimary = useMemo(
    () => sanitizeHex(settings.colorPrimary, '#ffffff'),
    [settings.colorPrimary]
  )
  const colorAccent = useMemo(
    () => sanitizeHex(settings.colorAccent, '#00ffff'),
    [settings.colorAccent]
  )
  const glowColorForShadow = useMemo(
    () => sanitizeHex(settings.glowColor || settings.colorAccent, '#00ffff66'),
    [settings.glowColor, settings.colorAccent]
  )
  const removeBackgrounds = settings?.notesRemoveBackground !== false
  const removeOutlines = settings?.notesRemoveOutline !== false
  const glowShadow = settings?.notesGlowShadow !== false
  const blurEnabled = settings?.notesBlurEnabled !== false
  const manualBlur = Number.isFinite(Number(settings?.notesBlurPx))
    ? Math.max(0, Math.min(40, Number(settings.notesBlurPx)))
    : 18
  const blurPx = blurEnabled ? manualBlur : 0
  const accentGlow = hexToRgba(glowColorForShadow, 0.55)
  const effectiveCollapsed = isPinned ? false : isCollapsed

  // Measure available space
  useLayoutEffect(() => {
    if (effectiveCollapsed || !containerRef.current) {
      setAvailableHeight(null)
      return
    }
    const updateHeight = () => {
      const node = containerRef.current?.parentElement
      if (!node) return
      const rect = node.getBoundingClientRect()
      const computed = window.getComputedStyle(node)
      const padding = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom)
      setAvailableHeight(Math.max(200, rect.height - padding - 60))
    }
    updateHeight()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateHeight)
      observer.observe(containerRef.current.parentElement)
      return () => observer.disconnect()
    }
  }, [effectiveCollapsed])

  const handleHeaderClick = () => {
    if (isPinned) {
      setIsPinned(false)
    } else {
      setIsCollapsed(prev => !prev)
    }
  }

  const handlePinToggle = (e) => {
    e.stopPropagation()
    setIsPinned(prev => !prev)
    if (!isPinned) {
      setIsCollapsed(false)
    }
  }

  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId) || null
  const filterValue = filterMode === 'perWorkspace' ? 'perWorkspace' 
    : filterMode === 'manual' && filterWorkspaceId ? `ws:${filterWorkspaceId}`
    : 'all'

  const handleFilterSelect = (value) => {
    if (value === 'all') onChangeFilter?.('all')
    else if (value === 'perWorkspace') onChangeFilter?.('perWorkspace')
    else if (value.startsWith('ws:')) onChangeFilter?.('manual', value.slice(3))
  }

  return (
    <div
      ref={containerRef}
      className={`rounded-lg border transition-all duration-300 ${className}`}
      style={{
        borderColor: removeOutlines ? 'transparent' : hexToRgba(colorPrimary, 0.2),
        backgroundColor: removeBackgrounds ? 'transparent' : hexToRgba(colorPrimary, 0.05),
        backdropFilter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
        boxShadow: (!glowShadow || effectiveCollapsed) ? 'none' : `0 22px 55px -35px ${accentGlow}`,
      }}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between gap-2 h-7 px-2 cursor-pointer`}
        onDoubleClick={(e) => {
          if (e.target.closest('button')) return
          e.preventDefault()
          e.stopPropagation()
          // If alternator mode is active, use alternator toggle
          if (onWidgetAlternatorToggle && widgetAlternatorMode !== 'none') {
            onWidgetAlternatorToggle()
            return
          }
          // Otherwise, toggle pin
          handlePinToggle(e)
        }}
        onClick={handleHeaderClick}
        title={onWidgetAlternatorToggle && widgetAlternatorMode !== 'none' ? 'Double-click to toggle widgets' : (isPinned ? 'Double-click to unpin email list' : 'Double-click to pin email list')}
      >
        <div className="flex items-center gap-2 overflow-hidden min-w-0">
          <div 
            className={`flex items-center justify-center w-6 h-6 rounded-md bg-white/5 text-white/80 shrink-0 ${onWidgetAlternatorToggle && widgetAlternatorMode !== 'none' ? 'cursor-pointer hover:bg-white/10 transition-colors' : ''}`}
            onClick={(e) => {
              if (onWidgetAlternatorToggle && widgetAlternatorMode !== 'none') {
                e.stopPropagation()
                onWidgetAlternatorToggle()
              }
            }}
          >
            <Mail size={13} color={colorAccent} strokeWidth={2} />
          </div>
          <div className="flex items-center gap-2 min-w-0">
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
                      {ws.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handlePinToggle}
            className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title={isPinned ? 'Unpin' : 'Pin'}
          >
            {isPinned ? (
              <PinOff size={12} strokeWidth={2} />
            ) : (
              <Pin size={12} strokeWidth={2} />
            )}
          </button>
          {onRefreshEmails && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRefreshEmails()
              }}
              className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="Refresh emails"
            >
              <RefreshCw size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      {!effectiveCollapsed && (
        <div
          className={`mt-2 flex flex-col transition-all duration-300 ${effectiveCollapsed ? 'max-h-0 opacity-0 overflow-hidden mt-0' : 'min-h-[200px] opacity-100'}`}
          style={effectiveCollapsed ? {} : {
            maxHeight: availableHeight 
              ? `${Math.min(availableHeight - 120, Math.max(300, 480))}px`
              : '480px',
            overflow: 'visible',
            minHeight: 0
          }}
        >
          <EmailList
            onEmailClick={onEmailClick}
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
      )}
    </div>
  )
}

export default EmailWidget

