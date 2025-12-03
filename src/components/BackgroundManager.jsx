import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Image, X, Check, RotateCcw, Trash2 } from 'lucide-react'
import * as bgDB from '../lib/idb-backgrounds'
import * as bgServer from '../lib/background-storage'
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
  workspaceAssignmentsEnabled = true,
  selectedWorkspaceForAssignment = null
}) => {
  const isControlled = typeof open === 'boolean'
  const [internalOpen, setInternalOpen] = useState(false)
  const [uploadedBackgrounds, setUploadedBackgrounds] = useState([])
  const uploadedBackgroundsRef = useRef([])
  const [isUploading, setIsUploading] = useState(false)
  const [selectedKey, setSelectedKey] = useState(() => deriveSelectionKey(currentMeta, currentBackground))
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
                } catch { }
              }
            }
          }
          localStorage.setItem('vivaldi-migrated-backgrounds', '1')
          localStorage.removeItem('vivaldi-custom-backgrounds')
        } catch { }
      }

      uploadedBackgroundsRef.current.forEach(bg => {
        try { URL.revokeObjectURL(bg.url) } catch { }
      })

      // Try to load from server first, fallback to IndexedDB
      let list = []
      try {
        const serverList = await bgServer.tryListBackgroundsFromServer()
        if (serverList && serverList.length > 0) {
          // Convert server format to our format
          list = serverList.map(bg => ({
            id: bg.id,
            name: bg.name,
            type: bg.mime,
            size: bg.size,
            createdAt: bg.createdAt || Date.now(),
            url: bg.url,
            fromServer: true
          }))
        }
      } catch (e) {
        console.warn('Server unavailable, using IndexedDB:', e)
      }

      // If no server backgrounds, load from IndexedDB
      if (list.length === 0) {
        list = await bgDB.listBackgrounds()
      } else {
        // Merge with IndexedDB backgrounds (server takes precedence)
        const idbList = await bgDB.listBackgrounds()
        const serverIds = new Set(list.map(bg => bg.id))
        const idbOnly = idbList.filter(bg => !serverIds.has(bg.id))
        list = [...list, ...idbOnly]
      }

      uploadedBackgroundsRef.current = list
      setUploadedBackgrounds(list)
    } catch (e) {
      console.error('Failed to load backgrounds', e)
    }
  }, [])

  const applyBackground = useCallback((backgroundUrl, meta) => {
    const normalizedMeta = meta || { type: 'inline', url: backgroundUrl }
    setSelectedKey(deriveSelectionKey(normalizedMeta, backgroundUrl))
    
    // If workspace backgrounds enabled, use workspace assignment (null means Master Override)
    // Otherwise use default behavior
    if (workspaceAssignmentsEnabled && onAssignWorkspace) {
      // selectedWorkspaceForAssignment can be null (Master Override) or a workspace ID
      onAssignWorkspace(selectedWorkspaceForAssignment, backgroundUrl, normalizedMeta)
    } else {
      onBackgroundChange?.(backgroundUrl, normalizedMeta)
    }
    
    if (closeOnSelect && !embedded) {
      setOpen(false)
    }
  }, [closeOnSelect, embedded, onBackgroundChange, setOpen, workspaceAssignmentsEnabled, selectedWorkspaceForAssignment, onAssignWorkspace])

  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files[0]
    if (!file) return

    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      alert('Please select a valid image or video file (JPG, PNG, GIF, WebP, MP4, WebM)')
      return
    }

    if (file.size > 250 * 1024 * 1024) {
      const proceed = confirm('This image is very large (>250MB) and may impact performance. Continue?')
      if (!proceed) return
    }

    setIsUploading(true)

    try {
      // Try server first, fallback to IndexedDB
      let backgroundUrl = null
      let backgroundMeta = null
      
      try {
        const serverResult = await bgServer.trySaveBackgroundToServer(file, file.name)
        if (serverResult) {
          backgroundUrl = serverResult.url
          backgroundMeta = { 
            type: 'custom', 
            id: serverResult.id, 
            mime: serverResult.mime,
            url: serverResult.url,
            fromServer: true
          }
        }
      } catch (e) {
        console.warn('Server upload failed, using IndexedDB:', e)
      }

      // Fallback to IndexedDB if server unavailable
      if (!backgroundUrl) {
        const record = await bgDB.saveBackgroundFile(file)
        backgroundUrl = await bgDB.getBackgroundURLById(record.id)
        backgroundMeta = { type: 'custom', id: record.id, mime: record.type }
      }

      await loadBackgrounds()
      applyBackground(backgroundUrl, backgroundMeta)
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
      
      // Try server first if it's a server background
      if (deleted?.fromServer) {
        try {
          await bgServer.tryDeleteBackgroundFromServer(backgroundId)
        } catch (e) {
          console.warn('Server delete failed, trying IndexedDB:', e)
        }
      }
      
      // Also delete from IndexedDB (in case it exists there too)
      try {
        await bgDB.deleteBackground(backgroundId)
      } catch (e) {
        // Ignore if not in IndexedDB
      }
      
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


  const Content = (
    <>
      <div className="mb-8">
        <h3 className="text-lg font-medium text-white mb-4">Upload New Background</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/mp4,video/webm"
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
                    Supports JPG, PNG, GIF, WebP, MP4, WebM (large files allowed)
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
                className={`relative aspect-video rounded-lg overflow-hidden border-2 cursor-pointer ${selectedKey === key
                  ? 'border-cyan-400 shadow-lg shadow-cyan-400/30'
                  : 'border-white/20 hover:border-white/40'
                  }`}
                whileHover={{ scale: 1.05 }}
                onClick={() => applyBackground(bg.dataUrl, bg.meta)}
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
              const meta = { type: 'custom', id: bg.id, mime: bg.type }
              const key = deriveSelectionKey(meta, bg.url)
              return (
                <motion.div
                  key={bg.id}
                  className={`relative aspect-video rounded-lg overflow-hidden border-2 cursor-pointer group ${selectedKey === key
                    ? 'border-cyan-400 shadow-lg shadow-cyan-400/30'
                    : 'border-white/20 hover:border-white/40'
                    }`}
                  whileHover={{ scale: 1.05 }}
                  onClick={() => applyBackground(bg.url, meta)}
                >
                  {bg.type.startsWith('video/') ? (
                    <video
                      src={bg.url}
                      className="w-full h-full object-cover"
                      muted
                      loop
                      onMouseOver={e => e.target.play()}
                      onMouseOut={e => e.target.pause()}
                    />
                  ) : (
                    <img
                      src={bg.url}
                      alt={bg.name}
                      className="w-full h-full object-cover"
                    />
                  )}
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


  useEffect(() => {
    loadBackgrounds()
    return () => {
      uploadedBackgroundsRef.current.forEach(bg => {
        try { URL.revokeObjectURL(bg.url) } catch { }
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
    </>
  )
}

export default BackgroundManager
