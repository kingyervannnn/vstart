import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Image, X, Check, RotateCcw, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import * as bgDB from '../lib/idb-backgrounds'
import themeGif2 from '@/assets/theme_2.gif'
import themeGif3 from '@/assets/theme_3.gif'
import backgroundDefault from '@/assets/background.webp'
import defaultBg from '@/assets/1d24f44ca3ba213da16e8aec97ea163f.png'
import downloadBg from '@/assets/download.jpg'

const BUILTIN_BACKGROUNDS = [
  {
    id: 'default-bg',
    name: 'Default Background',
    dataUrl: defaultBg,
    meta: { type: 'builtin', id: 'default-bg', url: defaultBg }
  },
  {
    id: 'default-1',
    name: 'Cyberpunk City',
    dataUrl: themeGif2,
    meta: { type: 'builtin', id: 'default-1', url: themeGif2 }
  },
  {
    id: 'default-2',
    name: 'Matrix Rain',
    dataUrl: themeGif3,
    meta: { type: 'builtin', id: 'default-2', url: themeGif3 }
  },
  {
    id: 'default-3',
    name: 'Static Background',
    dataUrl: backgroundDefault,
    meta: { type: 'builtin', id: 'default-3', url: backgroundDefault }
  },
  {
    id: 'default-download',
    name: 'Download Background',
    dataUrl: downloadBg,
    meta: { type: 'builtin', id: 'default-download', url: downloadBg }
  }
]

const deriveSelectionKey = (meta, url) => {
  if (meta && typeof meta === 'object') {
    const type = String(meta.type || '').toLowerCase()
    if (type === 'custom' && meta.id) return `custom:${meta.id}`
    if (type === 'builtin' && meta.id) return `builtin:${meta.id}`
    if (meta.id && type) return `${type}:${meta.id}`
    if (meta.url && type) return `${type}:${meta.url}`
  }
  if (url) return `url:${url}`
  return 'none'
}

const BackgroundManager = ({
  onBackgroundChange,
  currentBackground,
  currentMeta = null,
  embedded = false,
  onClearBackground,
  clearLabel = 'Use default background',
  open,
  onOpenChange,
  hideTrigger = false,
  title = 'Background Manager',
  subtitle = 'Upload and manage custom backgrounds',
  closeOnSelect = false,
  workspaces = [],
  workspaceBackgrounds = {},
  anchoredWorkspaceId = null,
  onAssignWorkspace,
  onAssignDefault,
  workspaceAssignmentsEnabled = true
}) => {
  const isControlled = typeof open === 'boolean'
  const [internalOpen, setInternalOpen] = useState(false)
  const [uploadedBackgrounds, setUploadedBackgrounds] = useState([])
  const uploadedBackgroundsRef = useRef([])
  const [isUploading, setIsUploading] = useState(false)
  const [selectedKey, setSelectedKey] = useState(() => deriveSelectionKey(currentMeta, currentBackground))
  const [contextMenu, setContextMenu] = useState(null)
  const contextMenuRef = useRef(null)
  const fileInputRef = useRef(null)
  const assignDefault = onAssignDefault || onBackgroundChange

  const metaEquals = (a, b) => {
    if (!a || !b) return false
    if (a.type && b.type && a.type !== b.type) return false
    if (a.type === 'custom' || b.type === 'custom') {
      return a.id && b.id ? a.id === b.id : false
    }
    if (a.id && b.id) return a.id === b.id
    if (a.url && b.url) return a.url === b.url
    return false
  }

  const setOpen = useCallback((value) => {
    if (!isControlled) {
      setInternalOpen(value)
    }
    onOpenChange?.(value)
  }, [isControlled, onOpenChange])

  const showManager = isControlled ? open : internalOpen

  useEffect(() => {
    setSelectedKey(deriveSelectionKey(currentMeta, currentBackground))
  }, [currentMeta, currentBackground])

  useEffect(() => {
    if (!contextMenu) return
    if (typeof window === 'undefined') return undefined

    const handleMouseLike = (event) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(event.target)) return
      setContextMenu(null)
    }

    const handleKey = (event) => {
      if (event.key === 'Escape') setContextMenu(null)
    }

    const handleBlur = () => setContextMenu(null)

    window.addEventListener('mousedown', handleMouseLike)
    window.addEventListener('wheel', handleMouseLike, true)
    window.addEventListener('resize', handleMouseLike)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleMouseLike)
      window.removeEventListener('wheel', handleMouseLike, true)
      window.removeEventListener('resize', handleMouseLike)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!workspaceAssignmentsEnabled) {
      setContextMenu(null)
    }
  }, [workspaceAssignmentsEnabled])


  const loadBackgrounds = useCallback(async () => {
    try {
      // Migrate any legacy localStorage-stored data URLs to IndexedDB (one-time)
      const legacy = localStorage.getItem('vivaldi-custom-backgrounds')
      const migratedFlag = localStorage.getItem('vivaldi-migrated-backgrounds')
      if (legacy && !migratedFlag) {
        try {
          const items = JSON.parse(legacy)
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item?.dataUrl && item?.name && typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:')) {
                try {
                  const res = await fetch(item.dataUrl)
                  const blob = await res.blob()
                  const file = new File([blob], item.name || 'background', { type: blob.type || 'image/*' })
                  await bgDB.saveBackgroundFile(file)
                } catch {}
              }
            }
          }
          localStorage.setItem('vivaldi-migrated-backgrounds', '1')
          localStorage.removeItem('vivaldi-custom-backgrounds')
        } catch {}
      }

      uploadedBackgroundsRef.current.forEach(bg => {
        try { URL.revokeObjectURL(bg.url) } catch {}
      })

      const list = await bgDB.listBackgrounds()
      uploadedBackgroundsRef.current = list
      setUploadedBackgrounds(list)
    } catch (e) {
      console.error('Failed to load backgrounds from IndexedDB', e)
    }
  }, [])

  const applyBackground = useCallback((backgroundUrl, meta) => {
    setContextMenu(null)
    const normalizedMeta = meta || { type: 'inline', url: backgroundUrl }
    setSelectedKey(deriveSelectionKey(normalizedMeta, backgroundUrl))
    onBackgroundChange?.(backgroundUrl, normalizedMeta)
    if (closeOnSelect && !embedded) {
      setOpen(false)
    }
  }, [closeOnSelect, embedded, onBackgroundChange, setOpen])

  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file (JPG, PNG, GIF, WebP)')
      return
    }

    if (file.size > 250 * 1024 * 1024) {
      const proceed = confirm('This image is very large (>250MB) and may impact performance. Continue?')
      if (!proceed) return
    }

    setIsUploading(true)

    try {
      const record = await bgDB.saveBackgroundFile(file)
      const objectUrl = await bgDB.getBackgroundURLById(record.id)
      await loadBackgrounds()
      applyBackground(objectUrl, { type: 'custom', id: record.id })
      setIsUploading(false)
    } catch (error) {
      console.error('Upload error:', error)
      alert('Error uploading file. Please try again.')
      setIsUploading(false)
    }

    event.target.value = ''
  }, [applyBackground, loadBackgrounds])

  const deleteBackground = useCallback(async (backgroundId) => {
    try {
      const deleted = uploadedBackgroundsRef.current.find(bg => bg.id === backgroundId)
      await bgDB.deleteBackground(backgroundId)
      await loadBackgrounds()
      const deletedKey = deriveSelectionKey({ type: 'custom', id: backgroundId }, deleted?.url)
      if (deleted && selectedKey === deletedKey) {
        if (typeof onClearBackground === 'function') {
          onClearBackground()
          setSelectedKey('none')
          if (closeOnSelect && !embedded) setOpen(false)
        } else {
          const fallback = BUILTIN_BACKGROUNDS[0]
          applyBackground(fallback.dataUrl, fallback.meta)
        }
      }
      setContextMenu(null)
    } catch (e) {
      console.error('Failed to delete background', e)
    }
  }, [applyBackground, closeOnSelect, embedded, loadBackgrounds, onClearBackground, selectedKey, setOpen])

  const resetToDefault = useCallback(() => {
    const fallback = BUILTIN_BACKGROUNDS[0]
    applyBackground(fallback.dataUrl, fallback.meta)
    if (!embedded && !isControlled && closeOnSelect) {
      setOpen(false)
    }
    setContextMenu(null)
  }, [applyBackground, closeOnSelect, embedded, isControlled, setOpen])

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  const HeaderActions = useMemo(() => {
    return (
      <div className="flex items-center gap-2">
        {typeof onClearBackground === 'function' && (
          <button
            onClick={() => {
              onClearBackground()
              setSelectedKey('none')
              if (closeOnSelect && !embedded) setOpen(false)
            }}
            className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-xs text-white/80 transition-colors"
          >
            {clearLabel}
          </button>
        )}
        <button
          onClick={resetToDefault}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
          title="Reset to default background"
        >
          <RotateCcw className="w-4 h-4 text-white/70" />
        </button>
      </div>
    )
  }, [clearLabel, closeOnSelect, embedded, onClearBackground, resetToDefault, setOpen])

  const openContextMenu = useCallback((event, payload) => {
    if (!workspaceAssignmentsEnabled) return
    if (!onAssignWorkspace) return
    if (!payload?.meta || !payload?.url) return
    if (typeof window === 'undefined') return
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 240
    const optionCount = 1 + Math.max(workspaces.length, 1)
    const estimatedHeight = 56 + optionCount * 36
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const rawX = event.clientX
    const rawY = event.clientY
    const maxX = Math.max(0, viewportWidth - menuWidth - 8)
    const maxY = Math.max(0, viewportHeight - estimatedHeight - 8)
    const proposedX = rawX - menuWidth * 0.85
    const proposedY = rawY - 12
    const x = Math.min(Math.max(proposedX, 8), maxX)
    const y = Math.min(Math.max(proposedY, 8), maxY)
    setContextMenu({
      x,
      y,
      meta: payload.meta,
      url: payload.url,
      selectionKey: deriveSelectionKey(payload.meta, payload.url)
    })
  }, [workspaces.length])

  const handleAssignment = useCallback((targetId) => {
    if (!contextMenu) return
    if (targetId === '__default__') {
      if (assignDefault) {
        assignDefault(contextMenu.url, contextMenu.meta)
        setSelectedKey(contextMenu.selectionKey)
      }
    } else if (targetId && onAssignWorkspace && workspaceAssignmentsEnabled) {
      onAssignWorkspace(targetId, contextMenu.url, contextMenu.meta)
    }
    setContextMenu(null)
  }, [assignDefault, contextMenu, onAssignWorkspace, workspaceAssignmentsEnabled])

  const Content = (
    <>
      <div className="mb-8">
        <h3 className="text-lg font-medium text-white mb-4">Upload New Background</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />
        <motion.button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full p-6 border-2 border-dashed border-white/30 rounded-xl hover:border-white/50 transition-colors bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
          whileHover={{ scale: isUploading ? 1 : 1.02 }}
          whileTap={{ scale: isUploading ? 1 : 0.98 }}
        >
          <div className="flex flex-col items-center gap-3">
            {isUploading ? (
              <>
                <div className="w-8 h-8 border-2 border-white/40 border-t-white/70 rounded-full animate-spin"></div>
                <span className="text-white/80">Uploading...</span>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-white/60" />
                <div className="text-center">
                  <span className="text-white/80 font-medium">Click to upload background</span>
                  <p className="text-sm text-white/50 mt-1">
                    Supports JPG, PNG, GIF, WebP (large files allowed)
                  </p>
                </div>
              </>
            )}
          </div>
        </motion.button>
      </div>

      <div className="mb-8">
        <h3 className="text-lg font-medium text-white mb-4">Default Backgrounds</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {BUILTIN_BACKGROUNDS.map((bg) => {
            const key = deriveSelectionKey(bg.meta, bg.dataUrl)
            return (
              <motion.div
                key={bg.id}
                className={`relative aspect-video rounded-lg overflow-hidden border-2 cursor-pointer ${
                  selectedKey === key
                    ? 'border-cyan-400 shadow-lg shadow-cyan-400/30'
                    : 'border-white/20 hover:border-white/40'
                }`}
                whileHover={{ scale: 1.05 }}
                onClick={() => applyBackground(bg.dataUrl, bg.meta)}
                onContextMenu={(e) => openContextMenu(e, { meta: bg.meta, url: bg.dataUrl })}
              >
                <img
                  src={bg.dataUrl}
                  alt={bg.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/40 flex items-end">
                  <div className="p-3 w-full">
                    <p className="text-white text-sm font-medium">{bg.name}</p>
                  </div>
                </div>
                {selectedKey === key && (
                  <div className="absolute top-2 right-2 bg-cyan-400 rounded-full p-1">
                    <Check className="w-3 h-3 text-black" />
                  </div>
                )}
              </motion.div>
            )
          })}
        </div>
      </div>

      {uploadedBackgrounds.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-white mb-4">Custom Backgrounds</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {uploadedBackgrounds.map((bg) => {
              const meta = { type: 'custom', id: bg.id }
              const key = deriveSelectionKey(meta, bg.url)
              return (
                <motion.div
                  key={bg.id}
                  className={`relative aspect-video rounded-lg overflow-hidden border-2 cursor-pointer group ${
                    selectedKey === key
                      ? 'border-cyan-400 shadow-lg shadow-cyan-400/30'
                      : 'border-white/20 hover:border-white/40'
                  }`}
                  whileHover={{ scale: 1.05 }}
                  onClick={() => applyBackground(bg.url, meta)}
                  onContextMenu={(e) => openContextMenu(e, { meta, url: bg.url })}
                >
                  <img
                    src={bg.url}
                    alt={bg.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-end">
                    <div className="p-3 w-full">
                      <p className="text-white text-sm font-medium truncate">{bg.name}</p>
                      <p className="text-white/60 text-xs">{formatFileSize(bg.size)}</p>
                    </div>
                  </div>
                  {selectedKey === key && (
                    <div className="absolute top-2 right-2 bg-cyan-400 rounded-full p-1">
                      <Check className="w-3 h-3 text-black" />
                    </div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteBackground(bg.id)
                    }}
                    className="absolute top-2 left-2 bg-red-500/90 hover:bg-red-600 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete background"
                  >
                    <Trash2 className="w-3 h-3 text-white" />
                  </button>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )

  const contextMenuNode = useMemo(() => {
    if (!contextMenu) return null
    if (typeof document === 'undefined') return null
    return createPortal(
      <div
        className="fixed z-[22000]"
        style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
      >
        <div
          ref={contextMenuRef}
          className="bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl min-w-[220px] overflow-hidden"
        >
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-white/40">Assign Background</div>
          <button
            type="button"
            onClick={() => handleAssignment('__default__')}
            disabled={!assignDefault}
            className={`flex w-full items-center justify-between px-3 py-2 text-sm text-left transition-colors ${assignDefault ? 'text-white/80 hover:bg-white/10' : 'text-white/30 cursor-not-allowed'} ${selectedKey === contextMenu.selectionKey ? 'bg-white/15 text-white' : ''}`}
          >
            <span>Default</span>
            {selectedKey === contextMenu.selectionKey && <Check className="w-4 h-4 text-cyan-400" />}
          </button>
          {workspaces.length > 0 ? (
            <>
              <div className="border-t border-white/10 my-1" />
              {workspaces.map((ws) => {
                const assignedMeta = workspaceBackgrounds?.[ws.id]?.meta
                const isActive = assignedMeta && contextMenu.meta && metaEquals(assignedMeta, contextMenu.meta)
                const isAnchoredWs = !!anchoredWorkspaceId && anchoredWorkspaceId === ws.id
                const disabled = isAnchoredWs || !onAssignWorkspace
                return (
                  <button
                    key={ws.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => !disabled && handleAssignment(ws.id)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-sm text-left transition-colors ${disabled ? 'text-white/30 cursor-not-allowed' : 'text-white/80 hover:bg-white/10'} ${isActive ? 'bg-white/15 text-white' : ''}`}
                  >
                    <span>
                      {ws.name || 'Workspace'}
                      {isAnchoredWs ? ' (anchored)' : ''}
                    </span>
                    {isActive && <Check className="w-4 h-4 text-cyan-400" />}
                  </button>
                )
              })}
            </>
          ) : (
            <div className="px-3 py-2 text-xs text-white/40">No workspaces available.</div>
          )}
        </div>
      </div>,
      document.body
    )
  }, [contextMenu, assignDefault, handleAssignment, workspaces, workspaceBackgrounds, anchoredWorkspaceId, metaEquals, selectedKey, onAssignWorkspace])

  useEffect(() => {
    loadBackgrounds()
    return () => {
      uploadedBackgroundsRef.current.forEach(bg => {
        try { URL.revokeObjectURL(bg.url) } catch {}
      })
    }
  }, [loadBackgrounds])

  if (embedded) {
    return (
      <>
        <div className="space-y-6 no-scrollbar">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">{title}</h2>
              <p className="text-sm text-white/60 mt-1">{subtitle}</p>
            </div>
            {HeaderActions}
          </div>
          <div className="overflow-y-auto max-h-[60vh] pr-1 no-scrollbar">
            {Content}
          </div>
        </div>
        {contextMenuNode}
      </>
    )
  }

  return (
    <>
      {!hideTrigger && (
        <motion.button
          onClick={() => setOpen(true)}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full border border-white/20 transition-colors backdrop-blur-sm"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title="Manage backgrounds"
        >
          <Image className="w-5 h-5 text-white/80" />
        </motion.button>
      )}

      <AnimatePresence>
        {showManager && (
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="bg-black/90 backdrop-blur-md rounded-xl border border-white/20 max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center p-6 border-b border-white/10">
                <div>
                  <h2 className="text-xl font-semibold text-white">{title}</h2>
                  <p className="text-sm text-white/60 mt-1">{subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  {HeaderActions}
                  <button
                    onClick={() => setOpen(false)}
                    className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-white/80" />
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto max-h-[60vh] no-scrollbar pr-1">
                {Content}
              </div>

              <div className="p-6 border-t border-white/10 bg-black/60">
                <div className="flex justify-between items-center text-white/60 text-sm">
                  <span>{uploadedBackgrounds.length} custom background{uploadedBackgrounds.length === 1 ? '' : 's'} uploaded</span>
                  <button
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 rounded-lg text-white font-medium transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {contextMenuNode}
    </>
  )
}

export default BackgroundManager
