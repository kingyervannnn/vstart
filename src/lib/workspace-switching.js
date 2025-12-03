/**
 * Workspace Switching Logic Manager
 * 
 * This module centralizes and refines the workspace switching behavior,
 * ensuring consistent theme token application and proper hard/soft switch handling.
 * 
 * The manager also handles the "Double-click for workspace URL" feature:
 * - When a workspace tab is double-clicked, it becomes the "active toggle tab"
 * - Only the active toggle tab can disable the double-click URL feature
 * - Double-clicking a different tab transfers the toggle responsibility to that tab
 */

/**
 * Slugifies workspace name for URL generation
 */
function slugifyWorkspaceName(name) {
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

/**
 * Workspace switching manager class
 */
export class WorkspaceSwitchingManager {
  constructor(options = {}) {
    this.workspaces = options.workspaces || []
    this.settings = options.settings || {}
    this.onWorkspaceChange = options.onWorkspaceChange || (() => {})
    this.onUrlChange = options.onUrlChange || (() => {})
    this.onThemeChange = options.onThemeChange || (() => {})
    this.onSettingsChange = options.onSettingsChange || (() => {})
    
    // Debounce URL updates to prevent rapid-fire history changes
    this.lastUrlUpdate = 0
    this.urlUpdateDelay = 300

    // Debounce workspace switches to handle rapid clicks
    this.pendingSwitchTimeout = null
    this.pendingSwitchId = null
    this.switchDebounceDelay = 150

    // Track which workspace tab is responsible for the double-click URL toggle
    this.activeToggleTabId = null
  }

  /**
   * Updates the manager's state
   */
  updateState(newOptions) {
    const prevSettings = this.settings
    Object.assign(this, newOptions)
    
    // If autoUrlDoubleClick was disabled externally (e.g. through settings menu),
    // clear the active toggle tab
    if (prevSettings?.general?.autoUrlDoubleClick && !this.settings?.general?.autoUrlDoubleClick) {
      this.activeToggleTabId = null
    }
  }

  /**
   * Determines the switching mode based on settings
   */
  getSwitchingMode() {
    const doubleClickEnabled = this.settings?.general?.autoUrlDoubleClick
    const slugEnabled = this.settings?.speedDial?.slugEnabled !== false // Default to true
    
    return {
      doubleClickEnabled,
      slugEnabled,
      // When double click is enabled:
      // - Single click = soft switch (no URL change, theme tokens only)
      // - Double click = hard switch (URL change, full theme + background)
      // When double click is disabled:
      // - Single click = hard switch (URL change, full theme + background)
      singleClickIsHard: !doubleClickEnabled
    }
  }

  /**
   * Performs a workspace switch with proper theme application
   */
  switchWorkspace(workspaceId, switchType = 'auto') {
    const workspace = this.workspaces.find(w => w.id === workspaceId)
    if (!workspace) {
      console.warn('Workspace not found:', workspaceId)
      return false
    }

    // Cancel any pending switch
    if (this.pendingSwitchTimeout) {
      clearTimeout(this.pendingSwitchTimeout)
      this.pendingSwitchTimeout = null
    }

    // Store the pending switch
    this.pendingSwitchId = { workspaceId, switchType }

    // Debounce the actual switch execution
    this.pendingSwitchTimeout = setTimeout(() => {
      const pending = this.pendingSwitchId
      this.pendingSwitchId = null
      this.pendingSwitchTimeout = null

      if (!pending) return

      const mode = this.getSwitchingMode()
      
      // Determine if this should be a hard or soft switch
      let isHardSwitch = false
      
      if (pending.switchType === 'hard') {
        isHardSwitch = true
      } else if (pending.switchType === 'soft') {
        isHardSwitch = false
      } else if (pending.switchType === 'auto') {
        // Auto-determine based on mode
        isHardSwitch = mode.singleClickIsHard
      }

      // Apply workspace change immediately
      this.onWorkspaceChange(pending.workspaceId)

      // Apply theme changes (always happens for both hard and soft switches)
      this.applyThemeChanges(pending.workspaceId, isHardSwitch)

      // Handle URL changes for hard switches
      if (isHardSwitch && mode.slugEnabled) {
        const workspace = this.workspaces.find(w => w.id === pending.workspaceId)
        if (workspace) {
          this.updateUrl(workspace)
        }
      }
    }, this.switchDebounceDelay)

    return true
  }

  /**
   * Handles single click on workspace
   */
  handleSingleClick(workspaceId) {
    const mode = this.getSwitchingMode()
    const switchType = mode.singleClickIsHard ? 'hard' : 'soft'
    return this.switchWorkspace(workspaceId, switchType)
  }

  /**
   * Handles double click on workspace
   */
  handleDoubleClick(workspaceId) {
    const mode = this.getSwitchingMode()
    const currentlyEnabled = mode.doubleClickEnabled
    
    if (currentlyEnabled) {
      // If this is the active toggle tab, disable the feature
      if (workspaceId === this.activeToggleTabId) {
        this.activeToggleTabId = null
        this.onSettingsChange({
          general: { autoUrlDoubleClick: false }
        })
        return true
      }
      // If a different tab was double-clicked, transfer the toggle responsibility
      this.activeToggleTabId = workspaceId
      return this.switchWorkspace(workspaceId, 'hard')
    } else {
      // Enable the feature and set this tab as the active toggle tab
      this.activeToggleTabId = workspaceId
      this.onSettingsChange({
        general: { autoUrlDoubleClick: true },
        speedDial: { glowByUrl: true }
      })
      return true
    }
  }

  /**
   * Applies theme changes for the workspace switch
   */
  applyThemeChanges(workspaceId, isHardSwitch) {
    // Theme token changes always apply for both hard and soft switches
    this.onThemeChange({
      workspaceId,
      isHardSwitch,
      applyBackground: isHardSwitch, // Backgrounds only change on hard switches
      applyTokens: true // Theme tokens always apply
    })
  }

  /**
   * Updates the URL for hard switches
   */
  updateUrl(workspace) {
    try {
      // Debounce URL updates
      const now = Date.now()
      if (now - this.lastUrlUpdate < this.urlUpdateDelay) {
        return
      }
      this.lastUrlUpdate = now

      const slug = slugifyWorkspaceName(workspace.name || 'workspace')
      const newPath = `/${slug}`

      // Update URL and state
      const nextPath = newPath === '' ? '/' : newPath
      window.history.pushState(
        { workspaceId: workspace.id, path: nextPath }, 
        '', 
        nextPath
      )
      
      // Update document title
      document.title = `${workspace.name} — Start`
      
      // Dispatch custom event for URL change
      window.dispatchEvent(new CustomEvent('app-workspace-url-change', { 
        detail: { id: workspace.id, slug } 
      }))

      // Notify callback
      this.onUrlChange(nextPath)
      
    } catch (err) {
      console.error('Failed to update URL:', err)
    }
  }

  /**
   * Handles browser back/forward navigation
   */
  handlePopState(event) {
    if (event.state?.workspaceId) {
      // Navigate to workspace from history state
      this.switchWorkspace(event.state.workspaceId, 'hard')
    } else {
      // Try to determine workspace from current URL
      const path = window.location.pathname
      const workspace = this.findWorkspaceByPath(path)
      if (workspace) {
        this.switchWorkspace(workspace.id, 'hard')
      }
    }
  }

  /**
   * Finds workspace by URL path
   */
  findWorkspaceByPath(path) {
    if (path === '/') {
      return this.workspaces[0] || null
    }

    // Remove leading slash and find matching workspace
    const slug = path.replace(/^\/+/, '')
    return this.workspaces.find(workspace => {
      const workspaceSlug = slugifyWorkspaceName(workspace.name)
      return workspaceSlug === slug
    }) || null
  }

  /**
   * Initializes the switching manager with event listeners
   */
  initialize() {
    // Listen for browser navigation
    window.addEventListener('popstate', (event) => {
      this.handlePopState(event)
    })

    // Listen for custom workspace URL change events
    window.addEventListener('app-workspace-url-change', (event) => {
      // This event is dispatched when URL is updated programmatically
      // We can use it for additional synchronization if needed
    })
  }

  /**
   * Cleans up event listeners and pending operations
   */
  destroy() {
    if (this.pendingSwitchTimeout) {
      clearTimeout(this.pendingSwitchTimeout)
      this.pendingSwitchTimeout = null
    }
    this.pendingSwitchId = null
    window.removeEventListener('popstate', this.handlePopState)
    window.removeEventListener('app-workspace-url-change', this.handleUrlChange)
  }
}

/**
 * Factory function to create workspace switching manager
 */
export function createWorkspaceSwitchingManager(options) {
  return new WorkspaceSwitchingManager(options)
}

/**
 * Utility function to get current normalized path
 */
export function getNormalizedPath() {
  if (typeof window === 'undefined') return '/'
  try {
    const raw = window.location.pathname || ''
    const trimmed = raw.replace(/\/+$/, '')
    return trimmed === '' ? '/' : trimmed
  } catch {
    return '/'
  }
}
