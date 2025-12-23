import React, { useEffect, useMemo, useState } from 'react'
import { X, Send, Paperclip } from 'lucide-react'

const EmailCompose = ({
  settings = {},
  emailAccounts = [],
  onClose,
  onSend,
  replyToEmail = null,
  draft = null
}) => {
  const colorAccent = settings?.colorAccent || '#00ffff'

  const initial = useMemo(() => {
    const fromFallback = emailAccounts[0]?.email || ''
    const fromEmail = (draft?.fromEmail || '').trim() || fromFallback
    const to = (draft?.to || '').trim() || (replyToEmail?.sender || '')
    const cc = (draft?.cc || '').trim()
    const bcc = (draft?.bcc || '').trim()
    const subject =
      (draft?.subject || '').trim() ||
      (replyToEmail ? `Re: ${replyToEmail.subject || ''}` : '')
    const body =
      (draft?.body ?? '') ||
      (replyToEmail
        ? `\n\n---\nOn ${replyToEmail.date || ''}, ${replyToEmail.sender} wrote:\n${replyToEmail.snippet || ''}`
        : '')
    return { fromEmail, to, cc, bcc, subject, body }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, replyToEmail, emailAccounts?.[0]?.email])

  const [fromEmail, setFromEmail] = useState(initial.fromEmail)
  const [to, setTo] = useState(initial.to)
  const [cc, setCc] = useState(initial.cc)
  const [bcc, setBcc] = useState(initial.bcc)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setFromEmail(initial.fromEmail)
    setTo(initial.to)
    setCc(initial.cc)
    setBcc(initial.bcc)
    setSubject(initial.subject)
    setBody(initial.body)
    setShowCc(false)
    setShowBcc(false)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.fromEmail, initial.to, initial.cc, initial.bcc, initial.subject, initial.body])

  const handleSend = async () => {
    if (!fromEmail || !to || !subject || !body.trim()) {
      setError('Please fill in all required fields (From, To, Subject, Body)')
      return
    }

    setSending(true)
    setError('')

    try {
      let base = ''
      try {
        const env = typeof import.meta !== 'undefined' ? import.meta.env || {} : {}
        base = env.VITE_GMAIL_API_BASE_URL || env.VITE_API_BASE_URL || ''
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
          if (isLocal || !host) base = 'http://127.0.0.1:3500'
        }
      } catch {
        base = ''
      }

      const url = `${base}/gmail/send`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: fromEmail,
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          textBody: body.trim(),
          htmlBody: body.trim().replace(/\n/g, '<br>')
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to send email: ${response.status}`)
      }

      const data = await response.json()
      if (onSend) {
        onSend(data)
      }
      if (onClose) {
        onClose()
      }
    } catch (e) {
      console.error('Failed to send email:', e)
      setError(e.message || 'Failed to send email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-black/60 rounded-xl border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
        <h2 className="text-lg font-semibold text-white">New Message</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          title="Close"
        >
          <X size={18} className="text-white/70" />
        </button>
      </div>

      {/* Compose Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* From */}
        {emailAccounts.length > 1 && (
          <div>
            <label className="block text-xs text-white/70 mb-1">From</label>
            <select
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-400/50"
            >
              {emailAccounts.map((acc) => (
                <option key={acc.email} value={acc.email}>
                  {acc.email}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* To */}
        <div>
          <label className="block text-xs text-white/70 mb-1">To <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50"
          />
        </div>

        {/* Cc/Bcc Toggle */}
        <div className="flex gap-2">
          {!showCc && (
            <button
              type="button"
              onClick={() => setShowCc(true)}
              className="text-xs text-white/60 hover:text-white transition-colors"
            >
              Cc
            </button>
          )}
          {!showBcc && (
            <button
              type="button"
              onClick={() => setShowBcc(true)}
              className="text-xs text-white/60 hover:text-white transition-colors"
            >
              Bcc
            </button>
          )}
        </div>

        {/* Cc */}
        {showCc && (
          <div>
            <label className="block text-xs text-white/70 mb-1">Cc</label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc@example.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50"
            />
          </div>
        )}

        {/* Bcc */}
        {showBcc && (
          <div>
            <label className="block text-xs text-white/70 mb-1">Bcc</label>
            <input
              type="text"
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="bcc@example.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50"
            />
          </div>
        )}

        {/* Subject */}
        <div>
          <label className="block text-xs text-white/70 mb-1">Subject <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50"
          />
        </div>

        {/* Body */}
        <div className="flex-1 min-h-[300px]">
          <label className="block text-xs text-white/70 mb-1">Message <span className="text-red-400">*</span></label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Compose your message..."
            className="w-full h-full min-h-[300px] bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50 resize-none"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg p-3">
            {error}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between p-4 border-t border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white"
            title="Attach file (coming soon)"
          >
            <Paperclip size={18} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/70 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !fromEmail || !to || !subject || !body.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-sm text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>Sending...</span>
              </>
            ) : (
              <>
                <Send size={16} />
                <span>Send</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EmailCompose





