// Client-side library for interacting with backgrounds-server API
// Falls back to IndexedDB if server is unavailable

const DEFAULT_ENDPOINT = '/backgrounds-api'

async function postJson(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function deleteRequest(url) {
  const res = await fetch(url, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * Try to save a background to the server
 * @param {File|Blob} file - The file to upload
 * @param {string} suggestedName - Suggested filename
 * @returns {Promise<{url: string, id: string} | null>} - Server URL and ID, or null if server unavailable
 */
export async function trySaveBackgroundToServer(file, suggestedName = 'background') {
  try {
    // Convert file to data URL
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const payload = { dataUrl, name: suggestedName }
    const candidates = [
      `${DEFAULT_ENDPOINT}/save`,
      'http://localhost:3100/save?type=background',
      'http://127.0.0.1:3100/save?type=background',
      'http://host.docker.internal:3100/save?type=background',
    ]
    
    for (const url of candidates) {
      try {
        const json = await postJson(url, payload)
        if (json && json.ok && json.url) {
          // If we posted to a relative endpoint, serve via same proxy prefix
          if (url.startsWith('/')) {
            const proxied = `/backgrounds-api${json.url.startsWith('/') ? json.url : '/' + json.url}`
            const u = new URL(proxied, window.location.origin)
            return { url: u.href, id: json.id, mime: json.mime, size: json.size }
          }
          // Absolute endpoint: resolve against the same server
          const base = new URL(url)
          const absolute = new URL(json.url, `${base.protocol}//${base.host}`)
          return { url: absolute.href, id: json.id, mime: json.mime, size: json.size }
        }
      } catch (e) {
        // Try next candidate
        continue
      }
    }
  } catch (e) {
    console.warn('Failed to save background to server:', e)
  }
  return null
}

/**
 * List backgrounds from the server
 * @returns {Promise<Array<{id: string, url: string, name: string, size: number, mime: string}> | null>}
 */
export async function tryListBackgroundsFromServer() {
  const candidates = [
    `${DEFAULT_ENDPOINT}/list`,
    'http://localhost:3100/list?type=background',
    'http://127.0.0.1:3100/list?type=background',
    'http://host.docker.internal:3100/list?type=background',
  ]
  
  for (const url of candidates) {
    try {
      const json = await getJson(url)
      if (json && json.ok && Array.isArray(json.backgrounds)) {
        // Resolve URLs relative to the endpoint
        return json.backgrounds.map(bg => {
          if (url.startsWith('/') && bg.url.startsWith('/')) {
            const proxied = `/backgrounds-api${bg.url}`
            const u = new URL(proxied, window.location.origin)
            return { ...bg, url: u.href }
          }
          if (!url.startsWith('/') && bg.url.startsWith('/')) {
            const base = new URL(url)
            const absolute = new URL(bg.url, `${base.protocol}//${base.host}`)
            return { ...bg, url: absolute.href }
          }
          return bg
        })
      }
    } catch (e) {
      // Try next candidate
      continue
    }
  }
  return null
}

/**
 * Delete a background from the server
 * @param {string} id - Background ID to delete
 * @returns {Promise<boolean>} - True if deleted, false if server unavailable
 */
export async function tryDeleteBackgroundFromServer(id) {
  const candidates = [
    `${DEFAULT_ENDPOINT}/delete/${id}`,
    `http://localhost:3100/delete/${id}?type=background`,
    `http://127.0.0.1:3100/delete/${id}?type=background`,
    `http://host.docker.internal:3100/delete/${id}?type=background`,
  ]
  
  for (const url of candidates) {
    try {
      const json = await deleteRequest(url)
      if (json && json.ok) {
        return true
      }
    } catch (e) {
      // Try next candidate
      continue
    }
  }
  return false
}

/**
 * Check if the backgrounds server is available
 * @returns {Promise<boolean>}
 */
export async function checkBackgroundsServerAvailable() {
  const candidates = [
    `${DEFAULT_ENDPOINT}/health`,
    'http://localhost:3100/health',
    'http://127.0.0.1:3100/health',
    'http://host.docker.internal:3100/health',
  ]
  
  for (const url of candidates) {
    try {
      const json = await getJson(url)
      if (json && json.ok) {
        return true
      }
    } catch (e) {
      // Try next candidate
      continue
    }
  }
  return false
}


