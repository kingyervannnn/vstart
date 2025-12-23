import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Mail, Star, Trash2, Archive, Reply, MoreVertical, RefreshCw } from 'lucide-react'
import { getCachedEmails, setCachedEmails } from '../lib/email-cache'

const MOCK_EMAILS = [
    {
        id: 1,
        sender: 'Team VSTART',
        subject: 'Welcome to your new dashboard',
        snippet: 'Thanks for installing VSTART! Here are some tips to get started with your new productivity center...',
        time: '10:42 AM',
        unread: true,
        starred: true,
        color: '#00ffff'
    },
    {
        id: 2,
        sender: 'GitHub',
        subject: '[GitHub] Security alert for your repository',
        snippet: 'We found a potential security vulnerability in one of your dependencies. Please review...',
        time: 'Yesterday',
        unread: true,
        starred: false,
        color: '#ffffff'
    },
    {
        id: 3,
        sender: 'Dribbble',
        subject: 'Top designs of the week',
        snippet: 'Check out the most popular shots from the last 7 days. Inspiration awaits!',
        time: 'Nov 26',
        unread: false,
        starred: false,
        color: '#ea4c89'
    },
    {
        id: 4,
        sender: 'Linear',
        subject: 'Cycle 24 Summary',
        snippet: 'Here is a summary of what your team accomplished in the last cycle. 12 issues completed...',
        time: 'Nov 25',
        unread: false,
        starred: false,
        color: '#5e6ad2'
    },
    {
        id: 5,
        sender: 'Vercel',
        subject: 'Deployment successful: vstart-web',
        snippet: 'Your latest commit has been successfully deployed to production. Click to view...',
        time: 'Nov 24',
        unread: false,
        starred: true,
        color: '#ffffff'
    }
]

const slugifyWorkspaceName = (name) => {
    try {
        return String(name || '')
            .trim()
            .toLowerCase()
            .replace(/[_\s]+/g, '-')
            .replace(/[^a-z0-9\-]/g, '')
            .replace(/\-+/g, '-')
            .replace(/^\-+|\-+$/g, '') || 'workspace'
    } catch {
        return 'workspace'
    }
}

const EmailList = ({
    settings = {},
    accounts = [],
    activeAccount = null,
    onCompose,
    className = '',
    filterMode = 'all',
    filterWorkspaceId = null,
    onChangeFilter,
    workspaces = [],
    currentWorkspaceId = null,
    searchQuery = '',
    highlightText = null,
    selectedEmailId = null,
    onEmailClick = null,
    onEmailHover = null,
    onEmailReply = null,
    externalReloadKey = 0,
    mailbox = 'INBOX',
}) => {
    const [emails, setEmails] = useState([])
    const [hoveredEmailId, setHoveredEmailId] = useState(null)
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [error, setError] = useState('')
    const [reloadKey, setReloadKey] = useState(0)
    const [actionBusyId, setActionBusyId] = useState(null)
    const [nextPageTokens, setNextPageTokens] = useState({})
    const scrollContainerRef = useRef(null)
    const mailboxCacheRef = useRef(new Map())
    const loadSeqRef = useRef(0)

    // Styles from settings or defaults
    const colorAccent = settings.colorAccent || '#00ffff'
    const removeBackgrounds = settings?.notesRemoveBackground !== false
    const removeOutlines = settings?.notesRemoveOutline !== false

    // Determine current workspace from URL slug
    const resolvedWorkspaceId = useMemo(() => {
        if (filterMode === 'perWorkspace') {
            if (currentWorkspaceId) return currentWorkspaceId
            // Fallback: try to get from URL
            try {
                const path = window.location.pathname
                const slug = path.replace(/^\/+/, '').replace(/\/+$/, '') || null
                if (!slug) return null
                const workspace = workspaces.find(ws => {
                    const wsSlug = slugifyWorkspaceName(ws.name)
                    return wsSlug === slug
                })
                return workspace?.id || null
            } catch {
                return null
            }
        }
        if (filterMode === 'manual' && filterWorkspaceId) {
            return filterWorkspaceId
        }
        return null
    }, [filterMode, filterWorkspaceId, currentWorkspaceId, workspaces])

    // Get accounts to show based on filter
    const filteredAccounts = useMemo(() => {
        let filtered = []
        if (filterMode === 'all') {
            filtered = accounts
        } else if (resolvedWorkspaceId) {
            filtered = accounts.filter(acc => acc.workspaceId === resolvedWorkspaceId)
        } else {
            filtered = accounts.filter(acc => !acc.workspaceId || acc.workspaceId === null)
        }
        return filtered
    }, [accounts, filterMode, resolvedWorkspaceId])

    // Get display label for current filter
    const filterLabel = useMemo(() => {
        if (filterMode === 'all') return 'All'
        if (filterMode === 'perWorkspace') {
            const ws = workspaces.find(w => w.id === resolvedWorkspaceId)
            return ws ? ws.name : 'Current WS'
        }
        if (filterMode === 'manual' && resolvedWorkspaceId) {
            const ws = workspaces.find(w => w.id === resolvedWorkspaceId)
            return ws ? ws.name : 'Manual'
        }
        return 'All'
    }, [filterMode, resolvedWorkspaceId, workspaces])

    const filterValue = useMemo(() => {
        if (filterMode === 'all') return 'all'
        if (filterMode === 'perWorkspace') return 'perWorkspace'
        if (filterMode === 'manual' && filterWorkspaceId) return `ws:${filterWorkspaceId}`
        return 'all'
    }, [filterMode, filterWorkspaceId])

    const handleFilterSelect = (value) => {
        if (value === 'all') {
            onChangeFilter?.('all')
        } else if (value === 'perWorkspace') {
            onChangeFilter?.('perWorkspace')
        } else if (value.startsWith('ws:')) {
            onChangeFilter?.('manual', value.slice(3))
        }
    }

    const formatTime = (ts) => {
        try {
            const n = Number(ts)
            const d = Number.isFinite(n) ? new Date(n) : new Date(ts)
            if (Number.isNaN(d.getTime())) return ''
            const now = new Date()
            const sameDay = d.toDateString() === now.toDateString()
            if (sameDay) {
                return d.toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit'
                })
            }
            const sameYear = d.getFullYear() === now.getFullYear()
            return d.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                ...(sameYear ? {} : { year: 'numeric' })
            })
        } catch {
            return ''
        }
    }

    // Check if auto-load/caching is enabled
    const emailAutoLoad = settings?.widgets?.emailAutoLoad !== false

    const mailboxKey = useMemo(() => {
        const acctKey = (filteredAccounts || [])
            .map(a => String(a?.email || '').toLowerCase().trim())
            .filter(Boolean)
            .sort()
            .join(',')
        return `${String(mailbox || 'INBOX').toUpperCase()}::${acctKey}`
    }, [filteredAccounts, mailbox])

    useEffect(() => {
        if (!filteredAccounts || !filteredAccounts.length) {
            setEmails([])
            setError('')
            setLoading(false)
            setLoadingMore(false)
            setNextPageTokens({})
            return
        }

        let cancelled = false
        const seq = ++loadSeqRef.current

        const loadEmails = async () => {
            // Restore per-mailbox cache immediately (prevents UI lag on mailbox switches)
            try {
                const cached = mailboxCacheRef.current.get(mailboxKey)
                if (cached && !cancelled) {
                    setEmails(Array.isArray(cached.emails) ? cached.emails : [])
                    setNextPageTokens(cached.nextPageTokens && typeof cached.nextPageTokens === 'object' ? cached.nextPageTokens : {})
                    setLoading(false)
                }
            } catch {}

            // Try to load from cache first if auto-load is enabled
            if (emailAutoLoad) {
                const cachedEmails = []
                for (const acc of filteredAccounts) {
                    if (!acc || !acc.email) continue
                    const cached = getCachedEmails(acc.email, mailbox)
                    if (cached && Array.isArray(cached)) {
                        // Add accountEmail to cached emails
                        cached.forEach(email => {
                            cachedEmails.push({
                                ...email,
                                accountEmail: acc.email
                            })
                        })
                    }
                }
                
                if (cachedEmails.length > 0 && !cancelled) {
                    // Sort by timestamp (most recent first)
                    cachedEmails.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                    setEmails(cachedEmails)
                    setLoading(false)
                    // Continue to fetch fresh data in background
                } else {
                    setLoading(true)
                }
            } else {
                setLoading(true)
            }
            
            setError('')
            try {
                const base = getApiBase()
                const endpointBase = `${base}/gmail/messages`
                const max = 25

                const fetchAccount = async (accEmail) => {
                    const labelParam =
                        mailbox && mailbox !== 'ALL' ? `&label=${encodeURIComponent(mailbox)}` : ''
                    const url = `${endpointBase}?email=${encodeURIComponent(accEmail)}&max=${max}${labelParam}`
                    const resp = await fetch(url)
                    const data = await resp.json().catch(() => ({}))
                    if (!resp.ok) {
                        throw new Error(data.error || `Failed to load emails (${resp.status})`)
                    }
                    const msgs = Array.isArray(data.messages) ? data.messages : []
                    const nextPageToken = data.nextPageToken ? String(data.nextPageToken) : null
                    const mapped = msgs.map((m) => {
                        const ts = m.timestamp || m.date || m.internalDate || Date.now()
                        return {
                            id: m.id,
                            accountEmail: accEmail,
                            sender: m.sender || m.from || accEmail,
                            subject: m.subject || '(no subject)',
                            snippet: m.snippet || '',
                            time: formatTime(ts),
                            timestamp: ts,
                            unread: !!m.unread,
                            starred: !!m.starred,
                            color: colorAccent
                        }
                    })
                    return { accEmail, mapped, nextPageToken }
                }

                const accountEmails = filteredAccounts
                    .map((a) => a && a.email)
                    .filter(Boolean)

                const results = await Promise.all(
                    accountEmails.map(async (accEmail) => {
                        try {
                            return await fetchAccount(accEmail)
                        } catch (e) {
                            // eslint-disable-next-line no-console
                            console.error('Gmail messages error', accEmail, e)
                            return { accEmail, mapped: [], nextPageToken: null, error: e }
                        }
                    })
                )

                if (cancelled || seq !== loadSeqRef.current) return

                const all = results.flatMap((r) => r.mapped || [])
                const nextTokens = {}
                results.forEach((r) => {
                    nextTokens[r.accEmail] = r.nextPageToken
                })

                if (cancelled) return
                if (all.length) {
                    all.sort((a, b) => {
                        const ta = Number.isFinite(Number(a.timestamp)) ? Number(a.timestamp) : 0
                        const tb = Number.isFinite(Number(b.timestamp)) ? Number(b.timestamp) : 0
                        return tb - ta
                    })
                    setEmails(all)
                    setError('') // Clear any previous errors if we got emails
                    setNextPageTokens(nextTokens)
                    
                    // Cache emails per account if auto-load is enabled
                    if (emailAutoLoad) {
                        // Group emails by account
                        const emailsByAccount = {}
                        all.forEach(email => {
                            const accEmail = email.accountEmail
                            if (accEmail) {
                                if (!emailsByAccount[accEmail]) {
                                    emailsByAccount[accEmail] = []
                                }
                                emailsByAccount[accEmail].push(email)
                            }
                        })
                        
                        // Save cache for each account
                        Object.entries(emailsByAccount).forEach(([accEmail, accountEmails]) => {
                            setCachedEmails(accEmail, mailbox, accountEmails)
                        })
                    }

                    try {
                        mailboxCacheRef.current.set(mailboxKey, {
                            emails: all,
                            nextPageTokens: nextTokens,
                            savedAt: Date.now()
                        })
                    } catch {}
                } else {
                    // Only show mock emails if we have accounts but no real emails
                    // Don't show mocks if there was an error (empty filteredAccounts would return early)
                    if (filteredAccounts.length > 0) {
                        setError('No emails found. Check console for API errors.')
                    }
                    setEmails([]) // Show empty list instead of mock emails
                    setNextPageTokens(nextTokens)
                }
            } catch (e) {
                if (cancelled) return
                setError(e.message || 'Failed to load emails')
                setEmails([])
                setNextPageTokens({})
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        loadEmails()

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredAccounts, reloadKey, externalReloadKey, mailboxKey, mailbox])

    const hasMore = useMemo(() => {
        try {
            const vals = Object.values(nextPageTokens || {})
            return vals.some((v) => !!v)
        } catch {
            return false
        }
    }, [nextPageTokens])

    const loadMore = async () => {
        if (loading || loadingMore) return
        if (!filteredAccounts || !filteredAccounts.length) return
        if (!hasMore) return
        setLoadingMore(true)
        setError('')
        const seq = ++loadSeqRef.current
        try {
            const base = getApiBase()
            const endpointBase = `${base}/gmail/messages`
            const max = 25

            const fetchAccountMore = async (accEmail) => {
                const pageToken = nextPageTokens?.[accEmail]
                if (!pageToken) {
                    return { accEmail, mapped: [], nextPageToken: null }
                }
                const labelParam =
                    mailbox && mailbox !== 'ALL' ? `&label=${encodeURIComponent(mailbox)}` : ''
                const url = `${endpointBase}?email=${encodeURIComponent(accEmail)}&max=${max}${labelParam}&pageToken=${encodeURIComponent(pageToken)}`
                const resp = await fetch(url)
                const data = await resp.json().catch(() => ({}))
                if (!resp.ok) {
                    throw new Error(data.error || `Failed to load more emails (${resp.status})`)
                }
                const msgs = Array.isArray(data.messages) ? data.messages : []
                const nextPageToken = data.nextPageToken ? String(data.nextPageToken) : null
                const mapped = msgs.map((m) => {
                    const ts = m.timestamp || m.date || m.internalDate || Date.now()
                    return {
                        id: m.id,
                        accountEmail: accEmail,
                        sender: m.sender || m.from || accEmail,
                        subject: m.subject || '(no subject)',
                        snippet: m.snippet || '',
                        time: formatTime(ts),
                        timestamp: ts,
                        unread: !!m.unread,
                        starred: !!m.starred,
                        color: colorAccent
                    }
                })
                return { accEmail, mapped, nextPageToken }
            }

            const accountEmails = filteredAccounts
                .map((a) => a && a.email)
                .filter(Boolean)

            const results = await Promise.all(
                accountEmails.map(async (accEmail) => {
                    try {
                        return await fetchAccountMore(accEmail)
                    } catch (e) {
                        // eslint-disable-next-line no-console
                        console.error('Gmail messages loadMore error', accEmail, e)
                        return { accEmail, mapped: [], nextPageToken: nextPageTokens?.[accEmail] || null, error: e }
                    }
                })
            )

            if (seq !== loadSeqRef.current) return

            const incoming = results.flatMap((r) => r.mapped || [])
            const updatedTokens = { ...(nextPageTokens || {}) }
            results.forEach((r) => {
                updatedTokens[r.accEmail] = r.nextPageToken
            })

            setNextPageTokens(updatedTokens)
            setEmails((prev) => {
                const seen = new Set()
                const merged = []
                for (const item of prev || []) {
                    const key = `${item.accountEmail || ''}:${item.id || ''}`
                    if (!item?.id || seen.has(key)) continue
                    seen.add(key)
                    merged.push(item)
                }
                for (const item of incoming || []) {
                    const key = `${item.accountEmail || ''}:${item.id || ''}`
                    if (!item?.id || seen.has(key)) continue
                    seen.add(key)
                    merged.push(item)
                }
                merged.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))

                if (emailAutoLoad) {
                    try {
                        const emailsByAccount = {}
                        merged.forEach((email) => {
                            const accEmail = email.accountEmail
                            if (!accEmail) return
                            if (!emailsByAccount[accEmail]) emailsByAccount[accEmail] = []
                            emailsByAccount[accEmail].push(email)
                        })
                        Object.entries(emailsByAccount).forEach(([accEmail, accountEmails]) => {
                            setCachedEmails(accEmail, mailbox, accountEmails)
                        })
                    } catch {}
                }

                try {
                    mailboxCacheRef.current.set(mailboxKey, {
                        emails: merged,
                        nextPageTokens: updatedTokens,
                        savedAt: Date.now()
                    })
                } catch {}
                return merged
            })
        } catch (e) {
            const msg = String(e?.message || '')
            setError(msg || 'Failed to load more emails')
        } finally {
            setLoadingMore(false)
        }
    }

    const handleRefresh = (e) => {
        e.stopPropagation()
        setReloadKey((prev) => prev + 1)
    }

    // Filter emails based on search query
    const filteredEmails = useMemo(() => {
        if (!searchQuery || !searchQuery.trim()) return emails
        const query = searchQuery.toLowerCase().trim()
        return emails.filter(email => {
            const sender = (email.sender || '').toLowerCase()
            const subject = (email.subject || '').toLowerCase()
            const snippet = (email.snippet || '').toLowerCase()
            return sender.includes(query) || subject.includes(query) || snippet.includes(query)
        })
    }, [emails, searchQuery])

    const getApiBase = () => {
        try {
            const env = typeof import.meta !== 'undefined' ? import.meta.env || {} : {}
            let base =
                env.VITE_GMAIL_API_BASE_URL ||
                env.VITE_API_BASE_URL ||
                ''
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

    const updateAccountCacheFromNextEmails = (nextEmails, accountEmail) => {
        try {
            if (!accountEmail) return
            const perAccount = nextEmails.filter(e => e && e.accountEmail === accountEmail)
            setCachedEmails(accountEmail, mailbox, perAccount)
        } catch {}
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

    const handleArchive = async (e, email) => {
        e.stopPropagation()
        if (!email?.id || !email?.accountEmail) return
        setActionBusyId(email.id)
        try {
            await callMessageAction({
                accountEmail: email.accountEmail,
                messageId: email.id,
                action: 'modify',
                body: { removeLabelIds: ['INBOX'] }
            })
            setEmails(prev => {
                const next = prev.filter(x => x.id !== email.id)
                updateAccountCacheFromNextEmails(next, email.accountEmail)
                return next
            })
        } catch (err) {
            console.error(err)
            const msg = String(err?.message || '')
            if (/insufficient authentication scopes/i.test(msg) || /insufficient.*scopes/i.test(msg)) {
                setError('Gmail permissions are missing (need gmail.modify). Remove the account and sign in again.')
            } else {
                setError(msg || 'Failed to archive email')
            }
        } finally {
            setActionBusyId(null)
        }
    }

    const handleTrash = async (e, email) => {
        e.stopPropagation()
        if (!email?.id || !email?.accountEmail) return
        setActionBusyId(email.id)
        try {
            const action = mailbox === 'TRASH' ? 'delete' : 'trash'
            await callMessageAction({
                accountEmail: email.accountEmail,
                messageId: email.id,
                action
            })
            setEmails(prev => {
                const next = prev.filter(x => x.id !== email.id)
                updateAccountCacheFromNextEmails(next, email.accountEmail)
                return next
            })
            if (selectedEmailId === email.id && onEmailClick) {
                onEmailClick(null, null)
            }
        } catch (err) {
            console.error(err)
            const msg = String(err?.message || '')
            if (/insufficient authentication scopes/i.test(msg) || /insufficient.*scopes/i.test(msg)) {
                setError('Gmail permissions are missing (need gmail.modify). Remove the account and sign in again.')
            } else {
                setError(msg || 'Failed to delete email')
            }
        } finally {
            setActionBusyId(null)
        }
    }

    const handleToggleStar = async (e, email) => {
        e.stopPropagation()
        if (!email?.id || !email?.accountEmail) return
        setActionBusyId(email.id)
        try {
            const shouldStar = !email.starred
            const result = await callMessageAction({
                accountEmail: email.accountEmail,
                messageId: email.id,
                action: 'modify',
                body: shouldStar
                    ? { addLabelIds: ['STARRED'] }
                    : { removeLabelIds: ['STARRED'] }
            })
            const labels = Array.isArray(result.labels) ? result.labels : null
            setEmails(prev => {
                const next = prev.map(x => {
                    if (x.id !== email.id) return x
                    const starred = labels ? labels.includes('STARRED') : shouldStar
                    return { ...x, starred }
                })
                updateAccountCacheFromNextEmails(next, email.accountEmail)
                return next
            })
        } catch (err) {
            console.error(err)
            const msg = String(err?.message || '')
            if (/insufficient authentication scopes/i.test(msg) || /insufficient.*scopes/i.test(msg)) {
                setError('Gmail permissions are missing (need gmail.modify). Remove the account and sign in again.')
            } else {
                setError(msg || 'Failed to star email')
            }
        } finally {
            setActionBusyId(null)
        }
    }

    const handleReply = async (e, email) => {
        e.stopPropagation()
        if (!email?.id || !email?.accountEmail) return
        if (typeof onEmailReply === 'function') {
            onEmailReply(email.id, email.accountEmail)
            return
        }
        if (onEmailClick) onEmailClick(email.id, email.accountEmail)
    }

    return (
        <div className={`flex flex-col w-full h-full min-h-0 ${className}`}>
            {/* Email List */}
            <div
                ref={scrollContainerRef}
                onScroll={() => {
                    const el = scrollContainerRef.current
                    if (!el) return
                    if (loading || loadingMore) return
                    if (!hasMore) return
                    const thresholdPx = 220
                    const remaining = (el.scrollHeight - el.scrollTop - el.clientHeight)
                    if (remaining < thresholdPx) {
                        loadMore()
                    }
                }}
                className="flex-1 min-h-0 overflow-y-auto -mx-3 px-3 space-y-[1px] email-scroll w-[calc(100%+1.5rem)]"
            >
                <style>{`
          .email-scroll::-webkit-scrollbar { display: none; }
          .email-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>

                {loading && (
                    <div className="flex items-center justify-center py-2 text-[11px] text-white/50">
                        <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                        <span>Loading emails…</span>
                    </div>
                )}

                {error && (
                    <div className="flex items-center justify-center py-2 text-[10px] text-red-300">
                        {error}
                    </div>
                )}

                {filteredEmails.map((email) => {
                    const isSelected = selectedEmailId === email.id
                    const hasSearchQuery = searchQuery && searchQuery.trim()
                    const accountEmail = email.accountEmail || filteredAccounts.find(acc => acc.email)?.email || ''
                    return (
                        <div
                            key={email.id}
                            onMouseEnter={() => {
                                setHoveredEmailId(email.id)
                                if (onEmailHover) {
                                    onEmailHover(email.id, accountEmail)
                                }
                            }}
                            onMouseLeave={() => {
                                setHoveredEmailId(null)
                                if (onEmailHover) {
                                    onEmailHover(null, null)
                                }
                            }}
                            onClick={() => {
                                if (onEmailClick) {
                                    // Get account email from email object or find from filtered accounts
                                    onEmailClick(isSelected ? null : email.id, accountEmail)
                                }
                            }}
                            className={`group relative flex flex-col p-3 rounded-lg transition-all cursor-pointer border ${
                                isSelected ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-transparent'
                            } ${email.unread ? 'bg-white/5' : 'hover:bg-white/5'}`}
                            style={{
                                borderColor: isSelected 
                                    ? 'rgba(0, 255, 255, 0.5)' 
                                    : hoveredEmailId === email.id && !removeOutlines 
                                        ? 'rgba(255,255,255,0.1)' 
                                        : 'transparent'
                            }}
                        >
                            <div className="flex items-start justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2 min-w-0">
                                    <div
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: email.unread ? colorAccent : 'transparent' }}
                                    />
                                    <span className={`text-[12px] truncate ${email.unread ? 'font-semibold text-white' : 'font-medium text-white/80'}`}>
                                        {hasSearchQuery && highlightText 
                                            ? highlightText(email.sender, searchQuery) 
                                            : email.sender}
                                    </span>
                                </div>
                                <span className="text-[10px] text-white/40 shrink-0 whitespace-nowrap">
                                    {email.time}
                                </span>
                            </div>

                            <div className={`text-[11px] mb-0.5 truncate ${email.unread ? 'text-white/90 font-medium' : 'text-white/70'}`}>
                                {hasSearchQuery && highlightText 
                                    ? highlightText(email.subject, searchQuery) 
                                    : email.subject}
                            </div>

                            <div className="text-[10px] text-white/50 truncate leading-relaxed">
                                {hasSearchQuery && highlightText 
                                    ? highlightText(email.snippet, searchQuery) 
                                    : email.snippet}
                            </div>

                        {/* Hover Actions */}
                        <div className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 transition-opacity duration-200
              bg-black/35 backdrop-blur-md border border-white/10 rounded-lg p-1 shadow-lg
              ${hoveredEmailId === email.id ? 'opacity-100' : 'opacity-0 pointer-events-none'}
            `}>
                            {mailbox === 'INBOX' && (
                            <button 
                                onClick={(e) => handleArchive(e, email)}
                                disabled={actionBusyId === email.id}
                                className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                title="Archive"
                            >
                                <Archive size={12} />
                            </button>
                            )}
                            <button 
                                onClick={(e) => handleTrash(e, email)}
                                disabled={actionBusyId === email.id}
                                className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                title={mailbox === 'TRASH' ? 'Delete forever' : 'Delete'}
                            >
                                <Trash2 size={12} />
                            </button>
                            <button 
                                onClick={(e) => handleReply(e, email)}
                                disabled={actionBusyId === email.id}
                                className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                title="Reply"
                            >
                                <Reply size={12} />
                            </button>
                            <button 
                                onClick={(e) => handleToggleStar(e, email)}
                                disabled={actionBusyId === email.id}
                                className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                title={email.starred ? "Unstar" : "Star"}
                            >
                                <Star size={12} fill={email.starred ? "currentColor" : "none"} className={email.starred ? "text-yellow-400" : ""} />
                            </button>
                        </div>
                    </div>
                    )
                })}

                {filteredEmails.length > 0 && hasMore && (
                    <div className="py-4 flex justify-center">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation()
                                loadMore()
                            }}
                            disabled={loadingMore || loading}
                            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/70 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loadingMore ? 'Loading…' : 'Load more'}
                        </button>
                    </div>
                )}

                {filteredEmails.length === 0 && !loading && !error && (
                    <div className="flex flex-col items-center justify-center py-12 text-white/30">
                        <Mail size={32} strokeWidth={1.5} className="mb-2 opacity-50" />
                        <span className="text-xs">No emails found</span>
                    </div>
                )}
            </div>
        </div>
    )
}

export default EmailList
