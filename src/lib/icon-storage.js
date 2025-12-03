// Client helper to save normalized icons into the project via Icons API

const DEFAULT_ENDPOINT = '/icons-api/save'

async function postJson(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function trySaveIconToProject(dataUrl, suggestedName = 'icon') {
  const payload = { dataUrl, name: suggestedName }
  const candidates = [
    DEFAULT_ENDPOINT,
    'http://localhost:3100/save?type=icon',
    'http://127.0.0.1:3100/save?type=icon',
    'http://host.docker.internal:3100/save?type=icon',
  ]
  for (const url of candidates) {
    try {
      const json = await postJson(url, payload)
      if (json && json.ok && json.url) {
        // If we posted to a relative endpoint, serve via same proxy prefix
        if (url.startsWith('/')) {
          const proxied = `/icons-api${json.url.startsWith('/') ? json.url : '/' + json.url}`
          const u = new URL(proxied, window.location.origin)
          return u.href
        }
        // Absolute endpoint: resolve against the same server
        const base = new URL(url)
        const absolute = new URL(json.url, `${base.protocol}//${base.host}`)
        return absolute.href
      }
    } catch {}
  }
  return null
}
