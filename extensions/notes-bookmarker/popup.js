// Popup script: lets the user tweak title / URL and target workspace, then
// sends a request to the background worker to add a link note.

function $(id) {
  return document.getElementById(id)
}

async function getActiveTab() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0] ? tabs[0] : null)
      })
    } catch {
      resolve(null)
    }
  })
}

async function findVstartTab() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError) {
          resolve(null)
          return
        }
        const all = Array.isArray(tabs) ? tabs : []
        const candidates = all.filter((tab) => {
          if (!tab || !tab.url) return false
          const url = String(tab.url || '').toLowerCase()
          const title = String(tab.title || '').toLowerCase()
          if (title.includes('vivaldi hybrid start page')) return true
          if (url.includes('vstart')) return true
          if (url.includes('localhost:3000') || url.includes('localhost:4173')) return true
          return false
        })
        resolve(candidates[0] || null)
      })
    } catch {
      resolve(null)
    }
  })
}

async function getStateFromPage(tabId) {
  if (!tabId) return null
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'GET_VSTART_STATE_FROM_PAGE' }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null)
          return
        }
        if (resp && resp.ok) {
          resolve({
            workspaces: resp.workspaces || [],
            activeId: resp.activeId || null,
            vaultLabel: resp.vaultLabel || null
          })
        } else {
          resolve(null)
        }
      })
    } catch {
      resolve(null)
    }
  })
}

async function getStateViaScripting(tabId) {
  if (!tabId || !chrome.scripting || !chrome.scripting.executeScript) return null
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        try {
          const workspaces = Array.isArray(window.__APP_WORKSPACES__) ? window.__APP_WORKSPACES__ : []
          const activeId = typeof window.__ACTIVE_WORKSPACE_ID__ === 'string' ? window.__ACTIVE_WORKSPACE_ID__ : null
          const vaultLabel = typeof window.__NOTES_VAULT__ === 'string' && window.__NOTES_VAULT__.trim()
            ? window.__NOTES_VAULT__.trim()
            : null
          if (!workspaces || !workspaces.length) {
            return { ok: false, workspaces: [], activeId: null, vaultLabel: null }
          }
          return { ok: true, workspaces, activeId, vaultLabel }
        } catch {
          return { ok: false, workspaces: [], activeId: null }
        }
      }
    })
    if (Array.isArray(results)) {
      for (const r of results) {
        if (r && r.result && r.result.ok) {
          return {
            workspaces: r.result.workspaces || [],
            activeId: r.result.activeId || null,
            vaultLabel: r.result.vaultLabel || null
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function getState() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
        if (!resp || !resp.ok) {
          resolve({ workspaces: [], activeId: null, vaultLabel: null })
          return
        }
        resolve({
          workspaces: resp.workspaces || [],
          activeId: resp.activeId || null,
          vaultLabel: resp.vaultLabel || null
        })
      })
    } catch {
      resolve({ workspaces: [], activeId: null, vaultLabel: null })
    }
  })
}

async function init() {
  const titleInput = $('title')
  const urlInput = $('url')
  const bodyInput = $('body')
  const wsSelect = $('workspace')
  const wsHint = $('workspace-hint')
  const status = $('status')
  const saveBtn = $('save')

  const activeTab = await getActiveTab()
  if (activeTab) {
    urlInput.value = activeTab.url || ''
    titleInput.value = activeTab.title || ''
  }

  let state = null
  if (activeTab) {
    state = await getStateFromPage(activeTab.id)
    if (!state) {
      state = await getStateViaScripting(activeTab.id)
    }
  }
  if (!state) {
    const vstartTab = await findVstartTab()
    if (vstartTab) {
      state = await getStateFromPage(vstartTab.id)
      if (!state) {
        state = await getStateViaScripting(vstartTab.id)
      }
    }
  }
  if (!state) {
    state = await getState()
  }
  if (!state) {
    state = { workspaces: [], activeId: null, vaultLabel: null }
  }
  const workspaces = state.workspaces || []
  const activeId = state.activeId || null
  const vaultLabel = state.vaultLabel || null

  // Populate workspace dropdown
  while (wsSelect.firstChild) wsSelect.removeChild(wsSelect.firstChild)
  const noneOpt = document.createElement('option')
  noneOpt.value = ''
  noneOpt.textContent = 'None (unassigned)'
  wsSelect.appendChild(noneOpt)

  workspaces.forEach((ws) => {
    const opt = document.createElement('option')
    opt.value = ws.id
    opt.textContent = ws.name || ws.id
    wsSelect.appendChild(opt)
  })

  if (activeId && workspaces.some((w) => w.id === activeId)) {
    wsSelect.value = activeId
    wsHint.textContent = 'Last active workspace on VSTART is preselected.'
  } else if (workspaces.length) {
    wsHint.textContent = 'Choose which VSTART workspace this link belongs to.'
  } else {
    wsHint.textContent = 'No VSTART workspace data yet. Keep your VSTART page open once, then reload this popup.'
  }

  saveBtn.addEventListener('click', () => {
    const url = urlInput.value.trim()
    const title = titleInput.value.trim()
    const body = bodyInput.value.trim()
    const workspaceId = wsSelect.value.trim() || null
    status.textContent = ''
    if (!url) {
      status.textContent = 'Please enter a valid URL.'
      return
    }
    saveBtn.disabled = true
    chrome.runtime.sendMessage(
      { type: 'ADD_LINK_NOTE', url, title, workspaceId, body, vaultLabel },
      (resp) => {
        saveBtn.disabled = false
        if (!resp || !resp.ok) {
          status.textContent = 'Could not reach VSTART page. Is it open on http://localhost:3000/?'
          return
        }
        status.textContent = 'Saved to notes.'
        setTimeout(() => {
          window.close()
        }, 600)
      }
    )
  })
}

document.addEventListener('DOMContentLoaded', init)
