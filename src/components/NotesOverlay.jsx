import { useMemo, useState } from 'react'
import {
  StickyNote,
  X,
  ArrowDownLeft,
  Layers,
  Home,
  Grid2X2,
  AppWindow,
  LayoutList,
  Mail
} from 'lucide-react'
import EmailList from './EmailList'

const ICON_MAP = { Home, Layers, Grid2X2, AppWindow, LayoutList }

const sanitizeHex = (hex, fallback = '#ffffff') => {
  if (!hex || typeof hex !== 'string') return fallback
  const clean = hex.trim()
  if (!clean.startsWith('#')) return clean
  const body = clean.slice(1)
  if (body.length >= 6) return `#${body.slice(0, 6)}`
  return fallback
}

const formatStamp = (value) => {
  if (!value) return 'Just now'
  try {
    const date = typeof value === 'number' ? new Date(value) : new Date(String(value))
    if (Number.isNaN(date.getTime())) return 'Just now'
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  } catch {
    return 'Just now'
  }
}

const NotesOverlay = ({
  settings = {},
  note,
  draftValue = '',
  onDraftChange,
  onTitleChange,
  onClose,
  onPopInline,
  workspaces = [],
  workspaceMeta = {},
  noteWorkspaceId = null,
  onAssignWorkspace,
  maxLength = 1200,

  previewMode = false,
  emailAccounts = [],
  activeEmailAccount = null,
  onComposeEmail
}) => {
  const [mode, setMode] = useState('notes') // 'notes' | 'email'
  const colorAccent = useMemo(
    () => sanitizeHex(settings.colorAccent, '#00ffff'),
    [settings.colorAccent]
  )
  const workspaceInfo = workspaceMeta?.[noteWorkspaceId] || null
  const workspaceColor = workspaceInfo?.color || '#ffffff'
  const workspaceName = workspaceInfo?.name || 'Unassigned'
  const IconComp = workspaceInfo?.icon && ICON_MAP[workspaceInfo.icon] ? ICON_MAP[workspaceInfo.icon] : null

  return (
    <div
      className="rounded-[32px] border border-white/10 bg-black/80 backdrop-blur-3xl shadow-2xl text-white p-8 space-y-6 animate-in fade-in zoom-in-95 duration-300"
      style={{
        opacity: previewMode ? 0.65 : 1,
        pointerEvents: previewMode ? 'none' : 'auto'
      }}
    >

      <div className="flex items-start justify-between gap-6">
        <div className="space-y-2 flex-1 min-w-0">
          <div
            className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/50 font-medium cursor-pointer hover:text-white/80 transition-colors select-none"
            onClick={() => setMode(prev => prev === 'notes' ? 'email' : 'notes')}
          >
            {mode === 'email' ? (
              <>
                <Mail size={14} color={colorAccent} strokeWidth={2} />
                <span>Email Client</span>
              </>
            ) : (
              <>
                <StickyNote size={14} color={colorAccent} strokeWidth={2} />
                <span>Center Note</span>
              </>
            )}
          </div>
          {mode === 'notes' && !previewMode ? (
            <input
              type="text"
              value={note?.title || ''}
              onChange={(e) => onTitleChange?.(note?.id, e.target.value)}
              className="w-full bg-transparent border-none text-2xl font-bold leading-tight tracking-tight truncate pr-4 focus:outline-none"
              placeholder="Untitled note"
            />
          ) : (
            <div
              className="text-2xl font-bold leading-tight tracking-tight truncate pr-4 cursor-pointer"
              onDoubleClick={() => setMode(prev => prev === 'notes' ? 'email' : 'notes')}
            >
              {mode === 'email' ? 'Inbox' : (note?.title?.trim() || 'Untitled note')}
            </div>
          )}
          {mode === 'notes' && (
            <div className="flex items-center gap-3 text-[11px] text-white/50">
              <span>{formatStamp(note?.updatedAt)}</span>
              <div className="w-px h-3 bg-white/10" />
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shadow-[0_0_6px_rgba(255,255,255,0.4)]" style={{ backgroundColor: workspaceColor }} />
                {IconComp && <IconComp size={11} color={workspaceColor} />}
                <span style={{ color: workspaceColor }} className="font-medium opacity-90">{workspaceName}</span>
              </div>
            </div>
          )}
        </div>
        {!previewMode && (
          <div className="flex items-center gap-2 shrink-0">
            {typeof onPopInline === 'function' && (
              <button
                type="button"
                onClick={onPopInline}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-[11px] font-medium text-white/70 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all"
              >
                <ArrowDownLeft size={13} />
                Inline
              </button>
            )}
            {typeof onClose === 'function' && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 p-2.5 text-white/60 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all"
                aria-label="Close notes overlay"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
      </div>

      {mode === 'email' ? (
        <div className="h-[50vh] min-h-[300px]">
          <EmailList
            settings={settings}
            accounts={emailAccounts}
            activeAccount={activeEmailAccount}
            onCompose={onComposeEmail}
            className="h-full"
          />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-[11px] text-white/50 gap-3 bg-white/5 rounded-xl p-2 px-3 border border-white/5">
            <span className="uppercase tracking-wider text-[10px] font-medium opacity-70">Workspace</span>
            <select
              value={noteWorkspaceId || ''}
              onChange={(e) => onAssignWorkspace?.(note?.id, e.target.value || null)}
              disabled={previewMode}
              className={`flex-1 bg-transparent border-none text-right text-white/90 focus:outline-none ${previewMode ? 'cursor-default opacity-70' : 'cursor-pointer hover:text-white'} transition-colors font-medium`}
            >
              <option value="">None</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name || ws.id}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 focus-within:bg-black/50 focus-within:border-white/20 transition-all overflow-hidden relative group">
            <textarea
              value={draftValue}
              onChange={(e) => onDraftChange?.(e.target.value)}
              spellCheck={false}
              maxLength={maxLength}
              readOnly={previewMode}
              className={`w-full h-[50vh] min-h-[300px] bg-transparent p-6 text-[15px] text-white/90 leading-relaxed resize-none focus:outline-none placeholder:text-white/20 font-light tracking-wide ${previewMode ? 'opacity-80 pointer-events-none' : ''}`}
              placeholder="Write your note…"
              autoFocus={!previewMode}
            />
            <div className="absolute bottom-4 right-5 text-[10px] text-white/20 pointer-events-none group-focus-within:text-white/40 transition-colors">
              {(draftValue || '').length}/{maxLength}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default NotesOverlay
