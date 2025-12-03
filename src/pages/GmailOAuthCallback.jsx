import { useEffect, useState } from 'react'
import { Loader2, X, CheckCircle } from 'lucide-react'

/**
 * Gmail OAuth Callback Page
 * 
 * This page handles the OAuth redirect from Google
 * It extracts the authorization code and sends it back to the parent window
 */
const GmailOAuthCallback = () => {
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('Completing authentication...')

  useEffect(() => {
    const handleCallback = () => {
      try {
        // Get URL parameters
        const urlParams = new URLSearchParams(window.location.search)
        const code = urlParams.get('code')
        const error = urlParams.get('error')
        const state = urlParams.get('state')

        // If no opener, this was opened directly (not in a popup)
        const hasOpener = window.opener && !window.opener.closed

        // If opened directly without OAuth params and no opener, redirect to home
        if (!hasOpener && !code && !error) {
          // Direct navigation - silently redirect to home
          setTimeout(() => {
            try {
              window.location.href = '/'
            } catch {
              try {
                window.close()
              } catch {}
            }
          }, 100)
          return
        }

        // Get state from localStorage for verification
        const storedState = localStorage.getItem('gmail_oauth_state')

        if (error) {
          const errorMsg = error === 'access_denied' 
            ? 'Access denied. Please try again and grant the required permissions.' 
            : error
          
          // Send error to parent window
          if (hasOpener) {
            window.opener.postMessage({
              type: 'gmail_oauth_error',
              error: errorMsg,
            }, window.location.origin)
            setTimeout(() => {
              window.close()
            }, 500)
          } else {
            setStatus('error')
            setMessage(errorMsg)
            setTimeout(() => {
              window.close()
            }, 3000)
          }
          return
        }

        if (code && state) {
          // Verify state
          if (storedState && storedState !== state) {
            const errorMsg = 'OAuth state mismatch. Please try again.'
            if (hasOpener) {
              window.opener.postMessage({
                type: 'gmail_oauth_error',
                error: errorMsg,
              }, window.location.origin)
              setTimeout(() => {
                window.close()
              }, 500)
            } else {
              setStatus('error')
              setMessage(errorMsg)
            }
            return
          }

          // Send success message to parent window
          if (hasOpener) {
            window.opener.postMessage({
              type: 'gmail_oauth_success',
              code,
              state,
            }, window.location.origin)
            
            setStatus('success')
            setMessage('Authentication successful! Closing window...')
            
            // Close popup after a short delay
            setTimeout(() => {
              window.close()
            }, 500)
          } else {
            // No opener - store code for manual retrieval
            localStorage.setItem('gmail_oauth_code', code)
            localStorage.setItem('gmail_oauth_state_received', state)
            setStatus('error')
            setMessage('Authentication code received, but no parent window found. Please return to the application and try again.')
            setTimeout(() => {
              window.close()
            }, 5000)
          }
        } else {
          // Invalid callback - missing code
          const errorMsg = 'Invalid OAuth callback. Missing authorization code.'
          if (hasOpener) {
            window.opener.postMessage({
              type: 'gmail_oauth_error',
              error: errorMsg,
            }, window.location.origin)
            setTimeout(() => {
              window.close()
            }, 500)
          } else {
            setStatus('error')
            setMessage(errorMsg)
            setTimeout(() => {
              window.close()
            }, 3000)
          }
        }
      } catch (err) {
        console.error('OAuth callback error:', err)
        const errorMsg = err.message || 'Failed to process OAuth callback'
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            type: 'gmail_oauth_error',
            error: errorMsg,
          }, window.location.origin)
          setTimeout(() => {
            window.close()
          }, 500)
        } else {
          setStatus('error')
          setMessage(errorMsg)
          setTimeout(() => {
            window.close()
          }, 3000)
        }
      }
    }

    // Small delay to ensure window is ready
    const timer = setTimeout(() => {
      handleCallback()
    }, 100)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md mx-4">
        {status === 'loading' && (
          <>
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
            <div className="text-white/70 text-sm">{message}</div>
            <div className="text-white/50 text-xs">You can close this window if it doesn't close automatically</div>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="w-8 h-8 text-green-400 mx-auto" />
            <div className="text-white/70 text-sm">{message}</div>
          </>
        )}
        {status === 'error' && (
          <>
            <X className="w-8 h-8 text-red-400 mx-auto" />
            <div className="text-white/70 text-sm">{message}</div>
            <div className="text-white/50 text-xs mt-2">This window will close automatically</div>
            <button
              onClick={() => {
                try {
                  window.close()
                } catch {
                  window.location.href = '/'
                }
              }}
              className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-md text-white text-sm"
            >
              Close Window
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default GmailOAuthCallback

