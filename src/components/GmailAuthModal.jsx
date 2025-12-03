import React, { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Mail, Loader2, Check, X, AlertCircle } from 'lucide-react'

/**
 * Gmail OAuth Authentication Modal
 * 
 * Handles Google OAuth 2.0 flow for Gmail account authentication
 * 
 * Required setup:
 * 1. Create a Google Cloud Project
 * 2. Enable Gmail API
 * 3. Create OAuth 2.0 credentials
 * 4. Add authorized redirect URIs (e.g., http://localhost:3000)
 * 5. Store CLIENT_ID in environment variable or settings
 */
const GmailAuthModal = ({
  open,
  onClose,
  onSuccess,
  onError,
  workspaces = [],
  clientId = null, // Google OAuth Client ID - should be in settings or env
}) => {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [status, setStatus] = useState('idle') // 'idle' | 'loading' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const oauthWindowRef = useRef(null)
  const checkIntervalRef = useRef(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
      }
      if (oauthWindowRef.current && !oauthWindowRef.current.closed) {
        oauthWindowRef.current.close()
      }
    }
  }, [])

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setStatus('idle')
      setErrorMessage('')
      setUserEmail('')
      setSelectedWorkspaceId('')
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
        checkIntervalRef.current = null
      }
      if (oauthWindowRef.current && !oauthWindowRef.current.closed) {
        oauthWindowRef.current.close()
      }
    } else {
      // When modal opens, verify Client ID is available
      const currentClientId = getClientId()
      if (!currentClientId) {
        console.warn('Gmail OAuth: Client ID not found when modal opened')
      } else {
        console.log('Gmail OAuth: Client ID found:', currentClientId.substring(0, 30) + '...')
      }
    }
  }, [open])

  const getClientId = () => {
    // Check if provided as prop first (most reliable)
    if (clientId && clientId.trim()) return clientId.trim()

    // Try to get from localStorage settings
    try {
      const stored = localStorage.getItem('gmailOAuthClientId')
      if (stored && stored.trim()) return stored.trim()
    } catch {}

    // Check environment variable (for build-time or .env.local)
    try {
      if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GMAIL_CLIENT_ID) {
        const envClientId = import.meta.env.VITE_GMAIL_CLIENT_ID
        if (envClientId && envClientId.trim()) {
          // Auto-save to localStorage for convenience
          try {
            if (!localStorage.getItem('gmailOAuthClientId')) {
              localStorage.setItem('gmailOAuthClientId', envClientId.trim())
            }
          } catch {}
          return envClientId.trim()
        }
      }
    } catch {}

    return null
  }

  const handleSignIn = () => {
    const clientIdValue = getClientId()
    
    if (!clientIdValue || !clientIdValue.trim()) {
      setStatus('error')
      setErrorMessage('Gmail OAuth Client ID not configured. Please check your settings and ensure the Client ID is entered.')
      console.error('Gmail OAuth: Client ID not found. Checked:', {
        fromProp: !!clientId,
        fromLocalStorage: !!localStorage.getItem('gmailOAuthClientId'),
        fromEnv: !!(typeof import.meta !== 'undefined' && import.meta.env?.VITE_GMAIL_CLIENT_ID),
      })
      return
    }
    
    console.log('Gmail OAuth: Starting authentication with Client ID:', clientIdValue.substring(0, 20) + '...')

    setStatus('loading')
    setErrorMessage('')

    try {
      // Generate state parameter for security
      const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
      localStorage.setItem('gmail_oauth_state', state)

      // OAuth 2.0 configuration
      const redirectUri = `${window.location.origin}/gmail-oauth-callback`
      const scope = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'
      const responseType = 'code'
      const accessType = 'offline' // Get refresh token
      const prompt = 'consent' // Force consent screen to get refresh token

      // Log the scope being requested for debugging
      console.log('🔐 Gmail OAuth - Requesting scopes:', scope)
      console.log('🔐 Gmail OAuth - Scopes include gmail.send:', scope.includes('gmail.send'))

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientIdValue)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=${responseType}&` +
        `scope=${encodeURIComponent(scope)}&` +
        `access_type=${accessType}&` +
        `prompt=${prompt}&` +
        `state=${encodeURIComponent(state)}`
      
      console.log('🔗 Gmail OAuth URL:', authUrl.replace(/state=[^&]+/, 'state=***'))

      // Open OAuth popup
      const width = 500
      const height = 600
      const left = (window.screen.width - width) / 2
      const top = (window.screen.height - height) / 2

      oauthWindowRef.current = window.open(
        authUrl,
        'Gmail Authentication',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
      )

      if (!oauthWindowRef.current) {
        setStatus('error')
        setErrorMessage('Popup blocked. Please allow popups for this site and try again.')
        return
      }

      // Listen for OAuth callback
      const handleMessage = (event) => {
        // Security: verify origin
        if (event.origin !== window.location.origin) {
          return
        }

        if (event.data.type === 'gmail_oauth_success') {
          const { code, state: receivedState } = event.data

          // Verify state
          const storedState = localStorage.getItem('gmail_oauth_state')
          if (storedState !== receivedState) {
            setStatus('error')
            setErrorMessage('OAuth state mismatch. Please try again.')
            window.removeEventListener('message', handleMessage)
            if (checkIntervalRef.current) {
              clearInterval(checkIntervalRef.current)
              checkIntervalRef.current = null
            }
            return
          }

          localStorage.removeItem('gmail_oauth_state')

          // Exchange code for tokens (this should be done server-side in production)
          exchangeCodeForTokens(code, clientIdValue)
            .then((result) => {
              if (result.success) {
                setStatus('success')
                setUserEmail(result.email || '')
              } else {
                setStatus('error')
                setErrorMessage(result.error || 'Failed to authenticate')
              }
            })
            .catch((err) => {
              setStatus('error')
              setErrorMessage(err.message || 'Authentication failed')
            })
            .finally(() => {
              window.removeEventListener('message', handleMessage)
              if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
              }
              if (oauthWindowRef.current && !oauthWindowRef.current.closed) {
                oauthWindowRef.current.close()
              }
            })
        }

        if (event.data.type === 'gmail_oauth_error') {
          setStatus('error')
          setErrorMessage(event.data.error || 'Authentication failed')
          window.removeEventListener('message', handleMessage)
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
          }
          if (oauthWindowRef.current && !oauthWindowRef.current.closed) {
            oauthWindowRef.current.close()
          }
        }
      }

      window.addEventListener('message', handleMessage)

      // Check if popup was closed manually
      checkIntervalRef.current = setInterval(() => {
        if (oauthWindowRef.current && oauthWindowRef.current.closed) {
          if (status === 'loading') {
            setStatus('idle')
            setErrorMessage('')
          }
          window.removeEventListener('message', handleMessage)
          clearInterval(checkIntervalRef.current)
          checkIntervalRef.current = null
        }
      }, 500)

    } catch (err) {
      setStatus('error')
      setErrorMessage(err.message || 'Failed to start authentication')
    }
  }

  const getBackendBase = () => {
    try {
      const env = typeof import.meta !== 'undefined' ? import.meta.env || {} : {}
      const base =
        env.VITE_GMAIL_API_BASE_URL ||
        env.VITE_API_BASE_URL ||
        '' // Empty string means use relative path, which will work with Vite proxy
      return String(base || '').replace(/\/+$/, '')
    } catch {
      return '' // Empty string = relative path
    }
  }

  const exchangeCodeForTokens = async (code, clientIdValue) => {
    // In production, this should be done server-side for security
    // For now, we'll use a client-side approach (less secure but works for localhost)
    
    const redirectUri = `${window.location.origin}/gmail-oauth-callback`
    
    try {
      // For development: use a proxy endpoint or handle client-side
      // Note: Client secret should NEVER be exposed to frontend
      // This is a simplified version - in production, use a backend endpoint
      
      // Check if there's a backend endpoint
      const backendBase = getBackendBase()
      const endpoint = `${backendBase}/gmail/oauth/token`
      
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            redirectUri,
          }),
        })

        if (response.ok) {
          const data = await response.json()
          return {
            success: true,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            email: data.email,
            expiresIn: data.expires_in,
          }
        }
      } catch (backendError) {
        // Backend endpoint not available, show instruction
        console.warn('Backend OAuth endpoint not available:', backendError)
      }

      // Fallback: show instructions for manual setup
      return {
        success: false,
        error: 'OAuth token exchange requires a backend endpoint. Please configure the OAuth backend or use the manual setup option.',
        needsBackend: true,
      }
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Failed to exchange authorization code',
      }
    }
  }

  const handleComplete = () => {
    if (!userEmail) {
      setErrorMessage('Email address not available')
      return
    }

    const accountData = {
      email: userEmail,
      workspaceId: selectedWorkspaceId || null,
      authenticated: true,
      authenticatedAt: Date.now(),
    }

    onSuccess?.(accountData)
    setStatus('idle')
    setUserEmail('')
    setSelectedWorkspaceId('')
    onClose()
  }

  // Get Client ID - check on every render to ensure it's up-to-date
  const clientIdValue = getClientId()
  const needsClientId = !clientIdValue || !clientIdValue.trim()

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        setStatus('idle')
        setErrorMessage('')
        setUserEmail('')
        setSelectedWorkspaceId('')
        onClose()
      }
    }}>
      <DialogContent className="sm:max-w-md bg-black/95 border-white/20 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Mail className="w-5 h-5" />
            Connect Gmail Account
          </DialogTitle>
          <DialogDescription className="text-white/70">
            Sign in with your Google account to access your Gmail inbox
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {needsClientId ? (
            <div className="p-4 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div className="text-yellow-200 text-sm font-medium">OAuth Client ID Required</div>
                  <div className="text-yellow-200/80 text-xs">
                    To use Gmail authentication, you need to configure a Google OAuth Client ID.
                  </div>
                  <div className="text-yellow-200/70 text-[11px] space-y-1">
                    <div>1. Go to Google Cloud Console</div>
                    <div>2. Create OAuth 2.0 credentials</div>
                    <div>3. Add authorized redirect URI: <code className="bg-black/30 px-1 rounded">{window.location.origin}/gmail-oauth-callback</code></div>
                    <div>4. Enter Client ID in settings above, or restart dev server if using .env.local</div>
                    <div className="text-yellow-200/60 text-[10px] mt-1">
                      Note: If using .env.local, restart your dev server for credentials to load.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : status === 'idle' ? (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-white/80 text-xs font-medium mb-1.5 block">
                    Associate with workspace (optional)
                  </label>
                  <select
                    value={selectedWorkspaceId}
                    onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                    className="w-full bg-white/10 text-white/90 text-xs rounded-md border border-white/20 px-3 py-2 focus:outline-none focus:border-white/40"
                  >
                    <option value="">No workspace</option>
                    {workspaces.map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.name || ws.id}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleSignIn}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-md text-white text-sm font-medium transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  Sign in with Google
                </button>
              </div>
            </>
          ) : status === 'loading' ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              <div className="text-white/70 text-sm">Opening Google sign-in...</div>
              <div className="text-white/50 text-xs">Complete authentication in the popup window</div>
            </div>
          ) : status === 'success' ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-500/20 border border-green-500/50 rounded-lg">
                <div className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-green-200 text-sm font-medium">Authentication successful!</div>
                    <div className="text-green-200/80 text-xs mt-1">
                      Signed in as: <span className="font-medium">{userEmail}</span>
                    </div>
                  </div>
                </div>
              </div>
              {workspaces.length > 0 && (
                <div>
                  <label className="text-white/80 text-xs font-medium mb-1.5 block">
                    Associate with workspace (optional)
                  </label>
                  <select
                    value={selectedWorkspaceId}
                    onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                    className="w-full bg-white/10 text-white/90 text-xs rounded-md border border-white/20 px-3 py-2 focus:outline-none focus:border-white/40"
                  >
                    <option value="">No workspace</option>
                    {workspaces.map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.name || ws.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleComplete}
                  className="flex-1 px-4 py-2 bg-cyan-500/30 hover:bg-cyan-500/40 border border-cyan-400/60 rounded-md text-white text-sm font-medium transition-colors"
                >
                  Add Account
                </button>
                <button
                  onClick={() => {
                    setStatus('idle')
                    setUserEmail('')
                    setSelectedWorkspaceId('')
                  }}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-md text-white text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : status === 'error' ? (
            <div className="space-y-3">
              <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
                <div className="flex items-start gap-2">
                  <X className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-red-200 text-sm font-medium">Authentication failed</div>
                    <div className="text-red-200/80 text-xs mt-1">{errorMessage || 'An error occurred during authentication'}</div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStatus('idle')
                    setErrorMessage('')
                  }}
                  className="flex-1 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-md text-white text-sm font-medium transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-white/70 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default GmailAuthModal
