import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Settings, X, Check } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { FONT_PRESET_DEFINITIONS } from '../lib/theme-tokens'
import BackgroundManager from './BackgroundManager'

const SettingsButton = ({
  onBackgroundChange,
  currentBackground,
  currentBackgroundMeta,
  workspaceBackgrounds = {},
  onWorkspaceBackgroundChange,
  workspaceBackgroundsEnabled = true,
  onToggleWorkspaceBackgroundsEnabled,
  backgroundFollowSlug = false,
  onToggleBackgroundFollowSlug,
  backgroundMode = 'cover',
  onBackgroundModeChange,
  backgroundZoom = 1,
  onBackgroundZoomChange,
  settings,
  workspaces = [],
  widgetsSettings,
  appearanceWorkspaceOptions = [],
  appearanceWorkspaceActiveId,
  appearanceWorkspacesEnabled = false,
  onToggleAppearanceWorkspaces,
  onSelectAppearanceWorkspace,
  onSettingsVisibilityChange,
  onToggleOpenInNewTab,
  onToggleAnimatedOverlay,
  onSelectMasterLayout,
  onToggleMirrorLayout,
  onToggleSwapClassicTabsWithPageSwitcher,
  onToggleSwapModernTabsWithPageSwitcher,
  // Search bar appearance
  onToggleSearchBarOutline,
  onToggleSearchBarShadow,
  onToggleSearchBarTransparent,
  onSelectSearchBarPosition,
  onSelectSearchBarBlurPreset,
  onChangeSearchBarBlurPx,
  onToggleSearchBarGlowByUrl,
  onToggleSearchBarGlowTransient,
  onToggleSearchBarInlineAiGlow,
  onToggleSearchBarRefocus,
  onToggleSearchBarHoverGlow,
  onChangeSearchBarRefocusMode,
  onToggleSearchBarUseDefaultFont,
  onToggleSearchBarUseDefaultColor,
  onToggleSearchBarDarkerPlaceholder,
  onChangeSearchBarWidthScale,
  onChangeSuggestionsBlurPx,
  onToggleSuggestionsMatchBarBlur,
  onToggleSuggestionsRemoveBackground,
  onToggleSuggestionsRemoveOutline,
  onToggleSuggestionsUseShadows,
  onToggleShowSeconds,
  onToggleTwentyFourHour,
  onToggleUnits,
  onSelectClockPreset,
  onSelectWeatherPreset,
  onToggleEnableMusicPlayer,
  onToggleWidgetsRemoveOutlines,
  onToggleWidgetsRemoveBackgrounds,
  onToggleClockWeatherSeparator,
  onChangeSubTimezones,
  onSelectFontPreset,
  onManualTextColorChange,
  onManualAccentColorChange,
  onToggleMatchWorkspaceTextColor,
  onToggleMatchWorkspaceAccentColor,
  onToggleMatchWorkspaceFonts,
  onToggleAiBubbleOutline,
  onToggleAiBubbleShadow,
  onToggleAutoUrlDoubleClick,
  onToggleSpeedDialTransparent,
  onToggleSpeedDialOutline,
  onToggleSpeedDialShadow,
  onChangeSpeedDialVerticalOffset,
  onChangeSpeedDialBlur,
  onToggleSpeedDialGlow,
  onChangeSpeedDialGlowColor,
  // System-wide glow max
  onChangeSystemGlowMaxIntensity,
  onChangeWorkspaceGlowColor,
  onToggleGlowByUrl,
  onToggleGlowTransient,
  onToggleGlowHover,
  onToggleTabsRect,
  onToggleTabsInside,
  onToggleTabsDivider,
  onSelectTabsMode,
  onToggleTabHoverShade,
  onSelectTabHoverStyle,
  onToggleGlowWorkspaceColorOnDoubleClick,
  onChangeWorkspaceTextColor,
  onChangeWorkspaceTextFont,
  onToggleWorkspaceTextByUrl,
  onChangeWorkspaceAccentColor,
  onSelectHeaderAlign,
  onSelectHeaderEffectMode,
  onToggleHeaderBannerColor,
  onToggleHeaderBannerStatic,
  onToggleHeaderBannerOverscan,
  onToggleHeaderBannerEnhancedWrap,
  onChangeHeaderBannerScale,
  onToggleHeaderBannerBold,
  onChangeHeaderBannerSpeed,
  onToggleHeaderBannerFontOverride,
  onSelectHeaderBannerFont,
  onToggleHeaderBannerReverseDirection,
  onToggleHeaderBannerFlipOnDoubleClick,
  onToggleHeaderBannerAlternateOnSlug,
  onToggleWorkspaceHoverPreview,
  onToggleColorlessPreview,
  onToggleHeaderFollowsUrlSlug,
  // Workspace strip buttons
  onToggleWsButtonBackground,
  onToggleWsButtonShadow,
  onToggleWsButtonBlur,
  onToggleWsButtonMatchDialBlur,
  // Speed Dial header sync
  onToggleSpeedDialMatchHeaderColor,
  onToggleSpeedDialMatchHeaderFont,
  // Soft-switch glow behavior
  onChangeSoftSwitchGlowBehavior,
  // Appearance workspace context
  isMasterAppearanceView = false,
  // Last In theming
  onToggleLastInEnabled,
  onToggleLastInIncludeGlow,
  onToggleLastInIncludeTypography,
  // Theming: default outer glow
  onToggleDefaultOuterGlow,
  // Voice settings
  onChangeVoiceProvider,
  onChangeVoiceLocalBase,
  onChangeVoiceTtsBase,
  onChangeVoiceApiUrl,
  onChangeVoiceApiKey,
  onChangeVoiceSttBase,
  onChangeVoiceSttToken,
  onChangeVoiceSttModel,
  onChangeVoiceSttLanguage,
  onToggleVoiceSttVad,
  onToggleVoiceSttDiarization,
  onSelectVoiceSttTimestamps,
  // AI chat options
  onChangeAiStreamScale,
  onChangeChatBubbleBlur,
  // Inline results: return button position
  onSelectInlineReturnPos,
  // Music backend + styling
  onChangeMusicBackend,
  onChangeMusicToken,
  onChangeMusicBlurPx,
  onToggleMusicRemoveBackground,
  onToggleMusicRemoveOutline,
  onToggleMusicUseShadows,
  onToggleMusicMatchTextColor,
  onToggleMusicMatchSearchBarBlur,
  onChangeWidgetsVerticalOffset,
}) => {
  const [showSettings, setShowSettings] = useState(false)
  const [aiModels, setAiModels] = useState([])
  const [aiModel, setAiModel] = useState('')
  const [provStatus, setProvStatus] = useState({ lmstudio: 'idle', openai: 'idle', openrouter: 'idle' })
  const [showMemoryModal, setShowMemoryModal] = useState(false)
  const [memoryDraft, setMemoryDraft] = useState(settings?.ai?.memoryContent || '')
  // Controlled drafts so inputs reflect persisted values after reload
  const [lmstudioBaseDraft, setLmstudioBaseDraft] = useState(settings?.ai?.lmstudioBaseUrl ?? '')
  const [openaiKeyDraft, setOpenaiKeyDraft] = useState(settings?.ai?.openaiApiKey ?? '')
  const [openrouterKeyDraft, setOpenrouterKeyDraft] = useState(settings?.ai?.openrouterApiKey ?? '')
  const [openrouterBaseDraft, setOpenrouterBaseDraft] = useState(settings?.ai?.openrouterBaseUrl ?? '')
  const [firecrawlBaseDraft, setFirecrawlBaseDraft] = useState(settings?.ai?.firecrawlBaseUrl ?? '')
  const [firecrawlKeyDraft, setFirecrawlKeyDraft] = useState(settings?.ai?.firecrawlApiKey ?? '')
  const [licenseKeyInput, setLicenseKeyInput] = useState('')
  const [licenseStatus, setLicenseStatus] = useState('')
  const [showPremiumReasons, setShowPremiumReasons] = useState(true)
  const [showSetupInstructions, setShowSetupInstructions] = useState(true)
  const [exportImportStatus, setExportImportStatus] = useState('')
  const importFileInputRef = useRef(null)

  useEffect(() => {
    if (typeof onSettingsVisibilityChange === 'function') {
      onSettingsVisibilityChange(showSettings)
    }
  }, [showSettings, onSettingsVisibilityChange])

  useEffect(() => { setLmstudioBaseDraft(settings?.ai?.lmstudioBaseUrl ?? '') }, [settings?.ai?.lmstudioBaseUrl])
  useEffect(() => { setOpenaiKeyDraft(settings?.ai?.openaiApiKey ?? '') }, [settings?.ai?.openaiApiKey])
  useEffect(() => { setOpenrouterKeyDraft(settings?.ai?.openrouterApiKey ?? '') }, [settings?.ai?.openrouterApiKey])
  useEffect(() => { setOpenrouterBaseDraft(settings?.ai?.openrouterBaseUrl ?? '') }, [settings?.ai?.openrouterBaseUrl])
  useEffect(() => { setFirecrawlBaseDraft(settings?.ai?.firecrawlBaseUrl ?? '') }, [settings?.ai?.firecrawlBaseUrl])
  useEffect(() => { setFirecrawlKeyDraft(settings?.ai?.firecrawlApiKey ?? '') }, [settings?.ai?.firecrawlApiKey])

  // Persist AI drafts proactively so they survive reloads without blur
  useEffect(() => {
    // Debounced write to avoid excessive localStorage churn while typing
    const t = setTimeout(() => {
      try {
        const merged = {
          ...(settings?.ai || {}),
          lmstudioBaseUrl: lmstudioBaseDraft ?? '',
          openaiApiKey: openaiKeyDraft ?? '',
          openrouterApiKey: openrouterKeyDraft ?? '',
          openrouterBaseUrl: openrouterBaseDraft ?? '',
          firecrawlBaseUrl: firecrawlBaseDraft ?? '',
          firecrawlApiKey: firecrawlKeyDraft ?? ''
        }
        localStorage.setItem('aiSettings', JSON.stringify(merged))
      } catch {}
    }, 300)
    return () => clearTimeout(t)
    // Keep dependencies strictly to drafts + current settings.ai
  }, [
    lmstudioBaseDraft,
    openaiKeyDraft,
    openrouterKeyDraft,
    openrouterBaseDraft,
    firecrawlBaseDraft,
    firecrawlKeyDraft,
    settings?.ai
  ])

  // Ensure drafts are saved on unload even if inputs never blurred
  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        const merged = {
          ...(settings?.ai || {}),
          lmstudioBaseUrl: lmstudioBaseDraft ?? '',
          openaiApiKey: openaiKeyDraft ?? '',
          openrouterApiKey: openrouterKeyDraft ?? '',
          openrouterBaseUrl: openrouterBaseDraft ?? '',
          firecrawlBaseUrl: firecrawlBaseDraft ?? '',
          firecrawlApiKey: firecrawlKeyDraft ?? ''
        }
        localStorage.setItem('aiSettings', JSON.stringify(merged))
      } catch {}
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [
    lmstudioBaseDraft,
    openaiKeyDraft,
    openrouterKeyDraft,
    openrouterBaseDraft,
    firecrawlBaseDraft,
    firecrawlKeyDraft,
    settings?.ai
  ])
  const TZ_CHOICES = [
    { id: 'Asia/Yerevan', label: 'Yerevan' },
    { id: 'Europe/Vienna', label: 'Vienna' },
    { id: 'Asia/Tokyo', label: 'Tokyo' },
    { id: 'Europe/London', label: 'London' },
    { id: 'America/New_York', label: 'New York' },
  ]
  const aiOutlineEnabled = settings?.appearance?.aiBubbleOutline !== false
  const aiShadowEnabled = settings?.appearance?.aiBubbleShadow !== false
  const headerEffectMode = String(settings?.speedDial?.headerEffectMode || 'off').toLowerCase()
  const headerScrollEnabled = headerEffectMode !== 'off'
  const slugModeEnabled = !!(settings?.general?.autoUrlDoubleClick)
  const rawTabsMode = settings?.speedDial?.tabsMode
  const normalizedTabsMode = ['tabs', 'tight', 'tight-tabz', 'cyber', 'buttons_inside', 'buttons_outside', 'classic'].includes(rawTabsMode)
    ? rawTabsMode
    : 'tabs'
  const tabsMode = normalizedTabsMode
  const fontPresetOptions = FONT_PRESET_DEFINITIONS.map(({ id, label }) => ({ id, label }))
  const headerBannerFontOverrideEnabled = !!settings?.speedDial?.headerBannerFontOverrideEnabled
  const defaultBannerFont = 'Bebas Neue'
  const storedBannerFont = (settings?.speedDial?.headerBannerFont || defaultBannerFont).trim() || defaultBannerFont
  const bannerFontOptions = Array.from(new Set(fontPresetOptions.map(opt => opt.label)))
  const effectiveBannerFontValue = bannerFontOptions.includes(storedBannerFont)
    ? storedBannerFont
    : storedBannerFont || 'Bebas Neue'
  const handleBannerFontOverrideToggle = (checked) => {
    onToggleHeaderBannerFontOverride?.(checked)
    if (checked) {
      const fallbackFont = bannerFontOptions.includes(storedBannerFont)
        ? storedBannerFont
        : defaultBannerFont
      onSelectHeaderBannerFont?.(fallbackFont)
    }
  }
  const handleBannerFontSelect = (value) => {
    onSelectHeaderBannerFont?.(value)
    if (!headerBannerFontOverrideEnabled) {
      onToggleHeaderBannerFontOverride?.(true)
    }
  }
  const hasBannerOverrides = (
    !!settings?.speedDial?.headerBannerMatchWorkspaceColor ||
    !!settings?.speedDial?.headerBannerStatic ||
    settings?.speedDial?.headerBannerOverscan === false ||
    !!settings?.speedDial?.headerBannerBold ||
    Number(settings?.speedDial?.headerBannerScale ?? 1) !== 1 ||
    !!settings?.speedDial?.headerBannerReverseDirection ||
    !!settings?.speedDial?.headerBannerFlipOnTabDoubleClick ||
    !!settings?.speedDial?.headerBannerAlternateOnSlug
  )
  const tabsTriggerClass = 'flex-1 rounded-md px-3 py-1 text-xs font-medium text-white data-[state=active]:bg-white/15 data-[state=active]:text-white hover:text-white/90'
  const searchBarTransientEnabled = !!(settings?.appearance?.searchBar?.glowTransient)
  const searchBarRefocusEnabled = !!(settings?.appearance?.searchBar?.refocusByUrl)
  const searchBarHoverGlow = !!(settings?.appearance?.searchBar?.hoverGlow)
  const allowedRefocusModes = ['letters', 'pulse', 'steady']
  const searchBarRefocusMode = (typeof settings?.appearance?.searchBar?.refocusMode === 'string' && allowedRefocusModes.includes(settings.appearance.searchBar.refocusMode))
    ? settings.appearance.searchBar.refocusMode
    : 'letters'
  const searchBarPosition = (() => {
    const raw = String(settings?.appearance?.searchBar?.positionMode || '').toLowerCase()
    if (['bottom', 'center-unfixed', 'center-fixed', 'top-fixed'].includes(raw)) return raw
    if (settings?.appearance?.searchBar?.centered) {
      return settings.appearance.searchBar.trulyFixed ? 'center-fixed' : 'center-unfixed'
    }
    return 'bottom'
  })()
  const masterLayoutMode = (settings?.appearance?.masterLayout === 'classic') ? 'classic' : 'modern'
  const isClassicLayout = masterLayoutMode === 'classic'
  const speedDialOffsetModern = Number(settings?.speedDial?.verticalOffset ?? 0)
  const speedDialOffsetClassic = Number(settings?.speedDial?.landscapeOffset ?? 0)
  const speedDialPositionValue = isClassicLayout ? speedDialOffsetClassic : speedDialOffsetModern
  const speedDialPositionLabel = isClassicLayout ? 'Landscape position' : 'Vertical position'
  const speedDialPositionHint = isClassicLayout
    ? 'Slides the Speed Dial grid left or right when using Classic layout.'
    : 'Moves the Speed Dial up or down along the right column.'
  const speedDialPositionMin = isClassicLayout ? -360 : -240
  const speedDialPositionMax = isClassicLayout ? 360 : 240
  const suggCfg = settings?.appearance?.suggestions || {}
  const musicCfg = settings?.appearance?.music || {}
  const anchoredWorkspaceId = settings?.speedDial?.anchoredWorkspaceId || null
  const lastInConfig = settings?.theme?.lastIn || {}
  const lastInEnabled = typeof lastInConfig.enabled === 'boolean' ? lastInConfig.enabled : true
  const lastInIncludeGlow = typeof lastInConfig.includeGlow === 'boolean' ? lastInConfig.includeGlow : true
  const lastInIncludeTypography = typeof lastInConfig.includeTypography === 'boolean' ? lastInConfig.includeTypography : true
  const clockLayoutPreset = widgetsSettings?.clockPreset || widgetsSettings?.layoutPreset || 'preset1'
  const weatherLayoutPreset = widgetsSettings?.weatherPreset || widgetsSettings?.layoutPreset || 'preset1'

  const handleHeaderAlignClick = (position) => {
    onSelectHeaderAlign?.(position)
    if (headerScrollEnabled) {
      onSelectHeaderEffectMode?.('off')
    }
  }

  const handleHeaderScrollClick = () => {
    onSelectHeaderEffectMode?.(headerScrollEnabled ? 'off' : 'sustained')
  }

  // No-op retained function removed; separate toggles are provided below

  // Prevent focus-induced scroll jumps when interacting near the bottom of the scroll area.
  // Some browsers auto-adjust scroll to keep focused inputs fully visible, which can
  // cause the settings panel to jump into empty space when content reflows.
  const preserveScroll = (e) => {
    const el = e.currentTarget
    if (!el) return
    // Only intervene for text-like form controls near the bottom edge
    const t = e.target
    const tag = (t?.tagName || '').toUpperCase()
    let isFormControl = false
    if (tag === 'INPUT') {
      const type = String(t?.getAttribute?.('type') || '').toLowerCase()
      // Ignore toggles/sliders/buttons; they shouldn't freeze scroll near the bottom
      const nonTextTypes = ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color']
      isFormControl = !nonTextTypes.includes(type)
    } else if (tag === 'TEXTAREA' || tag === 'SELECT') {
      isFormControl = true
    }
    if (!isFormControl) return
    const distanceFromBottom = (el.scrollHeight - (el.scrollTop + el.clientHeight))
    if (distanceFromBottom > 96) return
    const top = el.scrollTop
    // Restore on next frame and shortly after to defeat anchor adjustments
    requestAnimationFrame(() => { try { el.scrollTop = top } catch {} })
    setTimeout(() => { try { el.scrollTop = top } catch {} }, 60)
  }

  useEffect(() => {
    if (typeof document === 'undefined') return
    const body = document.body
    if (!body) return
    if (showSettings) body.classList.add('settings-panel-open')
    else body.classList.remove('settings-panel-open')
    if (typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('app-settings-open', { detail: showSettings })) } catch {}
    }
  }, [showSettings])

  useEffect(() => {
    return () => {
      if (typeof document !== 'undefined') {
        try { document.body?.classList?.remove('settings-panel-open') } catch {}
      }
      if (typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('app-settings-open', { detail: false })) } catch {}
      }
    }
  }, [])

  const handleOpenSettings = () => setShowSettings(true)
  const handleCloseSettings = () => setShowSettings(false)

  // Background: refresh available models once after reload
  const refreshModels = async () => {
    try {
      const r = await fetch('/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          lmstudioBaseUrl: settings?.ai?.lmstudioBaseUrl || '',
          openaiApiKey: settings?.ai?.openaiApiKey || '',
          openrouterApiKey: settings?.ai?.openrouterApiKey || '',
          openrouterBaseUrl: settings?.ai?.openrouterBaseUrl || ''
        })
      })
      const data = await r.json().catch(() => ({}))
      const names = Array.isArray(data?.models) ? data.models : []
      setAiModels(names.filter(n => !/embedding|embed|^text-embedding|pipe|arena/i.test(String(n))))
      const st = data?.status || {}
      setProvStatus({
        lmstudio: (settings?.ai?.lmstudioBaseUrl ? (st.lmstudio?.ok ? 'ok' : (st.lmstudio?.ok === false ? 'fail' : 'idle')) : 'idle'),
        openai: (settings?.ai?.openaiApiKey ? (st.openai?.ok ? 'ok' : (st.openai?.ok === false ? 'fail' : 'idle')) : 'idle'),
        openrouter: (settings?.ai?.openrouterApiKey ? (st.openrouter?.ok ? 'ok' : (st.openrouter?.ok === false ? 'fail' : 'idle')) : 'idle')
      })
    } catch {
      setProvStatus(prev => ({ ...prev }))
    }
  }

  useEffect(() => {
    const t = setTimeout(() => { refreshModels() }, 600)
    return () => clearTimeout(t)
    // run once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div className="inline-flex w-10 h-10 items-center justify-center">
        <motion.button
          onClick={handleOpenSettings}
          className="p-3 bg-transparent hover:bg-transparent rounded-full border-0 transition-colors"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Open settings"
        >
          <Settings className="w-5 h-5 text-white/80" />
        </motion.button>
      </div>

      <AnimatePresence>
        {showSettings && (
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[20000]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => {
              const edgeThreshold = 96
              const { clientX, clientY, currentTarget } = e
              const { innerWidth, innerHeight } = window
              if (
                clientX <= edgeThreshold ||
                clientX >= innerWidth - edgeThreshold ||
                clientY <= edgeThreshold ||
                clientY >= innerHeight - edgeThreshold
              ) {
                handleCloseSettings()
              }
            }}
          >
            <motion.div
              className="bg-black/85 backdrop-blur-md rounded-xl p-6 border border-white/20 max-w-5xl w-full mx-4 max-h-[85vh] overflow-hidden settings-force-white"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ 
                color: '#fff', 
                '--text-rgb': '255,255,255',
                fontFamily: 'Inter, system-ui, Arial, sans-serif' // Unchangeable font for Settings panel
              }}
            >
              
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-white">Settings</h3>
                <button
                  onClick={handleCloseSettings}
                  className="text-white/60 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <Tabs defaultValue="general" className="mt-2">
                {/* Force white text throughout settings */}
                <style>{`
                  .settings-force-white,
                  .settings-force-white * {
                    color: #fff !important;
                    font-family: "Inter", "SF Pro Text", "Segoe UI", system-ui, sans-serif !important;
                    text-shadow: none !important;
                  }
                `}</style>
                <TabsList className="bg-[#1f1f1f] text-white rounded-lg p-1 flex gap-1">
                  <TabsTrigger value="general" className={tabsTriggerClass}>General</TabsTrigger>
                  <TabsTrigger value="appearance" className={tabsTriggerClass}>Appearance</TabsTrigger>
                  <TabsTrigger value="theming" className={tabsTriggerClass}>Theming</TabsTrigger>
                  <TabsTrigger value="backgrounds" className={tabsTriggerClass}>Backgrounds</TabsTrigger>
                  <TabsTrigger value="widgets" className={tabsTriggerClass}>Widgets</TabsTrigger>
                  <TabsTrigger value="about" className={tabsTriggerClass}>About</TabsTrigger>
                </TabsList>

                <TabsContent
                  value="general"
                  className="mt-4 max-h-[70vh] overflow-y-auto no-scrollbar pr-2"
                  style={{ overscrollBehavior: 'contain', overflowAnchor: 'none', scrollbarGutter: 'stable both-edges' }}
                  onPointerDown={preserveScroll}
                  onFocusCapture={preserveScroll}
                >
                  <div className="space-y-6">
                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div>
                        <div className="text-white text-sm font-medium">Links open in new tab</div>
                        <div className="text-white/60 text-xs">When enabled, shortcuts and search results open in a new tab. When off, they replace the current page.</div>
                      </div>
                      <label className="inline-flex items-center cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!(settings?.general?.openInNewTab)}
                          onChange={(e) => onToggleOpenInNewTab?.(e.target.checked)}
                          className="peer absolute opacity-0 w-0 h-0"
                        />
                        <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                          <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                        </div>
                      </label>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div>
                        <div className="text-white text-sm font-medium">Default search engine</div>
                        <div className="text-white/60 text-xs">Applies to Enter searches and suggestion links.</div>
                      </div>
                      <select
                        value={settings?.search?.engine || 'google'}
                        onChange={(e) => {
                          const val = e.target.value
                          try { localStorage.setItem('searchEngine', val) } catch {}
                          window.dispatchEvent(new CustomEvent('app-change-search-engine', { detail: val }))
                        }}
                        onWheel={(e) => { try { e.currentTarget.blur() } catch {} }}
                        className="ml-2 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 hover:bg-white/15 focus:outline-none"
                        title="Search engine"
                      >
                        <option value="google">Google</option>
                        <option value="duckduckgo">DuckDuckGo</option>
                        <option value="bing">Bing</option>
                        <option value="searxng">SearXNG</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div>
                        <div className="text-white text-sm font-medium">Suggestions provider</div>
                        <div className="text-white/60 text-xs">Controls autocomplete suggestions source; SearXNG uses the configurable endpoint below, or pick a custom API.</div>
                      </div>
                      <select
                        value={settings?.search?.suggestProvider || 'duckduckgo'}
                        onChange={(e) => {
                          const val = e.target.value
                          try { localStorage.setItem('suggestProvider', val) } catch {}
                          window.dispatchEvent(new CustomEvent('app-change-suggest-provider', { detail: val }))
                        }}
                        onWheel={(e) => { try { e.currentTarget.blur() } catch {} }}
                        className="ml-2 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 hover:bg-white/15 focus:outline-none"
                        title="Suggestions provider"
                      >
                        <option value="duckduckgo">DuckDuckGo</option>
                        <option value="google">Google</option>
                        <option value="brave">Brave</option>
                        <option value="searxng">SearXNG (proxy/custom)</option>
                        <option value="custom">Custom provider</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div>
                        <div className="text-white text-sm font-medium">Inline search provider</div>
                        <div className="text-white/60 text-xs">Controls the source of inline results shown below the search bar.</div>
                      </div>
                      <select
                        value={settings?.search?.inlineProvider || 'searxng'}
                        onChange={(e) => {
                          const val = e.target.value
                          try { localStorage.setItem('inlineProvider', val) } catch {}
                          window.dispatchEvent(new CustomEvent('app-inline-set-provider', { detail: val }))
                        }}
                        onWheel={(e) => { try { e.currentTarget.blur() } catch {} }}
                        className="ml-2 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 hover:bg-white/15 focus:outline-none"
                        title="Inline search provider"
                      >
                        <option value="searxng">SearXNG</option>
                        <option value="firecrawl">Firecrawl</option>
                        <option value="custom">Custom provider</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div>
                        <div className="text-white text-sm font-medium">Cap at 7 suggestions</div>
                        <div className="text-white/60 text-xs">Limit suggestions to a concise top 7; most relevant sits at the bottom.</div>
                      </div>
                      <label className="inline-flex items-center cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!(settings?.general?.capSuggestions7)}
                          onChange={(e) => window.dispatchEvent(new CustomEvent('app-toggle-suggestions-cap7', { detail: !!e.target.checked }))}
                          className="peer absolute opacity-0 w-0 h-0"
                        />
                        <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                          <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                        </div>
                      </label>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <div className="text-white text-sm font-medium">Enable inline AI answers</div>
                        </div>
                        <div className="text-white/60 text-xs">Controls whether inline Firecrawl uses AI; button remains visible but disabled when off.</div>
                      </div>
                      <label className="inline-flex items-center cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={settings?.search?.inlineEnabled !== false}
                          onChange={(e) => {
                            const detail = !!e.target.checked
                            try { localStorage.setItem('searchSettings', JSON.stringify({ ...(settings?.search || {}), inlineEnabled: detail })) } catch {}
                            try { window.dispatchEvent(new CustomEvent('app-inline-enabled', { detail })) } catch {}
                          }}
                          className="peer absolute opacity-0 w-0 h-0"
                          
                        />
                        <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                          <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                        </div>
                      </label>
                    </div>

                    {String(settings?.search?.inlineProvider || 'searxng') === 'firecrawl' && (
                      <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-white/80 text-xs">Use same Firecrawl settings as AI</div>
                        </div>
                        <label className="inline-flex items-center cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={settings?.search?.inlineUseAI !== false}
                            onChange={(e) => {
                              const val = !!e.target.checked
                              try { localStorage.setItem('inlineUseAI', String(val)) } catch {}
                              window.dispatchEvent(new CustomEvent('app-inline-use-ai', { detail: val }))
                            }}
                            className="peer absolute opacity-0 w-0 h-0"
                          />
                          <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                            <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                          </div>
                        </label>
                        {settings?.search?.inlineUseAI === false && (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-white/70 text-xs" style={{minWidth:'10rem'}}>Inline Firecrawl base URL</span>
                              <input
                                type="text"
                                defaultValue={settings?.search?.inlineFirecrawlBaseUrl || '/firecrawl-inline'}
                                onBlur={(e) => window.dispatchEvent(new CustomEvent('app-inline-firecrawl-base', { detail: e.target.value }))}
                                placeholder="/firecrawl-inline (proxied) or http://host:port"
                                className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-white/70 text-xs" style={{minWidth:'10rem'}}>Inline Firecrawl API key</span>
                              <input
                                type="text"
                                defaultValue={settings?.search?.inlineFirecrawlApiKey || ''}
                                onBlur={(e) => window.dispatchEvent(new CustomEvent('app-inline-firecrawl-key', { detail: e.target.value }))}
                                placeholder="Optional Bearer token"
                                className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-2">
                      <div>
                        <div className="text-white text-sm font-medium">SearXNG endpoints</div>
                        <div className="text-white/60 text-xs">
                          Global base is used for default search, suggestions, inline search, and AI web search unless an override is set.
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/70 text-xs" style={{minWidth:'10rem'}}>Global base URL</span>
                        <input
                          type="text"
                          defaultValue={settings?.search?.searxngBaseUrl || '/searxng'}
                          onBlur={(e) => window.dispatchEvent(new CustomEvent('app-search-searxng-base', { detail: e.target.value }))}
                          placeholder="/searxng (proxied) or https://your.searxng.host"
                          className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/70 text-xs" style={{minWidth:'10rem'}}>Suggestions override</span>
                        <input
                          type="text"
                          defaultValue={settings?.search?.suggestSearxngBaseUrl || ''}
                          onBlur={(e) => window.dispatchEvent(new CustomEvent('app-search-suggest-searxng-base', { detail: e.target.value }))}
                          placeholder="Optional; defaults to global base"
                          className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/70 text-xs" style={{minWidth:'10rem'}}>Inline override</span>
                        <input
                          type="text"
                          defaultValue={settings?.search?.inlineSearxngBaseUrl || ''}
                          onBlur={(e) => window.dispatchEvent(new CustomEvent('app-inline-searxng-base', { detail: e.target.value }))}
                          placeholder="Optional; defaults to global base"
                          className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-white text-sm font-medium">Custom inline provider</div>
                          <div className="text-white/60 text-xs">
                            Used when Inline search provider is set to Custom. Endpoint must accept a <code>q</code> parameter and return JSON results.
                          </div>
                        </div>
                        <label className="inline-flex items-center cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={settings?.search?.inlineEnabled !== false}
                            onChange={(e) => {
                              const detail = !!e.target.checked
                              try { localStorage.setItem('searchSettings', JSON.stringify({ ...(settings?.search || {}), inlineEnabled: detail })) } catch {}
                              try { window.dispatchEvent(new CustomEvent('app-inline-enabled', { detail })) } catch {}
                            }}
                            className="peer absolute opacity-0 w-0 h-0"
                            
                          />
                          <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                            <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                          </div>
                        </label>
                      </div>
                      <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-white/70 text-xs" style={{minWidth:'10rem'}}>Endpoint prefix</span>
                        <input
                          type="text"
                          defaultValue={settings?.search?.inlineCustomBaseUrl || ''}
                          onBlur={(e) => window.dispatchEvent(new CustomEvent('app-inline-custom-base', { detail: e.target.value }))}
                          placeholder="/inline/custom?q= or https://host/search?q="
                          className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                        />
                      </div>
                      <div className="text-white/55 text-[10px]">
                        The response should be either an array of results or an object with a <code>results</code> or <code>data</code> array. Each item may include
                        <code className="mx-1">title</code>, <code className="mx-1">url</code>, and <code className="mx-1">description</code>/<code className="mx-1">snippet</code>.
                      </div>
                    </div>
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-2">
                      <div>
                        <div className="text-white text-sm font-medium">Custom suggestions provider</div>
                        <div className="text-white/60 text-xs">
                          Use this when the Suggestions provider is set to Custom. Endpoint must accept a <code>q</code> parameter.
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/70 text-xs" style={{minWidth:'10rem'}}>Endpoint prefix</span>
                        <input
                          type="text"
                          defaultValue={settings?.search?.suggestCustomBaseUrl || ''}
                          onBlur={(e) => window.dispatchEvent(new CustomEvent('app-suggest-custom-base', { detail: e.target.value }))}
                          placeholder="/suggest/custom?q= or https://host/suggest?q="
                          className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/70 text-xs" style={{minWidth:'10rem'}}>Response format</span>
                        <select
                          defaultValue={settings?.search?.suggestCustomMode || 'ddg'}
                          onChange={(e) => window.dispatchEvent(new CustomEvent('app-suggest-custom-mode', { detail: e.target.value }))}
                          className="bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 hover:bg-white/15 focus:outline-none"
                        >
                          <option value="ddg">DuckDuckGo style (array of objects with "phrase")</option>
                          <option value="google">Google / Brave style ([q, [s1, s2, ...]] or array of strings)</option>
                        </select>
                      </div>
                    </div>
                    {/* Voice (STT + TTS) */}
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-3">
                      <div className="text-white text-sm font-medium">Voice</div>
                      {/* STT Provider */}
                      <div className="text-white/80 text-xs">Transcription (STT)</div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>Provider</span>
                        <select
                          value={settings?.general?.voice?.provider || settings?.general?.voice?.stt?.provider || 'local-stt'}
                          onChange={(e) => onChangeVoiceProvider?.(e.target.value)}
                          onWheel={(e) => { try { e.currentTarget.blur() } catch {} }}
                          className="bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 hover:bg-white/15 focus:outline-none"
                        >
                          <option value="local-stt">Local STT (Faster-Whisper)</option>
                          <option value="api">External API (ElevenLabs, etc.)</option>
                          <option value="local">Legacy local proxy (/api)</option>
                        </select>
                      </div>
                      {(settings?.general?.voice?.provider || settings?.general?.voice?.stt?.provider || 'local-stt') === 'local-stt' && (
                        <div className="space-y-2">
                          <div className="flex gap-2 items-center">
                            <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>STT base URL</span>
                            <input
                              type="text"
                              value={settings?.general?.voice?.stt?.baseUrl ?? '/stt'}
                              onChange={(e) => onChangeVoiceSttBase?.(e.target.value)}
                              className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                              placeholder="/stt (dev proxy) or http://127.0.0.1:8090"
                            />
                          </div>
                          <div className="flex gap-2 items-center">
                            <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>Auth token</span>
                            <input
                              type="text"
                              value={settings?.general?.voice?.stt?.token ?? ''}
                              onChange={(e) => onChangeVoiceSttToken?.(e.target.value)}
                              className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                              placeholder="Bearer token"
                            />
                          </div>
                          <div className="flex gap-2 items-center">
                            <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>Model</span>
                            <input
                              type="text"
                              value={settings?.general?.voice?.stt?.model ?? 'small'}
                              onChange={(e) => onChangeVoiceSttModel?.(e.target.value)}
                              className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                              placeholder="tiny/base/small/medium/large-v3 or path"
                            />
                          </div>
                          <div className="flex gap-2 items-center">
                            <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>Language</span>
                            <input
                              type="text"
                              value={settings?.general?.voice?.stt?.language ?? 'auto'}
                              onChange={(e) => onChangeVoiceSttLanguage?.(e.target.value)}
                              className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                              placeholder="auto or en, de, ..."
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                              <span className="text-white/80 text-xs">VAD</span>
                              <input type="checkbox" checked={settings?.general?.voice?.stt?.vad !== false} onChange={(e) => onToggleVoiceSttVad?.(e.target.checked)} />
                            </label>
                            <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                              <span className="text-white/80 text-xs">Diarization</span>
                              <input type="checkbox" checked={!!settings?.general?.voice?.stt?.diarization} onChange={(e) => onToggleVoiceSttDiarization?.(e.target.checked)} />
                            </label>
                            <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                              <span className="text-white/80 text-xs">Timestamps</span>
                              <select
                                value={settings?.general?.voice?.stt?.timestamps || 'word'}
                                onChange={(e) => onSelectVoiceSttTimestamps?.(e.target.value)}
                                className="ml-2 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 hover:bg-white/15 focus:outline-none"
                              >
                                <option value="word">Word</option>
                                <option value="segment">Segment</option>
                              </select>
                            </div>
                          </div>
                          <div className="text-white/50 text-[10px]">Tip: Keep timestamps on and enable diarization to prepare for voice-to-voice features.</div>
                        </div>
                      )}
                      {(settings?.general?.voice?.provider || settings?.general?.voice?.stt?.provider || 'local-stt') === 'api' && (
                        <div className="space-y-2">
                          <div className="flex gap-2 items-center">
                            <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>API URL</span>
                            <input
                              type="text"
                              value={settings?.general?.voice?.apiUrl ?? ''}
                              onChange={(e) => onChangeVoiceApiUrl?.(e.target.value)}
                              className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                              placeholder="https://api.elevenlabs.io/v1/speech-to-text (example)"
                            />
                          </div>
                          <div className="flex gap-2 items-center">
                            <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>API key</span>
                            <input
                              type="text"
                              value={settings?.general?.voice?.apiKey ?? ''}
                              onChange={(e) => onChangeVoiceApiKey?.(e.target.value)}
                              className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                              placeholder="Bearer token"
                            />
                          </div>
                        </div>
                      )}
                      {(settings?.general?.voice?.provider || settings?.general?.voice?.stt?.provider || 'local-stt') === 'local' && (
                        <div className="flex gap-2 items-center">
                          <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>Proxy base</span>
                          <input
                            type="text"
                            value={settings?.general?.voice?.serverBase ?? '/api'}
                            onChange={(e) => onChangeVoiceLocalBase?.(e.target.value)}
                            className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                            placeholder="/api (same-origin) or http://127.0.0.1:3099/api"
                          />
                          <button
                            onClick={() => onChangeVoiceLocalBase?.('/api')}
                            className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15 border border-white/20 text-white/80"
                          >Use default</button>
                        </div>
                      )}

                      {/* TTS Provider (XTTS) */}
                      <div className="mt-3 pt-3 border-t border-white/10">
                        <div className="text-white/80 text-xs mb-2">Synthesis (TTS)</div>
                        <div className="flex gap-2 items-center">
                          <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>XTTS base URL</span>
                          <input
                            type="text"
                            value={settings?.general?.voice?.tts?.baseUrl ?? settings?.general?.voice?.xttsBase ?? 'http://127.0.0.1:8088'}
                            onChange={(e) => onChangeVoiceTtsBase?.(e.target.value)}
                            className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                            placeholder="http://127.0.0.1:8088"
                          />
                        </div>
                      </div>
                    </div>
                    {/* AI subsection */}
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-white text-sm font-medium">AI</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-white/80 text-xs">Enable AI features</div>
                          <div className="text-white/60 text-[11px]">Controls AI chat and inline AI usage.</div>
                        </div>
                        <label className="inline-flex items-center cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={settings?.ai?.enabled !== false}
                            onChange={(e) => {
                              const detail = !!e.target.checked
                              try { localStorage.setItem('aiSettings', JSON.stringify({ ...(settings?.ai || {}), enabled: detail })) } catch {}
                              try { window.dispatchEvent(new CustomEvent('app-ai-enabled', { detail })) } catch {}
                            }}
                            className="peer absolute opacity-0 w-0 h-0"
                            
                          />
                          <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                            <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                          </div>
                        </label>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-white/80 text-xs">Open a new chat every time</div>
                          <div className="text-white/60 text-[11px]">When enabled, AI mode always starts a fresh chat instead of reopening the last one.</div>
                        </div>
                        <label className="inline-flex items-center cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!settings?.ai?.openNewChatEverytime}
                            onChange={(e) => {
                              const detail = !!e.target.checked
                              try { localStorage.setItem('aiSettings', JSON.stringify({ ...(settings?.ai || {}), openNewChatEverytime: detail })) } catch {}
                              try { window.dispatchEvent(new CustomEvent('app-ai-open-new-chat-everytime', { detail })) } catch {}
                            }}
                            className="peer absolute opacity-0 w-0 h-0"
                          />
                          <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                            <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                          </div>
                        </label>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-white/80 text-xs">Available models</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={refreshModels}
                            className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15 border border-white/20 text-white/80"
                          >Refresh models</button>
                          <select
                            value={settings?.ai?.model || aiModel || ''}
                            onChange={(e) => {
                              // Change current session model without accidental wheel changes
                              setAiModel(e.target.value)
                            }}
                            onWheel={(e) => {
                              // Prevent wheel from altering select; just blur
                              try { e.stopPropagation() } catch {}
                              try { e.currentTarget.blur() } catch {}
                            }}
                            onContextMenu={(e) => {
                              // Right click: set as default (persisted)
                              e.preventDefault()
                              const val = e.currentTarget.value
                              try {
                                window.dispatchEvent(new CustomEvent('app-ai-change-model', { detail: val }))
                              } catch {}
                            }}
                            className="bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 hover:bg-white/15 focus:outline-none"
                            title="Available models (right-click to make default)"
                          >
                            <option value="">(use default)</option>
                            {aiModels.map((m) => (<option key={m} value={m}>{m}</option>))}
                          </select>
                        </div>
                      </div>
                      
                      {/* Voice backend and bubble toggles removed */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <div className="text-white/80 text-xs" style={{minWidth:'10rem'}}>LM Studio base URL</div>
                          <input
                            type="text"
                            value={lmstudioBaseDraft}
                            onChange={(e) => setLmstudioBaseDraft(e.target.value)}
                            onBlur={(e) => window.dispatchEvent(new CustomEvent('app-ai-set-lmstudio-base', { detail: e.target.value }))}
                            placeholder="http://127.0.0.1:1234/v1 (Docker: http://host.docker.internal:1234/v1)"
                            className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                          />
                          {String(settings?.ai?.lmstudioBaseUrl||'').trim() && (
                            provStatus.lmstudio === 'ok' ? <Check className="w-4 h-4 text-green-400" /> : (provStatus.lmstudio === 'fail' ? <X className="w-4 h-4 text-red-400" /> : <span className="w-4 h-4" />)
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-white/80 text-xs" style={{minWidth:'10rem'}}>OpenAI API key</div>
                          <input
                            type="password"
                            value={openaiKeyDraft}
                            onChange={(e) => setOpenaiKeyDraft(e.target.value)}
                            onBlur={(e) => window.dispatchEvent(new CustomEvent('app-ai-set-openai-key', { detail: e.target.value }))}
                            placeholder="sk-..."
                            className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                          />
                          {String(settings?.ai?.openaiApiKey||'').trim() && (
                            provStatus.openai === 'ok' ? <Check className="w-4 h-4 text-green-400" /> : (provStatus.openai === 'fail' ? <X className="w-4 h-4 text-red-400" /> : <span className="w-4 h-4" />)
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-white/80 text-xs" style={{minWidth:'10rem'}}>OpenRouter API key</div>
                          <input
                            type="password"
                            value={openrouterKeyDraft}
                            onChange={(e) => setOpenrouterKeyDraft(e.target.value)}
                            onBlur={(e) => window.dispatchEvent(new CustomEvent('app-ai-set-openrouter-key', { detail: e.target.value }))}
                            placeholder="or-..."
                            className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                          />
                          {String(settings?.ai?.openrouterApiKey||'').trim() && (
                            provStatus.openrouter === 'ok' ? <Check className="w-4 h-4 text-green-400" /> : (provStatus.openrouter === 'fail' ? <X className="w-4 h-4 text-red-400" /> : <span className="w-4 h-4" />)
                          )}
                        </div>
                      <div className="flex items-center gap-2">
                          <div className="text-white/80 text-xs" style={{minWidth:'10rem'}}>OpenRouter base URL</div>
                          <input
                            type="text"
                            value={openrouterBaseDraft}
                            onChange={(e) => setOpenrouterBaseDraft(e.target.value)}
                            onBlur={(e) => window.dispatchEvent(new CustomEvent('app-ai-set-openrouter-base', { detail: e.target.value }))}
                            placeholder="https://openrouter.ai/api/v1 (optional)"
                            className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-white/80 text-xs" style={{minWidth:'10rem'}}>Results count</div>
                          <select
                            defaultValue={String(settings?.ai?.webResultsCount || 5)}
                            onChange={(e) => window.dispatchEvent(new CustomEvent('app-ai-results-count', { detail: Number(e.target.value) }))}
                            className="bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1"
                          >
                            {[3,5,7,10].map(n => (<option key={n} value={n}>{n}</option>))}
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1" />
                          <div className="text-white/80 text-xs" style={{minWidth:'8rem'}}>AI Memory</div>
                          <button
                            className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15 border border-white/20 text-white/80"
                            onClick={() => { setMemoryDraft(settings?.ai?.memoryContent || ''); setShowMemoryModal(true) }}
                          >Edit...</button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-white/80 text-xs">Web search provider</div>
                        <select
                          value={settings?.ai?.webSearchProvider || 'firecrawl'}
                          onChange={(e) => {
                            const val = e.target.value
                            try { localStorage.setItem('aiWebProvider', val) } catch {}
                            window.dispatchEvent(new CustomEvent('app-ai-set-web-provider', { detail: val }))
                          }}
                          onWheel={(e) => { try { e.currentTarget.blur() } catch {} }}
                          className="ml-2 bg-white/10 text-white text-xs rounded-md border border-white/20 px-2 py-1 hover:bg-white/15 focus:outline-none"
                          title="Web search provider"
                        >
                          <option value="searxng">SearXNG (fallback)</option>
                          <option value="firecrawl">Firecrawl (self-host)</option>
                        </select>
                      </div>
                      {String(settings?.ai?.webSearchProvider || 'firecrawl') === 'searxng' && (
                        <div className="flex flex-col gap-2 mt-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>SearXNG base URL</span>
                            <input
                              type="text"
                              defaultValue={settings?.ai?.webSearxngBaseUrl || ''}
                              onBlur={(e) => window.dispatchEvent(new CustomEvent('app-ai-web-searxng-base', { detail: e.target.value }))}
                              placeholder="Optional; defaults to global SearXNG base"
                              className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}
                      {String(settings?.ai?.webSearchProvider || 'firecrawl') === 'firecrawl' && (
                        <div className="flex flex-col gap-2 mt-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>Firecrawl base URL</span>
                          <input
                              type="text"
                              value={firecrawlBaseDraft || ''}
                              onChange={(e) => setFirecrawlBaseDraft(e.target.value)}
                              onBlur={(e) => window.dispatchEvent(new CustomEvent('app-ai-firecrawl-base', { detail: e.target.value }))}
                              placeholder="/firecrawl (proxied) or http://localhost:3002"
                              className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-white/70 text-xs" style={{minWidth:'8rem'}}>Firecrawl API key</span>
                            <input
                              type="text"
                              value={firecrawlKeyDraft}
                              onChange={(e) => setFirecrawlKeyDraft(e.target.value)}
                              onBlur={(e) => window.dispatchEvent(new CustomEvent('app-ai-firecrawl-key', { detail: e.target.value }))}
                              placeholder="Optional Bearer token"
                              className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Routing controls */}
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-white text-sm font-medium">Routing</div>
                        <input
                          type="checkbox"
                          checked={settings?.ai?.routingEnabled !== false}
                          onChange={(e) => window.dispatchEvent(new CustomEvent('app-ai-routing-enabled', { detail: !!e.target.checked }))}
                        />
                      </div>
                      {settings?.ai?.routingEnabled !== false && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-4 text-white/80 text-xs">
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="radio"
                                name="ai-routing-mode"
                                checked={(settings?.ai?.routingMode || 'auto') === 'manual'}
                                onChange={() => window.dispatchEvent(new CustomEvent('app-ai-routing-mode', { detail: 'manual' }))}
                              />
                              <span>Manual by task</span>
                            </label>
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="radio"
                                name="ai-routing-mode"
                                checked={(settings?.ai?.routingMode || 'auto') === 'auto'}
                                onChange={() => window.dispatchEvent(new CustomEvent('app-ai-routing-mode', { detail: 'auto' }))}
                              />
                              <span>Pure auto</span>
                            </label>
                            {(settings?.ai?.routingMode || 'auto') === 'auto' && (
                              <label className="inline-flex items-center gap-2 ml-4">
                                <input
                                  type="checkbox"
                                  checked={!!settings?.ai?.preferLocal}
                                  onChange={(e) => window.dispatchEvent(new CustomEvent('app-ai-routing-prefer-local', { detail: !!e.target.checked }))}
                                />
                                <span>Prefer local models</span>
                              </label>
                            )}
                          </div>
                          {(settings?.ai?.routingMode || 'auto') === 'manual' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-white/70 text-xs" style={{minWidth:'4.5rem'}}>Default</span>
                                <select
                                  value={settings?.ai?.routeModels?.default || ''}
                                  onChange={(e) => window.dispatchEvent(new CustomEvent('app-ai-routing-model-default', { detail: e.target.value }))}
                                  className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1"
                                >
                                  <option value="">(auto)</option>
                                  {aiModels.map((m) => (<option key={`d-${m}`} value={m}>{m}</option>))}
                                </select>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-white/70 text-xs" style={{minWidth:'4.5rem'}}>Coding</span>
                                <select
                                  value={settings?.ai?.routeModels?.code || ''}
                                  onChange={(e) => window.dispatchEvent(new CustomEvent('app-ai-routing-model-code', { detail: e.target.value }))}
                                  className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1"
                                >
                                  <option value="">(auto)</option>
                                  {aiModels.map((m) => (<option key={`c-${m}`} value={m}>{m}</option>))}
                                </select>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-white/70 text-xs" style={{minWidth:'4.5rem'}}>Long input</span>
                                <select
                                  value={settings?.ai?.routeModels?.long || ''}
                                  onChange={(e) => window.dispatchEvent(new CustomEvent('app-ai-routing-model-long', { detail: e.target.value }))}
                                  className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1"
                                >
                                  <option value="">(auto)</option>
                                  {aiModels.map((m) => (<option key={`l-${m}`} value={m}>{m}</option>))}
                                </select>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  </div>
                  
                </TabsContent>

                {showMemoryModal && (
                  <div className="fixed inset-0 z-[100000] bg-black/60 backdrop-blur-sm flex items-center justify-center settings-force-white" onClick={() => setShowMemoryModal(false)}>
                    <div className="bg-black/85 border border-white/20 rounded-xl p-4 w-[min(90vw,900px)] settings-force-white" onClick={(e) => e.stopPropagation()}>
                      <div className="text-white mb-2 text-sm">AI Memory</div>
                      <textarea
                        rows={12}
                        value={memoryDraft}
                        onChange={(e) => setMemoryDraft(e.target.value)}
                        className="w-full bg-white/10 text-white/80 text-sm rounded-md border border-white/20 px-3 py-2 focus:outline-none"
                        placeholder="Facts and notes you want the AI to remember and use (e.g., tone, preferences, project facts)."
                      />
                      <div className="mt-3 flex justify-end gap-2">
                        <button className="px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/15 border border-white/20 text-white/80" onClick={() => setShowMemoryModal(false)}>Cancel</button>
                        <button
                          className="px-3 py-1.5 text-xs rounded bg-cyan-600/70 hover:bg-cyan-600 border border-cyan-400/40 text-white"
                          onClick={() => { window.dispatchEvent(new CustomEvent('app-ai-set-memory', { detail: memoryDraft })); setShowMemoryModal(false) }}
                        >Save</button>
                      </div>
                    </div>
                  </div>
                )}

                <TabsContent
                  value="backgrounds"
                  className="mt-4 max-h-[70vh] overflow-y-auto no-scrollbar pr-2"
                  style={{ overscrollBehavior: 'contain', overflowAnchor: 'none', scrollbarGutter: 'stable both-edges' }}
                  onPointerDown={preserveScroll}
                  onFocusCapture={preserveScroll}
                >
                  <div className="space-y-6">
                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="text-white text-sm font-medium">Enable workspace backgrounds</div>
                          <div className="text-white/60 text-xs">Allows assigning specific backgrounds to individual workspaces.</div>
                        </div>
                      </div>
                      <label className="inline-flex items-center cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!workspaceBackgroundsEnabled}
                          onChange={(e) => onToggleWorkspaceBackgroundsEnabled?.(!!e.target.checked)}
                          className="peer absolute opacity-0 w-0 h-0"
                          
                        />
                        <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60 opacity-100">
                          <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                        </div>
                      </label>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white/70 text-sm">Zoom</span>
                        <span className="text-white/50 text-xs">{Math.round((backgroundZoom || 1) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.05"
                        value={backgroundZoom || 1}
                        onChange={(e) => onBackgroundZoomChange?.(Number(e.target.value))}
                        className="w-full"
                      />
                    </div>

                    <BackgroundManager
                      embedded
                      onBackgroundChange={onBackgroundChange}
                      currentBackground={currentBackground}
                      currentMeta={currentBackgroundMeta}
                      workspaces={workspaces}
                      workspaceBackgrounds={workspaceBackgrounds}
                      anchoredWorkspaceId={settings?.speedDial?.anchoredWorkspaceId || null}
                      onAssignWorkspace={workspaceBackgroundsEnabled ? onWorkspaceBackgroundChange : undefined}
                      onAssignDefault={onBackgroundChange}
                      workspaceAssignmentsEnabled={workspaceBackgroundsEnabled}
                      title="Background Manager"
                      subtitle="Upload and manage custom backgrounds"
                    />

                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div>
                        <div className="text-white text-sm font-medium">Match URL slug backgrounds</div>
                        <div className="text-white/60 text-xs">
                          When enabled, backgrounds follow the active workspace slug just like other themed elements.
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-2 text-white/80 text-xs cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!backgroundFollowSlug}
                          onChange={(e) => onToggleBackgroundFollowSlug?.(!!e.target.checked)}
                          className="w-4 h-4 rounded border border-white/40 bg-white/10 text-cyan-400 focus:ring-0 focus:outline-none"
                        />
                        <span>Enable</span>
                      </label>
                    </div>

                    {workspaceBackgroundsEnabled ? (
                      <p className="text-white/50 text-xs">
                        Tip: right-click any background tile to assign it to a specific workspace.
                      </p>
                    ) : (
                      <p className="text-white/40 text-xs">
                        Workspace backgrounds are disabled. Toggle the setting above to assign backgrounds per workspace.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent
                  value="appearance"
                  className="mt-4 max-h-[70vh] overflow-y-auto no-scrollbar pr-2"
                  style={{ overscrollBehavior: 'contain', overflowAnchor: 'none', scrollbarGutter: 'stable both-edges' }}
                  onPointerDown={preserveScroll}
                  onFocusCapture={preserveScroll}
                >
                  <div className="space-y-6">
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-white text-sm font-medium">Appearance workspaces <span className="text-white/50 text-[11px]">- experimental</span></div>
                          <div className="text-white/60 text-xs">Toggle per-workspace appearance profiles and pick which one to edit.</div>
                        </div>
                        <label className="inline-flex items-center gap-2 text-white/80 text-xs cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!appearanceWorkspacesEnabled}
                            onChange={(e) => onToggleAppearanceWorkspaces?.(!!e.target.checked)}
                            className="w-4 h-4 rounded border border-white/40 bg-white/10 text-cyan-400 focus:ring-0 focus:outline-none"
                          />
                          <span>{appearanceWorkspacesEnabled ? 'Enabled' : 'Disabled'}</span>
                        </label>
                      </div>
                      {appearanceWorkspacesEnabled ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {(appearanceWorkspaceOptions || []).map((opt) => {
                              const isActive = appearanceWorkspaceActiveId === opt.id;
                              const anchoredLabel = opt.anchored && opt.id !== 'default' ? ' (Anchored)' : '';
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => onSelectAppearanceWorkspace?.(opt.id)}
                                  className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                                    isActive
                                      ? 'bg-cyan-500/20 border-cyan-300 text-white'
                                      : 'bg-white/5 border-white/15 text-white/70 hover:text-white hover:border-white/25'
                                  }`}
                                >
                                  {opt.label}{anchoredLabel}
                                </button>
                              )
                            })}
                          </div>
                          <div className="text-white/50 text-[10px]">Default / Anchored edits the base appearance; other entries save workspace-specific overrides.</div>
                        </div>
                      ) : (
                        <div className="text-white/45 text-[10px]">Enable this to switch the Appearance tab between workspaces.</div>
                      )}
                    </div>
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-3">
                      <div>
                        <div className="text-white text-sm font-medium mb-2">Master layout</div>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { id: 'modern', label: 'Modern', blurb: 'Three-column layout with right-side Speed Dial.' },
                            { id: 'classic', label: 'Classic', blurb: 'Two-column layout with landscape Speed Dial.' }
                          ].map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                                masterLayoutMode === opt.id
                                  ? 'bg-cyan-500/20 border-cyan-300 text-white'
                                  : 'bg-white/5 border-white/15 text-white/70 hover:text-white hover:border-white/25'
                              }`}
                              onClick={() => onSelectMasterLayout?.(opt.id)}
                              aria-pressed={masterLayoutMode === opt.id}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <div className="text-white/60 text-xs mt-2">
                          {masterLayoutMode === 'classic'
                            ? 'Classic moves Speed Dial into the center column with a 5x7 grid.'
                            : 'Modern keeps the original three-column layout.'}
                        </div>
                      </div>
                      <div className="border-t border-white/10 pt-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-white text-xs font-medium uppercase tracking-wide">Mirror layout</div>
                            <div className="text-white/60 text-[11px]">Swap the widgets and Speed Dial columns.</div>
                          </div>
                          <label className="inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!settings?.appearance?.mirrorLayout}
                              onChange={(e) => onToggleMirrorLayout?.(!!e.target.checked)}
                            />
                          </label>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-white text-xs font-medium uppercase tracking-wide">Swap workspace tabs with page switcher (Classic)</div>
                            <div className="text-white/60 text-[11px]">Moves workspace tabs to the left and page switcher to the right when using the Classic layout.</div>
                          </div>
                          <label className="inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!settings?.appearance?.swapClassicTabsWithPageSwitcher}
                              onChange={(e) => onToggleSwapClassicTabsWithPageSwitcher?.(!!e.target.checked)}
                            />
                          </label>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-white text-xs font-medium uppercase tracking-wide">Swap workspace tabs with page switcher (Modern)</div>
                            <div className="text-white/60 text-[11px]">Moves workspace tabs to the left and page switcher to the right when using the Modern layout.</div>
                          </div>
                          <label className="inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!settings?.appearance?.swapModernTabsWithPageSwitcher}
                              onChange={(e) => onToggleSwapModernTabsWithPageSwitcher?.(!!e.target.checked)}
                            />
                          </label>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-white text-xs font-medium uppercase tracking-wide">Animated overlay</div>
                            <div className="text-white/60 text-[11px]">Toggle the subtle scan-line animation overlaying the background.</div>
                          </div>
                          <label className="inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!(settings?.appearance?.animatedOverlay)}
                              onChange={(e) => onToggleAnimatedOverlay?.(e.target.checked)}
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* System-wide glow (its own section at the top) */}
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">System-wide glow</div>
                      <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                        <span className="text-white/80 text-xs">Enable glow across Speed Dial and workspace UI</span>
                        <input
                          type="checkbox"
                          checked={!!settings?.speedDial?.glowEnabled}
                          onChange={(e) => onToggleSpeedDialGlow?.(e.target.checked)}
                        />
                      </div>
                      <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded mt-2">
                        <span className="text-white/80 text-xs">Max glow intensity</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0.1"
                            max="2.5"
                            step="0.1"
                            value={Number(settings?.appearance?.glowMaxIntensity ?? 1.0)}
                            onChange={(e) => onChangeSystemGlowMaxIntensity?.(parseFloat(e.target.value))}
                            disabled={!settings?.speedDial?.glowEnabled}
                            className="w-24"
                          />
                          <span className="text-white/60 text-xs w-8">{Number(settings?.appearance?.glowMaxIntensity ?? 1.0).toFixed(1)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">Speed Dial</div>
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-white/70 text-xs">Background blur</span>
                          <span className="text-white/50 text-xs">{Number(settings?.speedDial?.blurPx ?? 0)}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="24"
                          step="1"
                          value={Number(settings?.speedDial?.blurPx ?? 0)}
                          onChange={(e) => onChangeSpeedDialBlur?.(Number(e.target.value))}
                          className="w-full"
                        />
                      </div>
                      <div className="mb-4 p-2 bg-white/5 border border-white/10 rounded">
                        <div className="flex items-center justify-between mb-1">
                          <div>
                            <div className="text-white/80 text-xs">{speedDialPositionLabel}</div>
                            <div className="text-white/50 text-[10px]">{speedDialPositionHint}</div>
                          </div>
                          <span className="text-white/60 text-xs w-16 text-right">{speedDialPositionValue >= 0 ? `+${speedDialPositionValue}` : speedDialPositionValue}px</span>
                        </div>
                        <input
                          type="range"
                          min={speedDialPositionMin}
                          max={speedDialPositionMax}
                          step={5}
                          value={Math.max(speedDialPositionMin, Math.min(speedDialPositionMax, speedDialPositionValue))}
                          onChange={(e) => onChangeSpeedDialVerticalOffset?.(Number(e.target.value))}
                          className="w-full"
                          title={speedDialPositionHint}
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Transparent background</span>
                          <input type="checkbox" checked={!!settings?.speedDial?.transparentBg} onChange={(e) => onToggleSpeedDialTransparent?.(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Outline (border)</span>
                          <input type="checkbox" checked={!!settings?.speedDial?.outline} onChange={(e) => onToggleSpeedDialOutline?.(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Shadow</span>
                          <input type="checkbox" checked={!!settings?.speedDial?.shadow} onChange={(e) => onToggleSpeedDialShadow?.(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Match icons + text to header color</span>
                          <input type="checkbox" checked={!!settings?.speedDial?.matchHeaderColor} onChange={(e) => onToggleSpeedDialMatchHeaderColor?.(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Match Speed Dial text to header font</span>
                          <input type="checkbox" checked={!!settings?.speedDial?.matchHeaderFont} onChange={(e) => onToggleSpeedDialMatchHeaderFont?.(e.target.checked)} />
                        </label>
                      </div>
                      <div className="mt-4">
                        <div className="text-white/70 text-xs mb-2">Header alignment & scroll</div>
                        <div className="flex flex-wrap gap-2">
                          {['left', 'center', 'right'].map(position => {
                            const isActive = !headerScrollEnabled && (settings?.speedDial?.headerAlign || 'center') === position
                            return (
                              <button
                                key={position}
                                onClick={() => handleHeaderAlignClick(position)}
                                className={`px-3 py-1 rounded-full text-xs border transition-colors capitalize ${
                                  isActive
                                    ? 'bg-cyan-500/20 border-cyan-400 text-white'
                                    : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                                }`}
                              >
                                {position}
                              </button>
                            )
                          })}
                          <button
                            onClick={handleHeaderScrollClick}
                            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                              headerScrollEnabled
                                ? 'bg-cyan-500/20 border-cyan-400 text-white'
                                : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                            }`}
                          >
                            Scroll
                          </button>
                        </div>
                        <div className="text-white/55 text-[10px] mt-1">Scroll animates the workspace banner; disable to keep it static.</div>
                        <div className="mt-2 flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Header follows URL slug</span>
                          <input
                            type="checkbox"
                            checked={!!(settings?.speedDial?.headerFollowsUrlSlug)}
                            onChange={(e) => onToggleHeaderFollowsUrlSlug?.(!!e.target.checked)}
                            disabled={!slugModeEnabled}
                            title={!slugModeEnabled ? 'Enable double-click for workspace URL to activate this option' : undefined}
                          />
                        </div>
                        <div className="text-white/55 text-[10px] mt-1">When on, header text tracks the URL workspace even during soft switches.</div>
                      </div>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Scroll speed (s)</span>
                          <input
                            type="number"
                            min={4}
                            max={120}
                            step={1}
                            value={Number(settings?.speedDial?.headerBannerScrollSeconds ?? 24)}
                            onChange={(e) => {
                              const v = Math.max(4, Math.min(120, Number(e.target.value) || 24))
                              onChangeHeaderBannerSpeed?.(v)
                            }}
                            disabled={!headerScrollEnabled}
                            className="w-20 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                            title={!headerScrollEnabled ? 'Enable Scroll to adjust speed' : 'Seconds per full loop'}
                          />
                        </div>
                        <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Banner text size</span>
                          <input
                            type="range"
                            min={0.75}
                            max={1.4}
                            step={0.05}
                            value={Number(settings?.speedDial?.headerBannerScale ?? 1)}
                            onChange={(e) => onChangeHeaderBannerScale?.(Number(e.target.value))}
                            disabled={!headerScrollEnabled}
                            className="w-full"
                          />
                        </div>
                        <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Use bold banner text</span>
                          <input
                            type="checkbox"
                            checked={!!settings?.speedDial?.headerBannerBold}
                            onChange={(e) => onToggleHeaderBannerBold?.(!!e.target.checked)}
                            disabled={!headerScrollEnabled}
                          />
                        </div>
                        <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Allow banner to overscan edges</span>
                          <input
                            type="checkbox"
                            checked={settings?.speedDial?.headerBannerOverscan !== false}
                            onChange={(e) => onToggleHeaderBannerOverscan?.(!!e.target.checked)}
                            disabled={!headerScrollEnabled}
                            title={!headerScrollEnabled ? 'Enable Scroll to activate banner options' : undefined}
                          />
                        </div>
                        {settings?.speedDial?.headerBannerOverscan !== false && (
                          <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                            <div>
                              <div className="text-white/80 text-xs">Enhance wraparound</div>
                              <div className="text-white/55 text-[10px]">Adds subtle blur/shadow curvature when overscanning.</div>
                            </div>
                            <input
                              type="checkbox"
                              checked={!!settings?.speedDial?.headerBannerEnhancedWrap}
                              onChange={(e) => onToggleHeaderBannerEnhancedWrap?.(!!e.target.checked)}
                              disabled={!headerScrollEnabled}
                              title={!headerScrollEnabled ? 'Enable Scroll to activate banner options' : undefined}
                            />
                          </div>
                        )}
                        <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Font override</span>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-white/65 text-[11px]">
                              <input
                                type="checkbox"
                                checked={headerBannerFontOverrideEnabled}
                                onChange={(e) => handleBannerFontOverrideToggle(!!e.target.checked)}
                              />
                              <span>Override</span>
                            </label>
                            <select
                              className="bg-black/40 text-white/90 text-xs border border-white/20 rounded px-2 py-1"
                              value={effectiveBannerFontValue}
                              onChange={(e) => handleBannerFontSelect(e.target.value)}
                              disabled={!headerBannerFontOverrideEnabled}
                            >
                              {bannerFontOptions.map(font => (
                                <option key={font} value={font}>{font}</option>
                              ))}
                              {!bannerFontOptions.includes(effectiveBannerFontValue) && (
                                <option value={effectiveBannerFontValue}>{effectiveBannerFontValue}</option>
                              )}
                            </select>
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Reverse scroll direction</span>
                          <input
                            type="checkbox"
                            checked={!!settings?.speedDial?.headerBannerReverseDirection}
                            onChange={(e) => onToggleHeaderBannerReverseDirection?.(!!e.target.checked)}
                            disabled={!headerScrollEnabled}
                            title={!headerScrollEnabled ? 'Enable Scroll to activate banner options' : undefined}
                          />
                        </div>
                        <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <div>
                            <div className="text-white/80 text-xs">Flip on workspace double-click</div>
                            <div className="text-white/55 text-[10px]">Changes direction whenever a workspace tab is double-clicked.</div>
                          </div>
                          <input
                            type="checkbox"
                            checked={!!settings?.speedDial?.headerBannerFlipOnTabDoubleClick}
                            onChange={(e) => onToggleHeaderBannerFlipOnDoubleClick?.(!!e.target.checked)}
                            disabled={!headerScrollEnabled}
                            title={!headerScrollEnabled ? 'Enable Scroll to activate banner options' : undefined}
                          />
                        </div>
                        <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <div>
                            <div className="text-white/80 text-xs">Alternate on slug hard switch</div>
                            <div className="text-white/55 text-[10px]">Automatically flips whenever the URL slug changes workspaces.</div>
                          </div>
                          <input
                            type="checkbox"
                            checked={!!settings?.speedDial?.headerBannerAlternateOnSlug}
                            onChange={(e) => onToggleHeaderBannerAlternateOnSlug?.(!!e.target.checked)}
                            disabled={!headerScrollEnabled}
                            title={!headerScrollEnabled ? 'Enable Scroll to activate banner options' : undefined}
                          />
                        </div>
                        <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Workspace hover preview</span>
                          <input type="checkbox" checked={!!(settings?.speedDial?.workspaceHoverPreview)} onChange={(e) => onToggleWorkspaceHoverPreview?.(!!e.target.checked)} />
                        </div>
                        {settings?.speedDial?.workspaceHoverPreview && (
                          <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                            <span className="text-white/80 text-xs">Colorless preview</span>
                            <input
                              type="checkbox"
                              checked={!!(settings?.speedDial?.colorlessPreview)}
                              onChange={(e) => onToggleColorlessPreview?.(!!e.target.checked)}
                              title="Keep header text and tab icon colors from changing while previewing"
                            />
                          </div>
                        )}
                      </div>
                      {!headerScrollEnabled && hasBannerOverrides && (
                        <div className="text-white/55 text-[10px] mt-2">Enable Scroll to use the banner options.</div>
                      )}
                    </div>

                    <div className="relative p-3 bg-gradient-to-r from-cyan-900/40 via-transparent to-indigo-900/40 border border-cyan-400/50 rounded-lg overflow-hidden">
                      <div className="absolute inset-0 pointer-events-none opacity-40">
                        <div className="absolute -top-10 left-8 w-24 h-24 rounded-full bg-cyan-300/40 blur-3xl" />
                        <div className="absolute bottom-0 right-4 w-28 h-28 rounded-full bg-indigo-500/30 blur-3xl" />
                      </div>
                      <div className="relative flex items-center justify-between gap-4">
                        <div>
                          <div className="text-white text-sm font-medium">Speed Dial transient glow</div>
                          <div className="text-white/65 text-[11px]">Pulse briefly and re-ignite on interactions.</div>
                        </div>
                        <label className="inline-flex items-center cursor-pointer select-none border border-white/20 rounded-full px-3 py-1 bg-black/40">
                          <input
                            type="checkbox"
                            checked={!!(settings?.speedDial?.glowTransient)}
                            onChange={(e) => onToggleGlowTransient?.(!!e.target.checked)}
                            className="peer absolute opacity-0 w-0 h-0"
                          />
                          <span className={`text-xs tracking-wide ${settings?.speedDial?.glowTransient ? 'text-white' : 'text-white/60'}`}>{settings?.speedDial?.glowTransient ? 'ON' : 'OFF'}</span>
                          <div className="ml-2 w-10 h-5 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/70">
                            <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-all peer-checked:left-5 shadow" />
                          </div>
                        </label>
                      </div>
                      <div className="relative mt-2 text-white/55 text-[10px]">Controls Speed Dial and workspace strip glow pulsing.</div>
                      {settings?.speedDial?.glowTransient && (
                        <label className="flex items-center justify-between mt-3 p-2 bg-white/5 border border-white/10 rounded cursor-pointer select-none">
                          <div className="flex flex-col">
                            <span className="text-white/80 text-xs">Glow on hover</span>
                            <span className="text-white/55 text-[10px]">Hovering the dial retriggers a pulse.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={!!settings?.speedDial?.glowHover}
                            onChange={(e) => onToggleGlowHover?.(!!e.target.checked)}
                          />
                        </label>
                      )}
                    </div>

                    {(isMasterAppearanceView || !appearanceWorkspacesEnabled) && (
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">Workspace Tabs</div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: 'tabs', label: 'Tabs' },
                          { id: 'tight', label: 'Tight Tabs' },
                          { id: 'tight-tabz', label: 'Tight Tabz' },
                          { id: 'cyber', label: 'Cyber Tabs' },
                          { id: 'buttons_inside', label: 'Buttons Inside' },
                          { id: 'buttons_outside', label: 'Buttons Outside' },
                          { id: 'classic', label: 'Classic' },
                        ].map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => onSelectTabsMode?.(opt.id)}
                            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                              tabsMode === opt.id
                                ? 'bg-cyan-500/20 border-cyan-400 text-white'
                                : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                            }`}
                          >
                            {opt.label}
                          </button>
                          ))}
                        </div>
                      <div className="text-white/60 text-xs mt-2">
                        Tabs use the original pill layout. Tight Tabs keep the pill geometry but blend the active tab into the dial. Cyber Tabs add a futuristic fused style. Buttons use a rectangular layout. Classic shows a vertical workspace strip. <span className="text-white/70 font-semibold">Workspace tab shape is global</span> so all workspace appearances share this choice.
                      </div>
                      <div className="mt-3 grid gap-2">
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded cursor-pointer select-none">
                          <div className="flex flex-col">
                            <span className="text-white/80 text-xs">Hover feedback</span>
                            <span className="text-white/50 text-[10px]">Enable hover effects on workspace tabs.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={!!settings?.speedDial?.tabHoverShade}
                            onChange={(e) => onToggleTabHoverShade?.(!!e.target.checked)}
                          />
                        </label>
                        {settings?.speedDial?.tabHoverShade && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-white/80">
                            {[
                              { id: 'shade', label: 'Shade (neutral)' },
                              { id: 'shade-color', label: 'Shade with workspace color' },
                              { id: 'blur', label: 'Blur background on hover' },
                              { id: 'blur-color', label: 'Blur + workspace color' },
                            ].map(opt => (
                              <label key={opt.id} className={`flex items-center justify-between p-2 border rounded bg-white/5 border-white/10 ${settings?.speedDial?.tabHoverStyle === opt.id ? 'bg-white/10 border-cyan-400' : ''}`}>
                                <span className="pr-2">{opt.label}</span>
                                <input
                                  type="radio"
                                  name="tab-hover-style"
                                  value={opt.id}
                                  checked={(settings?.speedDial?.tabHoverStyle || 'shade-color') === opt.id}
                                  onChange={(e) => onSelectTabHoverStyle?.(e.target.value)}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                        {tabsMode === 'buttons_inside' && (
                          <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                            <span className="text-white/80 text-xs">Show divider between tabs and shortcuts</span>
                            <input type="checkbox" checked={!!settings?.speedDial?.tabsDivider} onChange={(e) => onToggleTabsDivider?.(e.target.checked)} />
                          </div>
                        )}
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <div>
                            <div className="text-white/80 text-xs">Glow workspace color on double click</div>
                            <div className="text-white/50 text-[10px]">Applies the workspace glow color to the double-click flash instead of blue.</div>
                          </div>
                          <input
                            type="checkbox"
                            checked={!!settings?.speedDial?.glowWorkspaceColorOnDoubleClick}
                            onChange={(e) => onToggleGlowWorkspaceColorOnDoubleClick?.(!!e.target.checked)}
                          />
                        </label>
                      </div>
                      <div className="mt-4 border-t border-white/10 pt-3">
                        <div className="text-white/70 text-xs mb-2">Strip Button Styles</div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center justify-between bg-white/5 border border-white/10 rounded p-2">
                            <span className="text-white/80 text-xs">Background</span>
                            <input type="checkbox" checked={!!(settings?.speedDial?.wsButtons?.background)} onChange={(e) => onToggleWsButtonBackground?.(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between bg-white/5 border border-white/10 rounded p-2">
                            <span className="text-white/80 text-xs">Shadow</span>
                            <input type="checkbox" checked={!!(settings?.speedDial?.wsButtons?.shadow)} onChange={(e) => onToggleWsButtonShadow?.(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between bg-white/5 border border-white/10 rounded p-2">
                            <span className="text-white/80 text-xs">Blur when active</span>
                            <input type="checkbox" checked={!!(settings?.speedDial?.wsButtons?.blur)} onChange={(e) => onToggleWsButtonBlur?.(e.target.checked)} />
                          </label>
                          {settings?.speedDial?.wsButtons?.blur && (
                            <label className="flex items-center justify-between bg-white/5 border border-white/10 rounded p-2">
                              <span className="text-white/80 text-xs">Active blur matches Speed Dial blur level</span>
                              <input
                                type="checkbox"
                                checked={!!(settings?.speedDial?.wsButtons?.matchDialBlur)}
                                onChange={(e) => onToggleWsButtonMatchDialBlur?.(e.target.checked)}
                              />
                            </label>
                          )}
                        </div>
                      <div className="text-white/50 text-[11px] mt-2">Affects the vertical workspace strip shown in Classic mode.</div>
                    </div>

                      {/* System-wide glow block moved to top of Appearance */}
                    </div>
                    )}
                    {/* ai chat (moved after Workspace Tabs) */}
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">ai chat</div>
                      <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded gap-3">
                        <span className="text-white/80 text-xs">Stream width (x bar width)</span>
                        <div className="flex items-center gap-2">
                          <span className="text-white/50 text-[11px]">x{Number(settings?.appearance?.chatWidthScale ?? 1).toFixed(2)}</span>
                          <input
                            type="range"
                            min="1"
                            max="1.5"
                            step="0.05"
                            value={Number(settings?.appearance?.chatWidthScale ?? 1)}
                            onChange={(e) => onChangeAiStreamScale?.(Number(e.target.value))}
                            className="w-32"
                            title="AI stream width multiplier"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded mt-2 gap-3">
                        <div>
                          <div className="text-white/80 text-xs">Bubble background blur</div>
                          <div className="text-white/50 text-[10px]">Set assistant bubble blur strength (0 = off). Saves between reloads.</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-white/60 text-[11px] w-10 text-right">{Math.round(Number(settings?.appearance?.chatBubbleBlurPx ?? 12))}px</span>
                          <input
                            type="range"
                            min="0"
                            max="30"
                            step="1"
                            value={Number(settings?.appearance?.chatBubbleBlurPx ?? 12)}
                            onChange={(e) => onChangeChatBubbleBlur?.(e.target.value)}
                            className="w-32"
                          />
                        </div>
                      </div>
                      <div className="text-white/55 text-[10px] mt-2">Both options clamp to the middle column so chat never overlaps the Speed Dial.</div>
                    </div>

                    {/* Search Bar appearance */}
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">Search Bar</div>
                      <div className="space-y-3">
                        <div className="p-2 bg-white/5 border border-white/10 rounded">
                          <div className="text-white/80 text-xs mb-2">Search bar position</div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {[
                              { id: 'bottom', label: 'bottom' },
                              { id: 'center-unfixed', label: 'center-unfixed' },
                              { id: 'center-fixed', label: 'center-fixed' },
                              { id: 'top-fixed', label: 'Top-fixed' }
                            ].map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                                  searchBarPosition === opt.id
                                    ? 'bg-cyan-500/20 border-cyan-300 text-white'
                                    : 'bg-white/5 border-white/15 text-white/70 hover:text-white hover:border-white/25'
                                }`}
                                onClick={() => onSelectSearchBarPosition?.(opt.id)}
                                aria-pressed={searchBarPosition === opt.id}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          <div className="text-white/50 text-[10px] mt-2">
                            Bottom keeps the docked position. Center modes float in the middle, and Top fixed pins the bar near the header until AI mode pulls it down.
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                            <span className="text-white/80 text-xs">Transparent background</span>
                            <input type="checkbox" checked={!!settings?.appearance?.searchBar?.transparentBg} onChange={(e) => onToggleSearchBarTransparent?.(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                            <span className="text-white/80 text-xs">Outline (border)</span>
                            <input type="checkbox" checked={!!settings?.appearance?.searchBar?.outline} onChange={(e) => onToggleSearchBarOutline?.(e.target.checked)} />
                          </label>
                          <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                            <span className="text-white/80 text-xs">Shadow</span>
                            <input type="checkbox" checked={!!settings?.appearance?.searchBar?.shadow} onChange={(e) => onToggleSearchBarShadow?.(e.target.checked)} />
                          </label>
                          <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded gap-3">
                            <div>
                              <div className="text-white/80 text-xs">Width</div>
                              <div className="text-white/50 text-[10px]">Relative to current maximum</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min={0.5}
                                max={1}
                                step={0.05}
                                value={Number(settings?.appearance?.searchBar?.widthScale ?? 1)}
                                onChange={(e) => onChangeSearchBarWidthScale?.(Number(e.target.value))}
                                className="w-28"
                                disabled={isClassicLayout}
                                title={isClassicLayout ? 'Width locks in Classic layout' : 'Search bar width scale'}
                              />
                              <span className="text-white/50 text-[11px]">{Math.round(Number(settings?.appearance?.searchBar?.widthScale ?? 1) * 100)}%</span>
                            </div>
                          </div>
                          {isClassicLayout && (
                            <div className="text-white/45 text-[10px]">Width follows the classic stack and cannot be adjusted.</div>
                          )}
                          <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                            <div>
                              <div className="text-white/80 text-xs">Inline &amp; AI buttons glow</div>
                              <div className="text-white/50 text-[10px]">Trigger their neon glow as soon as the buttons are pressed.</div>
                            </div>
                            <input
                              type="checkbox"
                              checked={!!settings?.appearance?.searchBar?.inlineAiButtonGlow}
                              onChange={(e) => onToggleSearchBarInlineAiGlow?.(!!e.target.checked)}
                            />
                          </label>
                          <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded gap-3">
                            <span className="text-white/80 text-xs">Search bar blur</span>
                            <div className="flex items-center gap-2">
                              <span className="text-white/50 text-[11px]">{Number(settings?.appearance?.searchBar?.blurPx ?? 20)}px</span>
                              <input
                                type="range"
                                min="0"
                                max="28"
                                step="1"
                                value={Number(settings?.appearance?.searchBar?.blurPx ?? 20)}
                                onChange={(e) => onChangeSearchBarBlurPx?.(Number(e.target.value))}
                                className="w-24"
                                title="Search bar blur (px)"
                              />
                            </div>
                          </div>

                          {/* Suggestions blur next to search bar blur */}
                          <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-white/80 text-xs">Suggestions blur</span>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={Math.max(0, Math.min(100, Math.round((Number(settings?.appearance?.suggestionsBlurPx ?? 0) / 64) * 100)))}
                                onChange={(e) => {
                                  const pct = Math.max(0, Math.min(100, Number(e.target.value)))
                                  const px = Math.round((pct / 100) * 64)
                                  onChangeSuggestionsBlurPx?.(px)
                                }}
                                className="w-24"
                                disabled={!!settings?.appearance?.suggestionsMatchBarBlur}
                                title="Suggestions background blur (0-100%)"
                              />
                            </div>
                            <label className="flex items-center gap-2 text-white/70 text-xs" title="Use search bar blur for suggestions">
                              <input type="checkbox" checked={!!settings?.appearance?.suggestionsMatchBarBlur} onChange={(e) => onToggleSuggestionsMatchBarBlur?.(!!e.target.checked)} />
                              <span>Match bar</span>
                            </label>
                          </div>
                          {/* Suggestions styling options */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <label className="p-2 bg-white/5 border border-white/10 rounded flex items-center justify-between">
                            <span className="text-white/80 text-xs">Remove background</span>
                            <input type="checkbox" checked={!!suggCfg.removeBackground} onChange={(e) => onToggleSuggestionsRemoveBackground?.(!!e.target.checked)} />
                          </label>
                          <label className="p-2 bg-white/5 border border-white/10 rounded flex items-center justify-between">
                            <span className="text-white/80 text-xs">Remove outline</span>
                            <input type="checkbox" checked={!!suggCfg.removeOutline} onChange={(e) => onToggleSuggestionsRemoveOutline?.(!!e.target.checked)} />
                          </label>
                          <label className="p-2 bg-white/5 border border-white/10 rounded flex items-center justify-between">
                            <span className="text-white/80 text-xs">Use shadows</span>
                            <input type="checkbox" checked={suggCfg.useShadows !== false} onChange={(e) => onToggleSuggestionsUseShadows?.(!!e.target.checked)} />
                          </label>
                        </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="p-2 bg-white/5 border border-white/10 rounded flex items-center justify-between">
                            <div>
                              <div className="text-white/90 text-xs font-medium">Transient glow</div>
                              <div className="text-white/60 text-[10px]">Pulse when URL switches to a workspace.</div>
                            </div>
                            <label className="inline-flex items-center cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={searchBarTransientEnabled}
                                onChange={(e) => onToggleSearchBarGlowTransient?.(!!e.target.checked)}
                              />
                            </label>
                          </div>
                          <div className="p-2 bg-white/5 border border-white/10 rounded flex items-center justify-between">
                            <div>
                              <div className="text-white/90 text-xs font-medium">Refocus (URL slug)</div>
                              <div className="text-white/60 text-[10px]">On focus, glow using the URL workspace; falls back to current workspace when URL slug is off.</div>
                            </div>
                            <label className="inline-flex items-center cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={searchBarRefocusEnabled}
                                onChange={(e) => onToggleSearchBarRefocus?.(!!e.target.checked)}
                              />
                            </label>
                          </div>
                      {searchBarRefocusEnabled && (
                        <div className="sm:col-span-2 p-2 bg-white/5 border border-white/10 rounded space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="text-white/90 text-xs font-medium">Refocus glow mode</div>
                            <div className="text-white/60 text-[10px]">Choose how the focus halo animates.</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => onChangeSearchBarRefocusMode?.('letters')}
                              aria-pressed={searchBarRefocusMode === 'letters'}
                              className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                                searchBarRefocusMode === 'letters'
                                  ? 'bg-cyan-500/20 border-cyan-300 text-white'
                                  : 'bg-white/5 border-white/15 text-white/70 hover:text-white hover:border-white/25'
                              }`}
                            >
                              Mode 1 - Directional on input
                            </button>
                            <button
                              type="button"
                              onClick={() => onChangeSearchBarRefocusMode?.('pulse')}
                              aria-pressed={searchBarRefocusMode === 'pulse'}
                              className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                                searchBarRefocusMode === 'pulse'
                                  ? 'bg-cyan-500/20 border-cyan-300 text-white'
                                  : 'bg-white/5 border-white/15 text-white/70 hover:text-white hover:border-white/25'
                              }`}
                            >
                              Mode 2 - Pulse then orient
                            </button>
                            <button
                              type="button"
                              onClick={() => onChangeSearchBarRefocusMode?.('steady')}
                              aria-pressed={searchBarRefocusMode === 'steady'}
                              className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                                searchBarRefocusMode === 'steady'
                                  ? 'bg-cyan-500/20 border-cyan-300 text-white'
                                  : 'bg-white/5 border-white/15 text-white/70 hover:text-white hover:border-white/25'
                              }`}
                            >
                              Mode 3 - Lock direction
                            </button>
                          </div>
                          <div className="text-white/50 text-[10px] leading-relaxed">
                            Mode 1 keeps the glow tight and only leans once text is present. Mode 2 flashes a brief halo before steering toward its on-screen position. Mode 3 locks the directional lean so typing never changes it.
                          </div>
                          <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded cursor-pointer select-none">
                            <div className="flex flex-col">
                              <span className="text-white/80 text-xs">Hover glow</span>
                              <span className="text-white/55 text-[10px]">Keep the refocus halo active while hovering over the bar.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={searchBarHoverGlow}
                              onChange={(e) => onToggleSearchBarHoverGlow?.(!!e.target.checked)}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                    <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                      <span className="text-white/80 text-xs">Always use default font</span>
                      <input type="checkbox" checked={!!settings?.appearance?.searchBar?.useDefaultFont} onChange={(e) => onToggleSearchBarUseDefaultFont?.(e.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                      <span className="text-white/80 text-xs">Always use default color</span>
                      <input type="checkbox" checked={!!settings?.appearance?.searchBar?.useDefaultColor} onChange={(e) => onToggleSearchBarUseDefaultColor?.(e.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                      <span className="text-white/80 text-xs">Darker placeholder text</span>
                      <input type="checkbox" checked={!!settings?.appearance?.searchBar?.darkerPlaceholder} onChange={(e) => onToggleSearchBarDarkerPlaceholder?.(e.target.checked)} />
                    </label>
                  </div>
                      <div className="text-white/60 text-xs mt-2">Glow uses the workspace glow color (Speed Dial settings). When transient is on, the search bar pulses briefly when the URL switches to a workspace.</div>
                    </div>

</div>
                    

                    

                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-3">
                      <div className="text-white text-sm font-medium">Inline Results</div>
                      <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                        <span className="text-white/80 text-xs">Theme</span>
                        <select
                          value={settings?.appearance?.inline?.theme || 'terminal'}
                          onChange={(e) => window.dispatchEvent(new CustomEvent('app-inline-theme', { detail: e.target.value }))}
                          onWheel={(e) => { try { e.currentTarget.blur() } catch {} }}
                          className="ml-2 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 hover:bg-white/15 focus:outline-none"
                          title="Inline theme"
                        >
                          <option value="terminal">Terminal</option>
                          <option value="glassy">Glassy</option>
                        </select>
                      </div>
                      <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                        <span className="text-white/80 text-xs">Outline (border)</span>
                        <input
                          type="checkbox"
                          checked={settings?.appearance?.inline?.outline !== false}
                          onChange={(e) => window.dispatchEvent(new CustomEvent('app-inline-outline', { detail: !!e.target.checked }))}
                        />
                      </label>

                      <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                        <span className="text-white/80 text-xs">Use workspace slug font color</span>
                        <input
                          type="checkbox"
                          checked={!!settings?.appearance?.inline?.useWorkspaceSlugTextColor}
                          onChange={(e) => window.dispatchEvent(new CustomEvent('app-inline-slug-font-color', { detail: !!e.target.checked }))}
                        />
                      </label>

                      <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                        <span className="text-white/80 text-xs">System-style return button</span>
                        <input
                          type="checkbox"
                          checked={!!settings?.appearance?.inline?.systemReturnButton}
                          onChange={(e) => window.dispatchEvent(new CustomEvent('app-inline-return-style', { detail: !!e.target.checked }))}
                        />
                      </label>
                      <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                        <span className="text-white/80 text-xs">Return button position</span>
                        <div className="flex items-center gap-3 text-white/80 text-xs">
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="radio"
                              name="inline-return-pos"
                              checked={(settings?.appearance?.inline?.returnPos || 'center') === 'left'}
                              onChange={() => onSelectInlineReturnPos?.('left')}
                            />
                            <span>Bottom left</span>
                          </label>
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="radio"
                              name="inline-return-pos"
                              checked={(settings?.appearance?.inline?.returnPos || 'center') === 'center'}
                              onChange={() => onSelectInlineReturnPos?.('center')}
                            />
                            <span>Bottom center</span>
                          </label>
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="radio"
                              name="inline-return-pos"
                              checked={(settings?.appearance?.inline?.returnPos || 'center') === 'right'}
                              onChange={() => onSelectInlineReturnPos?.('right')}
                            />
                            <span>Bottom right</span>
                          </label>
                        </div>
                      </div>
                      <div className="text-white/55 text-[10px]">Controls the inline results window styling. More themes coming soon.</div>
                    </div>

                    {/* Removed Chat & Music UI customizations */}

                  </div>
                  
                </TabsContent>

                <TabsContent
                  value="theming"
                  className="mt-4 max-h-[70vh] overflow-y-auto no-scrollbar pr-2"
                  style={{ overscrollBehavior: 'contain', overflowAnchor: 'none', scrollbarGutter: 'stable both-edges' }}
                  onPointerDown={preserveScroll}
                  onFocusCapture={preserveScroll}
                >
                  <div className="space-y-6">
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">Workspace URL behavior</div>
                      <div className="flex items-start justify-between gap-3 p-2 bg-white/5 border border-white/10 rounded">
                        <div>
                          <div className="text-white/80 text-xs">Double-click for workspace URL</div>
                          <div className="text-white/60 text-[11px]">When on, updating the URL to /workspace requires a double-click. When off, a single click updates the URL.</div>
                        </div>
                        <label className="inline-flex items-center cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!(settings?.general?.autoUrlDoubleClick)}
                            onChange={(e) => onToggleAutoUrlDoubleClick?.(e.target.checked)}
                            className="peer absolute opacity-0 w-0 h-0"
                          />
                          <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                            <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                          </div>
                        </label>
                      </div>
                      <div className="mt-3 flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                        <span className="text-white/80 text-xs">Apply workspace glow by URL slug</span>
                        <input
                          type="checkbox"
                          checked={!!settings?.speedDial?.glowByUrl}
                          onChange={(e) => onToggleGlowByUrl?.(!!e.target.checked)}
                          disabled={!settings?.general?.autoUrlDoubleClick}
                          title={!settings?.general?.autoUrlDoubleClick ? 'Enable double-click for workspace URL to activate this option' : undefined}
                        />
                      </div>
                      <div className="text-white/50 text-[11px] mt-1">Automatically matches the current path (e.g. /work-name) before applying workspace colors and glow.</div>

                      {settings?.general?.autoUrlDoubleClick && settings?.speedDial?.glowByUrl && (
                        <div className="mt-3 p-2 bg-white/5 border border-white/10 rounded">
                          <div className="text-white/80 text-xs mb-2">Glow behavior during soft switching</div>
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-white/70 text-xs">
                              <input
                                type="radio"
                                name="soft-switch-glow-behavior"
                                checked={(settings?.speedDial?.softSwitchGlowBehavior || 'noGlow') === 'noGlow'}
                                onChange={() => {
                                  onChangeSoftSwitchGlowBehavior?.('noGlow')
                                  window.dispatchEvent(new CustomEvent('app-set-soft-switch-glow-behavior', { detail: 'noGlow' }))
                                }}
                              />
                              <span>No Glow: Disables outer glow during soft switches.</span>
                            </label>
                            <label className="flex items-center gap-2 text-white/70 text-xs">
                              <input
                                type="radio"
                                name="soft-switch-glow-behavior"
                                checked={settings?.speedDial?.softSwitchGlowBehavior === 'pinnedGlow'}
                                onChange={() => {
                                  onChangeSoftSwitchGlowBehavior?.('pinnedGlow')
                                  window.dispatchEvent(new CustomEvent('app-set-soft-switch-glow-behavior', { detail: 'pinnedGlow' }))
                                }}
                              />
                              <span>Pinned Glow: Glow stays fixed around the double-clicked workspace tab and Speed Dial.</span>
                            </label>
                            <label className="flex items-center gap-2 text-white/70 text-xs">
                              <input
                                type="radio"
                                name="soft-switch-glow-behavior"
                                checked={settings?.speedDial?.softSwitchGlowBehavior === 'glowFollows'}
                                onChange={() => {
                                  onChangeSoftSwitchGlowBehavior?.('glowFollows')
                                  window.dispatchEvent(new CustomEvent('app-set-soft-switch-glow-behavior', { detail: 'glowFollows' }))
                                }}
                              />
                              <span>Glow Follows: Speed Dial glow stays pinned; workspace tab glow moves with the active selection.</span>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>

                      <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                        <div className="text-white text-sm font-medium">Last In Theming</div>
                        <div className="text-white/60 text-xs mb-3">Reapply your most recent workspace styling when opening the default homepage.</div>
                        <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <div>
                            <div className="text-white/80 text-xs">Enable Last In</div>
                            <div className="text-white/50 text-[11px]">Overrides the base look on <code>localhost:3000</code> with the last workspace.</div>
                          </div>
                          <label className="inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={lastInEnabled}
                              onChange={(e) => onToggleLastInEnabled?.(!!e.target.checked)}
                              className="peer absolute opacity-0 w-0 h-0"
                            />
                            <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                              <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                            </div>
                          </label>
                        </div>
                        <div className="mt-3 space-y-2">
                          <label className={`flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded ${lastInEnabled ? '' : 'opacity-50'}`}>
                            <div className="text-white/80 text-xs">Include glow</div>
                            <input
                              type="checkbox"
                              checked={lastInIncludeGlow}
                              onChange={(e) => onToggleLastInIncludeGlow?.(!!e.target.checked)}
                              disabled={!lastInEnabled}
                            />
                          </label>
                          <label className={`flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded ${lastInEnabled ? '' : 'opacity-50'}`}>
                            <div className="text-white/80 text-xs">Include typography</div>
                            <input
                              type="checkbox"
                              checked={lastInIncludeTypography}
                              onChange={(e) => onToggleLastInIncludeTypography?.(!!e.target.checked)}
                              disabled={!lastInEnabled}
                            />
                          </label>
                        </div>
                      </div>

                    { /* System-wide glow moved to Appearance */ }

                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">Default outer glow</div>
                      <div className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                        <span className="text-white/80 text-xs">Default outer glow</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={settings?.theme?.includeGlow !== false}
                            onChange={(e) => onToggleDefaultOuterGlow?.(!!e.target.checked)}
                            title="Enable or disable default outer glow color"
                          />
                          <input
                            type="color"
                            value={settings?.speedDial?.glowColor || '#00ffff66'}
                            onChange={(e) => onChangeSpeedDialGlowColor?.(e.target.value)}
                            disabled={settings?.theme?.includeGlow === false}
                            title={settings?.theme?.includeGlow === false ? 'Enable default outer glow to edit' : 'Select glow color'}
                          />
                        </div>
                      </div>
                      <div className="text-white/60 text-xs mt-2">Speed Dial, workspace headers, and glow fallback effects reference this value when enabled.</div>
                    </div>

                    {/* Workspace glow colors */}
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">Workspace Glow Colors</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {workspaces.map(ws => {
                          const isAnchored = anchoredWorkspaceId === ws.id
                          return (
                            <label
                              key={ws.id}
                              className={`flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded ${isAnchored ? 'opacity-40' : ''}`}
                            >
                              <span className="text-white/80 text-xs">{ws.name}{isAnchored ? ' (Anchored)' : ''}</span>
                              <input
                                type="color"
                                value={(settings?.speedDial?.workspaceGlowColors || {})[ws.id] || settings?.speedDial?.glowColor || '#00ffff66'}
                                onChange={(e) => onChangeWorkspaceGlowColor?.(ws.id, e.target.value)}
                                disabled={isAnchored}
                                title={isAnchored ? 'Anchored workspace uses default glow.' : undefined}
                              />
                            </label>
                          )
                        })}
                      </div>
                      <div className="text-white/60 text-xs mt-2">When changing workspaces (URL updates), the dial uses the assigned glow color. Toggle transient effects from the shared glow control above.</div>
                      {anchoredWorkspaceId && (
                        <div className="text-white/45 text-[10px] mt-2">Anchored workspace always uses the default glow color.</div>
                      )}
                    </div>

                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium">Default Typography</div>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="flex items-center gap-3 bg-white/5 border border-white/10 rounded p-2">
                          <span className="text-white/70 text-xs w-24">Text color</span>
                          <input
                            type="color"
                            value={settings?.theme?.colors?.primary || '#ffffff'}
                            onChange={(e) => onManualTextColorChange?.(e.target.value)}
                          />
                        </label>
                        <label className="flex items-center gap-3 bg-white/5 border border-white/10 rounded p-2">
                          <span className="text-white/70 text-xs w-24">Accent color</span>
                          <input
                            type="color"
                            value={settings?.theme?.colors?.accent || '#ff00ff'}
                            onChange={(e) => onManualAccentColorChange?.(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="mt-4 text-white/70 text-xs uppercase tracking-wide">Font preset</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {fontPresetOptions.map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => onSelectFontPreset?.(opt.id)}
                            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                              (settings?.appearance?.fontPreset || 'industrial') === opt.id
                                ? 'bg-cyan-500/20 border-cyan-400 text-white'
                                : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Workspace typography */}
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-white text-sm font-medium">Workspace Typography</div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {workspaces.map(ws => {
                          const isAnchored = anchoredWorkspaceId === ws.id
                          return (
                            <div key={ws.id} className={`p-2 bg-white/5 border border-white/10 rounded ${isAnchored ? 'opacity-40' : ''}`}>
                              <div className="text-white/70 text-xs mb-1">{ws.name}{isAnchored ? ' (Anchored)' : ''}</div>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-white/60 text-xs w-16">Font</span>
                                <select
                                  className="flex-1 px-2 py-1 bg-white/10 border border-white/20 rounded text-white/90 text-xs"
                                  onChange={(e) => onChangeWorkspaceTextFont?.(ws.id, e.target.value)}
                                  value={(settings?.speedDial?.workspaceTextFonts || {})[ws.id] || ''}
                                  disabled={isAnchored}
                                  title={isAnchored ? 'Anchored workspace inherits default typography.' : undefined}
                                >
                                  <option value="">Default</option>
                                  {fontPresetOptions.map(opt => (
                                    <option key={opt.id} value={opt.label}>{opt.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-white/60 text-xs w-16">Color</span>
                                <input
                                  type="color"
                                  value={(settings?.speedDial?.workspaceTextColors || {})[ws.id] || '#ffffff'}
                                  onChange={(e) => onChangeWorkspaceTextColor?.(ws.id, e.target.value)}
                                  disabled={isAnchored}
                                  title={isAnchored ? 'Anchored workspace uses global text color.' : undefined}
                                />
                              </div>
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-white/60 text-xs w-16">Accent</span>
                                <input
                                  type="color"
                                  value={isAnchored
                                    ? (settings?.theme?.colors?.accent || '#ff00ff')
                                    : ((settings?.speedDial?.workspaceAccentColors || {})[ws.id] ?? '#ff00ff')}
                                  onChange={(e) => onChangeWorkspaceAccentColor?.(ws.id, e.target.value)}
                                  disabled={isAnchored}
                                  title={isAnchored ? 'Anchored workspace uses global accent color.' : undefined}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <div className="text-white/60 text-xs mt-2">Speed Dial is exempt from the universal font/color. Hover labels and workspace title follow these settings.</div>
                      {anchoredWorkspaceId && (
                        <div className="text-white/45 text-[10px] mt-2">Anchored workspace inherits global typography and colors.</div>
                      )}
                    </div>

                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">Workspace-wide sync</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Match all text colors to active workspace</span>
                          <input type="checkbox" checked={!!settings?.appearance?.matchWorkspaceTextColor} onChange={(e) => onToggleMatchWorkspaceTextColor?.(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Match accent text to active workspace</span>
                          <input type="checkbox" checked={!!settings?.appearance?.matchWorkspaceAccentColor} onChange={(e) => onToggleMatchWorkspaceAccentColor?.(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Match fonts to active workspace</span>
                          <input type="checkbox" checked={!!settings?.appearance?.matchWorkspaceFonts} onChange={(e) => onToggleMatchWorkspaceFonts?.(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between p-2 bg-white/5 border border-white/10 rounded">
                          <span className="text-white/80 text-xs">Apply font/color only when URL matches</span>
                          <input type="checkbox" checked={!!settings?.speedDial?.workspaceTextByUrl} onChange={(e) => onToggleWorkspaceTextByUrl?.(e.target.checked)} />
                        </label>
                      </div>
                      <div className="text-white/60 text-xs mt-2">Use these toggles to cascade workspace styling rules or keep them scoped.</div>
                    </div>

                  </div>
                    
                </TabsContent>

                <TabsContent
                  value="widgets"
                  className="mt-4 max-h-[70vh] overflow-y-auto no-scrollbar pr-2"
                  style={{ overscrollBehavior: 'contain', overflowAnchor: 'none', scrollbarGutter: 'stable both-edges' }}
                  onPointerDown={preserveScroll}
                  onFocusCapture={preserveScroll}
                >
                  <div className="space-y-6">
                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="text-white text-sm font-medium">Vertical offset</div>
                          <div className="text-white/60 text-xs">Push clock + weather block up/down together.</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-white/60 text-[11px] w-10 text-right">{Math.round(Number(widgetsSettings?.verticalOffset ?? 0))}px</span>
                          <input
                            type="range"
                            min={-120}
                            max={120}
                            step={2}
                            value={Number(widgetsSettings?.verticalOffset ?? 0)}
                            onChange={(e) => onChangeWidgetsVerticalOffset?.(Number(e.target.value))}
                            className="w-36"
                            title="Vertical offset for clock + weather"
                          />
                        </div>
                      </div>
                      <div className="text-white text-sm font-medium mb-2">Clock layout</div>
                      <div className="flex gap-2">
                        {[
                          { id: 'preset1', label: 'Preset 1' },
                          { id: 'preset2', label: 'Preset 2' },
                        ].map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => onSelectClockPreset?.(opt.id)}
                            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                              clockLayoutPreset === opt.id
                                ? 'bg-cyan-500/20 border-cyan-400 text-white'
                                : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <div className="text-white/50 text-xs mt-2">Preset 2 enlarges the primary clock face and arranges sub-zones in capsules.</div>
                    </div>

                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">Weather layout</div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: 'preset1', label: 'Preset 1' },
                          { id: 'preset2', label: 'Preset 2' },
                          { id: 'preset3', label: 'Preset 3' },
                        ].map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => onSelectWeatherPreset?.(opt.id)}
                            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                              weatherLayoutPreset === opt.id
                                ? 'bg-cyan-500/20 border-cyan-400 text-white'
                                : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <div className="text-white/50 text-xs mt-2">Preset 2 is the compact + detail variant; Preset 3 mirrors it with a flipped hero row and a tighter 7-day strip.</div>
                    </div>

                    <label className="p-3 bg-white/5 border border-white/15 rounded-lg flex items-center justify-between">
                      <div>
                        <div className="text-white text-sm font-medium">Clock/weather separator element</div>
                        <div className="text-white/60 text-xs">Adds a subtle neon divider between the widgets.</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={!!widgetsSettings?.clockWeatherSeparator}
                        onChange={(e) => onToggleClockWeatherSeparator?.(!!e.target.checked)}
                      />
                    </label>

                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-3">
                      <div className="text-white text-sm font-medium">Widget surface tweaks</div>
                      <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded px-3 py-2">
                        <div>
                          <div className="text-white/80 text-xs font-medium uppercase tracking-wide">Remove outlines</div>
                          <div className="text-white/60 text-[11px]">Swap borders for soft shadows across preset 2/3 layouts.</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={!!widgetsSettings?.removeOutlines}
                          onChange={(e) => onToggleWidgetsRemoveOutlines?.(e.target.checked)}
                        />
                      </div>
                      <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded px-3 py-2">
                        <div>
                          <div className="text-white/80 text-xs font-medium uppercase tracking-wide">Remove backgrounds</div>
                          <div className="text-white/60 text-[11px]">Clear card fills, ideal for weather preset 3 or minimal themes.</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={!!widgetsSettings?.removeBackgrounds}
                          onChange={(e) => onToggleWidgetsRemoveBackgrounds?.(e.target.checked)}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div>
                        <div className="text-white text-sm font-medium">Show seconds</div>
                        <div className="text-white/60 text-xs">Display seconds in the clock.</div>
                      </div>
                      <label className="inline-flex items-center cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!(widgetsSettings?.showSeconds)}
                          onChange={(e) => onToggleShowSeconds?.(e.target.checked)}
                          className="peer absolute opacity-0 w-0 h-0"
                        />
                        <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                          <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                        </div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div>
                        <div className="text-white text-sm font-medium">24-hour clock</div>
                        <div className="text-white/60 text-xs">Use 24-hour time instead of 12-hour.</div>
                      </div>
                      <label className="inline-flex items-center cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!(widgetsSettings?.twentyFourHour)}
                          onChange={(e) => onToggleTwentyFourHour?.(e.target.checked)}
                          className="peer absolute opacity-0 w-0 h-0"
                        />
                        <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                          <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                        </div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div>
                        <div className="text-white text-sm font-medium">Units</div>
                        <div className="text-white/60 text-xs">Toggle Fahrenheit / Celsius for weather.</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onToggleUnits?.(false)}
                          className={`px-3 py-1 rounded-full text-sm border ${
                            (widgetsSettings?.units || 'metric') === 'metric' ? 'bg-cyan-500/20 border-cyan-400 text-white' : 'bg-white/5 border-white/20 text-white/70'
                          }`}
                          title="Celsius"
                        >
                          C
                        </button>
                        <button
                          onClick={() => onToggleUnits?.(true)}
                          className={`px-3 py-1 rounded-full text-sm border ${
                            (widgetsSettings?.units || 'metric') === 'imperial' ? 'bg-cyan-500/20 border-cyan-400 text-white' : 'bg-white/5 border-white/20 text-white/70'
                          }`}
                          title="Fahrenheit"
                        >
                          F
                        </button>
                      </div>
                    </div>

                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">Sub timezones</div>
                      <div className="grid grid-cols-2 gap-2">
                        {TZ_CHOICES.map(opt => {
                          const checked = (widgetsSettings?.subTimezones || []).includes(opt.id)
                          return (
                            <label key={opt.id} className="flex items-center gap-2 text-white/80 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const current = new Set(widgetsSettings?.subTimezones || [])
                                  if (e.target.checked) current.add(opt.id)
                                  else current.delete(opt.id)
                                  onChangeSubTimezones?.(Array.from(current))
                                }}
                              />
                              <span>{opt.label}</span>
                            </label>
                          )
                        })}
                      </div>
                      <div className="text-white/50 text-xs mt-2">Local time is shown as the main clock. Selected sub timezones appear underneath.</div>
                    </div>

                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-col gap-1">
                          <div className="text-white text-sm font-medium">Music backend</div>
                          <div className="text-white/60 text-xs">
                            Controls the music player widget. When disabled, the music player is hidden from the widgets column.
                          </div>
                        </div>
                        <label className="inline-flex items-center cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={widgetsSettings?.enableMusicPlayer !== false}
                            onChange={(e) => onToggleEnableMusicPlayer?.(!!e.target.checked)}
                            className="peer absolute opacity-0 w-0 h-0"
                          />
                          <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
                            <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
                          </div>
                        </label>
                      </div>
                      <div className="text-white/60 text-xs">Default uses a same-origin proxy at <code>/music/api/v1</code>. Override if your player runs elsewhere.</div>
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                        <input
                          type="text"
                          value={settings?.general?.musicBackend || '/music/api/v1'}
                          onChange={(e) => onChangeMusicBackend?.(e.target.value)}
                          className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                          placeholder="/music/api/v1 or http://127.0.0.1:26538/api/v1"
                        />
                        <button
                          onClick={() => onChangeMusicBackend?.('/music/api/v1')}
                          className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15 border border-white/20 text-white/80"
                        >Use default</button>
                      </div>
                      <div className="flex gap-2 items-center mt-2">
                        <span className="text-white/70 text-xs" style={{minWidth:'6rem'}}>Music token</span>
                        <input
                          type="text"
                          defaultValue={settings?.general?.musicToken || ''}
                          onBlur={(e) => onChangeMusicToken?.(e.target.value)}
                          className="flex-1 bg-white/10 text-white/80 text-xs rounded-md border border-white/20 px-2 py-1 focus:outline-none"
                          placeholder="Bearer token (from /auth/{id})"
                        />
                      </div>
                    </div>

                    <div className="p-3 bg-white/5 border border-white/15 rounded-lg">
                      <div className="text-white text-sm font-medium mb-2">Music player styling</div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-white/80 text-xs">Blur</span>
                          <input
                            type="range"
                            min="0"
                            max="28"
                            step="1"
                            value={Number(musicCfg.blurPx ?? 12)}
                            onChange={(e) => onChangeMusicBlurPx?.(Number(e.target.value))}
                            className="w-28"
                            title="Music player background blur (px)"
                          />
                        </div>
                        <span className="text-white/50 text-[11px]">{Number(musicCfg.blurPx ?? 12)}px</span>
                      </div>
                      <label className="mt-1 p-2 bg-white/5 border border-white/10 rounded flex items-center justify-between">
                        <span className="text-white/80 text-xs">Match blur to search bar</span>
                        <input
                          type="checkbox"
                          checked={!!musicCfg.matchSearchBarBlur}
                          onChange={(e) => onToggleMusicMatchSearchBarBlur?.(!!e.target.checked)}
                        />
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="p-2 bg-white/5 border border-white/10 rounded flex items-center justify-between">
                          <span className="text-white/80 text-xs">Remove background</span>
                          <input type="checkbox" checked={!!musicCfg.removeBackground} onChange={(e) => onToggleMusicRemoveBackground?.(!!e.target.checked)} />
                        </label>
                        <label className="p-2 bg-white/5 border border-white/10 rounded flex items-center justify-between">
                          <span className="text-white/80 text-xs">Remove outline</span>
                          <input type="checkbox" checked={!!musicCfg.removeOutline} onChange={(e) => onToggleMusicRemoveOutline?.(!!e.target.checked)} />
                        </label>
                        <label className="p-2 bg-white/5 border border-white/10 rounded flex items-center justify-between">
                          <span className="text-white/80 text-xs">Use shadows</span>
                          <input type="checkbox" checked={musicCfg.useShadows !== false} onChange={(e) => onToggleMusicUseShadows?.(!!e.target.checked)} />
                        </label>
                      </div>
                      <label className="mt-2 p-2 bg-white/5 border border-white/10 rounded flex items-center justify-between">
                        <span className="text-white/80 text-xs">Match text color to workspace coloring</span>
                        <input type="checkbox" checked={!!musicCfg.matchWorkspaceTextColor} onChange={(e) => onToggleMusicMatchTextColor?.(!!e.target.checked)} />
                      </label>
                    </div>

                    {/* Preset 2 Styling controls removed as requested */}

                    

                  </div>
                  
                </TabsContent>

                <TabsContent
                  value="about"
                  className="mt-4 max-h-[70vh] overflow-y-auto no-scrollbar pr-2"
                  style={{ overscrollBehavior: 'contain', overflowAnchor: 'none', scrollbarGutter: 'stable both-edges' }}
                  onPointerDown={preserveScroll}
                  onFocusCapture={preserveScroll}
                >
                  <div className="space-y-4">
                    {/* Support card with Buy me a coffee */}
                    <div className="bg-gradient-to-r from-cyan-600/40 via-fuchsia-600/35 to-purple-700/30 border border-cyan-300/30 rounded-lg p-4 shadow-lg">
                      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-2">
                          <div className="text-white text-[11px] font-semibold uppercase tracking-[0.12em] px-2 py-1 rounded-md bg-white/10 inline-block border border-white/15">Support</div>
                          <div className="text-white text-lg font-semibold">Enjoy VSTART? Support development</div>
                          <div className="text-white/80 text-sm">Optional and appreciated — all features are available without activation.</div>
                        </div>
                        <div className="w-full md:w-auto flex flex-col gap-2 items-start md:items-end">
                          <button
                            type="button"
                            className="text-sm px-3 py-2 rounded-md bg-yellow-400/85 text-black font-semibold hover:bg-yellow-300/90 transition-colors border border-black/10 shadow"
                            title="Buy me a coffee"
                            onClick={() => {
                              try { window.open('https://buymeacoffee.com/vahagnb', '_blank', 'noopener,noreferrer') } catch {}
                            }}
                          >
                            Buy me a coffee
                          </button>
                          <span className="text-white/60 text-xs px-2 py-1 rounded border border-white/15 bg-white/5">MIT License</span>
                        </div>
                      </div>
                    </div>

                    {/* Setup Instructions (kept as-is from previous layout) */}
                    <div className="bg-white/5 border border-white/15 rounded-lg p-3 shadow-lg">
                      <button
                        type="button"
                        onClick={() => setShowSetupInstructions((prev) => !prev)}
                        className="w-full flex items-center justify-between gap-3 px-2 py-2 rounded-md bg-gradient-to-r from-emerald-600/30 via-cyan-600/25 to-blue-600/30 border border-emerald-300/40 text-white text-sm font-semibold hover:brightness-110 transition-all"
                      >
                        <span>Setup Instructions</span>
                        <span className="text-xs text-white/70">{showSetupInstructions ? 'Hide' : 'Show'}</span>
                      </button>
                      {showSetupInstructions && (
                        <div className="mt-3 space-y-3 text-white/85 text-sm">
                          <div className="p-3 bg-black/30 border border-emerald-400/60 rounded-lg space-y-2">
                            <div className="text-white font-semibold">History Helper browser extension (optional, recommended)</div>
                            <div className="text-white/75">
                              The History Helper extension lets VSTART use your browser history for smarter suggestions. It never sends history off-device; it only exposes matches to this local page.
                            </div>
                            <div className="flex flex-wrap gap-2 mt-1">
                              <button
                                type="button"
                                className="px-3 py-1.5 rounded-md bg-emerald-500/80 hover:bg-emerald-400 text-black text-xs font-semibold border border-emerald-900/40"
                                onClick={() => {
                                  try {
                                    // Attempt to open a packaged extension URL if served; otherwise fall back to instructions.
                                    const url = `${window.location.origin.replace(/\/+$/, '')}/extensions/history-helper/`
                                    window.open(url, '_blank', 'noopener,noreferrer')
                                  } catch {
                                    try { alert('To install History Helper, please follow the manual instructions shown below.') } catch {}
                                  }
                                }}
                              >
                                Install History Helper (opens in new tab)
                              </button>
                            </div>
                            <div className="mt-2 space-y-1 text-white/75 text-xs leading-relaxed">
                              <div className="font-semibold text-white/85">Manual install (most browsers):</div>
                              <ol className="list-decimal list-inside space-y-1">
                                <li>Open your browser&rsquo;s extensions page:
                                  <span className="ml-1">
                                    <span className="font-semibold">Chrome / Edge / Brave / Vivaldi:</span> go to <code>chrome://extensions</code>.
                                  </span>
                                </li>
                                <li>Enable <span className="font-semibold">Developer mode</span>.</li>
                                <li>
                                  Click <span className="font-semibold">Load unpacked</span> and select the
                                  <code className="ml-1">extensions/history-helper</code> folder from this project.
                                </li>
                                <li>
                                  Ensure the extension is <span className="font-semibold">enabled</span> and that VSTART is served from
                                  <code className="ml-1">http://localhost:3000</code> (matches the extension manifest).
                                </li>
                              </ol>
                              <div className="mt-1">
                                <span className="font-semibold">Firefox:</span> open <code>about:debugging</code> → This Firefox → Load Temporary Add-on… and pick a file in
                                <code className="ml-1">extensions/history-helper</code>. (You may need to allow MV3/beta features.)
                              </div>
                            </div>
                          </div>
                          <div className="p-3 bg-black/30 border border-white/10 rounded-lg space-y-2">
                            <div className="text-white font-semibold">1) Install VSTART (Docker required)</div>
                            <div className="text-white/75">Recommended: Docker Compose.</div>
                            <ol className="list-decimal list-inside space-y-1 text-white/75">
                              <li>Download and extract the project.</li>
                              <li>Open a terminal in the project folder.</li>
                              <li>Run <code>docker compose up -d</code>.</li>
                              <li>Visit <span className="font-semibold text-white">http://localhost:3000/</span>.</li>
                            </ol>
                            <div className="text-white/70 text-xs uppercase tracking-wide mt-1">Alternative: Docker CLI</div>
                            <div className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white/80 text-xs">
                              <code>docker run -d -p 3000:3000 --name vstart vstart:latest</code>
                            </div>
                          </div>

                          <div className="p-3 bg-black/30 border border-white/10 rounded-lg space-y-2">
                            <div className="text-white font-semibold">2) Set VSTART as your start page (Vivaldi)</div>
                            <ol className="list-decimal list-inside space-y-1 text-white/75">
                              <li>Open <strong>Settings</strong>.</li>
                              <li>Go to <strong>General</strong>.</li>
                              <li>Scroll to <strong>Startup</strong>.</li>
                              <li>Under <strong>Homepage</strong>, choose <strong>Specific Page</strong>.</li>
                              <li>Enter <span className="font-semibold text-white">http://localhost:3000/</span>.</li>
                            </ol>
                          </div>

                          <div className="p-3 bg-black/30 border border-white/10 rounded-lg space-y-2">
                            <div className="text-white font-semibold">3) Enable workspace routing in Vivaldi (required for hard switching)</div>
                            <div className="text-white/75">Create workspace rules so Vivaldi switches automatically when visiting workspace URLs.</div>
                            <ol className="list-decimal list-inside space-y-1 text-white/75">
                              <li>Open <strong>Settings</strong> &gt; <strong>Tabs</strong>.</li>
                              <li>Scroll to <strong>Workspace Rules</strong>.</li>
                              <li>Click <strong>Add New Workspace Rule</strong>.</li>
                              <li>Add rules like:</li>
                            </ol>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {[ 
                                { url: 'http://localhost:3000/home', workspace: 'Home' },
                                { url: 'http://localhost:3000/dev', workspace: 'Dev' },
                                { url: 'http://localhost:3000/cuny', workspace: 'CUNY' },
                                { url: 'http://localhost:3000/trade', workspace: 'Trade' },
                              ].map((rule) => (
                                <div key={rule.url} className="flex items-center justify-between bg-white/5 border border-white/10 rounded px-2 py-1 text-white/80 text-xs">
                                  <span className="truncate">{rule.url}</span>
                                  <span className="text-white/60">&rarr; {rule.workspace}</span>
                                </div>
                              ))}
                            </div>
                            <div className="text-white/60 text-xs">Repeat for every workspace you use.</div>
                          </div>

                          <div className="p-3 bg-black/30 border border-white/10 rounded-lg space-y-2">
                            <div className="text-white font-semibold">4) Create VSTART workspaces</div>
                            <div className="text-white/75">Each workspace is created using a URL slug.</div>
                            <ol className="list-decimal list-inside space-y-1 text-white/75">
                              <li>Right-click the workspace tabs.</li>
                              <li>Select <strong>Add Workspace</strong>.</li>
                              <li>Name it (example: Home, Dev, Work).</li>
                              <li>Visit the matching URL: <span className="font-semibold text-white">http://localhost:3000/WORKSPACENAME</span>.</li>
                            </ol>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-white/80 text-xs">
                              <div className="bg-white/5 border border-white/10 rounded px-2 py-1">/home</div>
                              <div className="bg-white/5 border border-white/10 rounded px-2 py-1">/dev</div>
                              <div className="bg-white/5 border border-white/10 rounded px-2 py-1">/work</div>
                            </div>
                          </div>

                          <div className="p-3 bg-black/30 border border-white/10 rounded-lg space-y-2">
                            <div className="text-white font-semibold">5) Chrome / Edge / Brave setup</div>
                            <div className="text-white/75">Automatic workspace switching is Vivaldi-only, but VSTART works normally.</div>
                            <ol className="list-decimal list-inside space-y-1 text-white/75">
                              <li>Open <strong>Settings</strong>.</li>
                              <li>Go to <strong>On Startup</strong>.</li>
                              <li>Choose <strong>Open a specific page</strong>.</li>
                              <li>Enter <span className="font-semibold text-white">http://localhost:3000/</span>.</li>
                            </ol>
                            <div className="text-white/70 text-xs uppercase tracking-wide mt-1">Manual workspace switching</div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-white/80 text-xs">
                              <div className="bg-white/5 border border-white/10 rounded px-2 py-1">/home</div>
                              <div className="bg-white/5 border border-white/10 rounded px-2 py-1">/dev</div>
                              <div className="bg-white/5 border border-white/10 rounded px-2 py-1">/study</div>
                            </div>
                          </div>

                          <div className="p-3 bg-black/30 border border-white/10 rounded-lg space-y-2">
                            <div className="text-white font-semibold">6) Troubleshooting</div>
                            <ul className="list-disc list-inside space-y-1 text-white/75">
                              <li><span className="font-semibold text-white">Blank page:</span> make sure Docker is running, then visit http://localhost:3000/.</li>
                              <li><span className="font-semibold text-white">Workspace not loading:</span> slug must match exactly (case-sensitive).</li>
                              <li><span className="font-semibold text-white">Vivaldi not switching:</span> check Settings &gt; Tabs &gt; Workspace Rules.</li>
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Export / Import section (unchanged) */}
                    <div className="bg-white/5 border border-white/15 rounded-lg p-3 shadow-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="text-white font-semibold text-sm">Export / Import</div>
                          <div className="text-white/70 text-xs">
                            Backup and restore your full VSTART configuration, including settings, workspaces, layouts, themes, widgets, backgrounds, fonts, and shortcuts.
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setExportImportStatus('')
                            window.dispatchEvent(new CustomEvent('vstart-export-config'))
                            setExportImportStatus('Export started... if your browser prompts, save the JSON file somewhere safe.')
                          }}
                          className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/15 border border-white/20 text-white text-xs font-semibold transition-colors"
                        >
                          Export full configuration
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setExportImportStatus('')
                            if (importFileInputRef.current) {
                              importFileInputRef.current.value = ''
                              importFileInputRef.current.click()
                            }
                          }}
                          className="px-3 py-2 rounded-md bg-cyan-500/30 hover:bg-cyan-500/40 border border-cyan-400/60 text-white text-xs font-semibold transition-colors"
                        >
                          Import full configuration
                        </button>
                        <input
                          ref={importFileInputRef}
                          type="file"
                          accept="application/json"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files && e.target.files[0]
                            if (!file) return
                            if (!file.name.toLowerCase().endsWith('.json')) {
                              setExportImportStatus('Import error: please choose a .json backup file.')
                              alert('Please select a valid VSTART JSON backup file.')
                              return
                            }
                            const reader = new FileReader()
                            reader.onload = () => {
                              try {
                                const text = String(reader.result || '')
                                const parsed = JSON.parse(text)
                                window.dispatchEvent(new CustomEvent('vstart-import-config', { detail: parsed }))
                                setExportImportStatus('Import requested... if the file is valid, your layout and settings will reload shortly.')
                              } catch (err) {
                                console.error('Failed to parse import file', err)
                                setExportImportStatus('Import error: invalid JSON file.')
                                alert('The selected file is not a valid VSTART backup (JSON parse error).')
                              }
                            }
                            reader.onerror = () => {
                              setExportImportStatus('Import error: failed to read file.')
                              alert('Could not read the selected file.')
                            }
                            reader.readAsText(file)
                          }}
                        />
                      </div>
                      {exportImportStatus && (
                        <div className="mt-2 text-[11px] text-white/60">
                          {exportImportStatus}
                        </div>
                      )}
                      <div className="mt-3 text-white/70 text-xs">
                        Contact: <a href="mailto:vbitzx@gmail.com" className="text-white hover:underline">vbitzx@gmail.com</a> for questions and concerns.
                      </div>
                    </div>
                  </div>
                </TabsContent>


              </Tabs>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export default SettingsButton
