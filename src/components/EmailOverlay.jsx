import React, { useState, useMemo, useRef, useEffect } from 'react'
import { X, Mail, Mic, Bot, Search, PenSquare, ChevronLeft } from 'lucide-react'
import EmailList from './EmailList'
import EmailCompose from './EmailCompose'

const EmailOverlay = ({
  settings = {},
  onClose,
  emailAccounts = [],
  workspaces = [],
  currentWorkspaceId = null,
  currentWorkspace = null,
  filterMode = 'all',
  filterWorkspaceId = null,
  onChangeFilter,
  onComposeEmail,
  onRefreshEmails,
  selectedEmailId = null,
  selectedEmailAccount = null
}) => {
  const colorAccent = settings?.colorAccent || '#00ffff'
  const [searchQuery, setSearchQuery] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [selectedEmailIdState, setSelectedEmailIdState] = useState(selectedEmailId || null)
  const [expandedEmail, setExpandedEmail] = useState(null)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [replyToEmail, setReplyToEmail] = useState(null)
  const searchInputRef = useRef(null)

  // Get search bar styling from settings
  const searchBarBlurPx = settings?.search?.blurPx || 18
  const searchBarTransparent = settings?.search?.transparent !== false
  const searchBarOutline = settings?.search?.outline !== false
  const searchBarShadow = settings?.search?.shadow !== false
  
  // Get shared center content appearance settings
  const removeBackgrounds = settings?.notesRemoveBackground !== false
  const removeOutlines = settings?.notesRemoveOutline !== false
  const glowShadow = settings?.notesGlowShadow !== false
  const blurEnabled = settings?.notesBlurEnabled !== false
  const manualBlur = Number.isFinite(Number(settings?.notesBlurPx))
    ? Math.max(0, Math.min(40, Number(settings.notesBlurPx)))
    : 18
  const blurPx = blurEnabled ? manualBlur : 0
  // Use resolved glow color (workspace-specific or default)
  const glowColorForShadow = settings?.glowColor || settings?.colorAccent || '#00ffff66'
  const accentGlow = (() => {
    try {
      const hex = String(glowColorForShadow).trim()
      const clean = hex.startsWith('#') ? hex.slice(1) : hex
      if (clean.length >= 6) {
        const r = parseInt(clean.slice(0, 2), 16)
        const g = parseInt(clean.slice(2, 4), 16)
        const b = parseInt(clean.slice(4, 6), 16)
        return `rgba(${r}, ${g}, ${b}, 0.55)`
      }
    } catch {}
    return 'rgba(0, 255, 255, 0.55)'
  })()

  // Mock voice search handler (visual only for now)
  const handleVoiceSearch = () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Voice search is not available in your browser')
      return
    }
    setIsRecording(true)
    // Visual feedback only - actual transcription would require backend
    setTimeout(() => {
      setIsRecording(false)
      setSearchQuery('Search query from voice...')
    }, 2000)
  }

  // Highlight matching text in email content
  const highlightText = (text, query) => {
    if (!query || !text) return text
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((part, i) => 
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} style={{ backgroundColor: colorAccent + '40', color: '#fff', padding: '0 2px', borderRadius: '2px' }}>
          {part}
        </mark>
      ) : part
    )
  }

  // Sync selectedEmailId prop with state
  useEffect(() => {
    if (selectedEmailId && selectedEmailAccount) {
      handleEmailClick(selectedEmailId, selectedEmailAccount)
    } else if (!selectedEmailId) {
      setExpandedEmail(null)
      setSelectedEmailIdState(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmailId, selectedEmailAccount])

  // Fetch full email content when clicked
  const handleEmailClick = async (emailId, accountEmail) => {
    if (!emailId) {
      setExpandedEmail(null)
      setSelectedEmailIdState(null)
      return
    }

    if (expandedEmail?.id === emailId) {
      // Already expanded, just toggle
      setExpandedEmail(null)
      setSelectedEmailIdState(null)
      return
    }

    setSelectedEmailIdState(emailId)
    setLoadingEmail(true)

    try {
      let base = ''
      try {
        const env = typeof import.meta !== 'undefined' ? import.meta.env || {} : {}
        base = env.VITE_GMAIL_API_BASE_URL || env.VITE_API_BASE_URL || ''
        base = String(base || '').replace(/\/+$/, '')
      } catch {
        base = ''
      }

      const url = `${base}/gmail/message/${encodeURIComponent(emailId)}?email=${encodeURIComponent(accountEmail)}`
      const resp = await fetch(url)
      
      if (!resp.ok) {
        throw new Error(`Failed to fetch email: ${resp.status}`)
      }

      const data = await resp.json()
      setExpandedEmail(data)
    } catch (e) {
      console.error('Failed to fetch email content:', e)
      alert(`Failed to load email: ${e.message}`)
      setSelectedEmailIdState(null)
    } finally {
      setLoadingEmail(false)
    }
  }

  return (
    <div
      className="rounded-[32px] text-white animate-in fade-in zoom-in-95 duration-300 w-full flex flex-col"
      style={{
        maxHeight: '70vh',
        height: '70vh',
        marginTop: '6rem',
        marginBottom: '4rem',
        border: removeOutlines ? 'none' : '1px solid rgba(255,255,255,0.1)',
        backgroundColor: removeBackgrounds ? 'transparent' : 'rgba(0,0,0,0.9)',
        backdropFilter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
        boxShadow: (!glowShadow) ? 'none' : `0 22px 55px -35px ${accentGlow}`,
      }}
    >
      {/* Header with Workspace Selector and Search Bar */}
      <div className="flex flex-col border-b border-white/10 flex-shrink-0">
        {/* Top row: Workspace selector and action buttons */}
        <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
          <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
            <Mail size={20} color={colorAccent} strokeWidth={2} className="shrink-0" />
            <div className="flex items-center min-w-0">
              <select
                value={(() => {
                  if (filterMode === 'perWorkspace') return 'perWorkspace'
                  if (filterMode === 'none') return 'none'
                  if (filterMode === 'manual' && filterWorkspaceId) return `ws:${filterWorkspaceId}`
                  return 'all'
                })()}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === 'all') onChangeFilter?.('all')
                  else if (value === 'perWorkspace') onChangeFilter?.('perWorkspace')
                  else if (value === 'none') onChangeFilter?.('none')
                  else if (value.startsWith('ws:')) onChangeFilter?.('manual', value.slice(3))
                }}
                className="bg-transparent border-none p-0 text-lg font-semibold text-white focus:outline-none cursor-pointer hover:text-white/90 transition-colors max-w-full truncate appearance-none"
                title="Filter emails by workspace"
              >
                <option value="all">All Emails</option>
                <option value="perWorkspace">
                  {currentWorkspace ? currentWorkspace.name : (currentWorkspaceId ? workspaces.find(w => w.id === currentWorkspaceId)?.name || 'Current Workspace' : 'Current Workspace')}
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
              <div className="pointer-events-none text-white/40 ml-1 shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowCompose(true)
                setReplyToEmail(null)
                if (onComposeEmail) onComposeEmail()
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 transition-colors shrink-0"
              title="Compose email"
            >
              <PenSquare size={16} />
              <span className="text-sm font-medium">Compose</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors shrink-0"
              title="Close email client"
            >
              <X size={18} className="text-white/70" />
            </button>
          </div>
        </div>
        
        {/* Search Bar in header (hidden when composing) */}
        {!showCompose && (
          <div className="px-6 pb-4 flex-shrink-0">
            <div
              className={`
                relative ${searchBarTransparent ? 'bg-transparent' : 'bg-black/20'} rounded-xl transition-all duration-300
                ${searchBarOutline ? 'border-2 border-white/20' : 'border-0'}
                ${searchBarShadow ? 'shadow-lg' : ''}
                ${searchQuery ? 'border-cyan-400/50 shadow-cyan-500/20' : ''}
              `}
              style={{
                backdropFilter: `blur(${searchBarBlurPx}px)`,
                WebkitBackdropFilter: `blur(${searchBarBlurPx}px)`,
              }}
            >
              <div className="flex items-center gap-2 px-4 py-3">
                <Search size={18} className="text-white/60 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search emails..."
                  className="flex-1 bg-transparent text-white outline-none text-sm placeholder-white/50"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="p-1 text-white/60 hover:text-white transition-colors shrink-0"
                  >
                    <X size={16} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleVoiceSearch}
                  className={`p-1.5 rounded transition-colors shrink-0 ${
                    isRecording 
                      ? 'text-red-400 hover:text-red-300' 
                      : 'text-white/60 hover:text-white'
                  }`}
                  title="Voice search"
                >
                  <Mic size={18} />
                </button>
                <button
                  type="button"
                  className="p-1.5 text-white/60 hover:text-white transition-colors shrink-0"
                  title="AI search (coming soon)"
                >
                  <Bot size={18} />
                </button>
              </div>
              {isRecording && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-red-400/50 animate-pulse" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Email List, Expanded Email View, or Compose */}
      <div className="flex-1 min-h-0 overflow-hidden px-6 pb-6">
        {showCompose ? (
          <EmailCompose
            settings={settings}
            emailAccounts={emailAccounts}
            onClose={() => {
              setShowCompose(false)
              setReplyToEmail(null)
            }}
            onSend={(result) => {
              console.log('Email sent:', result)
              setShowCompose(false)
              setReplyToEmail(null)
              if (onRefreshEmails) {
                // Refresh email list after sending
                setTimeout(() => onRefreshEmails(), 1000)
              }
            }}
            replyToEmail={replyToEmail}
          />
        ) : expandedEmail ? (
          <div className="h-full flex flex-col bg-black/40 rounded-xl border border-white/10 p-6 overflow-y-auto">
            {/* Back button */}
            <button
              type="button"
              onClick={() => {
                setExpandedEmail(null)
                setSelectedEmailIdState(null)
                if (onClose) onClose()
              }}
              className="flex items-center gap-2 mb-4 text-white/70 hover:text-white transition-colors"
            >
              <ChevronLeft size={18} />
              <span className="text-sm">Back to list</span>
            </button>

            {/* Email header */}
            <div className="border-b border-white/10 pb-4 mb-4">
              <h1 className="text-xl font-semibold text-white mb-2">{expandedEmail.subject}</h1>
              <div className="space-y-1 text-sm text-white/70">
                <div><strong>From:</strong> {expandedEmail.sender}</div>
                {expandedEmail.to && <div><strong>To:</strong> {expandedEmail.to}</div>}
                {expandedEmail.cc && <div><strong>Cc:</strong> {expandedEmail.cc}</div>}
                {expandedEmail.date && <div><strong>Date:</strong> {expandedEmail.date}</div>}
              </div>
            </div>

            {/* Email body */}
            <div className="flex-1 overflow-y-auto">
              {loadingEmail ? (
                <div className="flex items-center justify-center py-12 text-white/50">
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span className="ml-3">Loading email...</span>
                </div>
              ) : (
                <div className="prose prose-invert prose-sm max-w-none">
                  {expandedEmail.htmlBody ? (
                    <div 
                      dangerouslySetInnerHTML={{ __html: expandedEmail.htmlBody }} 
                      className="email-body-html"
                      style={{
                        color: '#ffffff',
                        lineHeight: '1.6'
                      }}
                    />
                  ) : (
                    <div 
                      className="whitespace-pre-wrap text-white/90"
                      style={{ lineHeight: '1.6' }}
                    >
                      {expandedEmail.body || expandedEmail.textBody || expandedEmail.snippet || 'No content available'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmailList
            settings={settings}
            accounts={emailAccounts}
            onCompose={onComposeEmail}
            filterMode={filterMode}
            filterWorkspaceId={filterWorkspaceId}
            onChangeFilter={onChangeFilter}
            workspaces={workspaces}
            currentWorkspaceId={currentWorkspaceId}
            onRefresh={onRefreshEmails}
            searchQuery={searchQuery}
            highlightText={highlightText}
            selectedEmailId={selectedEmailIdState}
            onEmailClick={handleEmailClick}
          />
        )}
      </div>
    </div>
  )
}

export default EmailOverlay
