/**
 * Speed Dial Glow Refinement
 * 
 * Enhanced glow effects specifically optimized for Speed Dial visibility
 * and modern aesthetic balance.
 */

import { hexToRgba } from './glow-system.js'

/**
 * Creates an enhanced Speed Dial glow with refined intensity and spread
 */
export function createSpeedDialGlow(color, intensity = 1, settings = {}) {
  if (!color) return ''
  
  // Balanced alpha values for Speed Dial visibility
  const coreColor = hexToRgba(color, 0.6)
  const primaryColor = hexToRgba(color, 0.4)
  const secondaryColor = hexToRgba(color, 0.2)
  const ambientColor = hexToRgba(color, 0.1)
  const subtleColor = hexToRgba(color, 0.05)
  
  // Balanced intensity scaling for Speed Dial
  const clampedIntensity = Math.max(0.2, Math.min(2.0, intensity))
  
  // Multi-layer glow system optimized for Speed Dial
  const layers = [
    // Core glow - sharp and defined
    `0 0 ${8 * clampedIntensity}px ${2 * clampedIntensity}px ${coreColor}`,
    // Primary glow - main visibility layer
    `0 0 ${20 * clampedIntensity}px ${5 * clampedIntensity}px ${primaryColor}`,
    // Secondary glow - depth and softness
    `0 0 ${40 * clampedIntensity}px ${10 * clampedIntensity}px ${secondaryColor}`,
    // Ambient glow - atmospheric presence
    `0 0 ${60 * clampedIntensity}px ${15 * clampedIntensity}px ${ambientColor}`,
    // Subtle glow - extended reach
    `0 0 ${80 * clampedIntensity}px ${20 * clampedIntensity}px ${subtleColor}`
  ]
  
  return layers.join(', ')
}

/**
 * Creates enhanced glow for Speed Dial tiles with focus states
 */
export function createTileGlow(color, intensity = 1, state = 'normal') {
  if (!color) return ''
  
  const baseIntensity = intensity * (state === 'focus' ? 1.4 : state === 'hover' ? 1.2 : 1.0)
  
  // Tile-specific glow with tighter spread
  const coreColor = hexToRgba(color, 0.8)
  const primaryColor = hexToRgba(color, 0.5)
  const ambientColor = hexToRgba(color, 0.2)
  
  const layers = [
    `0 0 ${4 * baseIntensity}px ${1 * baseIntensity}px ${coreColor}`,
    `0 0 ${12 * baseIntensity}px ${3 * baseIntensity}px ${primaryColor}`,
    `0 0 ${24 * baseIntensity}px ${6 * baseIntensity}px ${ambientColor}`
  ]
  
  return layers.join(', ')
}

/**
 * Creates enhanced glow for workspace tabs with seamless integration
 */
export function createTabGlow(color, intensity = 1, isSelected = false, isTight = false) {
  if (!color) return ''
  
  const baseIntensity = intensity * (isSelected ? 1.3 : 0.8)
  
  if (isTight && isSelected) {
    // Tight tabs: no upper glow seam, enhanced side and bottom glow
    const coreColor = hexToRgba(color, 0.9)
    const primaryColor = hexToRgba(color, 0.6)
    const ambientColor = hexToRgba(color, 0.25)
    
    return [
      // Side glow
      `${3 * baseIntensity}px 0 ${12 * baseIntensity}px ${3 * baseIntensity}px ${coreColor}`,
      `-${3 * baseIntensity}px 0 ${12 * baseIntensity}px ${3 * baseIntensity}px ${coreColor}`,
      // Bottom glow
      `0 ${4 * baseIntensity}px ${16 * baseIntensity}px ${4 * baseIntensity}px ${primaryColor}`,
      // Ambient glow
      `0 0 ${32 * baseIntensity}px ${8 * baseIntensity}px ${ambientColor}`
    ].join(', ')
  } else {
    // Standard tab glow
    return createSpeedDialGlow(color, baseIntensity)
  }
}

/**
 * Enhanced glow transition styles for smooth animations
 */
export const enhancedGlowTransitions = {
  transition: 'box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), filter 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
  willChange: 'box-shadow, filter'
}

/**
 * Glow intensity presets for different use cases
 */
export const glowPresets = {
  subtle: 0.6,
  normal: 1.0,
  enhanced: 1.4,
  dramatic: 2.0,
  maximum: 2.5
}

/**
 * Applies refined glow based on element type and state
 */
export function applyRefinedGlow(elementType, color, intensity, options = {}) {
  switch (elementType) {
    case 'speed-dial':
      return createSpeedDialGlow(color, intensity, options)
    case 'tile':
      return createTileGlow(color, intensity, options.state)
    case 'tab':
      return createTabGlow(color, intensity, options.isSelected, options.isTight)
    default:
      return createSpeedDialGlow(color, intensity, options)
  }
}

/**
 * Handles soft switch glow behavior based on settings
 */
export function applySoftSwitchGlow(
  settings,
  activeWorkspaceId,
  hardWorkspaceId,
  elementType = 'speed-dial',
  elementWorkspaceId = null
) {
  const doubleClickEnabled = settings?.general?.autoUrlDoubleClick
  const glowByUrl = settings?.speedDial?.glowByUrl
  const softSwitchBehavior = settings?.speedDial?.softSwitchGlowBehavior || 'noGlow'
  const glowEnabled = settings?.speedDial?.glowEnabled

  // Check if workspace theming is enabled - if not, ignore workspace-specific glow colors
  const workspaceThemingEnabled = settings?.workspaceThemingEnabled !== false
  const workspaceGlowColors = workspaceThemingEnabled ? (settings?.speedDial?.workspaceGlowColors || {}) : {}
  const fallbackColor = settings?.speedDial?.glowColor || '#00ffff66'
  const per = Number(settings?.speedDial?.glowIntensity ?? 1.0)
  const cap = Number(settings?.appearance?.glowMaxIntensity ?? 2.5)
  const dialCap = Number(settings?.speedDial?.maxGlow ?? 2.5)
  const normPer = Math.max(0.1, Math.min(5, per))
  const normCap = Math.max(0.1, Math.min(5, cap))
  const normDialCap = Math.max(0.1, Math.min(5, dialCap))
  const intensity = Math.min(normPer, normCap, normDialCap)
  const anchoredWorkspaceId = settings?.speedDial?.anchoredWorkspaceId || null

  const lastInConfig = settings?.theme?.lastIn || {}
  const lastInEnabled = typeof lastInConfig.enabled === 'boolean' ? lastInConfig.enabled : true
  const lastInIncludeGlow = typeof lastInConfig.includeGlow === 'boolean' ? lastInConfig.includeGlow : true

  let normalizedPath = '/'
  if (typeof window !== 'undefined') {
    try {
      const raw = (window.location?.pathname || '/')
      const trimmed = raw.replace(/\/+$/, '')
      normalizedPath = trimmed === '' ? '/' : trimmed
    } catch {
      normalizedPath = '/'
    }
  }

  const isDefaultLocation = normalizedPath === '/' || normalizedPath === '/index.html'
  const allowLastInGlow = workspaceThemingEnabled && lastInEnabled && lastInIncludeGlow && isDefaultLocation && !hardWorkspaceId && !!activeWorkspaceId && (!anchoredWorkspaceId || anchoredWorkspaceId !== activeWorkspaceId)

  const getGlow = (workspaceId, allowWorkspaceColor = true) => {
    // If workspace theming is disabled, always use fallback color
    const shouldUseWorkspaceColor = workspaceThemingEnabled && allowWorkspaceColor
    const resolvedId = shouldUseWorkspaceColor ? workspaceId : null
    const useFallback = !resolvedId || (anchoredWorkspaceId && resolvedId === anchoredWorkspaceId)
    const color = (!useFallback && workspaceGlowColors[resolvedId]) || fallbackColor
    if (!color) return ''
    return applyRefinedGlow(elementType, color, intensity)
  }

  const shouldHighlightActiveTab = () => (
    elementType !== 'tab' || !elementWorkspaceId || elementWorkspaceId === activeWorkspaceId
  )

  if (!glowEnabled) {
    return ''
  }

  if (!doubleClickEnabled || !glowByUrl || !hardWorkspaceId) {
    if (elementType === 'tab' && !shouldHighlightActiveTab()) {
      return ''
    }
    const allowWorkspaceColors = !!hardWorkspaceId || allowLastInGlow
    const targetId = (elementType === 'tab' && elementWorkspaceId) ? elementWorkspaceId : activeWorkspaceId
    return getGlow(allowWorkspaceColors ? targetId : null, allowWorkspaceColors)
  }

  // Soft switch mode is active
  switch (softSwitchBehavior) {
    case 'noGlow':
      // Show glow only when active workspace matches the hard (URL) workspace
      if (!hardWorkspaceId || activeWorkspaceId !== hardWorkspaceId) {
        return ''
      }
      if (elementType === 'tab' && elementWorkspaceId && elementWorkspaceId !== hardWorkspaceId) {
        return ''
      }
      return getGlow(hardWorkspaceId)

    case 'pinnedGlow':
      // Glow stays pinned to hard workspace (URL-based workspace)
      if (!hardWorkspaceId) {
        return ''
      }
      if (elementType === 'tab' && elementWorkspaceId && elementWorkspaceId !== hardWorkspaceId) {
        return ''
      }
      return getGlow(hardWorkspaceId)

    case 'glowFollows':
      // For Speed Dial: keep pinned to the hard (URL) workspace color
      if (elementType === 'speed-dial') {
        return getGlow(hardWorkspaceId)
      }
      // For workspace tabs: the glow follows the active tab, but uses the hard URL color
      if (elementType === 'tab') {
        if (elementWorkspaceId && elementWorkspaceId === activeWorkspaceId) {
          return getGlow(hardWorkspaceId)
        }
        return ''
      }
      return ''

    default:
      if (!shouldHighlightActiveTab()) {
        return ''
      }
      return getGlow(activeWorkspaceId)
  }
}

/**
 * Determines if transient glow should be applied based on soft switch behavior
 */
export function shouldApplyTransientGlow(settings, switchType = 'soft') {
  const doubleClickEnabled = settings?.general?.autoUrlDoubleClick
  const glowByUrl = settings?.speedDial?.glowByUrl
  const softSwitchBehavior = settings?.speedDial?.softSwitchGlowBehavior || 'noGlow'
  const glowTransient = settings?.speedDial?.glowTransient
  
  if (!glowTransient) return false
  
  // Hard switches always get transient glow if enabled
  if (switchType === 'hard') return true
  
  // Soft switches depend on behavior setting
  if (doubleClickEnabled && glowByUrl) {
    return softSwitchBehavior !== 'noGlow'
  }
  
  return true
}
