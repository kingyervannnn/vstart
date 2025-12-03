// Background service worker for the Notes Link Booker extension.
// - Tracks last known workspaces + active workspace from the VSTART page
// - Persists that state so it survives service worker restarts
// - Forwards "add link note" requests from the popup into the VSTART tab(s)

const STORAGE_KEY = 'vstart_notes_state_v1'

let lastState = {
  workspaces: [],
  activeId: null,
  vaultLabel: null,
  tabId: null
}

// On startup, hydrate in-memory state from storage so the popup
// still knows about workspaces even if the VSTART tab is closed.
try {
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(STORAGE_KEY, (res) => {
      try {
        const stored = res && res[STORAGE_KEY]
        if (stored && typeof stored === 'object') {
          lastState = {
            ...lastState,
            workspaces: Array.isArray(stored.workspaces) ? stored.workspaces : lastState.workspaces,
            activeId: typeof stored.activeId === 'string' ? stored.activeId : lastState.activeId,
            vaultLabel: typeof stored.vaultLabel === 'string' ? stored.vaultLabel : lastState.vaultLabel
          }
        }
      } catch {
        // ignore hydration errors
      }
    })
  }
} catch {
  // ignore storage init failures
}

function isVstartTab(tab) {
  if (!tab || !tab.url) return false
  const title = (tab.title || '').toLowerCase()
  const url = String(tab.url || '').toLowerCase()
  return title.includes('vivaldi hybrid start page') || url.includes('vstart')
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'VSTART_STATE') {
    try {
      const workspaces = Array.isArray(msg.workspaces) ? msg.workspaces : []
      const activeId = typeof msg.activeId === 'string' ? msg.activeId : null
      const tabId = sender && sender.tab && sender.tab.id ? sender.tab.id : lastState.tabId
      const vaultLabel = typeof msg.vaultLabel === 'string' && msg.vaultLabel.trim()
        ? msg.vaultLabel.trim()
        : lastState.vaultLabel || null
      lastState = { workspaces, activeId, vaultLabel, tabId }
      // Persist a snapshot so it survives service worker restarts
      try {
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            [STORAGE_KEY]: {
              workspaces,
              activeId,
              vaultLabel
            }
          }, () => { /* ignore callback errors */ })
        }
      } catch {
        // ignore storage failures
      }
    } catch {
      // ignore
    }
    return
  }

  if (msg.type === 'GET_STATE') {
    // If we already have an in-memory snapshot, return it immediately.
    if (lastState.workspaces && lastState.workspaces.length) {
      try {
        sendResponse({
          ok: true,
          workspaces: lastState.workspaces || [],
          activeId: lastState.activeId || null,
          vaultLabel: lastState.vaultLabel || null
        })
      } catch {
        sendResponse({ ok: false, workspaces: [], activeId: null, vaultLabel: null })
      }
      return true
    }

    // Otherwise, try to hydrate from storage on demand.
    try {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(STORAGE_KEY, (res) => {
          try {
            const stored = res && res[STORAGE_KEY]
            if (stored && typeof stored === 'object') {
              const workspaces = Array.isArray(stored.workspaces) ? stored.workspaces : []
              const activeId = typeof stored.activeId === 'string' ? stored.activeId : null
              const vaultLabel = typeof stored.vaultLabel === 'string' ? stored.vaultLabel : null
              lastState = { ...lastState, workspaces, activeId, vaultLabel }
              sendResponse({
                ok: true,
                workspaces,
                activeId,
                vaultLabel
              })
            } else {
              sendResponse({ ok: false, workspaces: [], activeId: null, vaultLabel: null })
            }
          } catch {
            sendResponse({ ok: false, workspaces: [], activeId: null, vaultLabel: null })
          }
        })
        return true
      }
    } catch {
      // fall through
    }

    sendResponse({ ok: false, workspaces: [], activeId: null, vaultLabel: null })
    return true
  }

  if (msg.type === 'ADD_LINK_NOTE') {
    const payload = {
      url: String(msg.url || ''),
      title: String(msg.title || ''),
      workspaceId: typeof msg.workspaceId === 'string' && msg.workspaceId ? msg.workspaceId : null,
      body: String(msg.body || ''),
      vaultLabel: typeof msg.vaultLabel === 'string' && msg.vaultLabel.trim()
        ? msg.vaultLabel.trim()
        : lastState.vaultLabel || null
    }
    if (!payload.url) {
      sendResponse && sendResponse({ ok: false, error: 'Missing URL' })
      return
    }

    const dispatchToTabs = (tabs) => {
      const targetIds = new Set()
      if (lastState.tabId) targetIds.add(lastState.tabId)
      ;(tabs || []).forEach((tab) => {
        if (tab.id && isVstartTab(tab)) targetIds.add(tab.id)
      })

      if (!targetIds.size) {
        sendResponse && sendResponse({ ok: false, error: 'No VSTART tab found' })
        return
      }

      targetIds.forEach((tabId) => {
        try {
          chrome.tabs.sendMessage(tabId, { type: 'ADD_LINK_NOTE', payload })
        } catch {
          // ignore per-tab failures
        }
      })
      sendResponse && sendResponse({ ok: true })
    }

    try {
      chrome.tabs.query({}, (tabs) => {
        dispatchToTabs(tabs)
      })
      return true
    } catch (e) {
      sendResponse && sendResponse({ ok: false, error: String(e || 'error') })
    }
  }
})
