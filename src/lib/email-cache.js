/**
 * Email Cache Utility
 * 
 * Caches most recent emails locally for faster access between page reloads.
 * Supports multiple inboxes (by email account).
 */

const CACHE_KEY_PREFIX = 'gmail_cache_'
const CACHE_VERSION = 1
const MAX_CACHED_EMAILS_PER_ACCOUNT = 50 // Cache most recent 50 emails per account
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Get cache key for an email account
 */
function getCacheKey(email) {
  return `${CACHE_KEY_PREFIX}${String(email || '').toLowerCase().trim()}`
}

/**
 * Get cached emails for an account
 * @param {string} email - Account email address
 * @returns {Array|null} - Cached emails or null if expired/missing
 */
export function getCachedEmails(email) {
  try {
    const key = getCacheKey(email)
    const cached = localStorage.getItem(key)
    if (!cached) return null

    const data = JSON.parse(cached)
    
    // Check version
    if (data.version !== CACHE_VERSION) {
      localStorage.removeItem(key)
      return null
    }

    // Check expiry
    const now = Date.now()
    if (data.timestamp && (now - data.timestamp) > CACHE_EXPIRY_MS) {
      localStorage.removeItem(key)
      return null
    }

    return Array.isArray(data.emails) ? data.emails : null
  } catch (e) {
    console.error('Error reading email cache:', e)
    return null
  }
}

/**
 * Save emails to cache for an account
 * @param {string} email - Account email address
 * @param {Array} emails - Array of email objects
 */
export function setCachedEmails(email, emails) {
  try {
    if (!email || !Array.isArray(emails)) return

    const key = getCacheKey(email)
    
    // Only cache most recent emails (limit to MAX_CACHED_EMAILS_PER_ACCOUNT)
    const emailsToCache = emails.slice(0, MAX_CACHED_EMAILS_PER_ACCOUNT)

    const data = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      email: String(email).toLowerCase().trim(),
      emails: emailsToCache
    }

    localStorage.setItem(key, JSON.stringify(data))
  } catch (e) {
    console.error('Error saving email cache:', e)
  }
}

/**
 * Clear cache for a specific account
 * @param {string} email - Account email address
 */
export function clearCachedEmails(email) {
  try {
    const key = getCacheKey(email)
    localStorage.removeItem(key)
  } catch (e) {
    console.error('Error clearing email cache:', e)
  }
}

/**
 * Clear all email caches
 */
export function clearAllEmailCaches() {
  try {
    const keys = Object.keys(localStorage)
    keys.forEach(key => {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        localStorage.removeItem(key)
      }
    })
  } catch (e) {
    console.error('Error clearing all email caches:', e)
  }
}

/**
 * Get cache info for all accounts
 * @returns {Array} - Array of { email, count, timestamp }
 */
export function getAllCacheInfo() {
  try {
    const keys = Object.keys(localStorage)
    const info = []
    
    keys.forEach(key => {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        try {
          const cached = localStorage.getItem(key)
          if (cached) {
            const data = JSON.parse(cached)
            const email = key.replace(CACHE_KEY_PREFIX, '')
            info.push({
              email,
              count: Array.isArray(data.emails) ? data.emails.length : 0,
              timestamp: data.timestamp || null,
              age: data.timestamp ? Date.now() - data.timestamp : null
            })
          }
        } catch {}
      }
    })
    
    return info
  } catch (e) {
    console.error('Error getting cache info:', e)
    return []
  }
}




