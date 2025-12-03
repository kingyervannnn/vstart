/**
 * Centralized Theme Token Management
 * 
 * This module provides a unified interface for resolving theme tokens
 * across workspace switching, ensuring consistent application of fonts,
 * text colors, accent colors, and glow effects.
 */

// Unified font preset definitions shared across the site + header banners
export const FONT_PRESET_DEFINITIONS = [
  { id: 'industrial', label: 'Industrial', family: 'Noto Sans JP, Inter, system-ui, sans-serif' },
  { id: 'modern', label: 'Modern', family: 'Inter, system-ui, Arial, sans-serif' },
  { id: 'roboto', label: 'Roboto', family: 'Roboto, system-ui, Arial, sans-serif' },
  { id: 'bauhaus', label: 'Bauhaus', family: 'Josefin Sans, system-ui, Arial, sans-serif' },
  { id: 'terminal', label: 'Terminal', family: 'Fira Code, Menlo, Monaco, Consolas, "Courier New", monospace' },
  { id: 'minecraft', label: 'Minecraft', family: 'Press Start 2P, VT323, monospace' },
  { id: 'orbitron', label: 'Orbitron', family: 'Orbitron, Inter, system-ui, sans-serif' },
  { id: 'system', label: 'System', family: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, sans-serif' },
  { id: 'bebas-neue', label: 'Bebas Neue', family: '"Bebas Neue", Inter, system-ui, sans-serif' },
  { id: 'exo-2', label: 'Exo 2', family: '"Exo 2", Inter, system-ui, sans-serif' },
  { id: 'audiowide', label: 'Audiowide', family: 'Audiowide, Inter, system-ui, sans-serif' },
  { id: 'saira', label: 'Saira', family: 'Saira, Inter, system-ui, sans-serif' },
  { id: 'kanit', label: 'Kanit', family: 'Kanit, Inter, system-ui, sans-serif' },
  { id: 'lexend', label: 'Lexend', family: 'Lexend, Inter, system-ui, sans-serif' },
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat, Inter, system-ui, sans-serif' },
  { id: 'josefin-sans', label: 'Josefin Sans', family: 'Josefin Sans, system-ui, Arial, sans-serif' },
  { id: 'space-grotesk', label: 'Space Grotesk', family: 'Space Grotesk, Inter, system-ui, sans-serif' },
  { id: 'manrope', label: 'Manrope', family: 'Manrope, Inter, system-ui, sans-serif' },
  { id: 'tr2n', label: 'TR2N', family: '"TR2N", "Tron Legacy", Orbitron, system-ui, sans-serif' },
  { id: 'tron-legacy', label: 'Tron Legacy', family: '"Tron Legacy", "TR2N", Orbitron, system-ui, sans-serif' },
  { id: 'neuropol-x', label: 'Neuropol X', family: '"Neuropol X", Neuropol, Orbitron, system-ui, sans-serif' },
  { id: 'prisma', label: 'Prisma', family: 'Prisma, "Outrunner", "Retro Wave", system-ui, sans-serif' },
  { id: 'outrunner', label: 'Outrunner', family: 'Outrunner, "Retro Wave", "Neuropol X", system-ui, sans-serif' },
  { id: 'retro-wave', label: 'Retro Wave', family: '"Retro Wave", Outrunner, "Neuropol X", system-ui, sans-serif' },
]

const buildFontPresetMap = () => {
  const map = {}
  FONT_PRESET_DEFINITIONS.forEach(({ id, label, family }) => {
    const variations = new Set([
      id,
      label,
      id.replace(/_/g, '-'),
      label.toLowerCase(),
      id.toLowerCase(),
      label.toLowerCase().replace(/\s+/g, '-'),
      label.toLowerCase().replace(/-/g, ' '),
      id.toLowerCase().replace(/-/g, ' ')
    ])
    variations.forEach(key => {
      const normalized = String(key || '').trim().toLowerCase()
      if (!normalized) return
      map[normalized] = family
    })
  })
  return map
}

export const WORKSPACE_FONT_PRESETS = buildFontPresetMap()

/**
 * Strips alpha channel from hex color values
 */
function stripAlphaFromHex(hex) {
  if (!hex || typeof hex !== 'string') return '#ffffff'
  const clean = hex.trim()
  if (clean.startsWith('#')) {
    const withoutHash = clean.slice(1)
    if (withoutHash.length >= 6) {
      return '#' + withoutHash.slice(0, 6)
    }
  }
  return hex
}

/**
 * Resolves workspace-specific font family
 */
function resolveWorkspaceFont(workspaceId, settings) {
  if (!workspaceId || !settings?.speedDial?.workspaceTextFonts) {
    return undefined
  }
  const workspaceFont = settings.speedDial.workspaceTextFonts[workspaceId]
  if (!workspaceFont) return undefined
  const presetKey = String(workspaceFont).trim().toLowerCase()
  return WORKSPACE_FONT_PRESETS[presetKey] || workspaceFont
}

/**
 * Resolves workspace-specific text color
 */
function resolveWorkspaceTextColor(workspaceId, settings) {
  if (!workspaceId || !settings?.speedDial?.workspaceTextColors) {
    return undefined
  }
  
  return settings.speedDial.workspaceTextColors[workspaceId]
}

/**
 * Resolves workspace-specific accent color
 */
function resolveWorkspaceAccentColor(workspaceId, settings) {
  if (!workspaceId || !settings?.speedDial?.workspaceAccentColors) {
    return undefined
  }
  
  return settings.speedDial.workspaceAccentColors[workspaceId]
}

/**
 * Resolves workspace-specific glow color
 */
function resolveWorkspaceGlowColor(workspaceId, settings) {
  if (!workspaceId || !settings?.speedDial?.workspaceGlowColors) {
    return undefined
  }
  
  return settings.speedDial.workspaceGlowColors[workspaceId]
}

/**
 * Determines if workspace theming should apply based on URL matching
 */
function shouldApplyWorkspaceTheming(workspaceId, currentPath, workspaces, settings) {
  const anchoredWorkspaceId = settings?.speedDial?.anchoredWorkspaceId || null
  if (anchoredWorkspaceId && workspaceId && workspaceId === anchoredWorkspaceId) {
    return false
  }
  if (!workspaceId || !settings?.speedDial?.workspaceTextByUrl) {
    return true // Always apply workspace theming when URL matching is disabled
  }
  
  // Find the workspace and check if current path matches its slug
  const workspace = workspaces?.find(w => w.id === workspaceId)
  if (!workspace) return false
  
  const slug = slugifyWorkspaceName(workspace.name)
  const expectedPath = `/${slug}`
  
  return currentPath === expectedPath
}

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
 * Main theme token resolver class
 */
export class ThemeTokenResolver {
  constructor(settings, workspaces, currentPath) {
    this.settings = settings
    this.workspaces = workspaces
    this.currentPath = currentPath
    // Initialize header color mode per workspace (and Base)
    this.workspaceHeaderColorMode = settings.speedDial?.workspaceHeaderColorMode || {}
    this.BASE_KEY = '__base__'
    // Cache for resolved tokens to avoid redundant calculations
    this.tokenCache = new Map()
    this.cacheKey = null
  }

  /**
   * Generates a cache key from the current state
   */
  getCacheKey(workspaceId, options) {
    const path = String(this.currentPath || '/').trim() || '/'
    const anchoredId = this.settings?.speedDial?.anchoredWorkspaceId || null
    const optsKey = JSON.stringify(options || {})
    return `${workspaceId || 'none'}:${path}:${anchoredId || 'none'}:${optsKey}`
  }

  /**
   * Invalidates the cache (call when settings change)
   */
  invalidateCache() {
    this.tokenCache.clear()
    this.cacheKey = null
  }

  /**
   * Updates resolver state and invalidates cache if needed
   */
  updateState(settings, workspaces, currentPath) {
    const settingsChanged = this.settings !== settings
    const workspacesChanged = this.workspaces !== workspaces
    const pathChanged = this.currentPath !== currentPath

    if (settingsChanged || workspacesChanged || pathChanged) {
      this.settings = settings
      this.workspaces = workspaces
      this.currentPath = currentPath
      // Only invalidate cache if settings or workspaces changed (path changes are expected)
      if (settingsChanged || workspacesChanged) {
        this.invalidateCache()
      }
    }
  }

  _normalizeKey(workspaceId) {
    return workspaceId ? String(workspaceId) : this.BASE_KEY
  }

  getHeaderColorMode(workspaceId) {
    const key = this._normalizeKey(workspaceId)
    return this.workspaceHeaderColorMode[key] || 'text'
  }

  setHeaderColorMode(workspaceId, mode) {
    const key = this._normalizeKey(workspaceId)
    const nextMode = ['text', 'accent', 'glow'].includes(String(mode)) ? String(mode) : 'text'
    this.workspaceHeaderColorMode[key] = nextMode
    this.saveSettings()
  }

  saveSettings() {
    // Persist the settings
    this.settings.speedDial = this.settings.speedDial || {}
    this.settings.speedDial.workspaceHeaderColorMode = { ...this.workspaceHeaderColorMode }
  }

  removeWorkspaceSettings(workspaceId) {
    const key = this._normalizeKey(workspaceId)
    delete this.workspaceHeaderColorMode[key]
    this.saveSettings()
  }

  /**
   * Resolves theme tokens for a specific workspace context
   */
  resolveTokens(workspaceId, options = {}) {
    // Check cache first
    const cacheKey = this.getCacheKey(workspaceId, options)
    if (this.tokenCache.has(cacheKey)) {
      return this.tokenCache.get(cacheKey)
    }

    const {
      forceWorkspaceTheming = false,
      excludeBackground = false,
      unchangeableFont = false,
      unchangeableTextColor = false
    } = options

    // Check if workspace theming is enabled in settings
    const workspaceThemingEnabled = this.settings?.workspaceThemingEnabled !== false
    // If workspace theming is disabled, ignore workspace-specific settings
    const shouldUseWorkspaceTheming = workspaceThemingEnabled

    // Determine if workspace theming should apply based on current context
    const baseShouldApply = shouldUseWorkspaceTheming && (
      forceWorkspaceTheming ||
      shouldApplyWorkspaceTheming(workspaceId, this.currentPath, this.workspaces, this.settings)
    )

    const anchoredWorkspaceId = this.settings?.speedDial?.anchoredWorkspaceId || null
    const isAnchored = !!(anchoredWorkspaceId && workspaceId && workspaceId === anchoredWorkspaceId)

    const normalizedPath = String(this.currentPath || '/').trim() || '/'
    const isDefaultPath = normalizedPath === '/' || normalizedPath === '/index.html'

    const lastInConfig = this.settings?.theme?.lastIn || {}
    const lastInEnabled = typeof lastInConfig.enabled === 'boolean' ? lastInConfig.enabled : true
    const lastInIncludeGlow = typeof lastInConfig.includeGlow === 'boolean' ? lastInConfig.includeGlow : true
    const lastInIncludeTypography = typeof lastInConfig.includeTypography === 'boolean' ? lastInConfig.includeTypography : true

    const allowLastInGlow = !forceWorkspaceTheming && !isAnchored && lastInEnabled && lastInIncludeGlow && isDefaultPath && !!workspaceId && shouldUseWorkspaceTheming
    const allowLastInTypography = !forceWorkspaceTheming && !isAnchored && lastInEnabled && lastInIncludeTypography && isDefaultPath && !!workspaceId && shouldUseWorkspaceTheming

    // Only resolve workspace-specific settings if workspace theming is enabled
    const workspaceFont = shouldUseWorkspaceTheming ? resolveWorkspaceFont(workspaceId, this.settings) : undefined
    const workspaceTextColor = shouldUseWorkspaceTheming ? resolveWorkspaceTextColor(workspaceId, this.settings) : undefined
    const workspaceAccentColor = shouldUseWorkspaceTheming ? resolveWorkspaceAccentColor(workspaceId, this.settings) : undefined
    const workspaceGlowColor = shouldUseWorkspaceTheming ? resolveWorkspaceGlowColor(workspaceId, this.settings) : undefined

    const applyWorkspaceTheme = baseShouldApply && !isAnchored
    const applyGlow = applyWorkspaceTheme || allowLastInGlow
    const applyTypography = applyWorkspaceTheme || allowLastInTypography

    // Resolve base values
    const basePresetKey = (typeof this.settings?.appearance?.fontPreset === 'string')
      ? this.settings.appearance.fontPreset.trim().toLowerCase()
      : undefined
    const baseFontFamily = basePresetKey 
      ? WORKSPACE_FONT_PRESETS[basePresetKey] || this.settings.theme?.font || 'Inter'
      : this.settings.theme?.font || 'Inter'
    
    const basePrimaryColor = stripAlphaFromHex(this.settings?.theme?.colors?.primary || '#ffffff')
    const baseAccentColor = stripAlphaFromHex(this.settings?.theme?.colors?.accent || '#ff00ff')

    // Apply workspace overrides based on appearance settings
    // Fonts are allowed to follow the workspace whenever a workspace font
    // is configured, except for the anchored workspace (which stays on the
    // global/default typography). This keeps "Default typography" from
    // overriding other workspaces.
    let resolvedFont = baseFontFamily
    if (
      !unchangeableFont &&
      this.settings?.appearance?.matchWorkspaceFonts &&
      workspaceFont &&
      !isAnchored
    ) {
      resolvedFont = workspaceFont
    }

    let resolvedTextColor = basePrimaryColor
    if (!unchangeableTextColor && this.settings?.appearance?.matchWorkspaceTextColor && workspaceTextColor && applyTypography) {
      resolvedTextColor = stripAlphaFromHex(workspaceTextColor)
    }

    let resolvedAccentColor = baseAccentColor
    if (this.settings?.appearance?.matchWorkspaceAccentColor) {
      const workspaceAccent = (applyTypography || applyGlow)
        ? (workspaceAccentColor || (applyGlow ? workspaceGlowColor : undefined))
        : undefined
      if (workspaceAccent) {
        resolvedAccentColor = stripAlphaFromHex(workspaceAccent)
      }
    }

    // Resolve glow color (workspace glow takes precedence over global)
    const defaultOuterGlowEnabled = this.settings?.theme?.includeGlow !== false
    const resolvedGlowColor = (applyGlow && workspaceGlowColor) || (defaultOuterGlowEnabled ? (this.settings?.speedDial?.glowColor || '#00ffff66') : '#00000000')

    // Use header color mode from settings
    const headerColorMode = this.getHeaderColorMode(workspaceId)
    let headerColor
    if (headerColorMode === 'accent') {
      headerColor = resolvedAccentColor
    } else if (headerColorMode === 'glow') {
      // strip alpha channel for header text rendering
      headerColor = stripAlphaFromHex(resolvedGlowColor)
    } else {
      headerColor = resolvedTextColor
    }

    const result = {
      fontFamily: resolvedFont,
      textColor: resolvedTextColor,
      accentColor: resolvedAccentColor,
      glowColor: resolvedGlowColor,
      headerColor: headerColor,
      // Metadata for debugging
      _meta: {
        workspaceId,
        baseShouldApply,
        isAnchored,
        applyWorkspaceTheme,
        workspaceFont,
        workspaceTextColor,
        workspaceAccentColor,
        workspaceGlowColor,
        applyGlow,
        applyTypography,
        allowLastInGlow,
        allowLastInTypography,
        lastInEnabled,
        lastInIncludeGlow,
        lastInIncludeTypography,
        isDefaultPath,
        unchangeableFont,
        unchangeableTextColor
      }
    }

    // Cache the result (limit cache size to prevent memory issues)
    if (this.tokenCache.size > 50) {
      // Remove oldest entries (simple FIFO)
      const firstKey = this.tokenCache.keys().next().value
      this.tokenCache.delete(firstKey)
    }
    this.tokenCache.set(cacheKey, result)

    return result
  }

  /**
   * Resolves tokens for unchangeable UI elements (Speed Dial popup, Settings, AI selector)
   */
  resolveUnchangeableTokens() {
    return this.resolveTokens(null, {
      unchangeableFont: true,
      unchangeableTextColor: true,
      excludeBackground: true
    })
  }

  /**
   * Resolves tokens for widgets (Clock/Weather) with full workspace conformance
   */
  resolveWidgetTokens(workspaceId) {
    return this.resolveTokens(workspaceId, {
      forceWorkspaceTheming: true
    })
  }
}

/**
 * Factory function to create theme token resolver
 */
export function createThemeTokenResolver(settings, workspaces, currentPath) {
  return new ThemeTokenResolver(settings, workspaces, currentPath)
}

/**
 * Hook-like function for use in React components
 */
export function useThemeTokens(settings, workspaces, currentPath, workspaceId, options = {}) {
  const resolver = createThemeTokenResolver(settings, workspaces, currentPath)
  return resolver.resolveTokens(workspaceId, options)
}
