const SEARCH_BAR_BLUR_PRESET_MAP = {
  off: 0,
  soft: 8,
  medium: 14,
  strong: 20,
  max: 28,
}

export const clampBlurValue = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, numeric)
}

export const resolveSearchBarBlurPx = (searchBarConfig = {}) => {
  const direct = Number(searchBarConfig?.blurPx)
  if (Number.isFinite(direct)) {
    return clampBlurValue(direct)
  }
  const presetKey = String(searchBarConfig?.blurPreset || 'strong').toLowerCase()
  const presetValue = SEARCH_BAR_BLUR_PRESET_MAP[presetKey]
  if (typeof presetValue === 'number') {
    return presetValue
  }
  return SEARCH_BAR_BLUR_PRESET_MAP.strong
}

export const resolveSuggestionsBlurPx = ({
  matchSearchBar = false,
  explicitBlurPx,
  searchBarBlurPx,
  fallback = 10,
}) => {
  if (matchSearchBar) {
    return clampBlurValue(searchBarBlurPx)
  }
  const resolved = Number.isFinite(Number(explicitBlurPx))
    ? Number(explicitBlurPx)
    : fallback
  return clampBlurValue(resolved)
}

export { SEARCH_BAR_BLUR_PRESET_MAP }
