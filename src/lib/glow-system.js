import { useRef, useEffect } from 'react'

/**
 * Enhanced Glow System for Workspace Switching
 * 
 * This module provides a rebuilt glow system with tightened visuals,
 * smooth animations, and proper integration with existing settings.
 */

/**
 * Converts hex color to RGBA with alpha channel
 */
export function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string') return `rgba(255,255,255,${alpha})`
  
  let normalized = hex.trim()
  if (normalized.startsWith('#')) normalized = normalized.slice(1)
  
  // Handle 3-digit hex
  if (normalized.length === 3) {
    normalized = normalized.split('').map(ch => ch + ch).join('')
  }
  
  // Handle 8-digit hex (with alpha)
  if (normalized.length === 8) {
    normalized = normalized.slice(0, 6) // Strip existing alpha
  }
  
  if (normalized.length < 6) {
    return `rgba(255,255,255,${alpha})`
  }
  
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  
  return `rgba(${Number.isFinite(r) ? r : 255},${Number.isFinite(g) ? g : 255},${Number.isFinite(b) ? b : 255},${alpha})`
}

/**
 * Creates a multi-layered glow effect with enhanced visibility and smooth falloff
 */
function createTightenedGlow(color, intensity = 1, sectors = 'full') {
  if (!color) return ''
  
  // Balanced alpha values for appropriate visibility
  const baseColor = hexToRgba(color, 0.7)
  const midColor = hexToRgba(color, 0.4)
  const outerColor = hexToRgba(color, 0.18)
  const ambientColor = hexToRgba(color, 0.08)
  
  // Adjust intensity (0.1 to 2.0 range for balanced visibility)
  const clampedIntensity = Math.max(0.1, Math.min(2.0, intensity))
  
  // Balanced glow layers with appropriate spread
  const innerGlow = `0 0 ${5 * clampedIntensity}px ${1.5 * clampedIntensity}px ${baseColor}`
  const midGlow = `0 0 ${14 * clampedIntensity}px ${3.5 * clampedIntensity}px ${midColor}`
  const outerGlow = `0 0 ${28 * clampedIntensity}px ${7 * clampedIntensity}px ${outerColor}`
  const ambientGlow = `0 0 ${42 * clampedIntensity}px ${10 * clampedIntensity}px ${ambientColor}`
  
  // Handle glow sectors (directional glow) with enhanced visibility
  if (sectors === 'top') {
    return `0 -${3 * clampedIntensity}px ${12 * clampedIntensity}px ${3 * clampedIntensity}px ${baseColor}, 0 -${6 * clampedIntensity}px ${24 * clampedIntensity}px ${6 * clampedIntensity}px ${outerColor}`
  } else if (sectors === 'bottom') {
    return `0 ${3 * clampedIntensity}px ${12 * clampedIntensity}px ${3 * clampedIntensity}px ${baseColor}, 0 ${6 * clampedIntensity}px ${24 * clampedIntensity}px ${6 * clampedIntensity}px ${outerColor}`
  } else if (sectors === 'left') {
    return `-${3 * clampedIntensity}px 0 ${12 * clampedIntensity}px ${3 * clampedIntensity}px ${baseColor}, -${6 * clampedIntensity}px 0 ${24 * clampedIntensity}px ${6 * clampedIntensity}px ${outerColor}`
  } else if (sectors === 'right') {
    return `${3 * clampedIntensity}px 0 ${12 * clampedIntensity}px ${3 * clampedIntensity}px ${baseColor}, ${6 * clampedIntensity}px 0 ${24 * clampedIntensity}px ${6 * clampedIntensity}px ${outerColor}`
  }
  
  // Full glow (default) with enhanced 4-layer system
  return [innerGlow, midGlow, outerGlow, ambientGlow].join(', ')
}

/**
 * Enhanced Glow Manager Class
 */
export class GlowManager {
  constructor(settings = {}) {
    this.settings = settings
    this.activeGlows = new Map() // Track active glows to prevent overlaps
    this.transientTimers = new Map() // Track transient glow timers
    this.animationFrames = new Map() // Track animation frames for smooth transitions
  }

  /**
   * Updates settings
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings }
  }

  /**
   * Determines if glow should be applied based on current mode and settings
   */
  shouldApplyGlow(workspaceId, mode = 'default') {
    const glowEnabled = this.settings?.speedDial?.glowEnabled
    if (!glowEnabled) return false

    const doubleClickEnabled = this.settings?.general?.autoUrlDoubleClick
    const slugEnabled = this.settings?.speedDial?.slugEnabled !== false
    const glowByUrl = this.settings?.speedDial?.glowByUrl

    // Pinned glow and Follow glow only apply when double click is ON and URL slug is ON
    if (doubleClickEnabled && slugEnabled && glowByUrl) {
      const followGlow = this.settings?.speedDial?.followGlow
      
      if (mode === 'pinned') {
        // Pinned glow: stays on active workspace button
        return true
      } else if (mode === 'follow' && followGlow) {
        // Follow glow: follows the soft-switched tab/button
        return true
      }
    }

    return glowEnabled
  }

  /**
   * Gets the appropriate glow color for a workspace
   */
  getGlowColor(workspaceId) {
    const anchoredId = this.settings?.speedDial?.anchoredWorkspaceId || null
    if (!workspaceId || (anchoredId && workspaceId === anchoredId)) {
      return this.settings?.speedDial?.glowColor || '#00ffff66'
    }
    const workspaceGlowColors = this.settings?.speedDial?.workspaceGlowColors || {}
    return workspaceGlowColors[workspaceId] || this.settings?.speedDial?.glowColor || '#00ffff66'
  }

  /**
   * Gets glow intensity setting
   */
  getGlowIntensity() {
    const per = Number(this.settings?.speedDial?.glowIntensity ?? 1.0)
    const cap = Number(this.settings?.appearance?.glowMaxIntensity ?? 1.0)
    const normPer = Math.max(0.1, Math.min(2.5, per))
    const normCap = Math.max(0.1, Math.min(2.5, cap))
    return Math.min(normPer, normCap)
  }

  /**
   * Gets glow sectors setting
   */
  getGlowSectors() {
    return this.settings?.speedDial?.glowSectors || 'full'
  }

  /**
   * Creates a sustained glow for a workspace button
   */
  createSustainedGlow(workspaceId, mode = 'default') {
    if (!this.shouldApplyGlow(workspaceId, mode)) return ''

    const color = this.getGlowColor(workspaceId)
    const intensity = this.getGlowIntensity()
    const sectors = this.getGlowSectors()

    return createTightenedGlow(color, intensity, sectors)
  }

  resolveWorkspaceKey(workspaceId) {
    const key = workspaceId || '__default__'
    return String(key)
  }

  resolveTransientKey(workspaceId, contextKey = 'default') {
    const workspaceKey = this.resolveWorkspaceKey(workspaceId)
    const context = (contextKey && contextKey.toString()) || 'default'
    return `${workspaceKey}::${context}`
  }

  clearTransientKey(transientKey) {
    if (!transientKey) return
    const frameId = this.animationFrames.get(transientKey)
    if (frameId) {
      cancelAnimationFrame(frameId)
      this.animationFrames.delete(transientKey)
    }
    this.transientTimers.delete(transientKey)
  }

  /**
   * Creates a transient glow pulse with smooth animation
   */
  createTransientGlow(workspaceId, duration = 400, callback = null, options = {}) {
    if (!this.settings?.speedDial?.glowTransient) {
      if (callback) callback('')
      return ''
    }

    const contextKey = options?.contextKey || 'default'
    const transientKey = this.resolveTransientKey(workspaceId, contextKey)

    const color = this.getGlowColor(workspaceId)
    const baseIntensity = this.getGlowIntensity()
    const globalCapRaw = Number(this.settings?.appearance?.glowMaxIntensity ?? 1)
    const globalCap = Math.max(0.1, Math.min(2.5, globalCapRaw))
    const intensity = Math.min(baseIntensity * 1.6, globalCap)
    const sectors = this.getGlowSectors()

    // Clear any existing transient glow for this workspace
    this.clearTransientGlow(workspaceId, contextKey)

    const glowEffect = createTightenedGlow(color, intensity, sectors)

    // Set up smooth hold + fade animation
    const holdRatio = 0.65
    const holdBoost = Math.max(0, Number(options?.holdBoostMs) || 0)
    const holdDuration = Math.min((duration * holdRatio) + holdBoost + 1, duration - 60)
    const fadeDuration = Math.max(duration - holdDuration, 60)
    const fadeEasePower = Math.max(1.2, Number(options?.fadeEasePower) || 3.2)
    const startTime = Date.now()
    const animate = () => {
      const elapsed = Date.now() - startTime
      if (elapsed <= holdDuration) {
        if (callback) callback(glowEffect)
        const frameId = requestAnimationFrame(animate)
        this.animationFrames.set(transientKey, frameId)
        return
      }

      const fadeElapsed = Math.min(elapsed - holdDuration, fadeDuration)
      const fadeProgress = fadeElapsed / fadeDuration
      const eased = 1 - Math.pow(1 - fadeProgress, fadeEasePower)
      const currentIntensity = intensity * (1 - eased)

      if (fadeProgress >= 1) {
        this.clearTransientKey(transientKey)
        if (callback) callback('')
        return
      }

      const currentGlow = createTightenedGlow(color, currentIntensity, sectors)
      if (callback) callback(currentGlow)

      const frameId = requestAnimationFrame(animate)
      this.animationFrames.set(transientKey, frameId)
    }

    const frameId = requestAnimationFrame(animate)
    this.animationFrames.set(transientKey, frameId)
    this.transientTimers.set(transientKey, Date.now())

    return glowEffect
  }

  /**
   * Clears transient glow for a workspace
   */
  clearTransientGlow(workspaceId, contextKey = null) {
    const workspaceKey = this.resolveWorkspaceKey(workspaceId)

    if (typeof contextKey === 'string') {
      const key = this.resolveTransientKey(workspaceId, contextKey)
      this.clearTransientKey(key)
      return
    }

    const prefix = `${workspaceKey}::`
    for (const key of Array.from(this.animationFrames.keys())) {
      if (key.startsWith(prefix)) {
        this.clearTransientKey(key)
      }
    }
    for (const key of Array.from(this.transientTimers.keys())) {
      if (key.startsWith(prefix)) {
        this.clearTransientKey(key)
      }
    }
  }

  /**
   * Ensures only one workspace has glow at a time
   */
  setExclusiveGlow(workspaceId) {
    // Clear all other active glows
    for (const [id] of this.activeGlows) {
      if (id !== workspaceId) {
        this.clearTransientGlow(id)
        this.activeGlows.delete(id)
      }
    }

    // Set this workspace as having active glow
    this.activeGlows.set(workspaceId, true)
  }

  /**
   * Creates glow for focused state (when element has focus)
   */
  createFocusGlow(workspaceId) {
    const color = this.getGlowColor(workspaceId)
    const intensity = this.getGlowIntensity() * 0.9 // Enhanced focus glow for better visibility
    const sectors = this.getGlowSectors()

    return createTightenedGlow(color, intensity, sectors)
  }

  /**
   * Handles workspace switching with appropriate glow behavior
   */
  handleWorkspaceSwitch(fromWorkspaceId, toWorkspaceId, switchType = 'hard') {
    // Ensure exclusive glow
    this.setExclusiveGlow(toWorkspaceId)

    // Clear previous workspace glow
    if (fromWorkspaceId && fromWorkspaceId !== toWorkspaceId) {
      this.clearTransientGlow(fromWorkspaceId)
    }

    // Apply appropriate glow based on switch type and settings
    const doubleClickEnabled = this.settings?.general?.autoUrlDoubleClick
    const slugEnabled = this.settings?.speedDial?.slugEnabled !== false

    if (doubleClickEnabled && slugEnabled) {
      // In double-click mode with URL slugs
      if (switchType === 'hard') {
        // Hard switch: pinned glow
        return this.createSustainedGlow(toWorkspaceId, 'pinned')
      } else {
        // Soft switch: follow glow (if enabled)
        return this.createSustainedGlow(toWorkspaceId, 'follow')
      }
    } else {
      // Default mode: always sustained glow
      return this.createSustainedGlow(toWorkspaceId, 'default')
    }
  }

  /**
   * Cleanup method
   */
  destroy() {
    // Clear all timers and animation frames
    for (const key of Array.from(this.transientTimers.keys())) {
      this.clearTransientKey(key)
    }

    this.activeGlows.clear()
    this.transientTimers.clear()
    this.animationFrames.clear()
  }
}

/**
 * Factory function to create glow manager
 */
export function createGlowManager(settings) {
  return new GlowManager(settings)
}

/**
 * Utility function for creating quick glow effects
 */
export function createQuickGlow(color, intensity = 1, sectors = 'full') {
  return createTightenedGlow(color, intensity, sectors)
}

/**
 * CSS-in-JS helper for glow transitions
 */
export const glowTransitionStyles = {
  transition: 'box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
  willChange: 'box-shadow, filter'
}

/**
 * React hook for using glow system
 */
export function useGlowSystem(settings) {
  const glowManagerRef = useRef(null)

  if (!glowManagerRef.current) {
    glowManagerRef.current = new GlowManager(settings)
  }

  // Update settings when they change
  useEffect(() => {
    if (glowManagerRef.current) {
      glowManagerRef.current.updateSettings(settings)
    }
  }, [settings])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (glowManagerRef.current) {
        glowManagerRef.current.destroy()
      }
    }
  }, [])

  return glowManagerRef.current
}
