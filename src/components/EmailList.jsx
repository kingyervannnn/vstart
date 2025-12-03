import React, { useState, useMemo, useEffect } from 'react'
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
}) => {
    const [emails, setEmails] = useState([])
    const [hoveredEmailId, setHoveredEmailId] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [reloadKey, setReloadKey] = useState(0)

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
        console.log('📧 EmailList filtering:', { filterMode, resolvedWorkspaceId, accountsCount: accounts.length })
        console.log('📧 Accounts:', accounts.map(acc => ({ email: acc.email, workspaceId: acc.workspaceId })))
        
        let filtered = []
        if (filterMode === 'all') {
            filtered = accounts
        } else if (resolvedWorkspaceId) {
            filtered = accounts.filter(acc => acc.workspaceId === resolvedWorkspaceId)
            console.log('📧 Filtered by workspace:', resolvedWorkspaceId, '→', filtered.length, 'accounts')
        } else {
            filtered = accounts.filter(acc => !acc.workspaceId || acc.workspaceId === null)
            console.log('📧 Filtered unassigned →', filtered.length, 'accounts')
        }
        console.log('📧 Final filtered accounts:', filtered.map(acc => ({ email: acc.email, workspaceId: acc.workspaceId })))
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

    useEffect(() => {
        if (!filteredAccounts || !filteredAccounts.length) {
            setEmails([])
            setError('')
            setLoading(false)
            return
        }

        let cancelled = false

        const loadEmails = async () => {
            // Try to load from cache first if auto-load is enabled
            if (emailAutoLoad) {
                const cachedEmails = []
                for (const acc of filteredAccounts) {
                    if (!acc || !acc.email) continue
                    const cached = getCachedEmails(acc.email)
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
                let base = ''
                try {
                    const env = typeof import.meta !== 'undefined' ? import.meta.env || {} : {}
                    base =
                        env.VITE_GMAIL_API_BASE_URL ||
                        env.VITE_API_BASE_URL ||
                        ''
                    base = String(base || '').replace(/\/+$/, '')
                } catch {
                    base = ''
                }
                const endpointBase = `${base}/gmail/messages`
                const all = []
                for (const acc of filteredAccounts) {
                    if (!acc || !acc.email) continue
                    const url = `${endpointBase}?email=${encodeURIComponent(acc.email)}&max=25`
                    const resp = await fetch(url)
                    if (!resp.ok) {
                        // Log but continue with other accounts
                        const errorData = await resp.json().catch(() => ({}))
                        // eslint-disable-next-line no-console
                        console.error('Gmail messages error', resp.status, errorData)
                        // Show user-friendly error message for API not enabled
                        if (errorData.error && errorData.error.includes('has not been used')) {
                            console.error('⚠️ Gmail API not enabled! Enable it at: https://console.cloud.google.com/apis/library/gmail.googleapis.com')
                        }
                        continue
                    }
                    const data = await resp.json().catch(() => ({}))
                    const msgs = Array.isArray(data.messages) ? data.messages : []
                    for (const m of msgs) {
                        const ts = m.timestamp || m.date || m.internalDate || Date.now()
                        all.push({
                            id: m.id,
                            accountEmail: acc.email, // Store account email for fetching full content
                            sender: m.sender || m.from || acc.email,
                            subject: m.subject || '(no subject)',
                            snippet: m.snippet || '',
                            time: formatTime(ts),
                            timestamp: ts,
                            unread: !!m.unread,
                            starred: !!m.starred,
                            color: colorAccent
                        })
                    }
                }
                if (cancelled) return
                if (all.length) {
                    all.sort((a, b) => {
                        const ta = Number.isFinite(Number(a.timestamp)) ? Number(a.timestamp) : 0
                        const tb = Number.isFinite(Number(b.timestamp)) ? Number(b.timestamp) : 0
                        return tb - ta
                    })
                    setEmails(all)
                    setError('') // Clear any previous errors if we got emails
                    
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
                            setCachedEmails(accEmail, accountEmails)
                        })
                    }
                } else {
                    // Only show mock emails if we have accounts but no real emails
                    // Don't show mocks if there was an error (empty filteredAccounts would return early)
                    if (filteredAccounts.length > 0) {
                        setError('No emails found. Check console for API errors.')
                    }
                    setEmails([]) // Show empty list instead of mock emails
                }
            } catch (e) {
                if (cancelled) return
                setError(e.message || 'Failed to load emails')
                setEmails([])
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        loadEmails()

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredAccounts, reloadKey])

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

    return (
        <div className={`flex flex-col w-full h-full min-h-0 ${className}`}>
            {/* Email List */}
            <div className="flex-1 min-h-0 overflow-y-auto -mx-3 px-3 space-y-[1px] email-scroll w-[calc(100%+1.5rem)]">
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
                    return (
                        <div
                            key={email.id}
                            onMouseEnter={() => setHoveredEmailId(email.id)}
                            onMouseLeave={() => setHoveredEmailId(null)}
                            onClick={() => {
                                if (onEmailClick) {
                                    // Get account email from email object or find from filtered accounts
                                    const accountEmail = email.accountEmail || filteredAccounts.find(acc => acc.email)?.email || ''
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
              ${hoveredEmailId === email.id ? 'opacity-100' : 'opacity-0 pointer-events-none'}
            `}>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation()
                                    // TODO: Implement archive functionality
                                    console.log('Archive email:', email.id)
                                }}
                                className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                title="Archive"
                            >
                                <Archive size={12} />
                            </button>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation()
                                    // TODO: Implement delete functionality
                                    console.log('Delete email:', email.id)
                                }}
                                className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                title="Delete"
                            >
                                <Trash2 size={12} />
                            </button>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation()
                                    // TODO: Implement reply functionality
                                    console.log('Reply to email:', email.id)
                                }}
                                className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                title="Reply"
                            >
                                <Reply size={12} />
                            </button>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation()
                                    // TODO: Implement star/unstar functionality
                                    console.log('Star email:', email.id)
                                }}
                                className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                title={email.starred ? "Unstar" : "Star"}
                            >
                                <Star size={12} fill={email.starred ? "currentColor" : "none"} className={email.starred ? "text-yellow-400" : ""} />
                            </button>
                        </div>
                    </div>
                    )
                })}

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
