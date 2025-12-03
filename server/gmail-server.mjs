import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const PORT = process.env.GMAIL_PORT ? Number(process.env.GMAIL_PORT) : 3500
const DATA_DIR = process.env.GMAIL_DATA_DIR || path.resolve('/app/uploads/gmail')
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json')
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json')

// Credentials can be updated at runtime
let CLIENT_ID = process.env.GMAIL_CLIENT_ID || ''
let CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || ''

// Load credentials from file if it exists (takes precedence over env vars)
async function loadCredentialsFromFile() {
  try {
    const data = await fs.readFile(CREDENTIALS_FILE, 'utf8')
    const json = JSON.parse(data)
    if (json.client_id) CLIENT_ID = json.client_id
    if (json.client_secret) CLIENT_SECRET = json.client_secret
    console.log('[gmail-server] Loaded credentials from file')
  } catch {
    // File doesn't exist or invalid, use env vars
  }
}

// Save credentials to file
async function saveCredentialsToFile(clientId, clientSecret) {
  await ensureDir(DATA_DIR)
  await fs.writeFile(CREDENTIALS_FILE, JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    updated_at: new Date().toISOString()
  }, null, 2), 'utf8')
  CLIENT_ID = clientId
  CLIENT_SECRET = clientSecret
  console.log('[gmail-server] Credentials updated and saved to file')
}

// Load credentials on startup
loadCredentialsFromFile().catch(() => {})

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type':
      typeof body === 'string'
        ? 'text/plain; charset=utf-8'
        : 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...headers
  })
  res.end(payload)
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        // 1MB safety limit
        body = ''
        resolve({})
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function readTokens() {
  try {
    const txt = await fs.readFile(TOKENS_FILE, 'utf8')
    const data = JSON.parse(txt || '{}')
    if (!data || typeof data !== 'object') return { accounts: {} }
    if (!data.accounts || typeof data.accounts !== 'object') {
      data.accounts = {}
    }
    return data
  } catch {
    return { accounts: {} }
  }
}

async function writeTokens(data) {
  await ensureDir(DATA_DIR)
  const safe = {
    accounts:
      data && typeof data === 'object' && data.accounts && typeof data.accounts === 'object'
        ? data.accounts
        : {}
  }
  await fs.writeFile(TOKENS_FILE, JSON.stringify(safe, null, 2), 'utf8')
}

async function exchangeCodeForTokens(code, redirectUri) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'Gmail client credentials not configured (set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET)'
    )
  }

  const params = new URLSearchParams()
  params.set('code', code)
  params.set('client_id', CLIENT_ID)
  params.set('client_secret', CLIENT_SECRET)
  params.set('redirect_uri', redirectUri)
  params.set('grant_type', 'authorization_code')

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  })

  const json = await resp.json().catch(() => ({}))
  if (!resp.ok || !json.access_token) {
    const errMsg =
      json.error_description || json.error || `Upstream token error ${resp.status}`
    throw new Error(errMsg)
  }

  return json
}

async function refreshAccessToken(refreshToken) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'Gmail client credentials not configured (set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET)'
    )
  }
  if (!refreshToken) {
    throw new Error('Missing refresh token for account')
  }

  const params = new URLSearchParams()
  params.set('refresh_token', refreshToken)
  params.set('client_id', CLIENT_ID)
  params.set('client_secret', CLIENT_SECRET)
  params.set('grant_type', 'refresh_token')

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  })

  const json = await resp.json().catch(() => ({}))
  if (!resp.ok || !json.access_token) {
    const errMsg =
      json.error_description || json.error || `Refresh token error ${resp.status}`
    throw new Error(errMsg)
  }

  return json
}

async function fetchUserInfo(accessToken) {
  const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })
  if (!resp.ok) {
    return {}
  }
  const json = await resp.json().catch(() => ({}))
  return json || {}
}

async function getAccountTokens(email) {
  const store = await readTokens()
  const key = String(email || '').toLowerCase()
  const entry = store.accounts[key]
  if (!entry || !entry.refresh_token) {
    throw new Error('No stored tokens for this email')
  }

  const now = Date.now()
  const needsRefresh =
    !entry.access_token ||
    !entry.expiry_date ||
    Number(entry.expiry_date) <= now + 60_000

  if (!needsRefresh) {
    return { store, entry }
  }

  const refreshed = await refreshAccessToken(entry.refresh_token)
  const expiresInSec = Number(refreshed.expires_in || 3600)
  const updated = {
    ...entry,
    access_token: refreshed.access_token,
    scope: refreshed.scope || entry.scope || '',
    token_type: refreshed.token_type || entry.token_type || 'Bearer',
    expiry_date: now + expiresInSec * 1000,
    updated_at: new Date().toISOString()
  }
  store.accounts[key] = updated
  await writeTokens(store)
  return { store, entry: updated }
}

function formatTimestamp(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n)) return Date.now()
  return n
}

function extractHeader(headers, name) {
  if (!Array.isArray(headers)) return ''
  const lower = String(name || '').toLowerCase()
  for (const h of headers) {
    if (!h || typeof h.name !== 'string') continue
    if (h.name.toLowerCase() === lower) {
      return String(h.value || '')
    }
  }
  return ''
}

async function listMessagesForAccount(email, maxResults = 20) {
  let entry, token
  try {
    const result = await getAccountTokens(email)
    entry = result.entry
    token = entry.access_token
    if (!token) {
      throw new Error('No access token available for this account')
    }
  } catch (e) {
    console.error(`[gmail-server] Token error for ${email}:`, e.message)
    throw e
  }

  const max = Math.max(1, Math.min(50, Number(maxResults) || 20))

  const listUrl = new URL(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages'
  )
  listUrl.searchParams.set('maxResults', String(max))
  listUrl.searchParams.set('labelIds', 'INBOX')

  const listResp = await fetch(listUrl.toString(), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
  const listJson = await listResp.json().catch(() => ({}))
  if (!listResp.ok) {
    const errMsg =
      listJson.error?.message ||
      listJson.error_description ||
      listJson.error ||
      `Gmail messages error ${listResp.status}`
    throw new Error(errMsg)
  }

  const baseMessages = Array.isArray(listJson.messages)
    ? listJson.messages.slice(0, max)
    : []
  if (!baseMessages.length) {
    return []
  }

  const detailed = []
  for (const msg of baseMessages) {
    if (!msg || !msg.id) continue
    try {
      const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
        msg.id
      )}?format=full`
      const dResp = await fetch(detailUrl, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const dJson = await dResp.json().catch(() => ({}))
      if (!dResp.ok) {
        continue
      }
      const headers = dJson.payload?.headers || []
      const from = extractHeader(headers, 'From') || email
      const subject = extractHeader(headers, 'Subject') || '(no subject)'
      const dateHeader = extractHeader(headers, 'Date')
      let ts = null
      if (dJson.internalDate) {
        ts = formatTimestamp(dJson.internalDate)
      } else if (dateHeader) {
        const parsed = Date.parse(dateHeader)
        ts = Number.isNaN(parsed) ? Date.now() : parsed
      } else {
        ts = Date.now()
      }
      const labels = Array.isArray(dJson.labelIds) ? dJson.labelIds : []
      const unread = labels.includes('UNREAD')
      const starred = labels.includes('STARRED')
      const snippet = dJson.snippet || ''

      detailed.push({
        id: dJson.id || msg.id,
        email,
        sender: from,
        subject,
        snippet,
        timestamp: ts,
        unread,
        starred
      })
    } catch {
      // Skip individual message errors
    }
  }

  // Sort newest first
  detailed.sort((a, b) => {
    const ta = Number(a.timestamp || 0)
    const tb = Number(b.timestamp || 0)
    return tb - ta
  })

  return detailed
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `localhost:${PORT}`
    const url = new URL(req.url, `http://${host}`)
    const p = url.pathname
    // Debug: Log all incoming requests to /gmail/*
    if (p && p.startsWith('/gmail/')) {
      console.log(`[gmail-server] Request - Method: ${req.method}, Pathname: ${p}, Full URL: ${req.url}`)
    }

    if (req.method === 'OPTIONS') {
      send(res, 204, '')
      return
    }

    if (
      req.method === 'GET' &&
      (p === '/gmail/health' || p === '/gmail/api/v1/health')
    ) {
      send(res, 200, {
        ok: true,
        service: 'gmail',
        hasClientId: !!CLIENT_ID,
        hasClientSecret: !!CLIENT_SECRET
      })
      return
    }

    // Update credentials endpoint
    if (req.method === 'POST' && p === '/gmail/credentials') {
      const body = await parseBody(req)
      const clientId = String(body.client_id || body.clientId || '').trim()
      const clientSecret = String(body.client_secret || body.clientSecret || '').trim()
      
      if (!clientId || !clientSecret) {
        send(res, 400, { error: 'Missing client_id or client_secret' })
        return
      }
      
      try {
        await saveCredentialsToFile(clientId, clientSecret)
        send(res, 200, {
          success: true,
          message: 'Credentials updated successfully',
          hasClientId: !!CLIENT_ID,
          hasClientSecret: !!CLIENT_SECRET
        })
      } catch (e) {
        send(res, 500, { error: e?.message || 'Failed to save credentials' })
      }
      return
    }

    if (req.method === 'POST' && p === '/gmail/oauth/token') {
      const body = await parseBody(req)
      const code = String(body.code || '').trim()
      const redirectUri = String(body.redirectUri || '').trim()
      if (!code || !redirectUri) {
        send(res, 400, { error: 'Missing code or redirectUri' })
        return
      }
      try {
        const tokenJson = await exchangeCodeForTokens(code, redirectUri)
        const accessToken = tokenJson.access_token
        const refreshToken = tokenJson.refresh_token || ''
        const expiresIn = Number(tokenJson.expires_in || 3600)

        const user = await fetchUserInfo(accessToken)
        const email =
          String(user.email || tokenJson.email || '').trim().toLowerCase()
        if (!email) {
          throw new Error(
            'Unable to resolve user email from Google profile; ensure userinfo scopes are granted'
          )
        }

        const store = await readTokens()
        const key = email
        const prev = store.accounts[key] || {}
        const effectiveRefresh =
          refreshToken || prev.refresh_token || tokenJson.refresh_token || ''
        if (!effectiveRefresh) {
          // Still store short-lived access token, but warn about missing refresh
          console.warn(
            '[gmail-server] No refresh_token received; account may not persist across restarts'
          )
        }
        store.accounts[key] = {
          email,
          access_token: accessToken,
          refresh_token: effectiveRefresh,
          scope: tokenJson.scope || prev.scope || '',
          token_type: tokenJson.token_type || prev.token_type || 'Bearer',
          expiry_date: Date.now() + expiresIn * 1000,
          created_at: prev.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
        await writeTokens(store)

        send(res, 200, {
          access_token: accessToken,
          refresh_token: effectiveRefresh,
          email,
          expires_in: expiresIn
        })
      } catch (e) {
        send(res, 500, { error: e?.message || 'Token exchange failed' })
      }
      return
    }

    if (req.method === 'GET' && p === '/gmail/messages') {
      const email = url.searchParams.get('email') || ''
      const maxStr = url.searchParams.get('max') || ''
      const cleanEmail = String(email || '').trim().toLowerCase()
      if (!cleanEmail) {
        send(res, 400, { error: 'Missing email query parameter' })
        return
      }
      try {
        const messages = await listMessagesForAccount(cleanEmail, maxStr)
        send(res, 200, { email: cleanEmail, messages })
      } catch (e) {
        console.error(`[gmail-server] Error fetching messages for ${cleanEmail}:`, e)
        send(res, 500, { 
          error: e?.message || 'Failed to list messages',
          details: String(e || '')
        })
      }
      return
    }

    // Get single email full content
    if (req.method === 'GET' && p.startsWith('/gmail/message/')) {
      console.log(`[gmail-server] GET /gmail/message/ - Pathname: ${p}, Full URL: ${req.url}`)
      const messageId = p.replace('/gmail/message/', '').split('?')[0]
      const email = url.searchParams.get('email') || ''
      const cleanEmail = String(email || '').trim().toLowerCase()
      console.log(`[gmail-server] Extracted - messageId: ${messageId}, email: ${cleanEmail}`)
      if (!cleanEmail || !messageId) {
        console.log(`[gmail-server] Missing params - messageId: ${!!messageId}, email: ${!!cleanEmail}`)
        send(res, 400, { error: 'Missing email or messageId parameter' })
        return
      }
      try {
        const result = await getAccountTokens(cleanEmail)
        const token = result.entry.access_token
        if (!token) {
          send(res, 401, { error: 'No access token available' })
          return
        }
        const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`
        const dResp = await fetch(detailUrl, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!dResp.ok) {
          const errorData = await dResp.json().catch(() => ({}))
          send(res, dResp.status, { error: errorData.error?.message || 'Failed to fetch message' })
          return
        }
        const dJson = await dResp.json()
        const headers = dJson.payload?.headers || []
        
        // Extract body content
        function extractBody(payload) {
          if (!payload) return { text: '', html: '' }
          let text = ''
          let html = ''
          
          function walkParts(parts) {
            if (!Array.isArray(parts)) return
            for (const part of parts) {
              const mimeType = part.mimeType || ''
              const bodyData = part.body?.data || ''
              if (bodyData) {
                try {
                  const content = Buffer.from(bodyData, 'base64').toString('utf-8')
                  if (mimeType === 'text/plain') {
                    text = content
                  } else if (mimeType === 'text/html') {
                    html = content
                  }
                } catch {}
              }
              if (part.parts) {
                walkParts(part.parts)
              }
            }
          }
          
          if (payload.parts) {
            walkParts(payload.parts)
          } else if (payload.body?.data) {
            const mimeType = payload.mimeType || ''
            try {
              const content = Buffer.from(payload.body.data, 'base64').toString('utf-8')
              if (mimeType === 'text/plain') {
                text = content
              } else if (mimeType === 'text/html') {
                html = content
              }
            } catch {}
          }
          
          return { text, html }
        }
        
        const body = extractBody(dJson.payload)
        const labels = Array.isArray(dJson.labelIds) ? dJson.labelIds : []
        
        send(res, 200, {
          id: dJson.id,
          email: cleanEmail,
          sender: extractHeader(headers, 'From') || cleanEmail,
          subject: extractHeader(headers, 'Subject') || '(no subject)',
          to: extractHeader(headers, 'To') || '',
          cc: extractHeader(headers, 'Cc') || '',
          date: extractHeader(headers, 'Date') || '',
          timestamp: formatTimestamp(dJson.internalDate),
          body: body.text || body.html || '',
          htmlBody: body.html || '',
          textBody: body.text || '',
          snippet: dJson.snippet || '',
          unread: labels.includes('UNREAD'),
          starred: labels.includes('STARRED'),
          labels: labels
        })
      } catch (e) {
        console.error(`[gmail-server] Error fetching message ${messageId} for ${cleanEmail}:`, e)
        send(res, 500, { error: e?.message || 'Failed to fetch message' })
      }
      return
    }

    // Send email endpoint
    if (req.method === 'POST' && p === '/gmail/send') {
      console.log(`[gmail-server] POST /gmail/send - Pathname: ${p}`)
      const body = await parseBody(req)
      console.log(`[gmail-server] Send request body:`, { email: body.email, to: body.to, subject: body.subject })
      const email = String(body.email || '').trim().toLowerCase()
      const to = String(body.to || '').trim()
      const cc = String(body.cc || '').trim()
      const bcc = String(body.bcc || '').trim()
      const subject = String(body.subject || '').trim()
      const textBody = String(body.textBody || body.body || '').trim()
      const htmlBody = String(body.htmlBody || '').trim()
      
      if (!email || !to || !subject) {
        send(res, 400, { error: 'Missing required fields: email, to, subject' })
        return
      }
      
      try {
        const result = await getAccountTokens(email)
        const token = result.entry.access_token
        if (!token) {
          send(res, 401, { error: 'No access token available' })
          return
        }
        
        // Build email message in RFC 2822 format
        let message = []
        message.push(`To: ${to}`)
        if (cc) message.push(`Cc: ${cc}`)
        if (bcc) message.push(`Bcc: ${bcc}`)
        message.push(`Subject: ${subject}`)
        message.push('MIME-Version: 1.0')
        
        if (htmlBody) {
          // Multipart message with HTML
          const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36)}`
          message.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
          message.push('')
          message.push(`--${boundary}`)
          message.push('Content-Type: text/plain; charset=UTF-8')
          message.push('Content-Transfer-Encoding: 7bit')
          message.push('')
          message.push(textBody || htmlBody.replace(/<[^>]*>/g, ''))
          message.push(`--${boundary}`)
          message.push('Content-Type: text/html; charset=UTF-8')
          message.push('Content-Transfer-Encoding: 7bit')
          message.push('')
          message.push(htmlBody)
          message.push(`--${boundary}--`)
        } else {
          // Plain text message
          message.push('Content-Type: text/plain; charset=UTF-8')
          message.push('Content-Transfer-Encoding: 7bit')
          message.push('')
          message.push(textBody)
        }
        
        const rawMessage = message.join('\r\n')
        const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        
        // Send via Gmail API
        const sendUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
        const sendResp = await fetch(sendUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            raw: encodedMessage
          })
        })
        
        if (!sendResp.ok) {
          const errorData = await sendResp.json().catch(() => ({}))
          throw new Error(errorData.error?.message || `Failed to send email: ${sendResp.status}`)
        }
        
        const sendData = await sendResp.json()
        send(res, 200, {
          success: true,
          messageId: sendData.id,
          threadId: sendData.threadId
        })
      } catch (e) {
        console.error(`[gmail-server] Error sending email for ${email}:`, e)
        send(res, 500, { error: e?.message || 'Failed to send email' })
      }
      return
    }

    // Log unmatched routes for debugging
    console.log(`[gmail-server] 404 - Method: ${req.method}, Pathname: ${p}, Full URL: ${req.url}`)
    send(res, 404, { error: 'Not found' })
  } catch (e) {
    console.error(`[gmail-server] Server error:`, e)
    send(res, 500, { error: e?.message || 'Server error' })
  }
})

server.listen(PORT, () => {
  console.log(`gmail-server listening on :${PORT}`)
})

