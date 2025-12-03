// Content script injected into pages.
// On VSTART itself:
// - Periodically reports workspace state to the background worker
// - Receives "ADD_LINK_NOTE" messages and forwards them into the page

function isVstartPage() {
  try {
    if (typeof window === 'undefined' || !window.location) return false
    const { protocol, hostname, port } = window.location
    if (!protocol.startsWith('http')) return false
    if (hostname !== 'localhost') return false
    // Dev server often uses 3000; if empty, allow as well
    if (port && port !== '3000') return false
    return true
  } catch {
    return false
  }
}

function getWorkspaceStateFromPage() {
  try {
    const workspaces = Array.isArray(window.__APP_WORKSPACES__) ? window.__APP_WORKSPACES__ : []
    const activeId = typeof window.__ACTIVE_WORKSPACE_ID__ === 'string' ? window.__ACTIVE_WORKSPACE_ID__ : null
    const vaultLabel = typeof window.__NOTES_VAULT__ === 'string' && window.__NOTES_VAULT__.trim()
      ? window.__NOTES_VAULT__.trim()
      : null
    return { workspaces, activeId, vaultLabel }
  } catch {
    return { workspaces: [], activeId: null, vaultLabel: null }
  }
}

function reportStateOnce() {
  if (!isVstartPage()) return
  try {
    const { workspaces, activeId, vaultLabel } = getWorkspaceStateFromPage()
    if (!workspaces || !workspaces.length) return
    chrome.runtime.sendMessage({
      type: 'VSTART_STATE',
      workspaces,
      activeId,
      vaultLabel
    })
  } catch {
    // ignore
  }
}

// Send initial state (if available) and then keep it roughly up to date
reportStateOnce()
setInterval(reportStateOnce, 4000)

// Listen for messages from the background / popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'ADD_LINK_NOTE' && msg.payload && isVstartPage()) {
    try {
      window.dispatchEvent(new CustomEvent('ext-add-note-link', { detail: msg.payload }))
    } catch {
      // ignore
    }
  }

  if (msg.type === 'GET_VSTART_STATE_FROM_PAGE') {
    if (!isVstartPage()) {
      sendResponse && sendResponse({ ok: false, workspaces: [], activeId: null, vaultLabel: null })
      return true
    }
    const { workspaces, activeId, vaultLabel } = getWorkspaceStateFromPage()
    sendResponse && sendResponse({
      ok: !!(workspaces && workspaces.length),
      workspaces: workspaces || [],
      activeId: activeId || null,
      vaultLabel: vaultLabel || null
    })
    return true
  }
})
