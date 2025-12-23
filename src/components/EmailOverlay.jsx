import React, { useState, useRef, useEffect, useMemo } from 'react'
import { X, Mail, Search, PenSquare, ChevronLeft, Trash2, Archive, Reply, CornerUpRight, Star, RefreshCw, Inbox, Send, ShieldAlert } from 'lucide-react'
import EmailList from './EmailList'
import EmailCompose from './EmailCompose'

const sanitizeEmailHtml = (rawHtml) => {
  if (!rawHtml) return ''
  const html = String(rawHtml)
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<(?:link|meta|base|title|iframe|object|embed)\b[^>]*\/?>/gi, '')
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc
      .querySelectorAll(
        'script, style, link[rel="stylesheet"], meta, base, title, iframe, object, embed'
      )
      .forEach((el) => el.remove())
    doc.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes || [])) {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
      }
    })
    return doc.body?.innerHTML || ''
  } catch {
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<(?:link|meta|base|title|iframe|object|embed)\b[^>]*\/?>/gi, '')
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  }
}

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
  selectedEmailAccount = null,
  previewMode = false,
  panelWidth = "var(--center-column-width, 100%)",
  panelMaxWidth = "var(--center-column-max-width, 1200px)",
  panelHeight = "calc(100vh - 6rem - env(safe-area-inset-bottom))",
}) => {
  const colorAccent = settings?.colorAccent || '#00ffff'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEmailIdState, setSelectedEmailIdState] = useState(selectedEmailId || null)
  const [expandedEmail, setExpandedEmail] = useState(null)
  const [expandedEmailAccount, setExpandedEmailAccount] = useState(null)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [replyToEmail, setReplyToEmail] = useState(null)
  const [composeDraft, setComposeDraft] = useState(null)
  const [listReloadKey, setListReloadKey] = useState(0)
  const [actionBusy, setActionBusy] = useState(false)
  const [mailbox, setMailbox] = useState('INBOX')
  const searchInputRef = useRef(null)
  const overlayContainerRef = useRef(null)
  const scrollHostRef = useRef(null)

  const sanitizedHtmlBody = useMemo(() => {
    const raw = expandedEmail?.htmlBody
    if (!raw) return ''
    return sanitizeEmailHtml(raw)
  }, [expandedEmail?.htmlBody])

  // Get search bar styling from settings
  const searchBarBlurPx = settings?.search?.blurPx || 18
  const searchBarTransparent = settings?.search?.transparent !== false
  const searchBarOutline = settings?.search?.outline !== false
  const searchBarShadow = settings?.search?.shadow !== false

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

  // Keep the internal scroll host aligned without moving the page itself
  useEffect(() => {
    if (previewMode) return
    requestAnimationFrame(() => {
      const host = scrollHostRef.current
      if (!host) return
      if (typeof host.scrollTo === 'function') {
        host.scrollTo({ top: 0, behavior: 'auto' })
      } else {
        host.scrollTop = 0
      }
    })
  }, [expandedEmail, showCompose, previewMode])

  // Sync selectedEmailId prop with state
  useEffect(() => {
    if (selectedEmailId && selectedEmailAccount) {
      handleEmailClick(selectedEmailId, selectedEmailAccount)
    } else {
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
      setExpandedEmailAccount(null)
      return
    }

    setSelectedEmailIdState(emailId)
    setExpandedEmailAccount(accountEmail || null)
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

  const getApiBase = () => {
    try {
      const env = typeof import.meta !== 'undefined' ? import.meta.env || {} : {}
      let base = env.VITE_GMAIL_API_BASE_URL || env.VITE_API_BASE_URL || ''
      base = String(base || '').replace(/\/+$/, '')
      if (!base) {
        const host =
          typeof window !== 'undefined' && window.location
            ? String(window.location.hostname || '')
            : ''
        const isLocal =
          host === 'localhost' ||
          host === '127.0.0.1' ||
          host === '[::1]' ||
          host.endsWith('.local')
        if (isLocal || !host) return 'http://127.0.0.1:3500'
      }
      return base
    } catch {
      return ''
    }
  }

  const callMessageAction = async ({ accountEmail, messageId, action, body }) => {
    const base = getApiBase()
    const url = `${base}/gmail/message/${encodeURIComponent(messageId)}/${action}?email=${encodeURIComponent(accountEmail)}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      throw new Error(data.error || `Failed to ${action} email`)
    }
    return data
  }

  const fetchFullEmail = async (emailId, accountEmail) => {
    if (!emailId || !accountEmail) return null
    const base = getApiBase()
    const url = `${base}/gmail/message/${encodeURIComponent(emailId)}?email=${encodeURIComponent(accountEmail)}`
    const resp = await fetch(url)
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}))
      throw new Error(errJson.error || `Failed to fetch email: ${resp.status}`)
    }
    return await resp.json()
  }

  const replyFromList = async (emailId, accountEmail) => {
    if (!emailId || !accountEmail) return
    setActionBusy(true)
    try {
      const full = await fetchFullEmail(emailId, accountEmail)
      setExpandedEmail(null)
      setSelectedEmailIdState(null)
      setExpandedEmailAccount(null)
      setComposeDraft({ fromEmail: accountEmail })
      setReplyToEmail(full)
      setShowCompose(true)
    } catch (e) {
      const msg = String(e?.message || '')
      if (/insufficient authentication scopes/i.test(msg) || /insufficient.*scopes/i.test(msg)) {
        alert('Gmail permissions are missing (need gmail.modify). Remove the account and sign in again.')
      } else {
        alert(msg || 'Failed to start reply')
      }
    } finally {
      setActionBusy(false)
    }
  }

  const resolveFromEmailForCompose = () => {
    const preferred = expandedEmail?.email || expandedEmailAccount || selectedEmailAccount || ''
    if (preferred && emailAccounts.some(a => a?.email === preferred)) return preferred
    return emailAccounts[0]?.email || preferred || ''
  }

  const openReply = () => {
    if (!expandedEmail) return
    setComposeDraft({ fromEmail: resolveFromEmailForCompose() })
    setReplyToEmail(expandedEmail)
    setShowCompose(true)
  }

  const openForward = () => {
    if (!expandedEmail) return
    const bodyText =
      (expandedEmail.textBody && String(expandedEmail.textBody)) ||
      (expandedEmail.body && String(expandedEmail.body)) ||
      (expandedEmail.snippet && String(expandedEmail.snippet)) ||
      ''
    const forwarded = [
      '',
      '',
      '--- Forwarded message ---',
      `From: ${expandedEmail.sender || ''}`,
      expandedEmail.to ? `To: ${expandedEmail.to}` : '',
      expandedEmail.cc ? `Cc: ${expandedEmail.cc}` : '',
      expandedEmail.date ? `Date: ${expandedEmail.date}` : '',
      `Subject: ${expandedEmail.subject || ''}`,
      '',
      bodyText
    ]
      .filter(Boolean)
      .join('\n')

    setReplyToEmail(null)
    setComposeDraft({
      fromEmail: resolveFromEmailForCompose(),
      to: '',
      subject: expandedEmail.subject ? `Fwd: ${expandedEmail.subject}` : 'Fwd: ',
      body: forwarded
    })
    setShowCompose(true)
  }

  const archiveExpanded = async () => {
    if (!expandedEmail?.id) return
    const accountEmail = expandedEmail?.email || expandedEmailAccount || selectedEmailAccount
    if (!accountEmail) return
    setActionBusy(true)
    try {
      await callMessageAction({
        accountEmail,
        messageId: expandedEmail.id,
        action: 'modify',
        body: { removeLabelIds: ['INBOX'] }
      })
      setExpandedEmail(null)
      setSelectedEmailIdState(null)
      setExpandedEmailAccount(null)
      setListReloadKey((k) => k + 1)
      onEmailClick?.(null, null)
    } catch (e) {
      console.error(e)
      const msg = String(e?.message || '')
      if (/insufficient authentication scopes/i.test(msg) || /insufficient.*scopes/i.test(msg)) {
        alert('Gmail permissions are missing (need gmail.modify). Remove the account and sign in again.')
      } else {
        alert(msg || 'Failed to archive email')
      }
    } finally {
      setActionBusy(false)
    }
  }

  const trashExpanded = async () => {
    if (!expandedEmail?.id) return
    const accountEmail = expandedEmail?.email || expandedEmailAccount || selectedEmailAccount
    if (!accountEmail) return
    if (!window.confirm('Move this email to Trash?')) return
    setActionBusy(true)
    try {
      const isAlreadyTrash = Array.isArray(expandedEmail?.labels)
        ? expandedEmail.labels.includes('TRASH')
        : false
      await callMessageAction({
        accountEmail,
        messageId: expandedEmail.id,
        action: isAlreadyTrash ? 'delete' : 'trash'
      })
      setExpandedEmail(null)
      setSelectedEmailIdState(null)
      setExpandedEmailAccount(null)
      setListReloadKey((k) => k + 1)
      onEmailClick?.(null, null)
    } catch (e) {
      console.error(e)
      const msg = String(e?.message || '')
      if (/insufficient authentication scopes/i.test(msg) || /insufficient.*scopes/i.test(msg)) {
        alert('Gmail permissions are missing (need gmail.modify). Remove the account and sign in again.')
      } else {
        alert(msg || 'Failed to delete email')
      }
    } finally {
      setActionBusy(false)
    }
  }

  const toggleStarExpanded = async () => {
    if (!expandedEmail?.id) return
    const accountEmail = expandedEmail?.email || expandedEmailAccount || selectedEmailAccount
    if (!accountEmail) return
    const shouldStar = !expandedEmail.starred
    setActionBusy(true)
    try {
      const result = await callMessageAction({
        accountEmail,
        messageId: expandedEmail.id,
        action: 'modify',
        body: shouldStar ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] }
      })
      const labels = Array.isArray(result.labels) ? result.labels : []
      setExpandedEmail((prev) => {
        if (!prev) return prev
        return { ...prev, starred: labels.includes('STARRED'), labels }
      })
      setListReloadKey((k) => k + 1)
    } catch (e) {
      console.error(e)
      const msg = String(e?.message || '')
      if (/insufficient authentication scopes/i.test(msg) || /insufficient.*scopes/i.test(msg)) {
        alert('Gmail permissions are missing (need gmail.modify). Remove the account and sign in again.')
      } else {
        alert(msg || 'Failed to update star')
      }
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <div
      ref={overlayContainerRef}
      className="center-mail-frame text-white animate-in fade-in zoom-in-95 duration-300"
      style={{
        '--mail-accent': colorAccent,
        '--center-mail-width': panelWidth,
        '--center-mail-max-width': panelMaxWidth,
        '--center-mail-height': panelHeight,
        pointerEvents: previewMode ? 'none' : 'auto',
        opacity: previewMode ? 0.92 : 1,
      }}
    >
      <div className="center-mail-header">
        <div className="center-mail-title-row">
          <div className="flex items-center gap-3 min-w-0 flex-1">
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
            {!showCompose && !expandedEmail && (
              <div
                className={`
                  hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl transition-all duration-200
                  ${searchBarTransparent ? 'bg-transparent' : 'bg-black/20'}
                  ${searchBarOutline ? 'border border-white/15' : 'border-0'}
                  ${searchBarShadow ? 'shadow-lg' : ''}
                  ${searchQuery ? 'border-cyan-400/40 shadow-cyan-500/10' : ''}
                `}
                style={{
                  backdropFilter: `blur(${searchBarBlurPx}px)`,
                  WebkitBackdropFilter: `blur(${searchBarBlurPx}px)`,
                  minWidth: 180,
                  maxWidth: 380,
                  flex: 1,
                }}
              >
                <Search size={16} className="text-white/55 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search…"
                  className="flex-1 bg-transparent text-white outline-none text-sm placeholder-white/40 min-w-0"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="p-1 text-white/55 hover:text-white transition-colors shrink-0"
                    title="Clear"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowCompose(true)
                setReplyToEmail(null)
                setComposeDraft({ fromEmail: emailAccounts[0]?.email || '' })
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
            <button
              type="button"
              onClick={() => setListReloadKey((k) => k + 1)}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors shrink-0"
              title="Refresh emails"
              disabled={actionBusy || loadingEmail}
            >
              <RefreshCw size={18} className="text-white/70" />
            </button>
          </div>
        </div>
        {!showCompose && !expandedEmail && (
          <div className="mt-3 sm:hidden">
            <div
              className={`
                flex items-center gap-2 px-3 py-2 rounded-xl transition-all duration-200
                ${searchBarTransparent ? 'bg-transparent' : 'bg-black/20'}
                ${searchBarOutline ? 'border border-white/15' : 'border-0'}
                ${searchBarShadow ? 'shadow-lg' : ''}
                ${searchQuery ? 'border-cyan-400/40 shadow-cyan-500/10' : ''}
              `}
              style={{
                backdropFilter: `blur(${searchBarBlurPx}px)`,
                WebkitBackdropFilter: `blur(${searchBarBlurPx}px)`,
              }}
            >
              <Search size={16} className="text-white/55 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="flex-1 bg-transparent text-white outline-none text-sm placeholder-white/40 min-w-0"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-1 text-white/55 hover:text-white transition-colors shrink-0"
                  title="Clear"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="center-mail-body">
        <div ref={scrollHostRef} className="center-mail-scroll">
          {showCompose ? (
            <div className="center-mail-pane center-mail-pane--compose">
              <EmailCompose
                settings={settings}
                emailAccounts={emailAccounts}
                onClose={() => {
                  setShowCompose(false)
                  setReplyToEmail(null)
                  setComposeDraft(null)
                }}
                onSend={(result) => {
                  console.log('Email sent:', result)
                  setShowCompose(false)
                  setReplyToEmail(null)
                  setComposeDraft(null)
                  if (onRefreshEmails) {
                    setTimeout(() => onRefreshEmails(), 1000)
                  }
                }}
                replyToEmail={replyToEmail}
                draft={composeDraft}
              />
            </div>
          ) : expandedEmail ? (
            <div className="center-mail-pane center-mail-pane--expanded">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setExpandedEmail(null)
                    setSelectedEmailIdState(null)
                    setExpandedEmailAccount(null)
                    // Notify parent to clear email selection
                    if (onEmailClick) {
                      onEmailClick(null, null)
                    }
                  }}
                  className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
                  tabIndex={0}
                >
                  <ChevronLeft size={18} />
                  <span className="text-sm">Back to list</span>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={openReply}
                    disabled={actionBusy || loadingEmail}
                    className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Reply"
                  >
                    <Reply size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={openForward}
                    disabled={actionBusy || loadingEmail}
                    className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Forward"
                  >
                    <CornerUpRight size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={toggleStarExpanded}
                    disabled={actionBusy || loadingEmail}
                    className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    title={expandedEmail.starred ? 'Unstar' : 'Star'}
                  >
                    <Star size={16} fill={expandedEmail.starred ? 'currentColor' : 'none'} className={expandedEmail.starred ? 'text-yellow-400' : ''} />
                  </button>
                  {Array.isArray(expandedEmail.labels) && expandedEmail.labels.includes('INBOX') && (
                    <button
                      type="button"
                      onClick={archiveExpanded}
                      disabled={actionBusy || loadingEmail}
                      className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Archive"
                    >
                      <Archive size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={trashExpanded}
                    disabled={actionBusy || loadingEmail}
                    className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    title={
                      Array.isArray(expandedEmail.labels) && expandedEmail.labels.includes('TRASH')
                        ? 'Delete forever'
                        : 'Delete'
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="center-mail-meta">
                <h1 className="text-xl font-semibold text-white mb-2">{expandedEmail.subject}</h1>
                <div className="space-y-1 text-sm text-white/70">
                  <div><strong>From:</strong> {expandedEmail.sender}</div>
                  {expandedEmail.to && <div><strong>To:</strong> {expandedEmail.to}</div>}
                  {expandedEmail.cc && <div><strong>Cc:</strong> {expandedEmail.cc}</div>}
                  {expandedEmail.date && <div><strong>Date:</strong> {expandedEmail.date}</div>}
                </div>
              </div>

              <div className="center-mail-body-content">
                {loadingEmail ? (
                  <div className="flex items-center justify-center py-12 text-white/50">
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span className="ml-3">Loading email...</span>
                  </div>
                ) : (
                  <div className="prose prose-invert prose-sm max-w-none">
                    {expandedEmail.htmlBody ? (
                      <div 
                        dangerouslySetInnerHTML={{ __html: sanitizedHtmlBody }} 
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
            <div className="center-mail-pane center-mail-pane--list">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
                  {[
                    { id: 'INBOX', label: 'Inbox', Icon: Inbox },
                    { id: 'SENT', label: 'Sent', Icon: Send },
                    { id: 'STARRED', label: 'Starred', Icon: Star },
                    { id: 'SPAM', label: 'Spam', Icon: ShieldAlert },
                    { id: 'TRASH', label: 'Trash', Icon: Trash2 },
                  ].map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setMailbox(id)
                        setExpandedEmail(null)
                        setSelectedEmailIdState(null)
                        setExpandedEmailAccount(null)
                        setListReloadKey((k) => k + 1)
                      }}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                        mailbox === id
                          ? 'bg-white/15 text-white'
                          : 'text-white/60 hover:text-white hover:bg-white/10'
                      }`}
                      title={label}
                    >
                      <Icon size={14} />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
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
                onEmailReply={replyFromList}
                externalReloadKey={listReloadKey}
                mailbox={mailbox}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default EmailOverlay
