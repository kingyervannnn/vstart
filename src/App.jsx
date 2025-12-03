import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import "./App.css";
import VivaldiSpeedDial from "./components/VivaldiSpeedDial";
import WorkspaceStrip from "./components/WorkspaceStrip";
import SearchBox from "./components/SearchBox";
import ClockWidget from "./components/ClockWidget";
import WeatherWidget from "./components/WeatherWidget";
import NotesWidget from "./components/NotesWidget";
import NotesOverlay from "./components/NotesOverlay";
import EmailOverlay from "./components/EmailOverlay";
import EmailWidget from "./components/EmailWidget";
import MusicController from "./components/MusicController";
import SettingsButton from "./components/SettingsButton";
import BackgroundRenderer from "./components/BackgroundRenderer";
import IconThemeFilters from "./components/IconThemeFilters";
import ErrorBoundary from "./components/ErrorBoundary";
import GmailOAuthCallback from "./pages/GmailOAuthCallback";
import {
  getBackgroundURLById,
  getBackgroundRecordById,
  saveBackgroundFile,
} from "./lib/idb-backgrounds";
import { trySaveIconToProject } from "./lib/icon-storage";
import { createThemeTokenResolver } from "./lib/theme-tokens";
import {
  resolveSearchBarBlurPx,
  resolveSuggestionsBlurPx,
} from "./lib/blur-utils";
import {
  createWorkspaceSwitchingManager,
  getNormalizedPath,
} from "./lib/workspace-switching";
import { setSettingsOpen, isSettingsOpen } from "./lib/settings-visibility";
import {
  loadNotesFromVault,
  saveNoteToVault,
  deleteNoteFromVault,
} from "./lib/notes-sync";

// Import background assets
import themeGif2 from "./assets/theme_2.gif";
import themeGif3 from "./assets/theme_3.gif";
import themeGif2Still from "./assets/theme_2_still.webp";
import themeGif3Still from "./assets/theme_3_still.webp";
import defaultBackground from "./assets/1d24f44ca3ba213da16e8aec97ea163f.png";

// Font presets moved to theme-tokens.js for centralized management

// getNormalizedPath moved to workspace-switching.js

// Helper function for URL workspace detection
const slugifyWorkspaceName = (name) => {
  try {
    return (
      String(name || "")
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, "-")
        .replace(/[^a-z0-9\-]/g, "")
        .replace(/\-+/g, "-")
        .replace(/^\-+|\-+$/g, "") || "workspace"
    );
  } catch {
    return "workspace";
  }
};

const getWorkspaceFolderName = (workspaceId, workspaces) => {
  if (!workspaceId) return "";
  const list = Array.isArray(workspaces) ? workspaces : [];
  const ws =
    list.find((w) => w.id === workspaceId) ||
    null;
  const base = ws?.name || ws?.id || "workspace";
  const slug = slugifyWorkspaceName(base);
  return slug || "";
};

const normalizeVaultNotes = (rawNotes, workspaces) => {
  if (!Array.isArray(rawNotes) || !rawNotes.length) return [];
  const list = Array.isArray(workspaces) ? workspaces : [];
  const slugIndex = new Map();
  list.forEach((ws) => {
    const slug = getWorkspaceFolderName(ws.id, list);
    if (slug) {
      slugIndex.set(slug, ws.id);
    }
  });
  return rawNotes.map((note) => {
    const folderRaw =
      note && typeof note.folder === "string" ? note.folder.trim() : "";
    const folder = folderRaw || "";
    let workspaceId = note.workspaceId || null;
    if (!workspaceId && folder && folder !== "unassigned") {
      const matchId = slugIndex.get(folder);
      if (matchId) {
        workspaceId = matchId;
      }
    }
    let nextFolder = folder;
    if (!nextFolder && workspaceId) {
      const slug = getWorkspaceFolderName(workspaceId, list);
      nextFolder = slug || "";
    }
    if (!nextFolder && !workspaceId && folder === "unassigned") {
      nextFolder = "unassigned";
    }
    return {
      ...note,
      workspaceId,
      folder: nextFolder,
    };
  });
};

const isDataUrl = (value) => typeof value === "string" && /^data:/i.test(value);

const collectCustomIcons = (speedDialMap) => {
  const result = {};
  if (!speedDialMap || typeof speedDialMap !== "object") return result;
  const visit = (tiles) => {
    if (!Array.isArray(tiles)) return;
    tiles.forEach((tile) => {
      if (!tile || typeof tile !== "object") return;
      if (isDataUrl(tile.favicon)) {
        result[tile.id] = tile.favicon;
      }
      if (Array.isArray(tile.children) && tile.children.length) {
        visit(tile.children);
      }
    });
  };
  Object.values(speedDialMap).forEach(visit);
  return result;
};

const mergeCustomIcons = (speedDialMap, iconMap = {}) => {
  if (
    !speedDialMap ||
    typeof speedDialMap !== "object" ||
    !iconMap ||
    typeof iconMap !== "object"
  ) {
    return speedDialMap || {};
  }

  const applyIcons = (tiles) => {
    if (!Array.isArray(tiles)) return tiles;
    let changed = false;
    const nextTiles = tiles.map((tile) => {
      if (!tile || typeof tile !== "object") return tile;
      const icon = iconMap[tile.id];
      let next = tile;
      if (icon) {
        next = { ...next, favicon: icon };
        changed = true;
      }
      if (Array.isArray(tile.children) && tile.children.length) {
        const nextChildren = applyIcons(tile.children);
        if (nextChildren !== tile.children) {
          next = next === tile ? { ...tile } : next;
          next.children = nextChildren;
          changed = true;
        }
      }
      return next;
    });
    return changed ? nextTiles : tiles;
  };

  let mutates = false;
  const result = Object.entries(speedDialMap).reduce((acc, [wsId, tiles]) => {
    const nextTiles = applyIcons(tiles);
    if (nextTiles !== tiles) mutates = true;
    acc[wsId] = nextTiles;
    return acc;
  }, {});

  return mutates ? result : speedDialMap;
};

const BUILTIN_GIF_PLACEHOLDERS = new Map([
  [themeGif2, themeGif2Still],
  [themeGif3, themeGif3Still],
]);

const BUILTIN_GIF_PLACEHOLDERS_BY_META = {
  "default-1": themeGif2Still,
  "default-2": themeGif3Still,
};

const DEFAULT_APPEARANCE_WORKSPACE_ID = "default";
const MASTER_APPEARANCE_ID = "master";
const MASTER_WIDGETS_ID = "master";

const normalizeAppearanceWorkspaceState = (raw) => {
  const enabled = !!raw?.enabled;
  const overrides =
    raw && typeof raw.overrides === "object" && raw.overrides
      ? raw.overrides
      : {};
  const lastSelectedId =
    typeof raw?.lastSelectedId === "string" && raw.lastSelectedId
      ? raw.lastSelectedId
      : MASTER_APPEARANCE_ID;
  return { enabled, overrides, lastSelectedId };
};

const normalizeWorkspaceWidgetsState = (raw) => {
  const enabled = !!raw?.enabled;
  const overrides =
    raw && typeof raw.overrides === "object" && raw.overrides
      ? raw.overrides
      : {};
  const lastSelectedId =
    typeof raw?.lastSelectedId === "string" && raw.lastSelectedId
      ? raw.lastSelectedId
      : MASTER_WIDGETS_ID;
  return { enabled, overrides, lastSelectedId };
};

const resolveWorkspaceWidgetsTargetId = (
  state,
  requestedId,
) => {
  if (!state?.enabled) return MASTER_WIDGETS_ID;
  if (requestedId === MASTER_WIDGETS_ID) return MASTER_WIDGETS_ID;
  const normalized =
    typeof requestedId === "string" && requestedId
      ? requestedId
      : MASTER_WIDGETS_ID;
  return normalized;
};

const resolveWorkspaceWidgetsProfile = (
  baseWidgets,
  state,
  workspaceId,
) => {
  const masterOverride = state?.overrides?.[MASTER_WIDGETS_ID] || null;
  if (!state?.enabled) {
    // When workspace widgets are disabled, force everything to use
    // a single widgets profile: base widgets + master override (if exists).
    // Ignore all workspace-specific overrides.
    return masterOverride
      ? { ...baseWidgets, ...masterOverride }
      : baseWidgets;
  }
  const overrides = state?.overrides || {};
  if (workspaceId === MASTER_WIDGETS_ID) {
    return masterOverride || baseWidgets;
  }
  const baseEffective = masterOverride ? { ...baseWidgets, ...masterOverride } : baseWidgets;
  if (!workspaceId || workspaceId === MASTER_WIDGETS_ID) {
    return baseEffective;
  }
  if (overrides[workspaceId]) {
    return { ...baseEffective, ...overrides[workspaceId] };
  }
  return baseEffective;
};

const resolveAppearanceWorkspaceTargetId = (
  state,
  requestedId,
  anchoredWorkspaceId, // Kept for backward compatibility but not used for appearance workspaces
) => {
  if (!state?.enabled) return MASTER_APPEARANCE_ID;
  if (requestedId === MASTER_APPEARANCE_ID) return MASTER_APPEARANCE_ID;
  const normalized =
    typeof requestedId === "string" && requestedId
      ? requestedId
      : MASTER_APPEARANCE_ID;
  // No default workspace - only master override and individual workspaces
  return normalized;
};

// Helper to deep merge appearance profiles (handles nested objects like 'inline')
const deepMergeAppearance = (base, override) => {
  if (!override) return base;
  const merged = { ...base };
  for (const key in override) {
    if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      // Deep merge nested objects (like 'inline')
      merged[key] = deepMergeAppearance(base[key] || {}, override[key]);
    } else {
      // Override primitive values and arrays
      merged[key] = override[key];
    }
  }
  return merged;
};

const getAppearanceDiff = (base, target) => {
  const diff = {};
  const allKeys = new Set([...Object.keys(base || {}), ...Object.keys(target || {})]);

  for (const key of allKeys) {
    const baseVal = base?.[key];
    const targetVal = target?.[key];

    if (JSON.stringify(baseVal) === JSON.stringify(targetVal)) continue;

    if (
      baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal) &&
      targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)
    ) {
      const nestedDiff = getAppearanceDiff(baseVal, targetVal);
      if (Object.keys(nestedDiff).length > 0) {
        diff[key] = nestedDiff;
      }
    } else if (targetVal !== undefined) {
      diff[key] = targetVal;
    }
  }
  return diff;
};

const deepRemoveKeys = (target, keys) => {
  if (!target || typeof target !== 'object' || !keys || typeof keys !== 'object') return target;
  const next = { ...target };
  let changed = false;
  for (const key in keys) {
    if (keys[key] && typeof keys[key] === 'object' && !Array.isArray(keys[key])) {
      if (next[key]) {
        const nextVal = deepRemoveKeys(next[key], keys[key]);
        if (nextVal !== next[key]) {
          next[key] = nextVal;
          changed = true;
          if (Object.keys(next[key]).length === 0) {
            delete next[key];
          }
        }
      }
    } else {
      if (key in next) {
        delete next[key];
        changed = true;
      }
    }
  }
  return changed ? next : target;
};

const resolveAppearanceProfileForWorkspace = (
  baseAppearance,
  state,
  workspaceId,
  anchoredWorkspaceId,
) => {
  const masterOverride = state?.overrides?.[MASTER_APPEARANCE_ID] || null;
  if (!state?.enabled) {
    // When appearance workspaces are disabled, force everything to use
    // a single appearance profile: base appearance + master override (if exists).
    // Ignore all workspace-specific overrides.
    return masterOverride
      ? deepMergeAppearance(baseAppearance, masterOverride)
      : baseAppearance;
  }
  const overrides = state?.overrides || {};
  if (workspaceId === MASTER_APPEARANCE_ID) {
    return masterOverride || baseAppearance;
  }
  const baseEffective = masterOverride ? deepMergeAppearance(baseAppearance, masterOverride) : baseAppearance;
  // No default workspace - only master override and individual workspaces
  if (!workspaceId || workspaceId === MASTER_APPEARANCE_ID) {
    return baseEffective;
  }
  if (overrides[workspaceId]) {
    return deepMergeAppearance(baseEffective, overrides[workspaceId]);
  }
  return baseEffective;
};

function App() {
  // Handle Gmail OAuth callback route
  const isOAuthCallback = typeof window !== 'undefined' && window.location.pathname === '/gmail-oauth-callback'
  if (isOAuthCallback) {
    return <GmailOAuthCallback />
  }

  const [mounted, setMounted] = useState(false);
  // Compensate for browser zoom changes across displays
  const [uiScale, setUiScale] = useState(1);
  // Scale down Speed Dial on smaller viewports to external-baseline proportions
  const BASELINE = { width: 1365, height: 992 };
  const [dialScale, setDialScale] = useState(1);
  const [currentBackground, setCurrentBackground] = useState(() => {
    // Initialize from localStorage or default
    const saved = localStorage.getItem("vivaldi-current-background");
    return saved || defaultBackground; // Default background
  });
  const [globalBackgroundMeta, setGlobalBackgroundMeta] = useState(null);
  const globalBackgroundObjectUrlRef = useRef(null);
  const [workspaceBackgrounds, setWorkspaceBackgrounds] = useState({});
  const workspaceBackgroundsRef = useRef({});
  const [selectedWorkspaceForZoom, setSelectedWorkspaceForZoom] = useState(null);
  const backgroundAbortControllersRef = useRef(new Map());
  const lastAppliedBackgroundRef = useRef({ workspaceId: null, src: null });
  const workspaceBackgroundsRestoredRef = useRef(false);
  const [workspaceBackgroundsRestored, setWorkspaceBackgroundsRestored] = useState(false);
  const searchBoxRef = useRef(null);
  const seededNotesRef = useRef(false);
  const [notesInlineEditing, setNotesInlineEditing] = useState(false);
  const [notesCenterNoteId, setNotesCenterNoteId] = useState(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [emailsCenterOpen, setEmailsCenterOpen] = useState(false);
  const [emailCenterEmailId, setEmailCenterEmailId] = useState(null);
  const [emailCenterEmailAccount, setEmailCenterEmailAccount] = useState(null);
  // Widget alternator: 'none' (use settings), 'notes-only', 'email-only'
  const [widgetAlternatorMode, setWidgetAlternatorMode] = useState(() => {
    try {
      const saved = localStorage.getItem("vstart-widget-alternator-mode");
      return saved || 'none';
    } catch {
      return 'none';
    }
  });
  const [emailAccounts, setEmailAccounts] = useState(() => {
    try {
      const saved = localStorage.getItem("vivaldi-email-accounts");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const notesEditingIdRef = useRef(null);
  const [notesHoverPreviewId, setNotesHoverPreviewId] = useState(null);
  const [notesActiveFolder, setNotesActiveFolder] = useState("");
  const [settings, setSettings] = useState({
    ai: {
      enabled: true,
      webSearch: false,
      webSearchProvider: "searxng",
      routingEnabled: true,
      routingMode: "auto",
      preferLocal: true,
      lmstudioBaseUrl: "http://localhost:1234",
      model: "",
      openaiApiKey: "",
      openrouterBaseUrl: "",
      memoryContent: "",
      openrouterApiKey: "",
      firecrawlBaseUrl: "",
      firecrawlApiKey: "",
    },
    theme: {
      font: "Inter",
      colors: {
        primary: "#454545",
        secondary: "#00ffff",
        accent: "#a83838",
      },
      transparency: 0.1,
      glassEffect: true,
      borders: true,
      borderStyle: "rounded",
      lastIn: {
        enabled: true,
        includeGlow: true,
        includeTypography: true,
      },
    },
    speedDial: {
      transparency: 0.1,
      showText: false,
      blurPx: 7,
      transparentBg: true,
      verticalOffset: -20,
      landscapeOffset: -115,
      dialLayoutOverrides: {},
      outline: false,
      shadow: true,
      tabsMode: "buttons_inside", // 'tabs' | 'tight' | 'cyber' | 'buttons_inside' | 'buttons_outside' | 'classic'
      tabsModeVersion: 2,
      glowEnabled: true,
      glowColor: "#ffffff",
      workspaceGlowColors: {},
      glowByUrl: true,
      glowTransient: false,
      glowHover: true,
      softSwitchGlowBehavior: "pinnedGlow", // 'noGlow' | 'pinnedGlow' | 'glowFollows'
      tabsShape: "rect", // 'pill' | 'rect'
      tabsPlacement: "inside", // 'outside' | 'inside' (only when rect)
      tabsDivider: false,
      tabGlowEnabled: true,
      tabGlowUseWorkspaceColor: true,
      tabHoverShade: true,
      tabHoverStyle: "shade-color", // none | shade | shade-color | blur | blur-color
      workspaceTextColors: {},
      workspaceTextFonts: {},
      workspaceTextByUrl: true,
      wsButtons: {
        background: false,
        shadow: true,
        blur: true,
        matchDialBlur: true,
        outline: true,
      },
      workspaceAccentColors: {},
      headerAlign: "center",
      glowWorkspaceColorOnDoubleClick: true,
      headerEffectMode: "sustained", // 'off' | 'sustained'
      headerBannerMatchWorkspaceColor: false,
      headerBannerStatic: false,
      headerBannerOverscan: true,
      headerBannerEnhancedWrap: false,
      headerBannerScale: 1.4,
      headerBannerBold: true,
      headerBannerFontOverrideEnabled: false,
      headerBannerFont: "TR2N",
      headerBannerScrollSeconds: 51,
      headerBannerReverseDirection: false,
      headerBannerFlipOnTabDoubleClick: true,
      headerBannerAlternateOnSlug: true,
      workspaceHoverPreview: false,
      anchoredWorkspaceId: null,
      matchHeaderColor: true,
      matchHeaderFont: true,
      headerFollowsUrlSlug: false,
      extraClassicColumns: 0,
      extraModernRows: 0,
      matchHeaderColorByWorkspace: {},
      matchHeaderFontByWorkspace: {},
      colorlessPreview: true,
      workspaceHeaderColorMode: {},
      glowTransientByWorkspace: {},
      maxGlow: 2.5,
      maxGlowByWorkspace: {},
    },
    widgets: {
      showSeconds: false,
      twentyFourHour: false,
      units: "imperial", // 'metric' (°C) | 'imperial' (°F)
      clockPreset: "preset2", // 'preset1' | 'preset2'
      weatherPreset: "preset3", // 'preset1' | 'preset2' | 'preset3'
      weatherShowDetailsOnHover: true,
      enableClock: true,
      enableWeather: true,
      enableNotes: true,
      enableMusicPlayer: false,
      notesMode: "auto", // 'auto' | 'widget' | 'center'
      notesEntries: [],
      notesActiveId: null,
      notesContent: "",
      notesListStyle: "pill",
      notesFilterMode: "all",
      notesFilterWorkspaceId: null,
      emailCenterFilterMode: "all",
      emailCenterFilterWorkspaceId: null,
      showWorkspaceEmailListInsteadOfNotes: false,
      notesBlurEnabled: true,
      notesBlurPx: 18,
      notesLinkSpeedDialBlur: false,
      searchBarLinkSpeedDialBlur: false,
      notesDynamicBackground: true,
      notesHoverPreview: false,
      notesDynamicSizing: true,
      notesVault: "",
      notesVaults: [],
      notesVaultActiveId: "default",
      notesPinnedFolder: "",
      notesAutoExpandOnHover: false,
      notesRemoveBackground: true,
      notesRemoveOutline: true,
      searchBarPushDirection: "down", // 'up' | 'down' - when center content is open
      notesSimpleButtons: false,
      notesGlowShadow: true,
      notesEnhancedWorkspaceId: false,
      subTimezones: ["Asia/Yerevan", "Europe/Vienna"],
      fontPreset: "industrial",
      colorPrimary: "#ffffff",
      colorAccent: "#00ffff",
      p2OutlineSubTimes: false,
      p2ShadeSubTimes: false,
      p2OutlineMainTime: false,
      p2ShadeMainTime: false,
      p2OutlineWeek: true,
      p2ShadeWeek: false,
      removeOutlines: true,
      removeBackgrounds: true,
      verticalOffset: 48,
      p2ShadowWeek: true,
      clockWeatherSeparator: false,
    },
    appearance: {
      masterLayout: "modern",
      animatedOverlay: false,
      animatedOverlaySpeed: 2,
      mirrorLayout: true,
      swapClassicTabsWithPageSwitcher: false,
      swapModernTabsWithPageSwitcher: false,
      glowMaxIntensity: 2.5,
      // Suggestions styling options
      suggestions: {
        removeBackground: true,
        removeOutline: false,
        useShadows: false,
      },
      // Music player styling options
      music: {
        removeBackground: true,
        removeOutline: true,
        useShadows: true,
        blurPx: 28,
        linkSpeedDialBlur: false,
        matchWorkspaceTextColor: true,
        matchSearchBarBlur: true,
        disableButtonBackgrounds: false,
      },
      searchBar: {
        outline: false,
        shadow: true,
        transparentBg: false,
        blurPreset: "strong",
        positionMode: "top-fixed",
        glowByUrl: true,
        glowTransient: true,
        glowOnFocus: false,
        workspaceExempt: false,
        blurPx: 16,
        widthScale: 0.85,
        centered: false,
        trulyFixed: false,
        refocusByUrl: true,
        refocusMode: "letters",
        hoverGlow: true,
        useDefaultFont: false,
        useDefaultColor: false,
        inlineAiButtonGlow: true,
        darkerPlaceholder: true,
        maxGlow: 2.5,
        matchSpeedDialMaxGlow: false,
      },
      matchWorkspaceTextColor: true,
      matchWorkspaceAccentColor: true,
      matchWorkspaceFonts: true,
      suggestionsBlurPx: 17,
      aiMessageBlurPx: 16,
      aiBubbleOutline: true,
      aiBubbleShadow: true,
      chatBubbleBlurPx: 11,
      inline: {
        theme: "glassy",
        outline: true,
        useWorkspaceSlugTextColor: false,
        fullPinnedSearch: false,
        systemReturnButton: true,
        returnPos: "right",
        fullColumn: false,
      },
      chatWidthMode: "search",
      chatWidthScale: 1.1,
      suggestionsMatchBarBlur: false,
      fontPreset: "orbitron",
    },
    appearanceWorkspaces: {
      enabled: false,
      overrides: {},
      lastSelectedId: DEFAULT_APPEARANCE_WORKSPACE_ID,
    },
    workspaceWidgets: {
      enabled: false,
      overrides: {},
      lastSelectedId: MASTER_WIDGETS_ID,
    },
    search: {
      engine: "google",
      suggestProvider: "searxng",
      inlineEnabled: true,
      imgbbApiKey: "",
      imageSearch: {
        inlineProvider: "searxng", // "searxng" only
        externalProvider: "google-lens", // "google-lens" | "searxng"
        preferInline: false,
      },
    },
    general: {
      openInNewTab: false,
      autoUrlDoubleClick: false,
      capSuggestions7: false,
      allowScroll: true,
      scrollToChangeWorkspace: false,
      scrollToChangeWorkspaceIncludeSpeedDial: false,
      scrollToChangeWorkspaceIncludeWholeColumn: false,
      scrollToChangeWorkspaceResistance: false,
      scrollToChangeWorkspaceResistanceIntensity: 100,
      shortcuts: {
        focusSearchbar: 'x Space'
      },
      // Use same-origin proxy to avoid private network preflight issues
      musicBackend: "/music/api/v1",
      voice: {
        // STT provider selection controls transcription; TTS configured separately
        provider: "local-stt", // 'local-stt' | 'api' | 'local' (legacy proxy)
        stt: {
          baseUrl: "/stt",
          token: "stt-local",
          model: "small",
          language: "auto",
          vad: true,
          diarization: false,
          timestamps: "word",
        },
        tts: {
          baseUrl: "http://127.0.0.1:8088",
        },
        // Back-compat fields for older builds
        serverBase: "/api",
        xttsBase: "http://127.0.0.1:8088",
        apiUrl: "",
        apiKey: "",
      },
    },
    background: {
      type: "custom",
      customGifPath: themeGif2,
      mode: "cover", // 'cover' | 'contain' | 'tile'
      zoom: 1,
      followSlug: true,
      workspaceEnabled: false,
    },
    iconTheming: (() => {
      try {
        const saved = localStorage.getItem("iconThemingSettings");
        if (saved) {
          const parsed = JSON.parse(saved);
          const defaults = {
            enabled: false,
            mode: 'grayscale', // 'grayscale' | 'tint' | 'monochrome' | 'grayscale_and_tint'
            color: '#ff0000',
            opacity: 0.5,
            grayscaleIntensity: 1,
            linkWorkspaceOpacity: false,
            linkWorkspaceGrayscale: false,
            workspaces: {},
            followSlug: true,
          };
          return { ...defaults, ...parsed };
        }
      } catch { }
      return {
        enabled: false,
        mode: 'grayscale', // 'grayscale' | 'tint' | 'monochrome' | 'grayscale_and_tint'
        color: '#ff0000',
        opacity: 0.5,
        grayscaleIntensity: 1,
        linkWorkspaceOpacity: false,
        linkWorkspaceGrayscale: false,
        workspaces: {}, // { [workspaceId]: { mode, color, opacity, grayscaleIntensity } }
        followSlug: true,
      };
    })(),
    license: {
      active: false,
      key: "",
      lastCheckedAt: 0,
      license: null,
    },
  });
  // Initialize with the current normalized path value (not the function)
  const [currentPath, setCurrentPath] = useState(() => getNormalizedPath());

  const persistWorkspaceBackgroundMeta = useCallback((map) => {
    try {
      const metaEntries = Object.entries(map)
        .filter(([, entry]) => entry?.meta)
        .reduce((acc, [id, entry]) => {
          acc[id] = entry.meta;
          return acc;
        }, {});
      if (Object.keys(metaEntries).length) {
        localStorage.setItem(
          "vivaldi-workspace-backgrounds",
          JSON.stringify(metaEntries),
        );
      } else {
        localStorage.removeItem("vivaldi-workspace-backgrounds");
      }
    } catch { }
  }, []);

  const updateWorkspaceBackgroundState = useCallback(
    (mutator) => {
      setWorkspaceBackgrounds((prev) => {
        const next = mutator(prev);
        if (next === prev) return prev;
        workspaceBackgroundsRef.current = next;
        persistWorkspaceBackgroundMeta(next);
        return next;
      });
    },
    [persistWorkspaceBackgroundMeta],
  );

  // Keep ref in sync with state (important for fast workspace switching)
  useEffect(() => {
    workspaceBackgroundsRef.current = workspaceBackgrounds;
  }, [workspaceBackgrounds]);

  const resolveBackgroundSource = useCallback(async (meta) => {
    if (!meta) return null;
    const type = String(meta.type || "").toLowerCase();
    if (type === "custom" && meta.id) {
      try {
        const record = await getBackgroundRecordById(meta.id);
        if (!record) return null;
        const url = URL.createObjectURL(record.blob);
        // Enrich meta with mime type if missing
        if (record.type && !meta.mime) {
          meta.mime = record.type;
        }
        return url || null;
      } catch {
        return null;
      }
    }
    if (meta.url) return meta.url;
    return null;
  }, []);

  const setWorkspaceBackgroundMeta = useCallback(
    async (workspaceId, meta, hintUrl) => {
      if (!workspaceId) return;
      
      // Cancel any pending background loading for this workspace
      const existingController = backgroundAbortControllersRef.current.get(workspaceId);
      if (existingController) {
        existingController.abort();
        backgroundAbortControllersRef.current.delete(workspaceId);
      }

      // Create new AbortController for this request
      const abortController = new AbortController();
      backgroundAbortControllersRef.current.set(workspaceId, abortController);

      if (!meta) {
        updateWorkspaceBackgroundState((prev) => {
          if (!prev[workspaceId]) return prev;
          const next = { ...prev };
          const entry = prev[workspaceId];
          if (entry?.meta?.type === "custom" && entry.src) {
            try {
              URL.revokeObjectURL(entry.src);
            } catch { }
          }
          delete next[workspaceId];
          return next;
        });
        backgroundAbortControllersRef.current.delete(workspaceId);
        return;
      }

      let resolvedMeta = meta;
      let src = hintUrl || null;

      if (!src) {
        try {
          const resolved = await resolveBackgroundSource(resolvedMeta);
          // Check if request was aborted
          if (abortController.signal.aborted) {
            if (resolved && resolved.startsWith('blob:')) {
              try {
                URL.revokeObjectURL(resolved);
              } catch { }
            }
            return;
          }
          if (!resolved) {
            resolvedMeta = null;
          } else {
            src = resolved;
          }
        } catch (error) {
          // If aborted, clean up and return
          if (abortController.signal.aborted) {
            backgroundAbortControllersRef.current.delete(workspaceId);
            return;
          }
          throw error;
        }
      }
      
      // Check if request was aborted before updating state
      if (abortController.signal.aborted) {
        if (src && src.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(src);
          } catch { }
        }
        backgroundAbortControllersRef.current.delete(workspaceId);
        return;
      }

      if (!resolvedMeta || !src) {
        if (src && resolvedMeta?.type === "custom") {
          try {
            URL.revokeObjectURL(src);
          } catch { }
        }
        updateWorkspaceBackgroundState((prev) => {
          if (!prev[workspaceId]) return prev;
          const next = { ...prev };
          const entry = prev[workspaceId];
          if (entry?.meta?.type === "custom" && entry.src) {
            try {
              URL.revokeObjectURL(entry.src);
            } catch { }
          }
          delete next[workspaceId];
          return next;
        });
        backgroundAbortControllersRef.current.delete(workspaceId);
        return;
      }

      if (resolvedMeta.type !== "custom" && !resolvedMeta.url) {
        resolvedMeta = { ...resolvedMeta, url: src };
      }

      // Final check if aborted before state update
      if (abortController.signal.aborted) {
        if (src && src.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(src);
          } catch { }
        }
        backgroundAbortControllersRef.current.delete(workspaceId);
        return;
      }

      updateWorkspaceBackgroundState((prev) => {
        const next = { ...prev };
        const previous = prev[workspaceId];
        if (
          previous?.meta?.type === "custom" &&
          previous.src &&
          previous.src !== src
        ) {
          try {
            URL.revokeObjectURL(previous.src);
          } catch { }
        }
        next[workspaceId] = { meta: resolvedMeta, src };
        return next;
      });
      
      // Clean up controller after successful update
      backgroundAbortControllersRef.current.delete(workspaceId);
    },
    [resolveBackgroundSource, updateWorkspaceBackgroundState],
  );

  // Restore workspace backgrounds from localStorage
  useEffect(() => {
    const raw = localStorage.getItem("vivaldi-workspace-backgrounds");
    workspaceBackgroundsRestoredRef.current = false;
    setWorkspaceBackgroundsRestored(false);
    if (!raw) {
      workspaceBackgroundsRestoredRef.current = true;
      setWorkspaceBackgroundsRestored(true);
      return;
    }
    (async () => {
      try {
        const metaMap = JSON.parse(raw);
        if (!metaMap || typeof metaMap !== "object") {
          workspaceBackgroundsRestoredRef.current = true;
          setWorkspaceBackgroundsRestored(true);
          return;
        }
        let metaMapUpdated = false;
        // Enrich meta with mime type from IndexedDB if missing
        for (const [id, meta] of Object.entries(metaMap)) {
          if (meta && meta.type === "custom" && meta.id && !meta.mime) {
            try {
              const record = await getBackgroundRecordById(meta.id);
              if (record && record.type) {
                meta.mime = record.type;
                metaMapUpdated = true;
              }
            } catch { }
          }
        }
        // Update localStorage with enriched meta if any were updated
        if (metaMapUpdated) {
          try {
            localStorage.setItem("vivaldi-workspace-backgrounds", JSON.stringify(metaMap));
          } catch { }
        }
        // Restore all workspace backgrounds
        const restorePromises = [];
        for (const [id, meta] of Object.entries(metaMap)) {
          if (meta) {
            restorePromises.push(setWorkspaceBackgroundMeta(id, meta).catch(() => { }));
          }
        }
        // Wait for all restorations to complete
        await Promise.all(restorePromises);
        workspaceBackgroundsRestoredRef.current = true;
        setWorkspaceBackgroundsRestored(true);
      } catch {
        workspaceBackgroundsRestoredRef.current = true;
        setWorkspaceBackgroundsRestored(true);
      }
    })();
  }, [setWorkspaceBackgroundMeta]);

  useEffect(() => {
    try {
      const storedFollow = localStorage.getItem(
        "vivaldi-background-follow-slug",
      );
      const storedWorkspaceEnabled = localStorage.getItem(
        "vivaldi-background-workspaces-enabled",
      );
      setSettings((prev) => {
        const next = { ...prev };
        const nextBackground = { ...(prev.background || {}) };
        if (storedFollow !== null) {
          nextBackground.followSlug =
            storedFollow === "1" || storedFollow === "true";
        }
        if (storedWorkspaceEnabled !== null) {
          nextBackground.workspaceEnabled =
            storedWorkspaceEnabled === "1" || storedWorkspaceEnabled === "true";
        }
        next.background = nextBackground;
        return next;
      });
    } catch { }
  }, []);


  // Load Widgets settings from localStorage on mount (if present)
  useEffect(() => {
    try {
      // Listen for widgetsSettings changes from SettingsButton
      const handleWidgetsSettingsChange = (e) => {
        try {
          const updated = e.detail || JSON.parse(localStorage.getItem('widgetsSettings') || '{}')
          setSettings((prev) => ({
            ...prev,
            widgets: { ...(prev.widgets || {}), ...updated }
          }))
        } catch {}
      }
      window.addEventListener('widgetsSettingsChanged', handleWidgetsSettingsChange)
      
      const raw = localStorage.getItem("widgetsSettings");
      if (raw) {
        const parsed = JSON.parse(raw);
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, ...parsed },
        }));
      }
    } catch { }
  }, []);
  // Seed a starter note when notes are enabled and no entries exist
  useEffect(() => {
    const enabled = settings?.widgets?.enableNotes !== false;
    const entries = Array.isArray(settings?.widgets?.notesEntries)
      ? settings.widgets.notesEntries
      : [];
    if (!enabled || seededNotesRef.current) return;
    const activeVaultId = settings?.widgets?.notesVaultActiveId || "default";
    (async () => {
      try {
        let synced = null;
        if (activeVaultId) {
          synced = await loadNotesFromVault(activeVaultId);
        }
        if (Array.isArray(synced)) {
          const mapped = synced;
          seededNotesRef.current = true;
          setSettings((prev) => ({
            ...prev,
            widgets: {
              ...(prev.widgets || {}),
              notesEntries: mapped,
              notesActiveId: prev.widgets?.notesActiveId || mapped[0].id,
              notesContent:
                prev.widgets?.notesContent || mapped[0].content || "",
            },
          }));
          return;
        }
        if (entries.length > 0) return;
        seededNotesRef.current = true;
        const seedContent = "";
        const seedNote = {
          id: `note-${Date.now()}`,
          title: "New note",
          content: seedContent,
          updatedAt: Date.now(),
          workspaceId: null,
          vaultId: activeVaultId,
          folder: "unassigned",
        };
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesEntries: [seedNote],
            notesActiveId: seedNote.id,
            notesContent: seedContent,
          },
        }));
      } catch {
        // ignore sync failures; widget still works locally
      }
    })();
  }, [
    settings?.widgets?.enableNotes,
    settings?.widgets?.notesEntries,
    settings?.widgets?.notesContent,
    settings?.widgets?.notesVaultActiveId,
  ]);

  // When a pinned folder is configured, use it as the default active folder
  useEffect(() => {
    const pinned = settings?.widgets?.notesPinnedFolder || "";
    if (!pinned) return;
    setNotesActiveFolder((prev) => (prev ? prev : pinned));
  }, [settings?.widgets?.notesPinnedFolder]);

  // Ensure we always have an active note id when notes exist
  useEffect(() => {
    const entries = Array.isArray(settings?.widgets?.notesEntries)
      ? settings.widgets.notesEntries
      : [];
    const activeId = settings?.widgets?.notesActiveId;
    if (!entries.length) return;
    if (activeId && entries.some((n) => n.id === activeId)) return;
    setSettings((prev) => ({
      ...prev,
      widgets: {
        ...(prev.widgets || {}),
        notesActiveId: entries[0].id,
      },
    }));
  }, [settings?.widgets?.notesEntries, settings?.widgets?.notesActiveId]);

  // Load license state from localStorage (if present)
  // License is no longer used to gate features; we keep any stored license only for display.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("vstartLicense");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      setSettings((prev) => ({
        ...prev,
        license: {
          ...(prev.license || {}),
          ...parsed,
        },
      }));
    } catch { }
  }, []);

  // Load Appearance and manual text color on mount
  useEffect(() => {
    try {
      const aRaw = localStorage.getItem("appearanceSettings");
      if (aRaw) {
        const a = JSON.parse(aRaw);
        if (typeof a?.suggestionsBlurPx !== "number") {
          if (typeof a?.suggestionsBlurStrong === "boolean") {
            a.suggestionsBlurPx = a.suggestionsBlurStrong ? 22 : 10;
          } else {
            a.suggestionsBlurPx = 12;
          }
        }
        if (typeof a?.aiMessageBlurPx !== "number") {
          a.aiMessageBlurPx = a.suggestionsBlurPx;
        }
        if (typeof a?.aiBubbleOutline === "undefined") a.aiBubbleOutline = true;
        if (typeof a?.aiBubbleShadow === "undefined") a.aiBubbleShadow = true;
        if (
          typeof a?.chatBubbleBlurPx !== "number" ||
          Number.isNaN(a.chatBubbleBlurPx)
        ) {
          a.chatBubbleBlurPx = a?.chatDisableBlur ? 0 : 12;
        }
        a.chatBubbleBlurPx = Math.max(
          0,
          Math.min(30, Number(a.chatBubbleBlurPx)),
        );
        if (typeof a?.chatDisableBlur !== "undefined") delete a.chatDisableBlur;
        if (typeof a?.suggestionsBlurStrong !== "undefined")
          delete a.suggestionsBlurStrong;
        if (typeof a?.masterLayout !== "string") {
          a.masterLayout = "modern";
        }
        // Prefer the last manually selected master layout if present
        try {
          const lastManual = String(
            localStorage.getItem("lastManualMasterLayout") || "",
          ).toLowerCase();
          if (lastManual === "classic" || lastManual === "modern") {
            a.masterLayout = lastManual;
          }
        } catch { }
        if (a?.searchBar) {
          // Ensure maxGlow has a default value
          if (typeof a.searchBar.maxGlow !== "number" || isNaN(a.searchBar.maxGlow)) {
            a.searchBar.maxGlow = 2.5;
          }
          const allowedRefocusModes = ["letters", "pulse", "steady"];
          if (
            typeof a.searchBar.refocusMode !== "string" ||
            !allowedRefocusModes.includes(a.searchBar.refocusMode)
          ) {
            a.searchBar.refocusMode = "letters";
          }
          const allowedPositions = [
            "bottom",
            "center-unfixed",
            "center-fixed",
            "top-fixed",
          ];
          let nextPos = String(a.searchBar.positionMode || "").toLowerCase();
          if (!allowedPositions.includes(nextPos)) {
            if (a.searchBar.centered) {
              nextPos = a.searchBar.trulyFixed
                ? "center-fixed"
                : "center-unfixed";
            } else {
              nextPos = "bottom";
            }
          }
          a.searchBar.positionMode = nextPos;
          if (nextPos === "center-fixed") {
            a.searchBar.centered = true;
            a.searchBar.trulyFixed = true;
          } else if (nextPos === "center-unfixed") {
            a.searchBar.centered = true;
            a.searchBar.trulyFixed = false;
          } else {
            a.searchBar.centered = false;
            a.searchBar.trulyFixed = false;
          }
        }
        setSettings((prev) => ({
          ...prev,
          appearance: {
            ...prev.appearance,
            ...a,
            inline: {
              ...(prev.appearance?.inline || {}),
              ...(a?.inline || {}),
            },
          },
        }));
      }
      const awRaw = localStorage.getItem("appearanceWorkspaces");
      if (awRaw) {
        const awParsed = JSON.parse(awRaw);
        const normalized = normalizeAppearanceWorkspaceState(awParsed);
        setSettings((prev) => {
          const nextOverrides = { ...(normalized.overrides || {}) };
          // On first load, if workspace appearance is disabled and no master override exists,
          // initialize master override from current appearance
          if (!normalized.enabled && !nextOverrides[MASTER_APPEARANCE_ID] && prev.appearance) {
            nextOverrides[MASTER_APPEARANCE_ID] = prev.appearance;
          }
          return {
            ...prev,
            appearanceWorkspaces: {
              ...normalized,
              overrides: nextOverrides,
            },
          };
        });
      } else {
        // First time loading - if workspace appearance is disabled (default), initialize master override
        setSettings((prev) => {
          if (prev.appearance) {
            return {
              ...prev,
              appearanceWorkspaces: {
                enabled: false,
                overrides: {
                  [MASTER_APPEARANCE_ID]: prev.appearance,
                },
                lastSelectedId: MASTER_APPEARANCE_ID,
              },
            };
          }
          return prev;
        });
      }
      // Load workspace widgets state from localStorage
      const wwRaw = localStorage.getItem("workspaceWidgets");
      if (wwRaw) {
        try {
          const wwParsed = JSON.parse(wwRaw);
          const normalized = normalizeWorkspaceWidgetsState(wwParsed);
          setSettings((prev) => {
            const nextOverrides = { ...(normalized.overrides || {}) };
            // On first load, if workspace widgets is disabled and no master override exists,
            // initialize master override from current widgets
            if (!normalized.enabled && !nextOverrides[MASTER_WIDGETS_ID] && prev.widgets) {
              nextOverrides[MASTER_WIDGETS_ID] = prev.widgets;
            }
            return {
              ...prev,
              workspaceWidgets: {
                ...normalized,
                overrides: nextOverrides,
              },
            };
          });
        } catch { }
      } else {
        // First time loading - initialize master override from current widgets
        setSettings((prev) => {
          if (prev.widgets) {
            return {
              ...prev,
              workspaceWidgets: {
                enabled: false,
                overrides: {
                  [MASTER_WIDGETS_ID]: prev.widgets,
                },
                lastSelectedId: MASTER_WIDGETS_ID,
              },
            };
          }
          return prev;
        });
      }
      // Note: In incognito/first install, use defaults from useState - don't override with localStorage
      // This check only applies if there's existing localStorage data
      if (aRaw) {
        try {
          const lastManual = String(
            localStorage.getItem("lastManualMasterLayout") || "",
          ).toLowerCase();
          if (lastManual === "classic" || lastManual === "modern") {
            setSettings((prev) => ({
              ...prev,
              appearance: {
                ...(prev.appearance || {}),
                masterLayout: lastManual,
              },
            }));
          }
        } catch { }
      }
      const gRaw = localStorage.getItem("generalSettings");
      if (gRaw) {
        const g = JSON.parse(gRaw);
        setSettings((prev) => ({
          ...prev,
          general: { ...prev.general, ...g },
        }));
      }
      const aiRaw = localStorage.getItem("aiSettings");
      if (aiRaw) {
        try {
          const ai = JSON.parse(aiRaw);
          // Preserve enabled state from localStorage if it exists
          if (typeof ai.enabled === 'boolean') {
            setSettings((prev) => ({ ...prev, ai: { ...(prev.ai || {}), ...ai, enabled: ai.enabled } }));
          } else {
            setSettings((prev) => ({ ...prev, ai: { ...(prev.ai || {}), ...ai } }));
          }
        } catch (e) {
          console.warn('Failed to parse aiSettings from localStorage:', e);
        }
      }
      const sRaw = localStorage.getItem("searchSettings");
      if (sRaw) {
        const s = JSON.parse(sRaw);
        setSettings((prev) => ({ ...prev, search: { ...prev.search, ...s } }));
      } else {
        const eng = localStorage.getItem("searchEngine");
        if (eng)
          setSettings((prev) => ({
            ...prev,
            search: { ...prev.search, engine: eng },
          }));
      }
      const pRaw = localStorage.getItem("manualTextColor");
      if (pRaw) {
        setSettings((prev) => ({
          ...prev,
          theme: {
            ...prev.theme,
            colors: { ...prev.theme.colors, primary: pRaw },
          },
        }));
      }
      const accentRaw = localStorage.getItem("manualAccentColor");
      if (accentRaw) {
        setSettings((prev) => ({
          ...prev,
          theme: {
            ...prev.theme,
            colors: { ...prev.theme.colors, accent: accentRaw },
          },
        }));
      }
      const lastInRaw = localStorage.getItem("themeLastInSettings");
      if (lastInRaw) {
        try {
          const parsed = JSON.parse(lastInRaw);
          setSettings((prev) => ({
            ...prev,
            theme: {
              ...prev.theme,
              lastIn: { ...(prev.theme?.lastIn || {}), ...(parsed || {}) },
            },
          }));
        } catch { }
      }
      const sdRaw = localStorage.getItem("speedDialSettings");
      if (sdRaw) {
        const s = JSON.parse(sdRaw);
        // Map legacy fields if present
        const next = { ...s };
        if (typeof s.bgOpacity !== "undefined") delete next.bgOpacity;
        if (typeof s.fixedGrid !== "undefined") delete next.fixedGrid;
        // Derive tabsMode from legacy fields if missing
        if (!next.tabsMode) {
          if (next.classicTabs === true) next.tabsMode = "classic";
          else if ((next.tabsShape || "pill") === "rect") {
            next.tabsMode =
              (next.tabsPlacement || "outside") === "inside"
                ? "buttons_inside"
                : "buttons_outside";
          } else {
            next.tabsMode = "tabs";
          }
        }
        if (typeof next.verticalOffset !== "number") {
          next.verticalOffset = 0;
        }
        if (typeof next.landscapeOffset !== "number") {
          next.landscapeOffset = 0;
        }
        if (
          typeof next.maxGlow !== "number" ||
          !Number.isFinite(next.maxGlow)
        ) {
          next.maxGlow = 2.5;
        }
        if (
          !next.maxGlowByWorkspace ||
          typeof next.maxGlowByWorkspace !== "object"
        ) {
          next.maxGlowByWorkspace = {};
        }
        if (
          !next.dialLayoutOverrides ||
          typeof next.dialLayoutOverrides !== "object"
        ) {
          next.dialLayoutOverrides = {};
        }
        const wsDefaults = {
          background: true,
          shadow: true,
          blur: true,
          matchDialBlur: false,
        };
        if (!next.wsButtons || typeof next.wsButtons !== "object") {
          next.wsButtons = wsDefaults;
        } else {
          next.wsButtons = { ...wsDefaults, ...next.wsButtons };
        }
        // Ensure workspaceBlurOverrides is an object
        if (
          !next.workspaceBlurOverrides ||
          typeof next.workspaceBlurOverrides !== "object"
        ) {
          next.workspaceBlurOverrides = {};
        }
        // Bump version marker without remapping stored mode names.
        const modeVersion = Number(next.tabsModeVersion ?? 1);
        if (modeVersion < 2) {
          next.tabsModeVersion = 2;
        }
        if (typeof next.headerEffectMode === "string") {
          const mode = next.headerEffectMode.toLowerCase();
          if (mode === "sustained" || mode === "scroll")
            next.headerEffectMode = "sustained";
          else if (mode === "transient") next.headerEffectMode = "sustained";
          else next.headerEffectMode = "off";
        } else if (next.headerExperimentalEffect) {
          next.headerEffectMode = "sustained";
        }
        // Note: keep stored values unchanged; only UI labels are swapped intentionally.
        // Derive hover style if missing (legacy boolean -> shade-color)
        if (!next.tabHoverStyle) {
          if (typeof next.tabHoverShade === "boolean" && next.tabHoverShade) {
            next.tabHoverStyle = "shade-color";
          } else {
            next.tabHoverStyle = "none";
          }
        }
        if (typeof next.glowHover !== "boolean") {
          next.glowHover = false;
        }
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, ...next },
        }));
      }
    } catch { }
  }, []);

  // Persist Widgets settings when changed
  useEffect(() => {
    try {
      localStorage.setItem("widgetsSettings", JSON.stringify(settings.widgets));
    } catch { }
  }, [settings.widgets]);

  // Persist Appearance + manual text color + speed dial settings
  useEffect(() => {
    try {
      localStorage.setItem(
        "appearanceSettings",
        JSON.stringify({
          ...settings.appearance,
          // Don't persist masterLayout if it's just a temporary override
          masterLayout: settings.appearance.masterLayout,
        }),
      );
      localStorage.setItem("iconThemingSettings", JSON.stringify(settings.iconTheming));
    } catch { }
  }, [settings.appearance, settings.iconTheming]); // Added settings.iconTheming to dependencies
  useEffect(() => {
    try {
      localStorage.setItem(
        "appearanceWorkspaces",
        JSON.stringify(
          normalizeAppearanceWorkspaceState(settings.appearanceWorkspaces),
        ),
      );
    } catch { }
  }, [settings.appearanceWorkspaces]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "workspaceWidgets",
        JSON.stringify(
          normalizeWorkspaceWidgetsState(settings.workspaceWidgets),
        ),
      );
    } catch { }
  }, [settings.workspaceWidgets]);
  useEffect(() => {
    try {
      localStorage.setItem("searchSettings", JSON.stringify(settings.search));
    } catch { }
  }, [settings.search]);
  useEffect(() => {
    try {
      localStorage.setItem("generalSettings", JSON.stringify(settings.general));
    } catch { }
  }, [settings.general]);
  useEffect(() => {
    try {
      localStorage.setItem("aiSettings", JSON.stringify(settings.ai || {}));
    } catch { }
  }, [settings.ai]);
  useEffect(() => {
    try {
      localStorage.setItem("manualTextColor", settings.theme.colors.primary);
    } catch { }
  }, [settings.theme.colors.primary]);

  // Persist manual accent color when changed
  useEffect(() => {
    try {
      localStorage.setItem("manualAccentColor", settings.theme.colors.accent);
    } catch { }
  }, [settings.theme.colors.accent]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "themeLastInSettings",
        JSON.stringify(settings.theme.lastIn || {}),
      );
    } catch { }
  }, [settings.theme.lastIn]);
  useEffect(() => {
    try {
      const s = settings.speedDial || {};
      const wsButtons = {
        background: true,
        shadow: true,
        blur: true,
        matchDialBlur: false,
        ...(s.wsButtons || {}),
      };
      localStorage.setItem(
        "speedDialSettings",
        JSON.stringify({
          blurPx: Number(s.blurPx ?? 0),
          transparentBg: !!s.transparentBg,
          outline: !!s.outline,
          shadow: !!s.shadow,
          tabsMode: s.tabsMode || "tabs",
          tabsModeVersion: Number(s.tabsModeVersion ?? 2),
          glowEnabled: !!s.glowEnabled,
          glowColor: s.glowColor || "#00ffff66",
          workspaceGlowColors: s.workspaceGlowColors || {},
          glowByUrl: !!s.glowByUrl,
          glowTransient: !!s.glowTransient,
          tabsShape: s.tabsShape || "pill",
          tabsPlacement: s.tabsPlacement || "outside",
          tabsDivider: !!s.tabsDivider,
          tabGlowEnabled: s.tabGlowEnabled !== false,
          tabGlowUseWorkspaceColor: s.tabGlowUseWorkspaceColor !== false,
          tabHoverShade: !!s.tabHoverShade,
          tabHoverStyle:
            s.tabHoverStyle || (s.tabHoverShade ? "shade-color" : "none"),
          maxGlow: Number.isFinite(Number(s.maxGlow))
            ? Number(s.maxGlow)
            : 2.5,
          maxGlowByWorkspace: s.maxGlowByWorkspace || {},
          verticalOffset: Number(s.verticalOffset || 0),
          landscapeOffset: Number(s.landscapeOffset || 0),
          dialLayoutOverrides: s.dialLayoutOverrides || {},
          workspaceTextColors: s.workspaceTextColors || {},
          workspaceTextFonts: s.workspaceTextFonts || {},
          workspaceTextByUrl: !!s.workspaceTextByUrl,
          wsButtons,
          workspaceAccentColors: s.workspaceAccentColors || {},
          headerAlign: s.headerAlign || "center",
          glowWorkspaceColorOnDoubleClick: !!s.glowWorkspaceColorOnDoubleClick,
          headerEffectMode: (() => {
            if (typeof s.headerEffectMode === "string") {
              const val = s.headerEffectMode.toLowerCase();
              if (val === "off") return "off";
              if (val === "sustained" || val === "scroll") return "sustained";
              if (val === "transient") return "sustained";
            }
            if (s.headerExperimentalEffect) return "sustained";
            return "off";
          })(),
          headerBannerMatchWorkspaceColor: !!s.headerBannerMatchWorkspaceColor,
          headerBannerStatic: !!s.headerBannerStatic,
          headerBannerOverscan: s.headerBannerOverscan !== false,
          headerBannerEnhancedWrap: !!s.headerBannerEnhancedWrap,
          headerBannerScale: Number.isFinite(Number(s.headerBannerScale))
            ? Number(s.headerBannerScale)
            : 1,
          headerBannerBold: !!s.headerBannerBold,
          headerBannerFontOverrideEnabled: !!s.headerBannerFontOverrideEnabled,
          headerBannerFont: s.headerBannerFont || "Bebas Neue",
          headerBannerScrollSeconds: Number.isFinite(
            Number(s.headerBannerScrollSeconds),
          )
            ? Number(s.headerBannerScrollSeconds)
            : 24,
          headerBannerReverseDirection: !!s.headerBannerReverseDirection,
          headerBannerFlipOnTabDoubleClick:
            !!s.headerBannerFlipOnTabDoubleClick,
          headerBannerAlternateOnSlug: !!s.headerBannerAlternateOnSlug,
          workspaceHoverPreview: !!s.workspaceHoverPreview,
          colorlessPreview: !!s.colorlessPreview,
          softSwitchGlowBehavior: s.softSwitchGlowBehavior || "noGlow",
          anchoredWorkspaceId: s.anchoredWorkspaceId || null,
          workspaceHeaderColorMode: s.workspaceHeaderColorMode || {},
          matchHeaderColor: !!s.matchHeaderColor,
          matchHeaderColorByWorkspace: s.matchHeaderColorByWorkspace || {},
          matchHeaderFont: !!s.matchHeaderFont,
          matchHeaderFontByWorkspace: s.matchHeaderFontByWorkspace || {},
          glowTransientByWorkspace: s.glowTransientByWorkspace || {},
          headerFollowsUrlSlug: !!s.headerFollowsUrlSlug,
          glowHover: !!s.glowHover,
          workspaceBlurOverrides: s.workspaceBlurOverrides || {},
        }),
      );
    } catch { }
  }, [
    settings.speedDial.blurPx,
    settings.speedDial.transparentBg,
    settings.speedDial.outline,
    settings.speedDial.shadow,
    // Persist selected tabs mode variants
    settings.speedDial.tabsMode,
    settings.speedDial.tabsModeVersion,
    settings.speedDial.glowEnabled,
    settings.speedDial.glowColor,
    settings.speedDial.workspaceGlowColors,
    settings.speedDial.glowByUrl,
    settings.speedDial.glowTransient,
    settings.speedDial.tabsShape,
    settings.speedDial.tabsPlacement,
    settings.speedDial.tabsDivider,
    // Persist tab glow feature toggles
    settings.speedDial.tabGlowEnabled,
    settings.speedDial.tabGlowUseWorkspaceColor,
    settings.speedDial.tabHoverShade,
    settings.speedDial.tabHoverStyle,
    settings.speedDial.maxGlow,
    settings.speedDial.maxGlowByWorkspace,
    settings.speedDial.workspaceTextColors,
    settings.speedDial.workspaceTextFonts,
    settings.speedDial.workspaceTextByUrl,
    settings.speedDial.wsButtons,
    settings.speedDial.workspaceAccentColors,
    settings.speedDial.headerAlign,
    settings.speedDial.glowWorkspaceColorOnDoubleClick,
    settings.speedDial.headerEffectMode,
    settings.speedDial.headerBannerMatchWorkspaceColor,
    settings.speedDial.headerBannerStatic,
    settings.speedDial.headerBannerOverscan,
    settings.speedDial.headerBannerEnhancedWrap,
    settings.speedDial.headerBannerScale,
    settings.speedDial.headerBannerBold,
    settings.speedDial.headerBannerFontOverrideEnabled,
    settings.speedDial.headerBannerFont,
    settings.speedDial.headerBannerScrollSeconds,
    settings.speedDial.headerBannerReverseDirection,
    settings.speedDial.headerBannerFlipOnTabDoubleClick,
    settings.speedDial.headerBannerAlternateOnSlug,
    settings.speedDial.workspaceHoverPreview,
    settings.speedDial.colorlessPreview,
    settings.speedDial.softSwitchGlowBehavior,
    settings.speedDial.anchoredWorkspaceId,
    settings.speedDial.workspaceHeaderColorMode,
    settings.speedDial.matchHeaderColor,
    settings.speedDial.matchHeaderColorByWorkspace,
    settings.speedDial.matchHeaderFont,
    settings.speedDial.matchHeaderFontByWorkspace,
    settings.speedDial.glowTransient,
    settings.speedDial.glowTransientByWorkspace,
    settings.speedDial.glowHover,
    settings.speedDial.headerFollowsUrlSlug,
    // Persist per-layout classic overrides when positions change
    settings.speedDial.dialLayoutOverrides,
    // Persist offsets for modern/classic layouts
    settings.speedDial.verticalOffset,
    settings.speedDial.landscapeOffset,
    // Persist workspace blur overrides
    settings.speedDial.workspaceBlurOverrides,
  ]);

  // Workspaces and Speed Dial per workspace
  const [workspaces, setWorkspaces] = useState([
    { id: "ws-2", name: "Dev", icon: "Layers", position: 0 },
    { id: "ws-3", name: "Media", icon: "Grid2X2", position: 1 },
    { id: "ws-1", name: "Home", icon: "Home", position: 2 },
  ]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("ws-1");
  const [hoveredWorkspaceId, setHoveredWorkspaceId] = useState(null);
  const [lastHardWorkspaceId, setLastHardWorkspaceId] = useState(null);
  const lastInAppliedRef = useRef(false);
  const defaultTiles = [
    {
      id: "1",
      url: "https://www.google.com/",
      title: "Google",
      favicon: "",
      position: 0,
    },
  ];
  const [speedDials, setSpeedDials] = useState({
    "ws-1": defaultTiles,
    "ws-2": [],
    "ws-3": [],
  });
  const [loadedPersist, setLoadedPersist] = useState(false);
  const customSpeedDialIconsRef = useRef({});
  const [bannerDirectionPhase, setBannerDirectionPhase] = useState(1);

  const activeWorkspace =
    workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];
  const tiles = speedDials[activeWorkspaceId] || [];
  const setTiles = (next) =>
    setSpeedDials((prev) => ({ ...prev, [activeWorkspaceId]: next }));

  const normalizedPath = useMemo(() => {
    const trimmed = (currentPath || "").replace(/\/+$/, "");
    return trimmed === "" ? "/" : trimmed;
  }, [currentPath]);

  const urlWorkspace = useMemo(() => {
    if (!Array.isArray(workspaces)) return null;
    return (
      workspaces.find(
        (w) => `/${slugifyWorkspaceName(w.name || "")}` === normalizedPath,
      ) || null
    );
  }, [workspaces, normalizedPath]);

  const hardWorkspaceId = urlWorkspace?.id || null;

  const headerBannerFlipOnDoubleClick =
    !!settings?.speedDial?.headerBannerFlipOnTabDoubleClick;
  const headerBannerAlternateOnSlug =
    !!settings?.speedDial?.headerBannerAlternateOnSlug;
  const dynamicBannerDirectionEnabled =
    headerBannerFlipOnDoubleClick || headerBannerAlternateOnSlug;
  const baseBannerDirection = settings?.speedDial?.headerBannerReverseDirection
    ? -1
    : 1;
  const effectiveBannerDirection =
    baseBannerDirection *
    (dynamicBannerDirectionEnabled ? bannerDirectionPhase : 1);
  const normalizedBannerDirection = effectiveBannerDirection >= 0 ? 1 : -1;
  const bannerDirectionSlugRef = useRef(hardWorkspaceId);

  const lastInConfig = settings?.theme?.lastIn || {};
  const lastInEnabled =
    typeof lastInConfig.enabled === "boolean" ? lastInConfig.enabled : true;
  const doubleClickEnabled = !!settings?.general?.autoUrlDoubleClick;
  const anchoredWorkspaceId = settings?.speedDial?.anchoredWorkspaceId || null;
  const isDefaultPath =
    normalizedPath === "/" || normalizedPath === "/index.html";

  const lastInFallbackWorkspaceId = useMemo(() => {
    if (hardWorkspaceId) return null;
    if (!doubleClickEnabled) return null;
    if (!lastInEnabled) return null;
    if (!isDefaultPath) return null;
    if (!lastHardWorkspaceId) return null;
    if (anchoredWorkspaceId && anchoredWorkspaceId === lastHardWorkspaceId)
      return null;
    return lastHardWorkspaceId;
  }, [
    hardWorkspaceId,
    doubleClickEnabled,
    lastInEnabled,
    isDefaultPath,
    lastHardWorkspaceId,
    anchoredWorkspaceId,
  ]);

  const effectiveHardWorkspaceId = hardWorkspaceId || lastInFallbackWorkspaceId;

  const lastInFallbackRef = useRef(null);

  useEffect(() => {
    if (lastInFallbackRef.current !== lastInFallbackWorkspaceId) {
      lastInFallbackRef.current = lastInFallbackWorkspaceId;
      lastInAppliedRef.current = false;
    }
  }, [lastInFallbackWorkspaceId]);

  useEffect(() => {
    try {
      window.__APP_WORKSPACES__ = workspaces;
      window.__ACTIVE_WORKSPACE_ID__ = activeWorkspaceId;
      const widgets = settings?.widgets || {};
      const vaults = Array.isArray(widgets.notesVaults)
        ? widgets.notesVaults
        : [];
      const activeVaultId = widgets.notesVaultActiveId;
      const activeVault =
        vaults.find((v) => v.id === activeVaultId) || vaults[0] || null;
      const legacyLabel = widgets.notesVault || null;
      const vaultLabel = activeVault?.name || legacyLabel;
      window.__NOTES_VAULT__ = vaultLabel || null;
    } catch { }
  }, [
    workspaces,
    activeWorkspaceId,
    settings?.widgets?.notesVault,
    settings?.widgets?.notesVaults,
    settings?.widgets?.notesVaultActiveId,
  ]);

  useEffect(() => {
    setHoveredWorkspaceId(null);
  }, [hardWorkspaceId]);
  useEffect(() => {
    if (!dynamicBannerDirectionEnabled) {
      setBannerDirectionPhase(1);
    }
  }, [dynamicBannerDirectionEnabled]);
  useEffect(() => {
    const previous = bannerDirectionSlugRef.current;
    if (previous !== hardWorkspaceId) {
      bannerDirectionSlugRef.current = hardWorkspaceId;
      if (headerBannerAlternateOnSlug && hardWorkspaceId) {
        setBannerDirectionPhase((prev) => (prev > 0 ? -1 : 1));
      }
    }
  }, [hardWorkspaceId, headerBannerAlternateOnSlug]);

  useEffect(() => {
    if (!hardWorkspaceId) return;
    if (hardWorkspaceId === lastHardWorkspaceId) return;
    setLastHardWorkspaceId(hardWorkspaceId);
    try {
      localStorage.setItem("lastHardWorkspaceId", hardWorkspaceId);
    } catch { }
  }, [hardWorkspaceId, lastHardWorkspaceId]);

  useEffect(() => {
    if (!loadedPersist) return;

    const lastInActive = lastInEnabled && doubleClickEnabled && isDefaultPath;
    if (!lastInActive) {
      lastInAppliedRef.current = false;
      return;
    }

    if (lastInFallbackWorkspaceId) {
      if (lastInAppliedRef.current) return;
      lastInAppliedRef.current = true;
      if (activeWorkspaceId === lastInFallbackWorkspaceId) return;
      if (
        anchoredWorkspaceId &&
        anchoredWorkspaceId === lastInFallbackWorkspaceId
      )
        return;
      setActiveWorkspaceId(lastInFallbackWorkspaceId);
      setHoveredWorkspaceId(null);
      return;
    }

    lastInAppliedRef.current = false;
  }, [
    loadedPersist,
    lastInEnabled,
    doubleClickEnabled,
    isDefaultPath,
    lastInFallbackWorkspaceId,
    anchoredWorkspaceId,
    activeWorkspaceId,
  ]);

  const selectedWorkspaceId = effectiveHardWorkspaceId || activeWorkspaceId;
  const appearanceWorkspacesState = useMemo(
    () => normalizeAppearanceWorkspaceState(settings.appearanceWorkspaces),
    [settings.appearanceWorkspaces],
  );
  const appearanceWorkspacesEnabled = !!appearanceWorkspacesState.enabled;
  
  // Workspace Theming state (separate from appearance workspaces)
  const [workspaceThemingEnabled, setWorkspaceThemingEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem("workspaceThemingEnabled");
      return saved === "true";
    } catch {
      return false;
    }
  });
  
  // Persist workspace theming enabled state
  useEffect(() => {
    try {
      localStorage.setItem("workspaceThemingEnabled", String(workspaceThemingEnabled));
    } catch { }
  }, [workspaceThemingEnabled]);
  
  // Workspace theming selection (which workspace profile is being edited)
  const [workspaceThemingSelectedId, setWorkspaceThemingSelectedId] = useState(() => {
    try {
      const saved = localStorage.getItem("workspaceThemingSelectedId");
      return saved ? saved : null; // null = Master Override
    } catch {
      return null;
    }
  });
  
  // Persist workspace theming selection
  useEffect(() => {
    try {
      if (workspaceThemingSelectedId) {
        localStorage.setItem("workspaceThemingSelectedId", workspaceThemingSelectedId);
      } else {
        localStorage.removeItem("workspaceThemingSelectedId");
      }
    } catch { }
  }, [workspaceThemingSelectedId]);
  
  // Workspace Widgets state (separate from appearance workspaces and workspace theming)
  const [workspaceWidgetsEnabled, setWorkspaceWidgetsEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem("workspaceWidgetsEnabled");
      return saved === "true";
    } catch {
      return false;
    }
  });
  
  // Persist workspace widgets enabled state
  useEffect(() => {
    try {
      localStorage.setItem("workspaceWidgetsEnabled", String(workspaceWidgetsEnabled));
    } catch { }
  }, [workspaceWidgetsEnabled]);
  
  // Workspace widgets selection (which workspace profile is being edited)
  const [workspaceWidgetsSelectedId, setWorkspaceWidgetsSelectedId] = useState(() => {
    try {
      const saved = localStorage.getItem("workspaceWidgetsSelectedId");
      return saved ? saved : null; // null = Master Override
    } catch {
      return null;
    }
  });
  
  // Persist workspace widgets selection
  useEffect(() => {
    try {
      if (workspaceWidgetsSelectedId) {
        localStorage.setItem("workspaceWidgetsSelectedId", workspaceWidgetsSelectedId);
      } else {
        localStorage.removeItem("workspaceWidgetsSelectedId");
      }
    } catch { }
  }, [workspaceWidgetsSelectedId]);

  // Workspace Widgets state (normalized from settings)
  const workspaceWidgetsState = useMemo(
    () => normalizeWorkspaceWidgetsState(settings.workspaceWidgets),
    [settings.workspaceWidgets],
  );

  // Create ref for applyAppearanceEdit early so handlers can use it
  const applyAppearanceEditRef = useRef(null);
  const appearanceApplyAllChoiceRef = useRef(null);
  const resolveWorkspaceScopedToggle = useCallback(
    (baseValue, map, workspaceId) => {
      if (!appearanceWorkspacesEnabled) return baseValue;
      if (!workspaceId) return baseValue;
      if (map && Object.prototype.hasOwnProperty.call(map, workspaceId)) {
        return map[workspaceId];
      }
      return baseValue;
    },
    [appearanceWorkspacesEnabled],
  );
  const appearanceRuntimeTargetId = useMemo(
    () => {
      // When appearance workspaces are disabled, always use default to ensure
      // all workspaces use the same appearance profile
      if (!appearanceWorkspacesEnabled) {
        return DEFAULT_APPEARANCE_WORKSPACE_ID;
      }
      return resolveAppearanceWorkspaceTargetId(
        appearanceWorkspacesState,
        selectedWorkspaceId,
        anchoredWorkspaceId,
      );
    },
    [appearanceWorkspacesEnabled, appearanceWorkspacesState, selectedWorkspaceId, anchoredWorkspaceId],
  );
  const activeAppearance = useMemo(
    () =>
      resolveAppearanceProfileForWorkspace(
        settings.appearance,
        appearanceWorkspacesState,
        appearanceRuntimeTargetId,
        anchoredWorkspaceId,
      ),
    [
      settings.appearance,
      appearanceWorkspacesState,
      appearanceRuntimeTargetId,
      anchoredWorkspaceId,
    ],
  );
  const appearanceEditingTargetId = useMemo(
    () => {
      // Always ensure we have a valid target ID, even during state transitions
      const state = appearanceWorkspacesState || { enabled: false, lastSelectedId: MASTER_APPEARANCE_ID };
      const targetId = resolveAppearanceWorkspaceTargetId(
        state,
        state.lastSelectedId || MASTER_APPEARANCE_ID,
        anchoredWorkspaceId,
      );
      // Ensure we always return a valid ID
      return targetId || MASTER_APPEARANCE_ID;
    },
    [appearanceWorkspacesState, anchoredWorkspaceId],
  );
  const [lastAppearancePreviewId, setLastAppearancePreviewId] =
    useState(null);
  const editingAppearance = useMemo(
    () =>
      resolveAppearanceProfileForWorkspace(
        settings.appearance,
        appearanceWorkspacesState,
        appearanceEditingTargetId,
        anchoredWorkspaceId,
      ),
    [
      settings.appearance,
      appearanceWorkspacesState,
      appearanceEditingTargetId,
      anchoredWorkspaceId,
    ],
  );
  const runtimeSettings = useMemo(
    () => {
      const effectiveMatchHeaderColor = resolveWorkspaceScopedToggle(
        settings.speedDial?.matchHeaderColor,
        settings.speedDial?.matchHeaderColorByWorkspace,
        appearanceRuntimeTargetId,
      );
      const effectiveMatchHeaderFont = resolveWorkspaceScopedToggle(
        settings.speedDial?.matchHeaderFont,
        settings.speedDial?.matchHeaderFontByWorkspace,
        appearanceRuntimeTargetId,
      );
      const effectiveMaxGlow = resolveWorkspaceScopedToggle(
        settings.speedDial?.maxGlow,
        settings.speedDial?.maxGlowByWorkspace,
        appearanceRuntimeTargetId,
      );
      return {
        ...settings,
        appearance: activeAppearance,
        workspaceThemingEnabled: workspaceThemingEnabled,
        speedDial: {
          ...(settings.speedDial || {}),
          matchHeaderColor: !!effectiveMatchHeaderColor,
          matchHeaderFont: !!effectiveMatchHeaderFont,
          maxGlow: Number.isFinite(Number(effectiveMaxGlow))
            ? Number(effectiveMaxGlow)
            : Number(settings.speedDial?.maxGlow ?? 2.5),
        },
      };
    },
    [
      settings,
      activeAppearance,
      resolveWorkspaceScopedToggle,
      appearanceRuntimeTargetId,
      workspaceThemingEnabled,
    ],
  );
  const appearancePanelSettings = useMemo(
    () => {
      const effectiveMatchHeaderColor = resolveWorkspaceScopedToggle(
        settings.speedDial?.matchHeaderColor,
        settings.speedDial?.matchHeaderColorByWorkspace,
        appearanceEditingTargetId,
      );
      const effectiveMatchHeaderFont = resolveWorkspaceScopedToggle(
        settings.speedDial?.matchHeaderFont,
        settings.speedDial?.matchHeaderFontByWorkspace,
        appearanceEditingTargetId,
      );
      const effectiveMaxGlow = resolveWorkspaceScopedToggle(
        settings.speedDial?.maxGlow,
        settings.speedDial?.maxGlowByWorkspace,
        appearanceEditingTargetId,
      );
      return {
        ...settings,
        appearance: editingAppearance,
        speedDial: {
          ...(settings.speedDial || {}),
          matchHeaderColor: !!effectiveMatchHeaderColor,
          matchHeaderFont: !!effectiveMatchHeaderFont,
          maxGlow: Number.isFinite(Number(effectiveMaxGlow))
            ? Number(effectiveMaxGlow)
            : Number(settings.speedDial?.maxGlow ?? 2.5),
        },
      };
    },
    [
      settings,
      editingAppearance,
      resolveWorkspaceScopedToggle,
      appearanceEditingTargetId,
    ],
  );
  // Create centralized theme token resolver with cache invalidation
  const themeTokenResolver = useMemo(() => {
    const resolver = createThemeTokenResolver(runtimeSettings, workspaces, currentPath);
    // Update resolver state when dependencies change (it will invalidate cache if needed)
    if (typeof resolver.updateState === 'function') {
      resolver.updateState(runtimeSettings, workspaces, currentPath);
    }
    return resolver;
  }, [runtimeSettings, workspaces, currentPath]);

  // Workspace background selection (global + per-workspace, slug-aware)
  const workspaceBackgroundsEnabled =
    settings.background?.workspaceEnabled !== false;
  const backgroundFollowSlug = !!settings.background?.followSlug;
  
  // Initialize selectedWorkspaceForZoom to null (Master Override) when workspace backgrounds is enabled
  useEffect(() => {
    if (workspaceBackgroundsEnabled && !appearanceWorkspacesEnabled && selectedWorkspaceForZoom === undefined) {
      setSelectedWorkspaceForZoom(null);
    }
  }, [workspaceBackgroundsEnabled, appearanceWorkspacesEnabled]);
  const backgroundCandidateWorkspaceId = backgroundFollowSlug
    ? selectedWorkspaceId
    : activeWorkspaceId;
  const backgroundWorkspaceId = useMemo(() => {
    if (!workspaceBackgroundsEnabled) return null;
    if (backgroundCandidateWorkspaceId) {
      // Allow anchored workspaces to have their own backgrounds as well.
      return backgroundCandidateWorkspaceId;
    }
    // On default path or when no workspace is active, check for default/anchored workspace background
    if (isDefaultPath || !backgroundCandidateWorkspaceId) {
      const anchoredWorkspaceId = settings?.speedDial?.anchoredWorkspaceId || null;
      const defaultWorkspaceId = anchoredWorkspaceId || DEFAULT_APPEARANCE_WORKSPACE_ID;
      // Check if a background exists for the default workspace
      if (workspaceBackgrounds[defaultWorkspaceId]) {
        return defaultWorkspaceId;
      }
    }
    return null;
  }, [backgroundCandidateWorkspaceId, workspaceBackgroundsEnabled, isDefaultPath, workspaceBackgrounds, settings?.speedDial?.anchoredWorkspaceId]);
  const activeBackgroundSrc = useMemo(() => {
    if (workspaceBackgroundsEnabled && backgroundWorkspaceId) {
      const entry = workspaceBackgrounds[backgroundWorkspaceId];
      if (entry?.src) return entry.src;
    }
    return currentBackground;
  }, [
    backgroundWorkspaceId,
    workspaceBackgrounds,
    currentBackground,
    workspaceBackgroundsEnabled,
  ]);
  const activeBackgroundMeta = useMemo(() => {
    if (workspaceBackgroundsEnabled && backgroundWorkspaceId) {
      const entry = workspaceBackgrounds[backgroundWorkspaceId];
      if (entry?.meta) return entry.meta;
    }
    return globalBackgroundMeta;
  }, [
    workspaceBackgroundsEnabled,
    backgroundWorkspaceId,
    workspaceBackgrounds,
    globalBackgroundMeta,
  ]);
  const activeBackgroundPlaceholder = useMemo(() => {
    const resolvePlaceholderFromMeta = (meta) => {
      if (!meta || typeof meta !== "object") return null;
      const type = String(meta.type || "").toLowerCase();
      if (
        type === "builtin" &&
        meta.id &&
        BUILTIN_GIF_PLACEHOLDERS_BY_META[meta.id]
      ) {
        return BUILTIN_GIF_PLACEHOLDERS_BY_META[meta.id];
      }
      if (meta.url && BUILTIN_GIF_PLACEHOLDERS.has(meta.url)) {
        return BUILTIN_GIF_PLACEHOLDERS.get(meta.url);
      }
      return null;
    };

    if (workspaceBackgroundsEnabled && backgroundWorkspaceId) {
      const entry = workspaceBackgrounds[backgroundWorkspaceId];
      const metaPlaceholder = resolvePlaceholderFromMeta(entry?.meta);
      if (metaPlaceholder) return metaPlaceholder;
      if (entry?.src && BUILTIN_GIF_PLACEHOLDERS.has(entry.src)) {
        return BUILTIN_GIF_PLACEHOLDERS.get(entry.src);
      }
    }

    const globalMetaPlaceholder =
      resolvePlaceholderFromMeta(globalBackgroundMeta);
    if (globalMetaPlaceholder) return globalMetaPlaceholder;

    if (BUILTIN_GIF_PLACEHOLDERS.has(activeBackgroundSrc)) {
      return BUILTIN_GIF_PLACEHOLDERS.get(activeBackgroundSrc);
    }

    return null;
  }, [
    workspaceBackgroundsEnabled,
    backgroundWorkspaceId,
    workspaceBackgrounds,
    globalBackgroundMeta,
    activeBackgroundSrc,
  ]);
  const shouldDeferActiveBackground = useMemo(() => {
    if (!activeBackgroundPlaceholder) return false;
    if (typeof activeBackgroundSrc !== "string") return false;
    return /\.gif(?:[?#].*)?$/i.test(activeBackgroundSrc);
  }, [activeBackgroundPlaceholder, activeBackgroundSrc]);

  // Apply workspace background when backgroundWorkspaceId changes (e.g., URL change, workspace switch)
  // This ensures backgrounds are applied even when URL changes via browser navigation
  // Uses a ref to track the last applied background to avoid unnecessary updates
  useEffect(() => {
    // Wait for workspace backgrounds to be restored from localStorage before applying
    if (!workspaceBackgroundsRestoredRef.current) return;
    
    // Cancel any pending background loading when workspace changes
    const controllers = backgroundAbortControllersRef.current;
    controllers.forEach((controller, wsId) => {
      if (wsId !== backgroundWorkspaceId) {
        controller.abort();
        controllers.delete(wsId);
      }
    });

    if (!workspaceBackgroundsEnabled) return;
    if (!backgroundWorkspaceId) return;
    
    const entry = workspaceBackgrounds[backgroundWorkspaceId];
    if (!entry || !entry.src || !entry.meta) return;

    // Skip if this background is already applied
    if (
      lastAppliedBackgroundRef.current.workspaceId === backgroundWorkspaceId &&
      lastAppliedBackgroundRef.current.src === entry.src
    ) {
      return;
    }

    // Update the ref to track what we're applying
    lastAppliedBackgroundRef.current = {
      workspaceId: backgroundWorkspaceId,
      src: entry.src,
    };

    setGlobalBackgroundMeta(entry.meta);
    setCurrentBackground(entry.src);
    try {
      localStorage.setItem("vivaldi-current-background", entry.src);
    } catch { }
    try {
      localStorage.setItem(
        "vivaldi-current-background-meta",
        JSON.stringify(entry.meta),
      );
    } catch { }
  }, [
    backgroundWorkspaceId,
    workspaceBackgrounds,
    workspaceBackgroundsEnabled,
    workspaceBackgroundsRestored,
  ]);

  // Extract resolved tokens for backward compatibility
  const globalThemeTokens = useMemo(() => {
    try {
      return themeTokenResolver.resolveUnchangeableTokens();
    } catch {
      return {
        fontFamily: settings.theme?.font || "Inter",
        textColor: settings.theme?.colors?.primary || "#ffffff",
        accentColor: settings.theme?.colors?.accent || "#00ffff",
        glowColor: settings.speedDial?.glowColor || "#00ffff66",
        _meta: {},
      };
    }
  }, [themeTokenResolver, settings.theme, settings.speedDial]);
  const globalFontFamily = globalThemeTokens.fontFamily;
  const globalPrimaryColor = globalThemeTokens.textColor;
  const globalAccentColor = globalThemeTokens.accentColor;
  const GLOBAL_GLOW_COLOR = globalThemeTokens.glowColor;

  // Normalize workspace text color if resolver provided one
  const normalizedWorkspaceTextColor = useMemo(() => {
    try {
      const c = globalThemeTokens?._meta?.workspaceTextColor;
      if (!c) return null;
      return stripAlphaFromHex(c);
    } catch {
      return null;
    }
  }, [globalThemeTokens]);

  // Create centralized workspace switching manager
  const workspaceSwitchingManager = useMemo(() => {
    return createWorkspaceSwitchingManager({
      workspaces,
      settings,
      onWorkspaceChange: (workspaceId) => {
        setActiveWorkspaceId(workspaceId);
        setHoveredWorkspaceId(null);
      },
      onUrlChange: (path) => {
        setCurrentPath(path);
      },
      onThemeChange: ({ workspaceId, isHardSwitch, applyBackground }) => {
        // Theme tokens are automatically resolved through the resolver.
        // Background changes apply only on hard switches, and only when
        // workspace backgrounds are enabled and a per-workspace background
        // has been assigned.
        // Note: The background will be applied via the useEffect that watches
        // backgroundWorkspaceId, so we don't need to apply it here to avoid
        // race conditions. This callback is kept for backward compatibility
        // but the useEffect is the primary mechanism.
        if (!applyBackground || !isHardSwitch) return;
        if (!workspaceId) return;
        const enabled =
          settings.background?.workspaceEnabled !== false;
        if (!enabled) return;
        // Use state instead of ref to ensure we have the latest data
        // The useEffect will handle the actual application
      },
      onSettingsChange: (changes) => {
        setSettings((prev) => {
          const next = { ...prev };
          if (changes.general) {
            next.general = { ...(prev.general || {}), ...changes.general };
          }
          if (changes.speedDial) {
            next.speedDial = {
              ...(prev.speedDial || {}),
              ...changes.speedDial,
            };
          }
          return next;
        });
      },
    });
  }, [workspaces, settings]);

  // Update the switching manager when dependencies change
  useEffect(() => {
    workspaceSwitchingManager.updateState({
      workspaces,
      settings,
      onWorkspaceChange: (workspaceId) => {
        setActiveWorkspaceId(workspaceId);
        setHoveredWorkspaceId(null);
      },
      onUrlChange: (path) => {
        setCurrentPath(path);
      },
      onSettingsChange: (changes) => {
        setSettings((prev) => {
          const next = { ...prev };
          if (changes.general) {
            next.general = { ...(prev.general || {}), ...changes.general };
          }
          if (changes.speedDial) {
            next.speedDial = {
              ...(prev.speedDial || {}),
              ...changes.speedDial,
            };
          }
          return next;
        });
      },
    });
  }, [workspaces, settings, workspaceSwitchingManager]);

  // Initialize the switching manager
  useEffect(() => {
    workspaceSwitchingManager.initialize();
    return () => workspaceSwitchingManager.destroy();
  }, [workspaceSwitchingManager]);

  // Refactored workspace switching handlers
  const handleWorkspaceSelect = (id) => {
    workspaceSwitchingManager.handleSingleClick(id);
  };

  const handleWorkspaceDoubleSelect = (id) => {
    const handled = workspaceSwitchingManager.handleDoubleClick(id);
    if (handled && headerBannerFlipOnDoubleClick) {
      setBannerDirectionPhase((prev) => (prev > 0 ? -1 : 1));
    }
  };
  const handleWorkspaceAnchor = (id) => {
    setSettings((prev) => {
      const currentId = prev.speedDial?.anchoredWorkspaceId || null;
      const nextId = currentId === id ? null : id;
      return {
        ...prev,
        speedDial: { ...(prev.speedDial || {}), anchoredWorkspaceId: nextId },
      };
    });
  };
  const handleWorkspaceAdd = () => {
    const id = "ws-" + Date.now();
    const nextWorkspace = {
      id,
      name: "New",
      icon: "LayoutList",
      position: workspaces.length,
    };
    setWorkspaces((prev) => [...prev, nextWorkspace]);
    setSpeedDials((prev) => ({ ...prev, [id]: [] }));
    setActiveWorkspaceId(id);
    setHoveredWorkspaceId(null);
    try {
      const folder = getWorkspaceFolderName(id, [nextWorkspace]);
      if (folder) {
        import("./lib/notes-sync")
          .then((mod) => mod.ensureVaultFolders?.([folder]))
          .catch(() => { });
      }
    } catch { }
  };
  const handleWorkspaceRemove = (id, options) => {
    const ws = workspaces.find((w) => w.id === id) || null;
    if (!ws) return;
    let deleteFolder = !!(options && options.deleteFolder);
    if (!options) {
      const baseMsg =
        `Delete workspace "${ws.name || "Workspace"}"?\n\n` +
        `All shortcuts in this workspace will be removed from the Start page.`;
      // First confirmation: delete workspace at all
      if (typeof window !== "undefined") {
        const ok = window.confirm(baseMsg);
        if (!ok) return;
        const folderPrompt =
          "Also delete the associated notes folder for this workspace?\n\n" +
          "(Choose OK to delete the folder and its notes from the vault, or Cancel to keep them.)";
        deleteFolder = window.confirm(folderPrompt);
      }
    }
    setWorkspaces((prev) =>
      prev.filter((w) => w.id !== id).map((w, i) => ({ ...w, position: i })),
    );
    setSpeedDials((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    setWorkspaceBackgroundMeta(id, null).catch(() => { });
    if (hoveredWorkspaceId === id) {
      setHoveredWorkspaceId(null);
    }
    if (activeWorkspaceId === id && workspaces.length > 1) {
      setActiveWorkspaceId(workspaces[0].id);
    }
    if (deleteFolder) {
      const folder = getWorkspaceFolderName(id, workspaces);
      if (folder) {
        import("./lib/notes-sync")
          .then((mod) => mod.deleteVaultFolders?.([folder]))
          .catch(() => { });
      }
    }
  };
  const handleWorkspaceReorder = (next) => setWorkspaces(next);
  const handleWorkspaceTitleChange = (name) => {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === activeWorkspaceId ? { ...w, name } : w)),
    );
  };

  // Rename and icon change handlers
  const handleWorkspaceRename = (id) => {
    const ws = workspaces.find((w) => w.id === id);
    const name = prompt("Rename workspace", ws?.name || "");
    if (name != null) {
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === id ? { ...w, name: name || "Workspace" } : w,
        ),
      );
    }
  };
  const handleWorkspaceChangeIcon = (id, iconName) => {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === id ? { ...w, icon: iconName } : w)),
    );
  };

  // Persistence: load on mount
  useEffect(() => {
    try {
      const wsRaw = localStorage.getItem("workspaces");
      const sdRaw = localStorage.getItem("speedDials");
      const iconsRaw = localStorage.getItem("speedDialCustomIcons");
      const activeRaw = localStorage.getItem("activeWorkspaceId");
      const lastHardRaw = localStorage.getItem("lastHardWorkspaceId");

      if (iconsRaw) {
        try {
          const parsedIcons = JSON.parse(iconsRaw);
          if (parsedIcons && typeof parsedIcons === "object") {
            customSpeedDialIconsRef.current = parsedIcons;
          }
        } catch {
          customSpeedDialIconsRef.current = {};
        }
      }

      if (wsRaw) {
        const ws = JSON.parse(wsRaw);
        if (Array.isArray(ws) && ws.length) setWorkspaces(ws);
      }
      if (sdRaw) {
        const sds = JSON.parse(sdRaw);
        if (sds && typeof sds === "object") {
          const merged = mergeCustomIcons(sds, customSpeedDialIconsRef.current);
          setSpeedDials(merged);
        }
      }
      if (activeRaw) setActiveWorkspaceId(activeRaw);
      if (lastHardRaw && lastHardRaw !== "null")
        setLastHardWorkspaceId(lastHardRaw);
    } catch (err) {
      console.error("Failed to load persisted state", err);
    }
    setLoadedPersist(true);
  }, []);

  // Save on changes
  useEffect(() => {
    if (!loadedPersist) return;
    try {
      localStorage.setItem("workspaces", JSON.stringify(workspaces));
    } catch { }
  }, [workspaces, loadedPersist]);
  useEffect(() => {
    if (!loadedPersist) return;
    try {
      localStorage.setItem("speedDials", JSON.stringify(speedDials));
      const icons = collectCustomIcons(speedDials);
      customSpeedDialIconsRef.current = icons;
      localStorage.setItem("speedDialCustomIcons", JSON.stringify(icons));
    } catch (err) {
      console.error("Failed to persist speed dial state", err);
    }
  }, [speedDials, loadedPersist]);
  useEffect(() => {
    if (!loadedPersist) return;
    try {
      localStorage.setItem("activeWorkspaceId", activeWorkspaceId);
    } catch { }
  }, [activeWorkspaceId, loadedPersist]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Migrate any data URL favicons to project storage (once)
  useEffect(() => {
    if (!loadedPersist) return;
    const onceKey = "vivaldi-migrated-icons-to-project";
    if (localStorage.getItem(onceKey)) return;
    (async () => {
      try {
        const next = { ...speedDials };
        let changed = false;
        for (const [_wsId, tilesArr] of Object.entries(next)) {
          if (!Array.isArray(tilesArr)) continue;
          for (let i = 0; i < tilesArr.length; i++) {
            const t = tilesArr[i];
            if (t && isDataUrl(t.favicon)) {
              const saved = await trySaveIconToProject(
                t.favicon,
                `${t.title || "icon"}`,
              );
              if (saved) {
                tilesArr[i] = { ...t, favicon: saved };
                changed = true;
              }
            }
            // Migrate folder children too
            if (t && Array.isArray(t.children)) {
              const kids = t.children.slice();
              let kidsChanged = false;
              for (let k = 0; k < kids.length; k++) {
                const c = kids[k];
                if (c && isDataUrl(c.favicon)) {
                  const saved = await trySaveIconToProject(
                    c.favicon,
                    `${c.title || "icon"}`,
                  );
                  if (saved) {
                    kids[k] = { ...c, favicon: saved };
                    kidsChanged = true;
                    changed = true;
                  }
                }
              }
              if (kidsChanged) tilesArr[i] = { ...tilesArr[i], children: kids };
            }
          }
        }
        if (changed) {
          setSpeedDials(next);
          try {
            localStorage.setItem("speedDials", JSON.stringify(next));
          } catch { }
        }
        localStorage.setItem(onceKey, "1");
      } catch { }
    })();
  }, [loadedPersist]);

  // Experimental Speed Dial is always enabled; no mode switching

  // Listen to SettingsButton custom events for search engine, suggestions blur, and AI settings
  useEffect(() => {
    const onEng = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: { ...(prev.search || {}), engine: e.detail },
      }));
    const onSuggestProv = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: { ...(prev.search || {}), suggestProvider: e.detail },
      }));
    const onAiModel = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), model: e.detail },
      }));
    const onAiWeb = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), webSearch: !!e.detail },
      }));
    const onAiWebProvider = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: {
          ...(prev.ai || {}),
          webSearchProvider: String(e.detail || "searxng"),
        },
      }));
    const onAiFirecrawlBase = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), firecrawlBaseUrl: String(e.detail || "") },
      }));
    const onAiFirecrawlKey = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), firecrawlApiKey: String(e.detail || "") },
      }));
    const onAiVoiceBackend = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), voiceBackend: String(e.detail || "") },
      }));
    const onAiLmstudioBase = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), lmstudioBaseUrl: String(e.detail || "") },
      }));
    const onAiOpenAIKey = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), openaiApiKey: String(e.detail || "") },
      }));
    const onAiOpenRouterKey = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), openrouterApiKey: String(e.detail || "") },
      }));
    const onAiOpenRouterBase = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), openrouterBaseUrl: String(e.detail || "") },
      }));
    const onAiMemory = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), memoryContent: String(e.detail || "") },
      }));
    const onAiResultsCount = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), webResultsCount: Number(e.detail || 5) },
      }));
    const onAiRoutingEnabled = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), routingEnabled: !!e.detail },
      }));
    const onAiRoutingMode = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), routingMode: String(e.detail || "auto") },
      }));
    const onAiRoutingPreferLocal = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), preferLocal: !!e.detail },
      }));
    const onAiRoutingModelDefault = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: {
          ...(prev.ai || {}),
          routeModels: {
            ...(prev.ai?.routeModels || {}),
            default: String(e.detail || ""),
          },
        },
      }));
    const onAiRoutingModelCode = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: {
          ...(prev.ai || {}),
          routeModels: {
            ...(prev.ai?.routeModels || {}),
            code: String(e.detail || ""),
          },
        },
      }));
    const onAiRoutingModelLong = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: {
          ...(prev.ai || {}),
          routeModels: {
            ...(prev.ai?.routeModels || {}),
            long: String(e.detail || ""),
          },
        },
      }));
    const onCap7 = (e) =>
      setSettings((prev) => ({
        ...prev,
        general: { ...(prev.general || {}), capSuggestions7: !!e.detail },
      }));
    const onShortcutUpdate = (e) => {
      const { action, shortcut } = e.detail || {}
      if (!action || !shortcut) return
      setSettings((prev) => ({
        ...prev,
        general: {
          ...(prev.general || {}),
          shortcuts: {
            ...(prev.general?.shortcuts || {}),
            [action]: shortcut
          }
        }
      }))
    }
    const onInlineProvider = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          inlineProvider: String(e.detail || "searxng"),
        },
      }));
    const onInlineUseAI = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: { ...(prev.search || {}), inlineUseAI: !!e.detail },
      }));
    const onInlineFirecrawlBase = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          inlineFirecrawlBaseUrl: String(e.detail || ""),
        },
      }));
    const onInlineFirecrawlKey = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          inlineFirecrawlApiKey: String(e.detail || ""),
        },
      }));
    const onInlineAppearanceTheme = (e) => {
      const theme = String(e.detail || "terminal");
      setSettings((prev) => {
        const state = normalizeAppearanceWorkspaceState(prev.appearanceWorkspaces);
        if (state?.enabled && applyAppearanceEditRef.current) {
          // Use applyAppearanceEdit to update workspace-specific appearance
          applyAppearanceEditRef.current((appearanceProfile) => ({
            ...(appearanceProfile || {}),
            inline: {
              ...(appearanceProfile?.inline || {}),
              theme,
            },
          }));
          return prev;
        }
        return {
          ...prev,
          appearance: {
            ...(prev.appearance || {}),
            inline: {
              ...(prev.appearance?.inline || {}),
              theme,
            },
          },
        };
      });
    };
    const onInlineAppearanceSlugColor = (e) => {
      const useSlugColor = !!e.detail;
      setSettings((prev) => {
        const state = normalizeAppearanceWorkspaceState(prev.appearanceWorkspaces);
        if (state?.enabled && applyAppearanceEditRef.current) {
          // Use applyAppearanceEdit to update workspace-specific appearance
          applyAppearanceEditRef.current((appearanceProfile) => ({
            ...(appearanceProfile || {}),
            inline: {
              ...(appearanceProfile?.inline || {}),
              useWorkspaceSlugTextColor: useSlugColor,
            },
          }));
          return prev;
        }
        return {
          ...prev,
          appearance: {
            ...(prev.appearance || {}),
            inline: {
              ...(prev.appearance?.inline || {}),
              useWorkspaceSlugTextColor: useSlugColor,
            },
          },
        };
      });
    };
    const onInlineAppearanceOutline = (e) => {
      const outline = !!e.detail;
      setSettings((prev) => {
        const state = normalizeAppearanceWorkspaceState(prev.appearanceWorkspaces);
        if (state?.enabled && applyAppearanceEditRef.current) {
          applyAppearanceEditRef.current((appearanceProfile) => ({
            ...(appearanceProfile || {}),
            inline: {
              ...(appearanceProfile?.inline || {}),
              outline,
            },
          }));
          return prev;
        }
        return {
          ...prev,
          appearance: {
            ...(prev.appearance || {}),
            inline: { ...(prev.appearance?.inline || {}), outline },
          },
        };
      });
    };
    const onInlineAppearanceFull = (e) => {
      const fullPinnedSearch = !!e.detail;
      setSettings((prev) => {
        const state = normalizeAppearanceWorkspaceState(prev.appearanceWorkspaces);
        if (state?.enabled && applyAppearanceEditRef.current) {
          applyAppearanceEditRef.current((appearanceProfile) => ({
            ...(appearanceProfile || {}),
            inline: {
              ...(appearanceProfile?.inline || {}),
              fullPinnedSearch,
            },
          }));
          return prev;
        }
        return {
          ...prev,
          appearance: {
            ...(prev.appearance || {}),
            inline: {
              ...(prev.appearance?.inline || {}),
              fullPinnedSearch,
            },
          },
        };
      });
    };
    const onInlineAppearanceReturn = (e) => {
      const systemReturnButton = !!e.detail;
      setSettings((prev) => {
        const state = normalizeAppearanceWorkspaceState(prev.appearanceWorkspaces);
        if (state?.enabled && applyAppearanceEditRef.current) {
          applyAppearanceEditRef.current((appearanceProfile) => ({
            ...(appearanceProfile || {}),
            inline: {
              ...(appearanceProfile?.inline || {}),
              systemReturnButton,
            },
          }));
          return prev;
        }
        return {
          ...prev,
          appearance: {
            ...(prev.appearance || {}),
            inline: {
              ...(prev.appearance?.inline || {}),
              systemReturnButton,
            },
          },
        };
      });
    };
    const onSearxngBase = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          searxngBaseUrl: String(e.detail || "/searxng"),
        },
      }));
    const onImgbbApiKey = (e) => {
      console.log('onImgbbApiKey handler called with:', e.detail ? e.detail.substring(0, 10) + '...' : 'empty')
      setSettings((prev) => {
        const newSettings = {
          ...prev,
          search: {
            ...(prev.search || {}),
            imgbbApiKey: String(e.detail || ""),
          },
        }
        console.log('Settings updated, imgbbApiKey:', newSettings.search?.imgbbApiKey ? newSettings.search.imgbbApiKey.substring(0, 10) + '...' : 'empty')
        return newSettings
      })
    }
    const onImageSearchInlineProvider = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          imageSearch: {
            ...(prev.search?.imageSearch || {}),
            inlineProvider: String(e.detail || "searxng"), // "searxng" only
          },
        },
      }));
    const onImageSearchExternalProvider = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          imageSearch: {
            ...(prev.search?.imageSearch || {}),
            externalProvider: String(e.detail || "google-lens"),
          },
        },
      }));
    const onImageSearchPreferInline = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          imageSearch: {
            ...(prev.search?.imageSearch || {}),
            preferInline: !!e.detail,
          },
        },
      }));
    const onSearxngSuggestBase = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          suggestSearxngBaseUrl: String(e.detail || ""),
        },
      }));
    const onInlineSearxngBase = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          inlineSearxngBaseUrl: String(e.detail || ""),
        },
      }));
    const onInlineCustomBase = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          inlineCustomBaseUrl: String(e.detail || ""),
        },
      }));
    const onSuggestCustomBase = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          suggestCustomBaseUrl: String(e.detail || ""),
        },
      }));
    const onSuggestCustomMode = (e) =>
      setSettings((prev) => ({
        ...prev,
        search: {
          ...(prev.search || {}),
          suggestCustomMode: String(e.detail || "ddg"),
        },
      }));
    const onAiWebSearxngBase = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: {
          ...(prev.ai || {}),
          webSearxngBaseUrl: String(e.detail || ""),
        },
      }));
    // Temporary Modern layout override when AI or Inline results are active in Classic
    const onTemporaryModern = (e) => {
      const required = !!e?.detail?.required;
      const currLayout = currentLayoutRef.current;
      if (required) {
        if (currLayout === "classic" && !layoutOverrideRef.current.active) {
          layoutOverrideRef.current = { active: true, prev: "classic" };
          try {
            localStorage.setItem("lastManualMasterLayout", "classic");
          } catch { }
          setTempModernOverride(true);
        }
      } else {
        if (
          layoutOverrideRef.current.active &&
          layoutOverrideRef.current.prev === "classic"
        ) {
          layoutOverrideRef.current = { active: false, prev: null };
          setTempModernOverride(false);
        }
      }
    };
    const onAiToken = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), token: String(e.detail || "") },
      }));
    const onAiOpenNewChatEverytime = (e) =>
      setSettings((prev) => ({
        ...prev,
        ai: { ...(prev.ai || {}), openNewChatEverytime: !!e.detail },
      }));
    const onHeaderMode = (e) =>
      setSettings((prev) => {
        const key = e?.detail?.workspaceId ?? "__base__";
        const mode = String(e?.detail?.mode || "text");
        const curr = prev.speedDial?.workspaceHeaderColorMode || {};
        return {
          ...prev,
          speedDial: {
            ...prev.speedDial,
            workspaceHeaderColorMode: { ...curr, [key]: mode },
          },
        };
      });

    const onLicenseActivated = (e) => {
      const detail = e?.detail || {};
      const licenseObj = detail.license || null;
      const active = !!detail.success;
      setSettings((prev) => ({
        ...prev,
        license: {
          ...(prev.license || {}),
          active,
          license: licenseObj,
        },
      }));
    };
    window.addEventListener("app-change-search-engine", onEng);
    window.addEventListener("app-change-suggest-provider", onSuggestProv);
    window.addEventListener("app-ai-change-model", onAiModel);
    window.addEventListener("app-ai-toggle-websearch", onAiWeb);
    window.addEventListener("app-ai-set-web-provider", onAiWebProvider);
    window.addEventListener("app-ai-firecrawl-base", onAiFirecrawlBase);
    window.addEventListener("app-ai-firecrawl-key", onAiFirecrawlKey);
    window.addEventListener("app-ai-set-voice-backend", onAiVoiceBackend);
    window.addEventListener("app-ai-set-lmstudio-base", onAiLmstudioBase);
    window.addEventListener("app-ai-set-openai-key", onAiOpenAIKey);
    window.addEventListener("app-ai-set-openrouter-key", onAiOpenRouterKey);
    window.addEventListener("app-ai-set-openrouter-base", onAiOpenRouterBase);
    window.addEventListener("app-ai-set-memory", onAiMemory);
    window.addEventListener("app-ai-results-count", onAiResultsCount);
    window.addEventListener("app-ai-routing-enabled", onAiRoutingEnabled);
    window.addEventListener("app-ai-routing-mode", onAiRoutingMode);
    window.addEventListener(
      "app-ai-routing-prefer-local",
      onAiRoutingPreferLocal,
    );
    window.addEventListener(
      "app-ai-routing-model-default",
      onAiRoutingModelDefault,
    );
    window.addEventListener("app-ai-routing-model-code", onAiRoutingModelCode);
    window.addEventListener("app-ai-routing-model-long", onAiRoutingModelLong);
    window.addEventListener("app-toggle-suggestions-cap7", onCap7);
    window.addEventListener("app-shortcut-update", onShortcutUpdate);
    window.addEventListener("app-inline-set-provider", onInlineProvider);
    window.addEventListener("app-inline-use-ai", onInlineUseAI);
    window.addEventListener("app-inline-firecrawl-base", onInlineFirecrawlBase);
    window.addEventListener("app-inline-firecrawl-key", onInlineFirecrawlKey);
    window.addEventListener("app-inline-theme", onInlineAppearanceTheme);
    window.addEventListener(
      "app-inline-slug-font-color",
      onInlineAppearanceSlugColor,
    );
    window.addEventListener("app-inline-outline", onInlineAppearanceOutline);
    window.addEventListener("app-inline-full", onInlineAppearanceFull);
    window.addEventListener("app-search-searxng-base", onSearxngBase);
    window.addEventListener(
      "app-search-suggest-searxng-base",
      onSearxngSuggestBase,
    );
    window.addEventListener("app-search-imgbb-apikey", onImgbbApiKey);
    window.addEventListener("app-image-search-inline-provider", onImageSearchInlineProvider);
    window.addEventListener("app-image-search-external-provider", onImageSearchExternalProvider);
    window.addEventListener("app-image-search-prefer-inline", onImageSearchPreferInline);
    window.addEventListener("app-inline-searxng-base", onInlineSearxngBase);
    window.addEventListener("app-inline-custom-base", onInlineCustomBase);
    window.addEventListener("app-suggest-custom-base", onSuggestCustomBase);
    window.addEventListener("app-suggest-custom-mode", onSuggestCustomMode);
    window.addEventListener(
      "app-inline-return-style",
      onInlineAppearanceReturn,
    );
    window.addEventListener("app-temporary-modern-required", onTemporaryModern);
    window.addEventListener("app-ai-set-token", onAiToken);
    window.addEventListener(
      "app-ai-open-new-chat-everytime",
      onAiOpenNewChatEverytime,
    );
    window.addEventListener("app-ai-web-searxng-base", onAiWebSearxngBase);
    window.addEventListener("app-set-header-color-mode", onHeaderMode);
    window.addEventListener("vstart-activate-license", onLicenseActivated);

    // Global drag-and-drop handlers for images - allow dropping images anywhere on the page
    const handleGlobalDragOver = (e) => {
      // Only handle if dragging files (images)
      if (!e?.dataTransfer?.types?.includes('Files')) return;

      const target = e.target;
      // Check if we're over the search bar or its children - if so, let it handle it
      const isOverSearchBar = target?.closest?.('[data-search-box]');

      // If not over search bar, allow drop by preventing default
      if (!isOverSearchBar) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleGlobalDrop = async (e) => {
      try {
        // Only handle if files are being dropped
        if (!e?.dataTransfer?.files?.length) return;

        const target = e.target;
        // Check if we're dropping on the search bar or its children - if so, let it handle it
        const isOverSearchBar = target?.closest?.('[data-search-box]');

        // If not over search bar, handle it globally
        if (!isOverSearchBar) {
          const files = Array.from(e.dataTransfer.files);
          const imageFile = files.find(f => f.type.startsWith('image/'));

          if (imageFile && searchBoxRef.current?.attachImage) {
            e.preventDefault();
            e.stopPropagation();
            await searchBoxRef.current.attachImage(imageFile);
          }
        }
      } catch (error) {
        console.error('Global image drop failed:', error);
      }
    };

    // Add global event listeners - use capture phase to catch before other handlers
    // but check if target is search bar to avoid interfering
    document.addEventListener('dragover', handleGlobalDragOver, true);
    document.addEventListener('drop', handleGlobalDrop, true);

    return () => {
      // Remove global drag-and-drop listeners
      document.removeEventListener('dragover', handleGlobalDragOver, true);
      document.removeEventListener('drop', handleGlobalDrop, true);
      window.removeEventListener("app-change-search-engine", onEng);
      window.removeEventListener("app-change-suggest-provider", onSuggestProv);
      window.removeEventListener("app-ai-change-model", onAiModel);
      window.removeEventListener("app-ai-toggle-websearch", onAiWeb);
      window.removeEventListener("app-ai-set-web-provider", onAiWebProvider);
      window.removeEventListener("app-ai-firecrawl-base", onAiFirecrawlBase);
      window.removeEventListener("app-ai-firecrawl-key", onAiFirecrawlKey);
      window.removeEventListener("app-ai-set-voice-backend", onAiVoiceBackend);
      window.removeEventListener("app-ai-set-lmstudio-base", onAiLmstudioBase);
      window.removeEventListener("app-ai-set-openai-key", onAiOpenAIKey);
      window.removeEventListener(
        "app-ai-set-openrouter-key",
        onAiOpenRouterKey,
      );
      window.removeEventListener(
        "app-ai-set-openrouter-base",
        onAiOpenRouterBase,
      );
      window.removeEventListener("app-ai-set-memory", onAiMemory);
      window.removeEventListener("app-ai-results-count", onAiResultsCount);
      window.removeEventListener("app-ai-routing-enabled", onAiRoutingEnabled);
      window.removeEventListener("app-ai-routing-mode", onAiRoutingMode);
      window.removeEventListener(
        "app-ai-routing-prefer-local",
        onAiRoutingPreferLocal,
      );
      window.removeEventListener(
        "app-ai-routing-model-default",
        onAiRoutingModelDefault,
      );
      window.removeEventListener(
        "app-ai-routing-model-code",
        onAiRoutingModelCode,
      );
      window.removeEventListener(
        "app-ai-routing-model-long",
        onAiRoutingModelLong,
      );
      window.removeEventListener("app-toggle-suggestions-cap7", onCap7);
      window.removeEventListener("app-shortcut-update", onShortcutUpdate);
      window.removeEventListener("app-inline-set-provider", onInlineProvider);
      window.removeEventListener("app-inline-use-ai", onInlineUseAI);
      window.removeEventListener(
        "app-inline-firecrawl-base",
        onInlineFirecrawlBase,
      );
      window.removeEventListener(
        "app-inline-firecrawl-key",
        onInlineFirecrawlKey,
      );
      window.removeEventListener("app-inline-theme", onInlineAppearanceTheme);
      window.removeEventListener(
        "app-inline-slug-font-color",
        onInlineAppearanceSlugColor,
      );
      window.removeEventListener(
        "app-inline-outline",
        onInlineAppearanceOutline,
      );
      window.removeEventListener("app-inline-full", onInlineAppearanceFull);
      window.removeEventListener("app-search-searxng-base", onSearxngBase);
      window.removeEventListener(
        "app-search-suggest-searxng-base",
        onSearxngSuggestBase,
      );
      window.removeEventListener("app-search-imgbb-apikey", onImgbbApiKey);
      window.removeEventListener("app-image-search-inline-provider", onImageSearchInlineProvider);
      window.removeEventListener("app-image-search-external-provider", onImageSearchExternalProvider);
      window.removeEventListener("app-image-search-prefer-inline", onImageSearchPreferInline);
      window.removeEventListener(
        "app-inline-searxng-base",
        onInlineSearxngBase,
      );
      window.removeEventListener("app-inline-custom-base", onInlineCustomBase);
      window.removeEventListener(
        "app-suggest-custom-base",
        onSuggestCustomBase,
      );
      window.removeEventListener(
        "app-suggest-custom-mode",
        onSuggestCustomMode,
      );
      window.removeEventListener(
        "app-inline-return-style",
        onInlineAppearanceReturn,
      );
      window.removeEventListener(
        "app-temporary-modern-required",
        onTemporaryModern,
      );
      window.removeEventListener("app-ai-set-token", onAiToken);
      window.removeEventListener(
        "app-ai-open-new-chat-everytime",
        onAiOpenNewChatEverytime,
      );
      window.removeEventListener(
        "app-ai-web-searxng-base",
        onAiWebSearxngBase,
      );
      window.removeEventListener("app-set-header-color-mode", onHeaderMode);
      window.removeEventListener("vstart-activate-license", onLicenseActivated);
    };
  }, []);

  // Persist email accounts
  useEffect(() => {
    try {
      localStorage.setItem("vivaldi-email-accounts", JSON.stringify(emailAccounts));
    } catch { }
  }, [emailAccounts]);

  const handleAddEmailAccount = (account) => {
    setEmailAccounts((prev) => {
      if (prev.some((a) => a.email === account.email)) return prev;
      return [...prev, account];
    });
  };

  const handleRemoveEmailAccount = (account) => {
    setEmailAccounts((prev) => prev.filter((a) => a.email !== account.email));
  };

  const handleUpdateEmailAccountWorkspace = (account, workspaceId) => {
    // Handle both account object and email string
    const email = typeof account === 'string' ? account : account?.email
    if (!email) {
      console.error('handleUpdateEmailAccountWorkspace: missing email', account)
      return
    }
    console.log('📧 Updating email account workspace:', email, '→', workspaceId)
    setEmailAccounts((prev) => {
      const updated = prev.map((a) => (a.email === email ? { ...a, workspaceId: workspaceId || null } : a))
      console.log('📧 Updated email accounts:', updated)
      return updated
    })
  };

  // Track AI and inline enable toggles from Settings
  useEffect(() => {
    const onAiEnabled = (e) => {
      const enabled = !!e?.detail;
      setSettings((prev) => ({ ...prev, ai: { ...(prev.ai || {}), enabled } }));
    };
    const onInlineEnabled = (e) => {
      const enabled = !!e?.detail;
      setSettings((prev) => ({
        ...prev,
        search: { ...(prev.search || {}), inlineEnabled: enabled },
      }));
    };
    window.addEventListener("app-ai-enabled", onAiEnabled);
    window.addEventListener("app-inline-enabled", onInlineEnabled);
    return () => {
      window.removeEventListener("app-ai-enabled", onAiEnabled);
      window.removeEventListener("app-inline-enabled", onInlineEnabled);
    };
  }, []);

  // Detect scroll wheel button press (middle mouse button) and toggle "Double-click for workspace URL"
  useEffect(() => {
    const handleMiddleMouseButton = (e) => {
      // Middle mouse button (scroll wheel press) is button === 1
      if (e.button === 1) {
        setSettings((prev) => {
          const currentValue = prev.general?.autoUrlDoubleClick || false;
          return {
            ...prev,
            general: {
              ...(prev.general || {}),
              autoUrlDoubleClick: !currentValue,
            },
          };
        });
      }
    };

    // Listen for mousedown events to detect middle button press
    window.addEventListener("mousedown", handleMiddleMouseButton);
    return () => {
      window.removeEventListener("mousedown", handleMiddleMouseButton);
    };
  }, []);

  // Keyboard shortcut handler
  useEffect(() => {
    const keySequenceRef = { current: [] }
    const sequenceTimeoutRef = { current: null }
    const SEQUENCE_TIMEOUT = 1000 // 1 second to complete sequence

    const normalizeKey = (key) => {
      // Handle space character
      if (key === ' ' || key === 'Space') return ' '
      if (key.length === 1 && /[a-zA-Z0-9]/.test(key)) return key.toLowerCase()
      if (key.startsWith('Arrow')) return key.replace('Arrow', '')
      return key
    }

    const parseShortcut = (shortcut) => {
      if (!shortcut) return []
      return shortcut.split(' ').map(k => {
        k = k.trim()
        // Convert 'Space' string to space character for matching
        if (k === 'Space') return ' '
        return k
      }).filter(k => k)
    }

    const matchesSequence = (pressed, target) => {
      if (pressed.length !== target.length) return false
      for (let i = 0; i < pressed.length; i++) {
        const pressedKey = normalizeKey(pressed[i])
        const targetKey = normalizeKey(target[i])
        if (pressedKey !== targetKey) {
          return false
        }
      }
      return true
    }

    // Log the shortcut on mount/change
    const focusShortcut = settings?.general?.shortcuts?.focusSearchbar || 'x Space'
    console.log('Keyboard shortcut handler initialized. Shortcut:', focusShortcut, 'Parsed:', parseShortcut(focusShortcut))

    const handleKeyDown = (e) => {
      // Don't trigger shortcuts when typing in inputs, textareas, or contenteditable
      const target = e.target
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('[contenteditable="true"]')
      )) {
        // Reset sequence if user is typing
        keySequenceRef.current = []
        if (sequenceTimeoutRef.current) {
          clearTimeout(sequenceTimeoutRef.current)
          sequenceTimeoutRef.current = null
        }
        return
      }

      const key = normalizeKey(e.key)

      // Check for focusSearchbar shortcut
      const focusShortcut = settings?.general?.shortcuts?.focusSearchbar || 'x Space'
      const targetSequence = parseShortcut(focusShortcut)

      // Add the current key to the sequence
      keySequenceRef.current.push(key)

      // Clear existing timeout
      if (sequenceTimeoutRef.current) {
        clearTimeout(sequenceTimeoutRef.current)
        sequenceTimeoutRef.current = null
      }

      // Debug logging (can be removed later)
      console.log('Key pressed:', key, 'Sequence:', keySequenceRef.current, 'Target:', targetSequence)

      // Check if sequence matches
      if (matchesSequence(keySequenceRef.current, targetSequence)) {
        console.log('Shortcut matched! Focusing searchbar...')
        e.preventDefault()
        e.stopPropagation()
        keySequenceRef.current = []
        if (sequenceTimeoutRef.current) {
          clearTimeout(sequenceTimeoutRef.current)
          sequenceTimeoutRef.current = null
        }
        // Focus searchbar
        setTimeout(() => {
          if (searchBoxRef.current?.focus) {
            console.log('Calling focus on searchBoxRef')
            searchBoxRef.current.focus()
          } else {
            console.warn('searchBoxRef.current?.focus is not available', searchBoxRef.current)
          }
        }, 0)
        return
      }

      // Reset sequence if it's too long or doesn't match the start
      if (keySequenceRef.current.length > targetSequence.length) {
        // Check if this key could start a new sequence
        if (normalizeKey(key) === normalizeKey(targetSequence[0])) {
          keySequenceRef.current = [key]
        } else {
          keySequenceRef.current = []
        }
      } else {
        // Check if current sequence still matches the beginning of target
        let stillMatches = true
        for (let i = 0; i < keySequenceRef.current.length; i++) {
          if (normalizeKey(keySequenceRef.current[i]) !== normalizeKey(targetSequence[i])) {
            stillMatches = false
            break
          }
        }
        if (!stillMatches) {
          // If this key could start a new sequence, keep it, otherwise reset
          if (normalizeKey(key) === normalizeKey(targetSequence[0])) {
            keySequenceRef.current = [key]
          } else {
            keySequenceRef.current = []
          }
        }
      }

      // Set timeout to reset sequence if not completed
      sequenceTimeoutRef.current = setTimeout(() => {
        keySequenceRef.current = []
      }, SEQUENCE_TIMEOUT)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (sequenceTimeoutRef.current) {
        clearTimeout(sequenceTimeoutRef.current)
      }
    }
  }, [settings?.general?.shortcuts?.focusSearchbar])

  // Handle scroll-to-change-workspace for the entire right column when "include whole column" is enabled
  useEffect(() => {
    const scrollToChangeWorkspace = !!(settings?.general?.scrollToChangeWorkspace);
    const scrollToChangeWorkspaceIncludeSpeedDial = !!(settings?.general?.scrollToChangeWorkspaceIncludeSpeedDial);
    const scrollToChangeWorkspaceIncludeWholeColumn = !!(settings?.general?.scrollToChangeWorkspaceIncludeWholeColumn);
    const scrollToChangeWorkspaceResistance = !!(settings?.general?.scrollToChangeWorkspaceResistance);
    const scrollToChangeWorkspaceResistanceIntensity = Number(settings?.general?.scrollToChangeWorkspaceResistanceIntensity ?? 100);

    // Only add listener if "include whole column" is enabled
    if (!scrollToChangeWorkspace || !scrollToChangeWorkspaceIncludeSpeedDial || !scrollToChangeWorkspaceIncludeWholeColumn || workspaces.length === 0) {
      return;
    }

    const rightColumn = document.getElementById('app-right-column');
    if (!rightColumn) return;

    let lastScrollTime = 0;
    let scrollAccumulator = 0;

    const handleColumnWheel = (e) => {
      // Disable scroll-to-change-workspace when settings panel is open
      if (isSettingsOpen()) {
        return;
      }

      // Check if the scroll event is within the right column bounds
      const rect = rightColumn.getBoundingClientRect();
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      // Only process if mouse is within the column bounds
      if (mouseX < rect.left || mouseX > rect.right || mouseY < rect.top || mouseY > rect.bottom) {
        return;
      }

      // Throttle scroll events (max once per 150ms)
      const now = Date.now();
      if (now - lastScrollTime < 150) {
        e.preventDefault();
        return;
      }
      lastScrollTime = now;

      const deltaY = e.deltaY;

      // Resistance scrolling: accumulate scroll delta before changing workspace
      if (scrollToChangeWorkspaceResistance) {
        scrollAccumulator += Math.abs(deltaY);
        const RESISTANCE_THRESHOLD = Math.max(50, Math.min(500, scrollToChangeWorkspaceResistanceIntensity));
        if (scrollAccumulator < RESISTANCE_THRESHOLD) {
          e.preventDefault();
          return;
        }
        scrollAccumulator = 0; // Reset accumulator
      }

      // Prevent default scroll behavior
      e.preventDefault();
      e.stopPropagation();

      // Determine scroll direction
      const scrollDown = deltaY > 0;

      // Find current workspace index
      const currentIndex = workspaces.findIndex(ws => ws.id === activeWorkspaceId);
      if (currentIndex === -1) return;

      // Calculate next workspace index
      let nextIndex;
      if (scrollDown) {
        nextIndex = currentIndex < workspaces.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : workspaces.length - 1;
      }

      // Change workspace
      const nextWorkspace = workspaces[nextIndex];
      if (nextWorkspace && nextWorkspace.id !== activeWorkspaceId) {
        handleWorkspaceSelect(nextWorkspace.id);
      }
    };

    rightColumn.addEventListener('wheel', handleColumnWheel, { passive: false });
    return () => {
      rightColumn.removeEventListener('wheel', handleColumnWheel);
    };
  }, [settings?.general?.scrollToChangeWorkspace, settings?.general?.scrollToChangeWorkspaceIncludeSpeedDial, settings?.general?.scrollToChangeWorkspaceIncludeWholeColumn, settings?.general?.scrollToChangeWorkspaceResistance, settings?.general?.scrollToChangeWorkspaceResistanceIntensity, workspaces, activeWorkspaceId]);

  // Detect and neutralize page zoom so geometry stays constant unplugged/plugged
  useEffect(() => {
    const handle = () => {
      try {
        const z =
          window.visualViewport &&
            typeof window.visualViewport.scale === "number"
            ? window.visualViewport.scale
            : 1;
        setUiScale(z && z > 0 ? 1 / z : 1);
      } catch {
        setUiScale(1);
      }
    };
    handle();
    window.visualViewport?.addEventListener("resize", handle);
    window.addEventListener("resize", handle);
    return () => {
      window.visualViewport?.removeEventListener("resize", handle);
      window.removeEventListener("resize", handle);
    };
  }, []);

  // Compute dial scale relative to baseline; never upscale above 1
  useEffect(() => {
    const compute = () => {
      try {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const s = Math.min(vw / BASELINE.width, vh / BASELINE.height, 1);
        setDialScale(Number.isFinite(s) && s > 0 ? s : 1);
      } catch {
        setDialScale(1);
      }
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
    };
  }, []);

  // Restore custom background from IndexedDB if needed
  useEffect(() => {
    let cancelled = false;
    const restoreBackground = async () => {
      const metaStr = localStorage.getItem("vivaldi-current-background-meta");
      // If no saved meta, use default background image
      if (!metaStr) {
        const defaultMeta = { type: "builtin", id: "default-bg", url: defaultBackground };
        setGlobalBackgroundMeta(defaultMeta);
        setCurrentBackground(defaultBackground);
        try {
          localStorage.setItem("vivaldi-current-background-meta", JSON.stringify(defaultMeta));
        } catch { }
        return;
      }
      try {
        const meta = JSON.parse(metaStr);
        if (meta?.type === "custom" && meta?.id) {
          try {
            const record = await getBackgroundRecordById(meta.id);
            if (!record || cancelled) {
              // If custom background doesn't exist, fall back to default background
              if (!cancelled) {
                const fallbackMeta = { type: "builtin", id: "default-bg", url: defaultBackground };
                setGlobalBackgroundMeta(fallbackMeta);
                setCurrentBackground(defaultBackground);
                try {
                  localStorage.setItem("vivaldi-current-background-meta", JSON.stringify(fallbackMeta));
                } catch { }
              }
              return;
            }
            const url = URL.createObjectURL(record.blob);
            if (
              globalBackgroundObjectUrlRef.current &&
              globalBackgroundObjectUrlRef.current !== url
            ) {
              try {
                URL.revokeObjectURL(globalBackgroundObjectUrlRef.current);
              } catch { }
            }
            globalBackgroundObjectUrlRef.current = url;
            // Ensure mime type is included in meta
            const enrichedMeta = { ...meta };
            if (record.type && !enrichedMeta.mime) {
              enrichedMeta.mime = record.type;
            }
            setGlobalBackgroundMeta(enrichedMeta);
            setCurrentBackground(url);
            // Update localStorage with enriched meta if mime was missing
            if (record.type && !meta.mime) {
              try {
                localStorage.setItem("vivaldi-current-background-meta", JSON.stringify(enrichedMeta));
              } catch { }
            }
          } catch {
            if (cancelled) return;
            // If custom background doesn't exist, fall back to default background
            const fallbackMeta = { type: "builtin", id: "default-bg", url: defaultBackground };
            setGlobalBackgroundMeta(fallbackMeta);
            setCurrentBackground(defaultBackground);
            try {
              localStorage.setItem("vivaldi-current-background-meta", JSON.stringify(fallbackMeta));
            } catch { }
          }
        } else if (meta?.url) {
          if (globalBackgroundObjectUrlRef.current) {
            try {
              URL.revokeObjectURL(globalBackgroundObjectUrlRef.current);
            } catch { }
            globalBackgroundObjectUrlRef.current = null;
          }
          setGlobalBackgroundMeta(meta);
          setCurrentBackground(meta.url);
        } else {
          setGlobalBackgroundMeta(null);
        }
      } catch {
        if (!cancelled) {
          setGlobalBackgroundMeta(null);
        }
      }
    };
    restoreBackground();
    return () => {
      cancelled = true;
    };
  }, []);

  // Background mode persistence
  useEffect(() => {
    const savedMode = localStorage.getItem("vivaldi-background-mode");
    if (savedMode) {
      setSettings((prev) => ({
        ...prev,
        background: { ...prev.background, mode: savedMode },
      }));
    }
    const savedZoom = localStorage.getItem("vivaldi-background-zoom");
    if (savedZoom) {
      const z = parseFloat(savedZoom);
      if (!Number.isNaN(z) && z > 0) {
        setSettings((prev) => ({
          ...prev,
          background: { ...prev.background, zoom: z },
        }));
      }
    }
  }, []);

  useEffect(() => {
    try {
      const value = settings.background?.followSlug ? "1" : "0";
      localStorage.setItem("vivaldi-background-follow-slug", value);
    } catch { }
  }, [settings.background?.followSlug]);

  useEffect(() => {
    try {
      const value = settings.background?.workspaceEnabled === false ? "0" : "1";
      localStorage.setItem("vivaldi-background-workspaces-enabled", value);
    } catch { }
  }, [settings.background?.workspaceEnabled]);

  useEffect(
    () => () => {
      if (globalBackgroundObjectUrlRef.current) {
        try {
          URL.revokeObjectURL(globalBackgroundObjectUrlRef.current);
        } catch { }
      }
      Object.values(workspaceBackgroundsRef.current).forEach((entry) => {
        if (entry?.meta?.type === "custom" && entry.src) {
          try {
            URL.revokeObjectURL(entry.src);
          } catch { }
        }
      });
    },
    [],
  );

  // Mode query param is no longer supported (experimental-only)

  const handleBackgroundModeChange = (mode) => {
    setSettings((prev) => ({
      ...prev,
      background: { ...prev.background, mode },
    }));
    localStorage.setItem("vivaldi-background-mode", mode);
  };

  // Persist background zoom when it changes
  useEffect(() => {
    const z = Number(settings.background?.zoom || 1);
    try {
      localStorage.setItem("vivaldi-background-zoom", String(z));
    } catch { }
  }, [settings.background?.zoom]);

  // Handle background changes from BackgroundManager
  const handleBackgroundChange = useCallback(
    (newBackground, meta) => {
      if (!newBackground) return;
      if (
        globalBackgroundMeta?.type === "custom" &&
        globalBackgroundObjectUrlRef.current &&
        globalBackgroundObjectUrlRef.current !== newBackground
      ) {
        try {
          URL.revokeObjectURL(globalBackgroundObjectUrlRef.current);
        } catch { }
        globalBackgroundObjectUrlRef.current = null;
      }

      if (meta?.type === "custom") {
        globalBackgroundObjectUrlRef.current = newBackground;
      } else if (
        globalBackgroundMeta?.type === "custom" &&
        globalBackgroundObjectUrlRef.current
      ) {
        try {
          URL.revokeObjectURL(globalBackgroundObjectUrlRef.current);
        } catch { }
        globalBackgroundObjectUrlRef.current = null;
      }

      setCurrentBackground(newBackground);
      setGlobalBackgroundMeta(meta || null);

      try {
        localStorage.setItem("vivaldi-current-background", newBackground);
      } catch { }

      try {
        if (meta) {
          localStorage.setItem(
            "vivaldi-current-background-meta",
            JSON.stringify(meta),
          );
        } else {
          localStorage.removeItem("vivaldi-current-background-meta");
        }
      } catch { }
    },
    [globalBackgroundMeta],
  );

  // Export / Import full configuration (settings, workspaces, layouts, themes, widgets, backgrounds, fonts, shortcuts)
  useEffect(() => {
    const encodeBackgroundMeta = async (meta) => {
      if (
        !meta ||
        String(meta.type || "").toLowerCase() !== "custom" ||
        !meta.id
      )
        return null;
      try {
        const url = await getBackgroundURLById(meta.id);
        if (!url) return null;
        const res = await fetch(url);
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(blob);
        });
        try {
          URL.revokeObjectURL(url);
        } catch { }
        return {
          id: meta.id,
          name: meta.name || `background-${meta.id}`,
          type: blob.type || "image/*",
          size: blob.size,
          dataUrl,
        };
      } catch (err) {
        console.error("Failed to encode background for export", err);
        return null;
      }
    };

    const handleExportConfig = async () => {
      try {
        const backgroundFiles = {};
        const workspaceBackgroundMeta = {};

        Object.entries(
          workspaceBackgroundsRef.current || workspaceBackgrounds || {},
        ).forEach(([id, entry]) => {
          if (entry?.meta) {
            workspaceBackgroundMeta[id] = entry.meta;
          }
        });

        const collectMetaList = [];
        Object.values(workspaceBackgroundMeta).forEach((meta) => {
          if (meta && meta.type === "custom" && meta.id) {
            const key = `custom:${meta.id}`;
            if (!backgroundFiles[key]) collectMetaList.push({ key, meta });
          }
        });
        if (
          globalBackgroundMeta &&
          globalBackgroundMeta.type === "custom" &&
          globalBackgroundMeta.id
        ) {
          const key = `custom:${globalBackgroundMeta.id}`;
          if (!backgroundFiles[key])
            collectMetaList.push({ key, meta: globalBackgroundMeta });
        }

        for (const { key, meta } of collectMetaList) {
          const encoded = await encodeBackgroundMeta(meta);
          if (encoded && encoded.dataUrl) {
            backgroundFiles[key] = encoded;
          }
        }

        const payload = {
          app: "VSTART",
          version: 1,
          exportedAt: new Date().toISOString(),
          settings,
          workspaces,
          speedDials,
          activeWorkspaceId,
          lastHardWorkspaceId,
          workspaceBackgroundMeta,
          globalBackgroundMeta,
          backgroundFiles,
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `vstart-config-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch { }
        }, 5000);
        alert("VSTART configuration exported successfully.");
      } catch (err) {
        console.error("Export failed", err);
        alert("Failed to export configuration. See console for details.");
      }
    };

    const handleImportConfig = async (event) => {
      const data = event?.detail;
      try {
        if (!data || typeof data !== "object") {
          throw new Error("Invalid configuration format.");
        }
        if (data.app !== "VSTART") {
          throw new Error("This file does not appear to be a VSTART backup.");
        }
        if (typeof data.version !== "number" || data.version < 1) {
          throw new Error("Unsupported configuration version.");
        }
        if (!data.settings || typeof data.settings !== "object") {
          throw new Error("Missing settings section.");
        }
        if (!Array.isArray(data.workspaces)) {
          throw new Error("Missing workspaces section.");
        }
        if (!data.speedDials || typeof data.speedDials !== "object") {
          throw new Error("Missing speed dial section.");
        }

        const nextSettings = data.settings;
        const nextWorkspaces = data.workspaces;
        const nextSpeedDials = data.speedDials;
        nextSettings.appearanceWorkspaces = normalizeAppearanceWorkspaceState(
          nextSettings.appearanceWorkspaces,
        );
        
        // Clean up appearance workspace state: if disabled, clear all overrides
        // Global appearance settings take precedence when appearance workspaces are disabled
        const normalizedAws = nextSettings.appearanceWorkspaces;
        if (!normalizedAws.enabled) {
          // Clear all overrides when appearance workspaces are disabled
          normalizedAws.overrides = {};
        }
        const nextActiveId =
          data.activeWorkspaceId ||
          (Array.isArray(nextWorkspaces) && nextWorkspaces[0]?.id) ||
          "ws-1";
        const nextLastHardId = data.lastHardWorkspaceId || null;
        const importedWorkspaceBgMeta = data.workspaceBackgroundMeta || {};
        const importedGlobalBgMeta = data.globalBackgroundMeta || null;
        const importedFiles = data.backgroundFiles || {};

        const bgIdMap = {};
        for (const [key, fileInfo] of Object.entries(importedFiles)) {
          if (!fileInfo || typeof fileInfo !== "object" || !fileInfo.dataUrl)
            continue;
          try {
            const res = await fetch(fileInfo.dataUrl);
            const blob = await res.blob();
            const name = fileInfo.name || "background";
            const file = new File([blob], name, {
              type: fileInfo.type || blob.type || "image/*",
            });
            const record = await saveBackgroundFile(file);
            if (record?.id) {
              bgIdMap[key] = record.id;
            }
          } catch (err) {
            console.error("Failed to restore background from export", err);
          }
        }

        const remapBackgroundMeta = (meta) => {
          if (!meta || typeof meta !== "object") return meta;
          if (meta.type === "custom" && meta.id) {
            const key = `custom:${meta.id}`;
            const newId = bgIdMap[key];
            if (newId) {
              return { ...meta, id: newId };
            }
          }
          return meta;
        };

        const remappedWorkspaceBgMeta = {};
        Object.entries(importedWorkspaceBgMeta).forEach(([id, meta]) => {
          remappedWorkspaceBgMeta[id] = remapBackgroundMeta(meta);
        });
        const remappedGlobalBgMeta = remapBackgroundMeta(importedGlobalBgMeta);

        setSettings(nextSettings);
        setWorkspaces(nextWorkspaces);
        setSpeedDials(nextSpeedDials);
        setActiveWorkspaceId(nextActiveId);
        setLastHardWorkspaceId(nextLastHardId);

        Object.entries(remappedWorkspaceBgMeta).forEach(([id, meta]) => {
          if (meta) {
            setWorkspaceBackgroundMeta(id, meta).catch(() => { });
          } else {
            setWorkspaceBackgroundMeta(id, null).catch(() => { });
          }
        });

        if (remappedGlobalBgMeta) {
          if (
            remappedGlobalBgMeta.type === "custom" &&
            remappedGlobalBgMeta.id
          ) {
            try {
              const url = await getBackgroundURLById(remappedGlobalBgMeta.id);
              if (url) {
                handleBackgroundChange(url, remappedGlobalBgMeta);
              } else {
                handleBackgroundChange(themeGif2, null);
              }
            } catch {
              handleBackgroundChange(themeGif2, null);
            }
          } else if (remappedGlobalBgMeta.url) {
            handleBackgroundChange(
              remappedGlobalBgMeta.url,
              remappedGlobalBgMeta,
            );
          } else {
            handleBackgroundChange(themeGif2, null);
          }
        }

        alert(
          "VSTART configuration imported successfully. Some changes may require a reload.",
        );
      } catch (err) {
        console.error("Import failed", err);
        alert(
          err?.message
            ? `Failed to import configuration: ${err.message}`
            : "Failed to import configuration.",
        );
      }
    };

    const exportListener = () => {
      handleExportConfig();
    };
    window.addEventListener("vstart-export-config", exportListener);
    window.addEventListener("vstart-import-config", handleImportConfig);
    return () => {
      window.removeEventListener("vstart-export-config", exportListener);
      window.removeEventListener("vstart-import-config", handleImportConfig);
    };
  }, [
    settings,
    workspaces,
    speedDials,
    activeWorkspaceId,
    lastHardWorkspaceId,
    workspaceBackgrounds,
    globalBackgroundMeta,
    handleBackgroundChange,
    setWorkspaceBackgroundMeta,
  ]);

  const handleWorkspaceBackgroundChange = useCallback(
    (workspaceId, url, meta) => {
      if (workspaceId === null) {
        // Master Override: update all workspaces
        workspaces.forEach((ws) => {
          setWorkspaceBackgroundMeta(ws.id, meta, url).catch(() => { });
        });
        // Also update global background
        handleBackgroundChange(url, meta);
      } else if (workspaceId) {
        setWorkspaceBackgroundMeta(workspaceId, meta, url).catch(() => { });
      }
    },
    [setWorkspaceBackgroundMeta, workspaces, handleBackgroundChange],
  );

  const handleDefaultWorkspaceBackgroundChange = useCallback(
    (url, meta) => {
      // For default/anchored workspace, use the anchored workspace ID if it exists,
      // otherwise use the DEFAULT_APPEARANCE_WORKSPACE_ID constant
      const anchoredWorkspaceId = settings?.speedDial?.anchoredWorkspaceId || null;
      const defaultWorkspaceId = anchoredWorkspaceId || DEFAULT_APPEARANCE_WORKSPACE_ID;
      setWorkspaceBackgroundMeta(defaultWorkspaceId, meta, url).catch(() => { });
    },
    [setWorkspaceBackgroundMeta, settings?.speedDial?.anchoredWorkspaceId],
  );

  const handleToggleBackgroundFollowSlug = useCallback((value) => {
    setSettings((prev) => ({
      ...prev,
      background: { ...prev.background, followSlug: !!value },
    }));
  }, []);

  const handleToggleWorkspaceBackgroundsEnabled = useCallback((value) => {
    setSettings((prev) => ({
      ...prev,
      background: { ...prev.background, workspaceEnabled: !!value },
    }));
  }, []);

  const handleToggleWorkspaceTheming = useCallback((enabled) => {
    setWorkspaceThemingEnabled(enabled);
    // When disabling, reset selection to Master Override
    if (!enabled) {
      setWorkspaceThemingSelectedId(null);
    } else if (workspaceThemingSelectedId === null && activeWorkspaceId) {
      // When enabling, select active workspace if available
      setWorkspaceThemingSelectedId(activeWorkspaceId);
    }
  }, [activeWorkspaceId, workspaceThemingSelectedId]);
  
  const handleSelectWorkspaceTheming = useCallback((workspaceId) => {
    setWorkspaceThemingSelectedId(workspaceId);
  }, []);
  
  const handleToggleWorkspaceWidgets = useCallback((enabled) => {
    setWorkspaceWidgetsEnabled(enabled);
    // When disabling, reset selection to Master Override
    if (!enabled) {
      setWorkspaceWidgetsSelectedId(null);
    } else if (workspaceWidgetsSelectedId === null && activeWorkspaceId) {
      // When enabling, select active workspace if available
      setWorkspaceWidgetsSelectedId(activeWorkspaceId);
    }
  }, [activeWorkspaceId, workspaceWidgetsSelectedId]);
  
  const handleSelectWorkspaceWidgets = useCallback((workspaceId) => {
    setWorkspaceWidgetsSelectedId(workspaceId);
  }, []);

  const handleSelectAppearanceWorkspace = useCallback(
    (workspaceId) => {
      const targetId = resolveAppearanceWorkspaceTargetId(
        appearanceWorkspacesState,
        workspaceId,
        anchoredWorkspaceId,
      );
      const workspaceExists = workspaces.some((ws) => ws.id === targetId);
      const previewTargetId =
        targetId === MASTER_APPEARANCE_ID
          ? null
          : workspaceExists
            ? targetId
            : anchoredWorkspaceId || activeWorkspaceId;
      if (previewTargetId) {
        try {
          workspaceSwitchingManager.switchWorkspace(
            previewTargetId,
            "soft",
          );
        } catch { }
        setLastAppearancePreviewId(previewTargetId);
      }
      setSettings((prev) => {
        const state = normalizeAppearanceWorkspaceState(
          prev.appearanceWorkspaces,
        );
        return {
          ...prev,
          appearanceWorkspaces: { ...state, lastSelectedId: targetId },
        };
      });
      appearanceApplyAllChoiceRef.current = null;
    },
    [
      appearanceWorkspacesState,
      anchoredWorkspaceId,
      workspaces,
      activeWorkspaceId,
      workspaceSwitchingManager,
    ],
  );

  const handleToggleAppearanceWorkspaces = useCallback(
    (enabled) => {
      setSettings((prev) => {
        const state = normalizeAppearanceWorkspaceState(
          prev.appearanceWorkspaces,
        );
        const anchorId = prev.speedDial?.anchoredWorkspaceId || null;
        const nextOverrides = { ...(state.overrides || {}) };
        
        if (enabled) {
          // When enabling workspace appearance, if no master override exists, use current appearance as master override
          if (!nextOverrides[MASTER_APPEARANCE_ID]) {
            nextOverrides[MASTER_APPEARANCE_ID] = prev.appearance || {};
          }
        } else {
          // When disabling workspace appearance, master override becomes the main profile (base appearance)
          const masterOverride = nextOverrides[MASTER_APPEARANCE_ID];
          if (masterOverride) {
            return {
              ...prev,
              appearance: masterOverride,
              appearanceWorkspaces: {
                ...state,
                enabled: false,
                overrides: nextOverrides,
                lastSelectedId: MASTER_APPEARANCE_ID,
              },
            };
          }
        }
        
        // Ensure we always have a valid initial target
        const initialTarget = enabled 
          ? (state.lastSelectedId || MASTER_APPEARANCE_ID)
          : MASTER_APPEARANCE_ID;
        const targetId = resolveAppearanceWorkspaceTargetId(
          { ...state, enabled: !!enabled },
          initialTarget,
          anchorId,
        ) || MASTER_APPEARANCE_ID;
        if (enabled) {
          setLastAppearancePreviewId(
            selectedWorkspaceId || activeWorkspaceId,
          );
        } else {
          setLastAppearancePreviewId(null);
        }
        return {
          ...prev,
          appearanceWorkspaces: {
            ...state,
            enabled: !!enabled,
            overrides: nextOverrides,
            lastSelectedId: targetId,
          },
        };
      });
      if (!enabled) {
        appearanceApplyAllChoiceRef.current = null;
      }
    },
    [selectedWorkspaceId, activeWorkspaceId],
  );

  const handleSettingsVisibilityChange = useCallback(
    (open) => {
      setSettingsOpen(open);
      if (open) {
        setLastAppearancePreviewId(activeWorkspaceId);
        return;
      }
      if (lastAppearancePreviewId) {
        workspaceSwitchingManager.switchWorkspace(
          lastAppearancePreviewId,
          "hard",
        );
        setLastAppearancePreviewId(null);
      }
    },
    [activeWorkspaceId, lastAppearancePreviewId, workspaceSwitchingManager],
  );

  const updateAppearanceForWorkspace = useCallback(
    (workspaceId, mutator) => {
      if (typeof mutator !== "function") return;
      setSettings((prev) => {
        const state = normalizeAppearanceWorkspaceState(
          prev.appearanceWorkspaces,
        );
        const anchorId = prev.speedDial?.anchoredWorkspaceId || null;
        // Ensure we always have a valid workspaceId or fallback
        const validWorkspaceId = workspaceId || state.lastSelectedId || MASTER_APPEARANCE_ID;
        const targetId = resolveAppearanceWorkspaceTargetId(
          state,
          validWorkspaceId,
          anchorId,
        );
        const baseAppearance = prev.appearance || {};
        const overrides = state.overrides || {};
        const isMasterTarget = targetId === MASTER_APPEARANCE_ID;
        const useOverride = state.enabled && !isMasterTarget;

        // When appearance workspaces are disabled, use master override (or base if no master override exists)
        let currentAppearance;
        let parentLayer;
        if (!state.enabled) {
          // When disabled, master override IS the main profile
          const masterOverride = overrides[MASTER_APPEARANCE_ID];
          currentAppearance = masterOverride || baseAppearance;
        } else {
          // Determine Parent Layer (what we inherit from)
          const masterOverride = overrides[MASTER_APPEARANCE_ID];
          // If editing Master, parent is Base. If editing Workspace, parent is Base+Master.
          parentLayer = isMasterTarget
            ? baseAppearance
            : (masterOverride ? deepMergeAppearance(baseAppearance, masterOverride) : baseAppearance);

          // Determine Current Resolved State (what we see)
          // If editing Master, current is Master (or Base).
          // If editing Workspace, current is Parent + WorkspaceOverride.
          currentAppearance = isMasterTarget
            ? (masterOverride || baseAppearance)
            : (overrides[targetId] ? deepMergeAppearance(parentLayer, overrides[targetId]) : parentLayer);
        }

        const nextAppearance = mutator(currentAppearance) || currentAppearance;

        // When appearance workspaces are disabled, update master override (which is the main profile)
        if (!state.enabled) {
          const finalAppearance = nextAppearance;
          const nextOverrides = { ...overrides };
          // Store the appearance in master override when disabled
          nextOverrides[MASTER_APPEARANCE_ID] = finalAppearance;
          return {
            ...prev,
            appearance: finalAppearance, // Also update base for backward compatibility
            appearanceWorkspaces: {
              ...state,
              overrides: nextOverrides,
              lastSelectedId: workspaceId || targetId,
            },
          };
        }

        // When editing master override, ensure we merge with base to preserve all properties
        const finalAppearance = isMasterTarget && nextAppearance !== currentAppearance
          ? { ...baseAppearance, ...nextAppearance }
          : nextAppearance;

        const nextState = {
          ...state,
          lastSelectedId: workspaceId || targetId,
        };

        if (
          finalAppearance === currentAppearance &&
          nextState.lastSelectedId === state.lastSelectedId &&
          nextState.enabled === state.enabled
        ) {
          return prev;
        }

        if (isMasterTarget) {
          // Calculate what changed in Master
          const delta = getAppearanceDiff(currentAppearance, finalAppearance);

          // Clean up other overrides to ensure Master change propagates ("sync")
          const nextOverrides = { ...overrides };
          Object.keys(nextOverrides).forEach(key => {
            if (key !== MASTER_APPEARANCE_ID) {
              nextOverrides[key] = deepRemoveKeys(nextOverrides[key], delta);
              if (Object.keys(nextOverrides[key]).length === 0) {
                delete nextOverrides[key];
              }
            }
          });

          return {
            ...prev,
            appearanceWorkspaces: {
              ...nextState,
              overrides: {
                ...nextOverrides,
                [MASTER_APPEARANCE_ID]: finalAppearance,
              },
            },
          };
        }

        if (useOverride) {
          // Calculate Diff
          const delta = getAppearanceDiff(parentLayer, nextAppearance);
          return {
            ...prev,
            appearanceWorkspaces: {
              ...nextState,
              overrides: { ...overrides, [targetId]: delta },
            },
          };
        }

        return {
          ...prev,
          appearance: finalAppearance,
          appearanceWorkspaces: nextState,
        };
      });
    },
    [workspaces],
  );

  useEffect(() => {
    appearanceApplyAllChoiceRef.current = null;
  }, [appearanceWorkspacesState.lastSelectedId, appearanceWorkspacesEnabled]);

  const applyAppearanceEdit = useCallback(
    (mutator) => {
      // Ensure we always have a valid target ID before calling updateAppearanceForWorkspace
      const targetId = appearanceEditingTargetId || MASTER_APPEARANCE_ID;
      updateAppearanceForWorkspace(targetId, mutator);
    },
    [updateAppearanceForWorkspace, appearanceEditingTargetId],
  );
  useEffect(() => {
    applyAppearanceEditRef.current = applyAppearanceEdit;
  }, [applyAppearanceEdit]);

  // Workspace Widgets editing target ID (which workspace profile is being edited)
  const workspaceWidgetsEditingTargetId = useMemo(
    () => {
      const state = workspaceWidgetsState || { enabled: false, lastSelectedId: MASTER_WIDGETS_ID };
      const targetId = resolveWorkspaceWidgetsTargetId(
        state,
        workspaceWidgetsSelectedId || MASTER_WIDGETS_ID,
      );
      return targetId;
    },
    [workspaceWidgetsState, workspaceWidgetsSelectedId],
  );

  // Workspace Widgets runtime target ID (which workspace profile is active)
  const workspaceWidgetsRuntimeTargetId = useMemo(
    () => {
      // When workspace widgets are disabled, always use master to ensure
      // all workspaces use the same widgets profile
      if (!workspaceWidgetsEnabled) {
        return MASTER_WIDGETS_ID;
      }
      return resolveWorkspaceWidgetsTargetId(
        workspaceWidgetsState,
        selectedWorkspaceId,
      );
    },
    [workspaceWidgetsEnabled, workspaceWidgetsState, selectedWorkspaceId],
  );

  // Active widgets profile (resolved for current workspace - runtime)
  const activeWidgetsProfile = useMemo(
    () =>
      resolveWorkspaceWidgetsProfile(
        settings.widgets,
        workspaceWidgetsState,
        workspaceWidgetsRuntimeTargetId,
      ),
    [
      settings.widgets,
      workspaceWidgetsState,
      workspaceWidgetsRuntimeTargetId,
    ],
  );

  // Editing widgets profile (resolved for editing target - for settings UI)
  const editingWidgetsProfile = useMemo(
    () =>
      resolveWorkspaceWidgetsProfile(
        settings.widgets,
        workspaceWidgetsState,
        workspaceWidgetsEditingTargetId,
      ),
    [
      settings.widgets,
      workspaceWidgetsState,
      workspaceWidgetsEditingTargetId,
    ],
  );

  // Update widgets for a specific workspace (similar to updateAppearanceForWorkspace)
  const updateWidgetsForWorkspace = useCallback(
    (workspaceId, mutator) => {
      if (typeof mutator !== "function") return;
      setSettings((prev) => {
        const state = normalizeWorkspaceWidgetsState(
          prev.workspaceWidgets,
        );
        const validWorkspaceId = workspaceId || state.lastSelectedId || MASTER_WIDGETS_ID;
        const targetId = resolveWorkspaceWidgetsTargetId(
          state,
          validWorkspaceId,
        );
        const isMasterTarget = targetId === MASTER_WIDGETS_ID;
        const baseWidgets = prev.widgets || {};
        const overrides = state.overrides || {};
        const masterOverride = overrides[MASTER_WIDGETS_ID] || null;
        const workspaceOverride = overrides[targetId] || null;
        
        // Build parent layer (base + master override)
        const parentLayer = masterOverride
          ? { ...baseWidgets, ...masterOverride }
          : baseWidgets;
        
        // Build current widgets for this workspace
        const currentWidgets = workspaceOverride
          ? { ...parentLayer, ...workspaceOverride }
          : parentLayer;
        
        // Apply mutator
        const nextWidgets = mutator(currentWidgets);
        if (!nextWidgets || typeof nextWidgets !== "object") {
          return prev;
        }

        const nextState = {
          ...state,
          lastSelectedId: targetId,
        };

        if (isMasterTarget) {
          // Master override: store full profile
          return {
            ...prev,
            workspaceWidgets: {
              ...nextState,
              overrides: {
                ...overrides,
                [MASTER_WIDGETS_ID]: nextWidgets,
              },
            },
          };
        }

        // Workspace override: store diff from parent
        // Check all keys in nextWidgets and all keys currently in workspaceOverride
        const allKeys = new Set([
          ...Object.keys(nextWidgets),
          ...(workspaceOverride ? Object.keys(workspaceOverride) : [])
        ]);
        
        const delta = {};
        allKeys.forEach(key => {
          const nextValue = nextWidgets[key];
          const parentValue = parentLayer[key];
          
          // Handle undefined/missing keys - if key is missing in parent, it's undefined
          const nextHasKey = key in nextWidgets;
          const parentHasKey = key in parentLayer;
          
          // Special handling for boolean widget enable flags:
          // - undefined in parent means "enabled by default" (treated as true)
          // - false in workspace means "explicitly disabled"
          // - true in workspace when parent is undefined means "matches default" (no override needed)
          const isWidgetEnableFlag = key === 'enableClock' || key === 'enableWeather' || 
                                     key === 'enableMusicPlayer' || key === 'enableNotes' || 
                                     key === 'enableEmail';
          
          let isDifferent = false;
          
          if (isWidgetEnableFlag) {
            // For widget enable flags, always store the explicit value when in a workspace profile
            // This ensures workspace-specific toggles are saved even if they match the parent default
            // Only skip storing if we're in master override and it matches base
            if (isMasterTarget) {
              // In master: only store if different from base
              const parentEffectiveValue = parentHasKey ? parentValue : true;
              const nextEffectiveValue = nextHasKey ? nextValue : true;
              isDifferent = parentEffectiveValue !== nextEffectiveValue;
            } else {
              // In workspace profile: always store explicit value to ensure workspace-specific setting
              isDifferent = true;
            }
          } else {
            // For other properties, use standard comparison
            isDifferent = (nextHasKey !== parentHasKey) || 
              (nextHasKey && parentHasKey && JSON.stringify(nextValue) !== JSON.stringify(parentValue));
          }
          
          if (isDifferent) {
            // Value differs from parent - include in override
            delta[key] = nextValue;
          }
          // If value matches parent, don't include it (removes from override if it was there)
        });

        // If delta is empty, remove the workspace override entirely
        const nextOverrides = { ...overrides };
        if (Object.keys(delta).length === 0) {
          delete nextOverrides[targetId];
        } else {
          nextOverrides[targetId] = delta;
        }

        return {
          ...prev,
          workspaceWidgets: {
            ...nextState,
            overrides: nextOverrides,
          },
        };
      });
    },
    [],
  );

  // Apply widgets edit to current editing target
  const applyWidgetsEdit = useCallback(
    (mutator) => {
      const targetId = workspaceWidgetsEditingTargetId || MASTER_WIDGETS_ID;
      updateWidgetsForWorkspace(targetId, mutator);
    },
    [updateWidgetsForWorkspace, workspaceWidgetsEditingTargetId],
  );
  
  // Create ref for applyWidgetsEdit early so handlers can use it
  const applyWidgetsEditRef = useRef(null);
  useEffect(() => {
    applyWidgetsEditRef.current = applyWidgetsEdit;
  }, [applyWidgetsEdit]);

  const appearanceWorkspaceOptions = useMemo(() => {
    const items = [
      { id: MASTER_APPEARANCE_ID, label: "Master Override", anchored: false },
    ];
    workspaces.forEach((ws) => {
      items.push({
        id: ws.id,
        label: ws.name || "Workspace",
        anchored: false,
      });
    });
    return items;
  }, [workspaces]);

  // Apply theme styles to CSS custom properties for real-time updates (batched)
  useEffect(() => {
    if (!mounted) return;

    // Collect all CSS properties to apply in a single batch
    const cssProperties = new Map();

    // Font family from presets or workspace override
    cssProperties.set("--font-family", globalFontFamily);

    const fallbackPrimary = stripAlphaFromHex(
      settings.theme.colors.primary || "#ffffff",
    );
    const manualRgb = hexToRgb(globalPrimaryColor) ||
      hexToRgb(fallbackPrimary) || { r: 255, g: 255, b: 255 };

    // Text color
    const normalized = stripAlphaFromHex(globalPrimaryColor || fallbackPrimary);
    const rgb = hexToRgb(normalized) || manualRgb;
    cssProperties.set("--color-primary", normalized);
    cssProperties.set("--text-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);

    // Accent color
    cssProperties.set("--color-accent", globalAccentColor);

    // Secondary color
    cssProperties.set(
      "--color-secondary",
      settings.theme.colors.secondary,
    );

    // Transparency values
    cssProperties.set(
      "--transparency-global",
      String(settings.theme.transparency ?? 0.1),
    );
    cssProperties.set(
      "--transparency-speed-dial",
      String(settings.speedDial.transparency ?? 0.1),
    );

    // Glass effect
    cssProperties.set(
      "--glass-blur",
      settings.theme.glassEffect ? "16px" : "0px",
    );
    cssProperties.set(
      "--glass-border",
      settings.theme.borders ? "1px solid rgba(255, 255, 255, 0.2)" : "none",
    );

    // Border style
    cssProperties.set(
      "--border-radius",
      settings.theme.borderStyle === "rounded" ? "16px" : "4px",
    );

    // Batch apply all properties in a single requestAnimationFrame
    requestAnimationFrame(() => {
      const root = document.documentElement;
      cssProperties.forEach((value, property) => {
        root.style.setProperty(property, value);
      });
    });
  }, [
    settings.theme,
    settings.speedDial.transparency,
    settings.speedDial.workspaceTextColors,
    settings.speedDial.workspaceGlowColors,
    settings.speedDial.workspaceTextFonts,
    activeAppearance?.fontPreset,
    activeAppearance?.matchWorkspaceTextColor,
    activeAppearance?.matchWorkspaceAccentColor,
    activeAppearance?.matchWorkspaceFonts,
    globalFontFamily,
    globalPrimaryColor,
    globalAccentColor,
    normalizedWorkspaceTextColor,
    activeWorkspaceId,
    mounted,
    activeAppearance,
  ]);

  function stripAlphaFromHex(hex) {
    try {
      if (!hex || typeof hex !== "string") return "#ffffff";
      const clean = hex.trim();
      if (clean.startsWith("#")) {
        const withoutHash = clean.slice(1);
        if (withoutHash.length >= 6) {
          return "#" + withoutHash.slice(0, 6);
        }
      }
      return hex;
    } catch {
      return "#ffffff";
    }
  }

  function hexToRgb(hex) {
    try {
      let c = String(hex || "").trim();
      if (!c) return null;
      if (c.startsWith("#")) c = c.slice(1);
      if (c.length === 3) {
        const r = parseInt(c[0] + c[0], 16);
        const g = parseInt(c[1] + c[1], 16);
        const b = parseInt(c[2] + c[2], 16);
        return { r, g, b };
      }
      if (c.length === 4) {
        const r = parseInt(c[0] + c[0], 16);
        const g = parseInt(c[1] + c[1], 16);
        const b = parseInt(c[2] + c[2], 16);
        return { r, g, b };
      }
      if (c.length === 6 || c.length === 8) {
        const r = parseInt(c.slice(0, 2), 16);
        const g = parseInt(c.slice(2, 4), 16);
        const b = parseInt(c.slice(4, 6), 16);
        return { r, g, b };
      }
      return null;
    } catch {
      return null;
    }
  }

  function deriveNoteTitle(raw, fallback = "Untitled note") {
    try {
      const source = String(raw || "").trim();
      if (!source) return fallback;
      const line = source.split(/\r?\n/).find((l) => !!l.trim()) || source;
      const trimmed = line.trim();
      if (!trimmed) return fallback;
      return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
    } catch {
      return fallback;
    }
  }

  // Resolve widget theme tokens with full workspace conformance
  const widgetThemeTokens = useMemo(() => {
    return themeTokenResolver.resolveWidgetTokens(selectedWorkspaceId);
  }, [themeTokenResolver, selectedWorkspaceId]);

  // Use workspace-specific widget settings when workspace widgets are enabled
  const effectiveWidgetsSettings = workspaceWidgetsEnabled
    ? activeWidgetsProfile
    : (settings.widgets || {});
  
  const legacyLayoutPreset = effectiveWidgetsSettings?.layoutPreset || "preset1";
  const clockPreset = effectiveWidgetsSettings?.clockPreset || legacyLayoutPreset;
  const weatherPreset = effectiveWidgetsSettings?.weatherPreset || legacyLayoutPreset;

  const rawMirror = !!activeAppearance?.mirrorLayout;
  const isMirrorLayout = rawMirror;

  const baseWidgetSettings = {
    ...effectiveWidgetsSettings,
    colorPrimary: widgetThemeTokens.textColor,
    colorAccent: widgetThemeTokens.accentColor,
    resolvedFontFamily: widgetThemeTokens.fontFamily,
    isMirrorLayout,
    verticalOffset: Number(effectiveWidgetsSettings?.verticalOffset ?? 0),
  };

  const resolvedClockSettings = {
    ...baseWidgetSettings,
    layoutPreset: clockPreset,
    showSeconds: effectiveWidgetsSettings?.showSeconds !== false,
    twentyFourHour: effectiveWidgetsSettings?.twentyFourHour !== false,
    subTimezones: effectiveWidgetsSettings?.subTimezones || [],
  };

  const resolvedWeatherSettings = {
    ...baseWidgetSettings,
    layoutPreset: weatherPreset,
    showDetailsOnHover:
      effectiveWidgetsSettings?.weatherShowDetailsOnHover !== undefined
        ? effectiveWidgetsSettings.weatherShowDetailsOnHover
        : true,
    units: effectiveWidgetsSettings?.units || 'metric',
  };
  // Resolve glow color for glow shadows based on current workspace
  // Anchored workspace uses default glow; other workspaces use their specific glow color
  const resolvedGlowColorForShadows = useMemo(() => {
    // If workspace theming is disabled, always use master override glow color
    if (!workspaceThemingEnabled) {
      return settings?.speedDial?.glowColor || '#00ffff66';
    }
    
    const anchoredWorkspaceId = settings?.speedDial?.anchoredWorkspaceId || null;
    const workspaceId = selectedWorkspaceId || activeWorkspaceId;
    
    // If no workspace or it's the anchored workspace, use default glow
    if (!workspaceId || (anchoredWorkspaceId && workspaceId === anchoredWorkspaceId)) {
      return settings?.speedDial?.glowColor || '#00ffff66';
    }
    
    // Otherwise, use workspace-specific glow color if available, otherwise default
    const workspaceGlowColors = settings?.speedDial?.workspaceGlowColors || {};
    return workspaceGlowColors[workspaceId] || settings?.speedDial?.glowColor || '#00ffff66';
  }, [selectedWorkspaceId, activeWorkspaceId, workspaceThemingEnabled, settings?.speedDial?.glowColor, settings?.speedDial?.workspaceGlowColors, settings?.speedDial?.anchoredWorkspaceId]);

  const resolvedNotesSettings = {
    ...baseWidgetSettings,
    autoExpandOnHover: !!settings?.widgets?.notesAutoExpandOnHover,
    glowColor: resolvedGlowColorForShadows,
  };
  const notesEntries = Array.isArray(settings?.widgets?.notesEntries)
    ? settings.widgets.notesEntries
    : [];
  const activeNoteId =
    settings?.widgets?.notesActiveId ||
    (notesEntries.length ? notesEntries[0].id : null);
  const activeNote =
    notesEntries.find((n) => n.id === activeNoteId) || notesEntries[0] || null;
  const notesFilterMode = settings?.widgets?.notesFilterMode || "all";
  const notesFilterWorkspaceId =
    settings?.widgets?.notesFilterWorkspaceId || null;
  const emailCenterFilterMode = settings?.widgets?.emailCenterFilterMode || "all";
  const emailCenterFilterWorkspaceId =
    settings?.widgets?.emailCenterFilterWorkspaceId || null;
  const showWorkspaceEmailListInsteadOfNotes = settings?.widgets?.showWorkspaceEmailListInsteadOfNotes || false;
  const resolvedWorkspaceForFilter = useMemo(() => {
    return (
      activeWorkspaceId ||
      lastHardWorkspaceId ||
      (workspaces && workspaces.length ? workspaces[0].id : null)
    );
  }, [activeWorkspaceId, lastHardWorkspaceId, workspaces]);
  const filteredNotesEntries = useMemo(() => {
    if (!Array.isArray(notesEntries) || !notesEntries.length) return [];

    let filtered = [];
    if (notesFilterMode === "perWorkspace") {
      if (!resolvedWorkspaceForFilter) filtered = notesEntries;
      else {
        const folder = getWorkspaceFolderName(
          resolvedWorkspaceForFilter,
          workspaces,
        );
        if (folder) {
          filtered = notesEntries.filter(
            (note) => (note.folder || "") === folder,
          );
        } else {
          filtered = notesEntries.filter(
            (note) => (note.workspaceId || null) === resolvedWorkspaceForFilter,
          );
        }
      }
    } else if (notesFilterMode === "manual") {
      if (!notesFilterWorkspaceId) filtered = notesEntries;
      else {
        const folder = getWorkspaceFolderName(
          notesFilterWorkspaceId,
          workspaces,
        );
        if (folder) {
          filtered = notesEntries.filter(
            (note) => (note.folder || "") === folder,
          );
        } else {
          filtered = notesEntries.filter(
            (note) => (note.workspaceId || null) === notesFilterWorkspaceId,
          );
        }
      }
    } else if (notesFilterMode === "none") {
      filtered = notesEntries.filter(
        (note) =>
          !note.workspaceId &&
          (note.folder || "") === "unassigned",
      );
    } else {
      // "all" – whole vault
      filtered = notesEntries;
    }

    // Sort: pinned notes first, then by updatedAt (most recent first)
    return filtered.sort((a, b) => {
      const aPinned = !!a.pinned;
      const bPinned = !!b.pinned;
      if (aPinned !== bPinned) {
        return aPinned ? -1 : 1;
      }
      const aTime = a.updatedAt || a.createdAt || 0;
      const bTime = b.updatedAt || b.createdAt || 0;
      return bTime - aTime;
    });
  }, [
    notesEntries,
    notesFilterMode,
    notesFilterWorkspaceId,
    resolvedWorkspaceForFilter,
    workspaces,
  ]);
  const editingNoteId = notesCenterNoteId || (notesInlineEditing ? activeNoteId : null);
  const editingNote =
    notesEntries.find((note) => note.id === editingNoteId) || null;
  const hoverPreviewNote =
    notesHoverPreviewId &&
      settings?.widgets?.notesHoverPreview &&
      !notesCenterNoteId
      ? notesEntries.find((note) => note.id === notesHoverPreviewId) || null
      : null;
  useEffect(() => {
    if (notesHoverPreviewId && !hoverPreviewNote) {
      setNotesHoverPreviewId(null);
    }
  }, [notesHoverPreviewId, hoverPreviewNote]);

  const showClockWeatherSeparator = !!settings?.widgets?.clockWeatherSeparator;
  const accentRgb = hexToRgb(widgetThemeTokens.accentColor || "#00ffff") || {
    r: 0,
    g: 255,
    b: 255,
  };
  const separatorGradient = `linear-gradient(90deg, rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0), rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.65), rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0))`;
  const weatherMarginClass =
    weatherPreset === "preset1"
      ? ""
      : weatherPreset === "preset3"
        ? "mt-0"
        : "mt-4";
  const weatherMarginStyle =
    weatherPreset === "preset3" ? { marginTop: "-6px" } : undefined;
  // Use workspace-specific widget visibility when workspace widgets are enabled
  const baseShowNotesWidget = workspaceWidgetsEnabled
    ? (activeWidgetsProfile?.enableNotes !== false)
    : (settings?.widgets?.enableNotes !== false);
  const baseShowEmailWidget = workspaceWidgetsEnabled
    ? (activeWidgetsProfile?.enableEmail !== false)
    : (settings?.widgets?.enableEmail !== false);
  
  // Apply widget alternator mode if active - only show one widget at a time
  const showNotesWidget = widgetAlternatorMode === 'none' 
    ? baseShowNotesWidget
    : widgetAlternatorMode === 'notes-only';
  const showEmailWidget = widgetAlternatorMode === 'none'
    ? baseShowEmailWidget
    : widgetAlternatorMode === 'email-only';
  
  // Auto-activate alternator mode when both widgets are enabled (so they can toggle instead of stacking)
  useEffect(() => {
    if (baseShowNotesWidget && baseShowEmailWidget && widgetAlternatorMode === 'none') {
      // Both widgets are enabled, activate alternator starting with notes
      setWidgetAlternatorMode('notes-only');
      try {
        localStorage.setItem("vstart-widget-alternator-mode", 'notes-only');
      } catch {}
    } else if (!baseShowNotesWidget && !baseShowEmailWidget && widgetAlternatorMode !== 'none') {
      // Neither widget enabled, reset to none
      setWidgetAlternatorMode('none');
      try {
        localStorage.setItem("vstart-widget-alternator-mode", 'none');
      } catch {}
    } else if ((!baseShowNotesWidget && widgetAlternatorMode === 'notes-only') || 
               (!baseShowEmailWidget && widgetAlternatorMode === 'email-only')) {
      // Current alternator mode points to disabled widget, switch to the other or none
      if (baseShowNotesWidget) {
        setWidgetAlternatorMode('notes-only');
        try {
          localStorage.setItem("vstart-widget-alternator-mode", 'notes-only');
        } catch {}
      } else if (baseShowEmailWidget) {
        setWidgetAlternatorMode('email-only');
        try {
          localStorage.setItem("vstart-widget-alternator-mode", 'email-only');
        } catch {}
      } else {
        setWidgetAlternatorMode('none');
        try {
          localStorage.setItem("vstart-widget-alternator-mode", 'none');
        } catch {}
      }
    }
  }, [baseShowNotesWidget, baseShowEmailWidget, widgetAlternatorMode]);
  const showClockWidget = workspaceWidgetsEnabled
    ? (activeWidgetsProfile?.enableClock !== false)
    : (settings?.widgets?.enableClock !== false);
  const showWeatherWidget = workspaceWidgetsEnabled
    ? (activeWidgetsProfile?.enableWeather !== false)
    : (settings?.widgets?.enableWeather !== false);
  const showMusicPlayer = workspaceWidgetsEnabled
    ? (activeWidgetsProfile?.enableMusicPlayer !== false)
    : (settings?.widgets?.enableMusicPlayer !== false);
  const determineNotesLocation = useCallback(
    (note) => {
      const mode = settings?.widgets?.notesMode || "auto";
      if (mode === "center") return "center";
      if (mode === "widget") return "widget";
      const contentLength = (note?.content || "").length;
      return contentLength > 280 ? "center" : "widget";
    },
    [settings?.widgets?.notesMode],
  );
  const activeNoteLocation = notesCenterNoteId
    ? "center"
    : notesInlineEditing
      ? "widget"
      : determineNotesLocation(activeNote);
  const defaultWorkspaceForNewNote = useMemo(() => {
    if (notesFilterMode === "perWorkspace") {
      return resolvedWorkspaceForFilter || null;
    }
    if (notesFilterMode === "manual") {
      return notesFilterWorkspaceId || null;
    }
    if (notesFilterMode === "none") {
      return null;
    }
    return resolvedWorkspaceForFilter || null;
  }, [notesFilterMode, notesFilterWorkspaceId, resolvedWorkspaceForFilter]);
  const workspaceMetaMap = useMemo(() => {
    const glowColors = settings?.speedDial?.workspaceGlowColors || {};
    const accent = widgetThemeTokens.accentColor || "#00ffff";
    const meta = {};
    (workspaces || []).forEach((ws) => {
      meta[ws.id] = {
        name: ws.name || "Workspace",
        icon: ws.icon || "Layers",
        color: glowColors[ws.id] || accent,
      };
    });
    return meta;
  }, [
    workspaces,
    settings?.speedDial?.workspaceGlowColors,
    widgetThemeTokens.accentColor,
  ]);

  useEffect(() => {
    // Folder mounting is now implicit via notesFilterMode + workspace,
    // so we no longer track a separate active folder here.
    if (!Array.isArray(notesEntries) || !notesEntries.length) {
      setNotesActiveFolder("");
      return;
    }
    if (notesFilterMode === "perWorkspace" || notesFilterMode === "manual") {
      const targetId =
        notesFilterMode === "perWorkspace"
          ? resolvedWorkspaceForFilter
          : notesFilterWorkspaceId;
      if (!targetId) {
        setNotesActiveFolder("");
        return;
      }
      const folder = getWorkspaceFolderName(targetId, workspaces);
      setNotesActiveFolder(folder || "");
      return;
    }
    if (notesFilterMode === "none") {
      setNotesActiveFolder("unassigned");
      return;
    }
    // "all" – no active folder
    setNotesActiveFolder("");
  }, [
    notesEntries,
    notesFilterMode,
    notesFilterWorkspaceId,
    resolvedWorkspaceForFilter,
    workspaces,
  ]);
  useEffect(() => {
    if (!Array.isArray(settings?.widgets?.notesEntries)) return;
    if (!workspaces || !workspaces.length) return;
    setSettings((prev) => {
      const widgets = prev.widgets || {};
      const entries = Array.isArray(widgets.notesEntries)
        ? widgets.notesEntries
        : [];
      if (!entries.length) return prev;
      const normalized = normalizeVaultNotes(entries, workspaces);
      let changed = normalized.length !== entries.length;
      if (!changed) {
        for (let i = 0; i < entries.length; i += 1) {
          const a = entries[i];
          const b = normalized[i];
          if (
            !a ||
            !b ||
            a.id !== b.id ||
            (a.workspaceId || null) !== (b.workspaceId || null) ||
            (a.folder || "") !== (b.folder || "")
          ) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) return prev;
      return {
        ...prev,
        widgets: {
          ...widgets,
          notesEntries: normalized,
        },
      };
    });
  }, [workspaces, settings?.widgets?.notesEntries]);

  // Listen for extension-driven link notes (requires defaultWorkspaceForNewNote)
  useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail ? e.detail : {};
      const rawUrl = String(detail.url || "").trim();
      const body = String(detail.body || "").trim();
      if (!rawUrl) return;
      const title = String(detail.title || "").trim() || rawUrl;
      const workspaceIdFromExt =
        typeof detail.workspaceId === "string" && detail.workspaceId
          ? detail.workspaceId
          : null;
      const effectiveWorkspaceId =
        workspaceIdFromExt ||
        (settings?.widgets?.notesMode === "none"
          ? null
          : defaultWorkspaceForNewNote || null);
      setSettings((prev) => {
        const widgets = prev.widgets || {};
        const entries = Array.isArray(widgets.notesEntries)
          ? widgets.notesEntries
          : [];
        const combinedContent = body ? `${body}\n\n${rawUrl}` : rawUrl;
        const vaults = Array.isArray(widgets.notesVaults)
          ? widgets.notesVaults
          : [];
        const vaultLabelRaw =
          typeof detail.vaultLabel === "string" &&
            detail.vaultLabel.trim()
            ? detail.vaultLabel.trim()
            : null;
        let vaultId = widgets.notesVaultActiveId || null;
        if (vaultLabelRaw && vaults.length) {
          const match = vaults.find(
            (v) =>
              String(v.name || "")
                .trim()
                .toLowerCase() === vaultLabelRaw.toLowerCase(),
          );
          if (match) {
            vaultId = match.id;
          }
        }
        const currentFolderPath = (() => {
          if (effectiveWorkspaceId) {
            const folder = getWorkspaceFolderName(
              effectiveWorkspaceId,
              workspaces,
            );
            return folder || "";
          }
          return "unassigned";
        })();
        const newNote = {
          id: `note-link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title,
          manualTitle: !!title,
          content: combinedContent,
          updatedAt: Date.now(),
          workspaceId: effectiveWorkspaceId,
          vaultId: vaultId || null,
          linkUrl: rawUrl,
          linkOnly: !body,
          folder: currentFolderPath,
        };
        return {
          ...prev,
          widgets: {
            ...widgets,
            notesEntries: [newNote, ...entries],
            notesActiveId: newNote.id,
            notesContent: combinedContent,
          },
        };
      });
    };
    window.addEventListener("ext-add-note-link", handler);
    return () => window.removeEventListener("ext-add-note-link", handler);
  }, [defaultWorkspaceForNewNote, settings?.widgets?.notesMode, setSettings, workspaces]);

  useEffect(() => {
    if (!editingNoteId || !editingNote) {
      notesEditingIdRef.current = null;
      if (!notesInlineEditing && !notesCenterNoteId) {
        setNotesDraft("");
      }
      return;
    }
    if (notesEditingIdRef.current !== editingNoteId) {
      notesEditingIdRef.current = editingNoteId;
      setNotesDraft(editingNote?.content || "");
    }
  }, [editingNoteId, editingNote, notesInlineEditing, notesCenterNoteId]);

  const commitNoteDraft = useCallback((noteId, content) => {
    if (!noteId) return;
    const raw = String(content || "");
    const trimmed = raw.trim();

    let deletedNote = null;
    setSettings((prev) => {
      const entries = Array.isArray(prev.widgets?.notesEntries)
        ? prev.widgets.notesEntries
        : [];
      const existing = entries.find((note) => note.id === noteId) || null;
      if (!existing) return prev;

      // Only auto-delete when the note previously had content and user cleared it.
      if (!trimmed && String(existing.content || "").trim()) {
        deletedNote = existing;
        const remaining = entries.filter((note) => note.id !== noteId);
        const prevActiveId = prev.widgets?.notesActiveId || null;
        const nextActiveId =
          prevActiveId === noteId ? (remaining[0]?.id || null) : prevActiveId;
        return {
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesEntries: remaining,
            notesActiveId: nextActiveId,
            notesContent: "",
          },
        };
      }

      const nextEntries = entries.map((note) => {
        if (note.id !== noteId) return note;
        const manualTitle = note.manualTitle === true;
        const autoTitle = deriveNoteTitle(raw, note.title || "Untitled note");
        const updated = {
          ...note,
          content: raw,
          title: manualTitle ? (note.title || autoTitle) : autoTitle,
          updatedAt: Date.now(),
          linkOnly: note.linkUrl
            ? trimmed === String(note.linkUrl || "").trim()
            : false,
        };
        if (updated.vaultId) {
          saveNoteToVault(updated.vaultId, updated);
        }
        return updated;
      });
      return {
        ...prev,
        widgets: {
          ...(prev.widgets || {}),
          notesEntries: nextEntries,
          notesContent: raw,
        },
      };
    });
    if (deletedNote) {
      const vaultId =
        deletedNote.vaultId ||
        settings?.widgets?.notesVaultActiveId ||
        "default";
      if (vaultId) {
        deleteNoteFromVault(vaultId, deletedNote.id, deletedNote.folder || "");
      }
    }
  }, [settings?.widgets?.notesVaultActiveId]);

  useEffect(() => {
    if (!editingNoteId) return;
    const handle = setTimeout(() => {
      commitNoteDraft(editingNoteId, notesDraft || "");
    }, 180);
    return () => clearTimeout(handle);
  }, [editingNoteId, notesDraft, commitNoteDraft]);

  useEffect(() => {
    if (notesEntries.length) return;
    setNotesInlineEditing(false);
    setNotesCenterNoteId(null);
    setNotesDraft("");
    notesEditingIdRef.current = null;
  }, [notesEntries.length]);

  useEffect(() => {
    if (!settings?.widgets?.notesHoverPreview || notesCenterNoteId) {
      setNotesHoverPreviewId(null);
    }
  }, [settings?.widgets?.notesHoverPreview, notesCenterNoteId]);

  const refreshNotesFromVault = useCallback(
    async (allowWhileEditing = false) => {
      const enabled = settings?.widgets?.enableNotes !== false;
      const vaultId = settings?.widgets?.notesVaultActiveId || "default";
      if (!enabled || !vaultId) return;
      if (!allowWhileEditing && (notesInlineEditing || notesCenterNoteId)) {
        return;
      }
      try {
        const synced = await loadNotesFromVault(vaultId);
        if (!Array.isArray(synced)) return;
        const mapped = normalizeVaultNotes(synced, workspaces);
        setSettings((prev) => {
          const widgets = prev.widgets || {};
          const prevActiveId = widgets.notesActiveId || null;
          const nextActiveId =
            prevActiveId && mapped.some((n) => n.id === prevActiveId)
              ? prevActiveId
              : mapped[0]?.id || null;
          const nextActiveNote =
            nextActiveId &&
            mapped.find((n) => n.id === nextActiveId);
          return {
            ...prev,
            widgets: {
              ...widgets,
              notesEntries: mapped,
              notesActiveId: nextActiveId,
              notesContent: nextActiveNote?.content || "",
            },
          };
        });
      } catch {
        // Fail-soft: keep local state if vault refresh fails
      }
    },
    [
      settings?.widgets?.enableNotes,
      settings?.widgets?.notesVaultActiveId,
      notesInlineEditing,
      notesCenterNoteId,
      workspaces,
      setSettings,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const tick = async () => {
      await refreshNotesFromVault(false);
      if (!cancelled) {
        timer = setTimeout(tick, 12000);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshNotesFromVault]);

  // Master layout with temporary (non-persistent) Modern override support
  const [tempModernOverride, setTempModernOverride] = useState(false);
  const [notesForceModern, setNotesForceModern] = useState(false);
  const notesModernOverrideRef = useRef(false);
  const baseMasterLayout =
    activeAppearance?.masterLayout === "classic" ? "classic" : "modern";
  const masterLayoutMode =
    tempModernOverride || notesForceModern ? "modern" : baseMasterLayout;
  const isClassicLayout = masterLayoutMode === "classic";
  // Track current effective layout and manage temporary overrides to Modern when AI/Inline are active
  const layoutOverrideRef = useRef({ active: false, prev: null });
  const currentLayoutRef = useRef(masterLayoutMode);
  useEffect(() => {
    currentLayoutRef.current = masterLayoutMode;
  }, [masterLayoutMode]);
  useEffect(() => {
    const base = activeAppearance?.masterLayout === "classic" ? "classic" : "modern";
    if (notesCenterNoteId && base === "classic" && !notesModernOverrideRef.current) {
      notesModernOverrideRef.current = true;
      setNotesForceModern(true);
    } else if (!notesCenterNoteId && notesModernOverrideRef.current) {
      notesModernOverrideRef.current = false;
      setNotesForceModern(false);
    } else if (base === "modern" && notesForceModern) {
      notesModernOverrideRef.current = false;
      setNotesForceModern(false);
    }
  }, [notesCenterNoteId, activeAppearance?.masterLayout, notesForceModern]);

  // Temporarily switch to modern layout when email is opened in center column
  const emailModernOverrideRef = useRef(false);
  useEffect(() => {
    const base = activeAppearance?.masterLayout === "classic" ? "classic" : "modern";
    if (emailCenterEmailId && base === "classic" && !emailModernOverrideRef.current) {
      emailModernOverrideRef.current = true;
      setTempModernOverride(true);
    } else if (!emailCenterEmailId && emailModernOverrideRef.current) {
      emailModernOverrideRef.current = false;
      setTempModernOverride(false);
    } else if (base === "modern" && tempModernOverride && emailModernOverrideRef.current) {
      emailModernOverrideRef.current = false;
      setTempModernOverride(false);
    }
  }, [emailCenterEmailId, activeAppearance?.masterLayout, tempModernOverride]);
  const dialOffsetModern = Number(settings?.speedDial?.verticalOffset || 0);
  const dialOffsetClassic = Number(settings?.speedDial?.landscapeOffset || 0);
  const dialVerticalOffsetPx = isClassicLayout ? 0 : dialOffsetModern;
  const dialLandscapeOffsetPx = isClassicLayout ? dialOffsetClassic : 0;
  const searchBarCfg = activeAppearance?.searchBar || {};
  const searchBarPositionMode = (() => {
    const raw = String(searchBarCfg.positionMode || "").toLowerCase();
    if (["bottom", "center-unfixed", "center-fixed", "top-fixed"].includes(raw))
      return raw;
    if (searchBarCfg.centered)
      return searchBarCfg.trulyFixed ? "center-fixed" : "center-unfixed";
    return "bottom";
  })();
  const isSearchBarTopPinned =
    isClassicLayout && searchBarPositionMode === "top-fixed";
  const widgetsColumnWidth = "clamp(14rem, 22vw, 20rem)";
  const dialColumnWidth = "448px";
  const layoutLeftWidth = isClassicLayout
    ? widgetsColumnWidth
    : isMirrorLayout
      ? dialColumnWidth
      : widgetsColumnWidth;
  const layoutRightWidthBase = isClassicLayout
    ? "0px"
    : isMirrorLayout
      ? widgetsColumnWidth
      : dialColumnWidth;
  const layoutRightWidth = isClassicLayout ? "0px" : layoutRightWidthBase;
  const layoutGapLeft = isMirrorLayout && !isClassicLayout ? "0rem" : "4rem";
  const layoutGapRight = isClassicLayout
    ? "0rem"
    : isMirrorLayout
      ? "4rem"
      : "0rem";
  const layoutCssVars = {
    "--widgets-column-width": widgetsColumnWidth,
    "--dial-column-width": dialColumnWidth,
    "--column-left-width": layoutLeftWidth,
    "--column-right-width": layoutRightWidth,
    "--center-gap-left": layoutGapLeft,
    "--center-gap-right": layoutGapRight,
    "--center-column-max-width": "1200px",
    "--center-floating-padding": "clamp(1rem, 2vw, 2.5rem)",
    "--center-left-offset":
      "calc(var(--column-left-width) + var(--center-gap-left))",
    "--center-right-offset":
      "calc(var(--column-right-width) + var(--center-gap-right))",
    "--center-column-width":
      "clamp(360px, calc(100vw - var(--center-left-offset) - var(--center-right-offset)), var(--center-column-max-width))",
    "--center-column-shift": isClassicLayout
      ? "0px"
      : "calc((var(--center-left-offset) - var(--center-right-offset)) / 2)",
  };

  const handleDialLayoutChange = useCallback(
    (workspaceId, layoutKey, layoutTiles) => {
      setSettings((prev) => {
        const nextOverrides = {
          ...(prev.speedDial?.dialLayoutOverrides || {}),
        };
        const wsLayouts = { ...(nextOverrides[workspaceId] || {}) };
        wsLayouts[layoutKey] = layoutTiles;
        nextOverrides[workspaceId] = wsLayouts;
        return {
          ...prev,
          speedDial: {
            ...(prev.speedDial || {}),
            dialLayoutOverrides: nextOverrides,
          },
        };
      });
    },
    [],
  );

  const renderSpeedDial = () => (
    <VivaldiSpeedDial
      settings={runtimeSettings}
      layoutMode={masterLayoutMode}
      tiles={tiles}
      onTilesChange={setTiles}
      title={activeWorkspace?.name || "Speed Dial"}
      onTitleChange={handleWorkspaceTitleChange}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      appearanceWorkspacesEnabled={appearanceWorkspacesEnabled}
      workspaceThemingEnabled={workspaceThemingEnabled}
      onWorkspaceSelect={handleWorkspaceSelect}
      onWorkspaceDoubleSelect={handleWorkspaceDoubleSelect}
      onToggleAutoUrlDoubleClick={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), autoUrlDoubleClick: !!val },
        }))
      }
      onToggleScrollToChangeWorkspace={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), scrollToChangeWorkspace: !!val },
        }))
      }
      onToggleScrollToChangeWorkspaceIncludeSpeedDial={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), scrollToChangeWorkspaceIncludeSpeedDial: !!val },
        }))
      }
      onToggleScrollToChangeWorkspaceIncludeWholeColumn={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), scrollToChangeWorkspaceIncludeWholeColumn: !!val },
        }))
      }
      onToggleScrollToChangeWorkspaceResistance={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), scrollToChangeWorkspaceResistance: !!val },
        }))
      }
      onChangeScrollToChangeWorkspaceResistanceIntensity={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), scrollToChangeWorkspaceResistanceIntensity: Number(val) },
        }))
      }
      onWorkspaceAdd={handleWorkspaceAdd}
      onWorkspaceRemove={handleWorkspaceRemove}
      onWorkspaceReorder={handleWorkspaceReorder}
      onWorkspaceRename={handleWorkspaceRename}
      onWorkspaceChangeIcon={handleWorkspaceChangeIcon}
      allSpeedDials={speedDials}
      onTilesChangeByWorkspace={(wsId, next) =>
        setSpeedDials((prev) => ({ ...prev, [wsId]: next }))
      }
      hoveredWorkspaceId={hoveredWorkspaceId}
      onWorkspaceHoverChange={setHoveredWorkspaceId}
      hardWorkspaceId={hardWorkspaceId}
      bannerDirection={normalizedBannerDirection}
      lastInFallbackWorkspaceId={lastInFallbackWorkspaceId}
      onWorkspaceAnchor={handleWorkspaceAnchor}
      onDialLayoutChange={handleDialLayoutChange}
    />
  );

  const currentSpeedDialBlurPx = useMemo(() => {
    // When appearance workspaces are disabled, ignore workspace-specific blur overrides
    // and always use the master blur value
    if (!appearanceWorkspacesEnabled) {
      return Math.max(0, Number(settings?.speedDial?.blurPx ?? 0));
    }
    const workspaceOverrides = settings?.speedDial?.workspaceBlurOverrides;
    // Use hardWorkspaceId (from URL) to match what the speed dial actually uses
    const workspaceIdToCheck = hardWorkspaceId || activeWorkspaceId;
    let override = null;
    if (
      workspaceOverrides &&
      typeof workspaceOverrides === "object" &&
      workspaceIdToCheck &&
      workspaceOverrides[workspaceIdToCheck] !== undefined
    ) {
      const candidate = Number(workspaceOverrides[workspaceIdToCheck]);
      if (Number.isFinite(candidate)) {
        override = candidate;
      }
    }
    const baseBlur =
      override !== null
        ? override
        : Number(settings?.speedDial?.blurPx ?? 0);
    return Math.max(0, baseBlur);
  }, [
    appearanceWorkspacesEnabled,
    settings?.speedDial?.blurPx,
    settings?.speedDial?.workspaceBlurOverrides,
    hardWorkspaceId,
    activeWorkspaceId,
  ]);

  // Search bar blur resolution
  // Note: Search bar blur is part of appearance workspaces, not workspace theming.
  // It works independently of the workspace theming toggle and respects appearance workspace settings.
  const searchBarBlurPx = useMemo(() => {
    // If linked to speed dial, use speed dial blur
    if (settings?.appearance?.searchBarLinkSpeedDialBlur) {
      return currentSpeedDialBlurPx;
    }
    // Resolve from active appearance (which comes from appearance workspaces)
    // This works correctly regardless of workspace theming state
    return resolveSearchBarBlurPx(activeAppearance?.searchBar || {});
  }, [
    activeAppearance?.searchBar?.blurPx,
    activeAppearance?.searchBar?.blurPreset,
    settings?.appearance?.searchBarLinkSpeedDialBlur,
    currentSpeedDialBlurPx,
  ]);

  useEffect(() => {
    if (!activeAppearance?.suggestionsMatchBarBlur) return;
    const targetBlur = searchBarBlurPx;
    if (!Number.isFinite(targetBlur)) return;
    const currentBlur = Number(activeAppearance?.suggestionsBlurPx);
    if (
      Math.abs((Number.isFinite(currentBlur) ? currentBlur : -1) - targetBlur) <
      0.01
    )
      return;
    updateAppearanceForWorkspace(
      appearanceRuntimeTargetId,
      (appearanceProfile) => {
        if (!appearanceProfile?.suggestionsMatchBarBlur) return appearanceProfile;
        const prevBlur = Number(appearanceProfile?.suggestionsBlurPx);
        if (
          Math.abs((Number.isFinite(prevBlur) ? prevBlur : -1) - targetBlur) <
          0.01
        ) {
          return appearanceProfile;
        }
        return {
          ...(appearanceProfile || {}),
          suggestionsBlurPx: targetBlur,
        };
      },
    );
  }, [
    activeAppearance?.suggestionsMatchBarBlur,
    activeAppearance?.suggestionsBlurPx,
    searchBarBlurPx,
    updateAppearanceForWorkspace,
    appearanceRuntimeTargetId,
  ]);

  const effectiveSuggestionsBlurPx = useMemo(() => {
    return resolveSuggestionsBlurPx({
      matchSearchBar: !!activeAppearance?.suggestionsMatchBarBlur,
      explicitBlurPx: activeAppearance?.suggestionsBlurPx,
      searchBarBlurPx,
      fallback: 10,
    });
  }, [
    activeAppearance?.suggestionsMatchBarBlur,
    activeAppearance?.suggestionsBlurPx,
    searchBarBlurPx,
  ]);

  const musicAppearanceCfg = activeAppearance?.music || {};
  const musicMatchWorkspaceText = !!musicAppearanceCfg.matchWorkspaceTextColor;
  const musicMatchSearchBarBlur = !!musicAppearanceCfg.matchSearchBarBlur;
  const musicLinkSpeedDialBlur = !!musicAppearanceCfg.linkSpeedDialBlur;
  const resolvedMusicStyleConfig = (() => {
    const base = musicMatchWorkspaceText
      ? {
        ...musicAppearanceCfg,
        resolvedTextColor: widgetThemeTokens.textColor,
        resolvedAccentColor: widgetThemeTokens.accentColor,
      }
      : musicAppearanceCfg;
    let blur = Number.isFinite(Number(musicAppearanceCfg.blurPx))
      ? Number(musicAppearanceCfg.blurPx)
      : 12;
    if (musicMatchSearchBarBlur && Number.isFinite(searchBarBlurPx)) {
      blur = searchBarBlurPx;
    }
    if (musicLinkSpeedDialBlur) {
      blur = currentSpeedDialBlurPx;
    }
    // Include resolved glow color for glow shadows (workspace-specific or default)
    return { ...base, blurPx: blur, glowColor: resolvedGlowColorForShadows };
  })();
  const handleNoteCreate = useCallback(
    (location = "widget") => {
      const activeVaultId =
        settings?.widgets?.notesVaultActiveId || "default";
      const workspaceForNote = defaultWorkspaceForNewNote || null;
      const workspaceFolder =
        workspaceForNote && workspaces.length
          ? getWorkspaceFolderName(workspaceForNote, workspaces)
          : "";
      const currentFolderPath =
        workspaceFolder ||
        (workspaceForNote ? "" : "unassigned");
      const newNote = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: "New note",
        content: "",
        updatedAt: Date.now(),
        workspaceId: defaultWorkspaceForNewNote || null,
        vaultId: activeVaultId,
        folder: currentFolderPath,
      };
      setSettings((prev) => {
        const entries = Array.isArray(prev.widgets?.notesEntries)
          ? prev.widgets.notesEntries
          : [];
        return {
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesEntries: [newNote, ...entries],
            notesActiveId: newNote.id,
            notesContent: "",
          },
        };
      });
      setNotesDraft("");
      if (location === "center") {
        setNotesCenterNoteId(newNote.id);
        setNotesInlineEditing(false);
      } else {
        setNotesCenterNoteId(null);
        setNotesInlineEditing(true);
      }
      return newNote.id;
    },
    [
      defaultWorkspaceForNewNote,
      settings?.widgets?.notesVaultActiveId,
      settings?.widgets?.notesPinnedFolder,
      notesActiveFolder,
      workspaces,
    ],
  );

  const handleNoteSelect = useCallback(
    (id, preferredLocation = null) => {
      const note = notesEntries.find((n) => n.id === id);
      if (!note) return;
      // Any explicit selection should clear hover preview overlays
      setNotesHoverPreviewId(null);
      setSettings((prev) => ({
        ...prev,
        widgets: { ...(prev.widgets || {}), notesActiveId: id },
      }));
      const targetLocation = preferredLocation || determineNotesLocation(note);
      if (targetLocation === "center") {
        setNotesCenterNoteId(id);
        setNotesInlineEditing(false);
      } else {
        setNotesCenterNoteId(null);
        setNotesInlineEditing(true);
      }
      setNotesDraft(note.content || "");
    },
    [notesEntries, determineNotesLocation],
  );

  const handleNoteTitleChange = useCallback((noteId, title) => {
    if (!noteId) return;
    const raw = String(title || "");
    const trimmed = raw.trim();
    setSettings((prev) => {
      const entries = Array.isArray(prev.widgets?.notesEntries)
        ? prev.widgets.notesEntries
        : [];
      const nextEntries = entries.map((note) => {
        if (note.id !== noteId) return note;
        return {
          ...note,
          title: trimmed,
          manualTitle: true,
        };
      });
      return {
        ...prev,
        widgets: {
          ...(prev.widgets || {}),
          notesEntries: nextEntries,
        },
      };
    });
  }, []);

  const handleDeleteNoteById = useCallback(
    (noteId) => {
      if (!noteId) return;
      setSettings((prev) => {
        const entries = Array.isArray(prev.widgets?.notesEntries)
          ? prev.widgets.notesEntries
          : [];
        const remaining = entries.filter((note) => note.id !== noteId);
        const prevActiveId = prev.widgets?.notesActiveId || null;
        const nextActiveId =
          prevActiveId === noteId ? (remaining[0]?.id || null) : prevActiveId;
        const nextActiveNote =
          remaining.find((n) => n.id === nextActiveId) || null;
        return {
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesEntries: remaining,
            notesActiveId: nextActiveId,
            notesContent: nextActiveNote?.content || "",
          },
        };
      });
      const note = notesEntries.find((n) => n.id === noteId);
      if (note?.vaultId) {
        deleteNoteFromVault(
          note.vaultId,
          note.id,
          note.folder || "",
        );
      }
      if (notesCenterNoteId === noteId) {
        setNotesCenterNoteId(null);
      }
      if (notesEditingIdRef.current === noteId) {
        notesEditingIdRef.current = null;
        setNotesInlineEditing(false);
        setNotesDraft("");
      }
    },
    [setSettings, notesCenterNoteId, notesEntries],
  );

  const handleInlineBack = useCallback(() => {
    if (notesInlineEditing && editingNoteId && !(notesDraft || "").trim()) {
      handleDeleteNoteById(editingNoteId);
    }
    setNotesInlineEditing(false);
    notesEditingIdRef.current = null;
    setNotesDraft("");
  }, [notesInlineEditing, editingNoteId, notesDraft]);

  const handleCenterClose = useCallback(() => {
    if (notesCenterNoteId && editingNoteId === notesCenterNoteId && !(notesDraft || "").trim()) {
      handleDeleteNoteById(notesCenterNoteId);
    }
    setNotesCenterNoteId(null);
    setNotesInlineEditing(false);
    notesEditingIdRef.current = null;
    setNotesDraft("");
  }, [notesCenterNoteId, editingNoteId, notesDraft]);

  const handlePromoteActiveNoteToCenter = useCallback(() => {
    if (!activeNoteId) return;
    setNotesCenterNoteId(activeNoteId);
    setNotesInlineEditing(false);
  }, [activeNoteId]);
  
  const handleEmailClick = useCallback((emailId, accountEmail) => {
    if (!emailId) {
      setEmailCenterEmailId(null)
      setEmailCenterEmailAccount(null)
      return
    }
    setEmailCenterEmailId(emailId)
    setEmailCenterEmailAccount(accountEmail)
    setEmailsCenterOpen(true)
  }, [])

  const handlePromoteEmailToCenter = useCallback(() => {
    setEmailsCenterOpen(true);
    // Temporarily switch to modern layout if in classic
    const currLayout = baseMasterLayout;
    if (currLayout === "classic" && !layoutOverrideRef.current.active) {
      layoutOverrideRef.current = { active: true, prev: "classic" };
      try {
        localStorage.setItem("lastManualMasterLayout", "classic");
      } catch { }
      setTempModernOverride(true);
    }
  }, [baseMasterLayout]);
  
  // Widget alternator toggle: cycles through notes-only <-> email-only (never show both)
  // Only cycles through modes that are possible based on base widget settings
  const handleWidgetAlternatorToggle = useCallback(() => {
    setWidgetAlternatorMode(prev => {
      // Determine which modes are available
      const canShowNotes = baseShowNotesWidget;
      const canShowEmail = baseShowEmailWidget;
      
      if (!canShowNotes && !canShowEmail) {
        // Neither widget can be shown, stay at 'none'
        return 'none';
      }
      
      // Build cycle based on available widgets - only one at a time
      let cycle = [];
      if (canShowNotes && canShowEmail) {
        // When both are available, alternate between them
        cycle = ['notes-only', 'email-only'];
      } else if (canShowNotes) {
        cycle = ['notes-only'];
      } else if (canShowEmail) {
        cycle = ['email-only'];
      }
      
      if (cycle.length === 0) return 'none';
      
      // If currently at 'none', start at first widget
      if (prev === 'none') {
        const next = cycle[0];
        try {
          localStorage.setItem("vstart-widget-alternator-mode", next);
        } catch {}
        return next;
      }
      
      // Find current position in cycle and toggle to the other
      const currentIndex = cycle.indexOf(prev);
      if (currentIndex >= 0) {
        const nextIndex = (currentIndex + 1) % cycle.length;
        const next = cycle[nextIndex];
        try {
          localStorage.setItem("vstart-widget-alternator-mode", next);
        } catch {}
        return next;
      }
      
      // If prev mode not in cycle, start at first
      const next = cycle[0];
      try {
        localStorage.setItem("vstart-widget-alternator-mode", next);
      } catch {}
      return next;
    });
  }, [baseShowNotesWidget, baseShowEmailWidget]);
  
  // Persist widget alternator mode
  useEffect(() => {
    try {
      localStorage.setItem("vstart-widget-alternator-mode", widgetAlternatorMode);
    } catch {}
  }, [widgetAlternatorMode]);
  
  const handleEmailCenterClose = useCallback(() => {
    setEmailsCenterOpen(false);
    // Restore layout if was temporarily switched
    if (
      layoutOverrideRef.current.active &&
      layoutOverrideRef.current.prev === "classic"
    ) {
      layoutOverrideRef.current = { active: false, prev: null };
      setTempModernOverride(false);
    }
  }, []);
  const handleNoteHoverPreview = useCallback(
    (noteId) => {
      setNotesHoverPreviewId((prev) => {
        if (!settings?.widgets?.notesHoverPreview || notesCenterNoteId) {
          return prev === null ? prev : null;
        }
        const next = noteId || null;
        return next === prev ? prev : next;
      });
    },
    [settings?.widgets?.notesHoverPreview, notesCenterNoteId],
  );

  const handleEmailCenterFilterChange = useCallback((mode, workspaceId = null) => {
    setSettings((prev) => ({
      ...prev,
      widgets: {
        ...(prev.widgets || {}),
        emailCenterFilterMode: mode || "all",
        emailCenterFilterWorkspaceId: workspaceId || null,
      },
    }));
  }, []);

  const handleNotesFilterChange = useCallback((mode, workspaceId = null) => {
    const allowed = new Set(["perWorkspace", "manual", "none"]);
    const normalized = allowed.has(mode) ? mode : "all";
    const targetWorkspaceId = normalized === "manual" ? workspaceId || null : null;
    setSettings((prev) => ({
      ...prev,
      widgets: {
        ...(prev.widgets || {}),
        notesFilterMode: normalized,
        notesFilterWorkspaceId: targetWorkspaceId,
      },
    }));
  }, []);

  const handlePinNote = useCallback((noteId) => {
    if (!noteId) return;
    setSettings((prev) => {
      const entries = Array.isArray(prev.widgets?.notesEntries)
        ? prev.widgets.notesEntries
        : [];
      const nextEntries = entries.map((note) =>
        note.id === noteId
          ? {
            ...note,
            pinned: !note.pinned,
          }
          : note,
      );
      return {
        ...prev,
        widgets: {
          ...(prev.widgets || {}),
          notesEntries: nextEntries,
        },
      };
    });
    // Update vault if note has vaultId
    const note = notesEntries.find((n) => n.id === noteId);
    if (note?.vaultId) {
      const updatedNote = { ...note, pinned: !note.pinned };
      saveNoteToVault(
        note.vaultId,
        updatedNote,
        note.folder || "",
      ).catch(() => {});
    }
  }, [notesEntries]);

  const handleAssignWorkspaceToNote = useCallback((noteId, workspaceId) => {
    if (!noteId) return;
    const existing =
      Array.isArray(notesEntries) &&
      notesEntries.find((n) => n.id === noteId);
    if (!existing) return;
    const prevWorkspaceId = existing.workspaceId || null;
    const prevFolderRaw =
      typeof existing.folder === "string" ? existing.folder.trim() : "";
    const prevFolder =
      prevFolderRaw ||
      (prevWorkspaceId
        ? getWorkspaceFolderName(prevWorkspaceId, workspaces)
        : "");
    const nextWorkspaceId = workspaceId || null;
    const nextFolder = nextWorkspaceId
      ? getWorkspaceFolderName(nextWorkspaceId, workspaces)
      : prevFolder;
    setSettings((prev) => {
      const entries = Array.isArray(prev.widgets?.notesEntries)
        ? prev.widgets.notesEntries
        : [];
      const nextEntries = entries.map((note) =>
        note.id === noteId
          ? {
            ...note,
            workspaceId: nextWorkspaceId,
            folder: nextFolder,
          }
          : note,
      );
      return {
        ...prev,
        widgets: {
          ...(prev.widgets || {}),
          notesEntries: nextEntries,
        },
      };
    });
    const vaultId =
      existing.vaultId || settings?.widgets?.notesVaultActiveId || "default";
    if (vaultId) {
      if (prevFolder && prevFolder !== nextFolder) {
        deleteNoteFromVault(vaultId, existing.id, prevFolder);
      }
      const payload = {
        ...existing,
        workspaceId: nextWorkspaceId,
        folder: nextFolder,
        vaultId,
      };
      saveNoteToVault(vaultId, payload);
    }
	  }, [notesEntries, workspaces, settings?.widgets?.notesVaultActiveId]);
	
  const settingsCurrentBackground = useMemo(() => {
    if (workspaceBackgroundsEnabled && appearanceWorkspacesEnabled) {
      const targetWorkspaceId = appearanceEditingTargetId === MASTER_APPEARANCE_ID ? null : appearanceEditingTargetId;
      if (targetWorkspaceId && workspaceBackgrounds[targetWorkspaceId]?.src) {
        return workspaceBackgrounds[targetWorkspaceId].src;
      }
    } else if (workspaceBackgroundsEnabled && selectedWorkspaceForZoom) {
      if (workspaceBackgrounds[selectedWorkspaceForZoom]?.src) {
        return workspaceBackgrounds[selectedWorkspaceForZoom].src;
      }
    }
    return currentBackground;
  }, [workspaceBackgroundsEnabled, appearanceWorkspacesEnabled, appearanceEditingTargetId, workspaceBackgrounds, selectedWorkspaceForZoom, currentBackground]);

  const settingsCurrentBackgroundMeta = useMemo(() => {
    if (workspaceBackgroundsEnabled && appearanceWorkspacesEnabled) {
      const targetWorkspaceId = appearanceEditingTargetId === MASTER_APPEARANCE_ID ? null : appearanceEditingTargetId;
      if (targetWorkspaceId && workspaceBackgrounds[targetWorkspaceId]?.meta) {
        return workspaceBackgrounds[targetWorkspaceId].meta;
      }
    } else if (workspaceBackgroundsEnabled && selectedWorkspaceForZoom) {
      if (workspaceBackgrounds[selectedWorkspaceForZoom]?.meta) {
        return workspaceBackgrounds[selectedWorkspaceForZoom].meta;
      }
    }
    return globalBackgroundMeta;
  }, [workspaceBackgroundsEnabled, appearanceWorkspacesEnabled, appearanceEditingTargetId, workspaceBackgrounds, selectedWorkspaceForZoom, globalBackgroundMeta]);

  const settingsButtonElement = (
    <SettingsButton
      onBackgroundChange={handleBackgroundChange}
      currentBackground={settingsCurrentBackground}
      currentBackgroundMeta={settingsCurrentBackgroundMeta}
      workspaceBackgrounds={workspaceBackgrounds}
      onWorkspaceBackgroundChange={
        workspaceBackgroundsEnabled
          ? handleWorkspaceBackgroundChange
          : undefined
      }
      onDefaultWorkspaceBackgroundChange={
        workspaceBackgroundsEnabled
          ? handleDefaultWorkspaceBackgroundChange
          : undefined
      }
      backgroundFollowSlug={backgroundFollowSlug}
      onToggleBackgroundFollowSlug={handleToggleBackgroundFollowSlug}
      workspaceBackgroundsEnabled={workspaceBackgroundsEnabled}
      onToggleWorkspaceBackgroundsEnabled={
        handleToggleWorkspaceBackgroundsEnabled
      }
      backgroundMode={settings.background.mode || "cover"}
      onBackgroundModeChange={handleBackgroundModeChange}
      backgroundZoom={(() => {
        if (workspaceBackgroundsEnabled) {
          const targetWorkspaceId = appearanceWorkspacesEnabled
            ? (appearanceEditingTargetId === MASTER_APPEARANCE_ID ? null : appearanceEditingTargetId)
            : selectedWorkspaceForZoom;
          if (targetWorkspaceId) {
            const entry = workspaceBackgrounds[targetWorkspaceId];
            if (entry?.meta?.zoom !== undefined) {
              return Number(entry.meta.zoom);
            }
          }
        }
        return settings.background.zoom || 1;
      })()}
      selectedWorkspaceForZoom={selectedWorkspaceForZoom}
      onSelectWorkspaceForZoom={setSelectedWorkspaceForZoom}
      onBackgroundZoomChange={(zoom, workspaceId) => {
        if (workspaceBackgroundsEnabled && workspaceId) {
          // Update zoom in workspace background meta
          updateWorkspaceBackgroundState((prev) => {
            const next = { ...prev };
            if (next[workspaceId]) {
              next[workspaceId] = {
                ...next[workspaceId],
                meta: {
                  ...next[workspaceId].meta,
                  zoom: Number(zoom),
                },
              };
            }
            return next;
          });
        } else {
          // Update global zoom
          setSettings((prev) => ({
            ...prev,
            background: { ...prev.background, zoom },
          }));
        }
      }}
      settings={appearancePanelSettings}
      globalSpeedDialSettings={settings.speedDial}
      workspaces={workspaces}
      widgetsSettings={workspaceWidgetsEnabled ? editingWidgetsProfile : (settings.widgets || {})}
      appearanceWorkspaceOptions={appearanceWorkspaceOptions}
      appearanceWorkspaceActiveId={appearanceEditingTargetId}
      appearanceWorkspacesEnabled={appearanceWorkspacesEnabled}
      activeWorkspaceId={activeWorkspaceId}
      isMasterAppearanceView={
        appearanceEditingTargetId === MASTER_APPEARANCE_ID ||
        !appearanceWorkspacesEnabled
      }
      onToggleAppearanceWorkspaces={handleToggleAppearanceWorkspaces}
      onSelectAppearanceWorkspace={handleSelectAppearanceWorkspace}
      workspaceThemingEnabled={workspaceThemingEnabled}
      onToggleWorkspaceTheming={handleToggleWorkspaceTheming}
      workspaceThemingSelectedId={workspaceThemingSelectedId}
      onSelectWorkspaceTheming={handleSelectWorkspaceTheming}
      workspaceWidgetsEnabled={workspaceWidgetsEnabled}
      onToggleWorkspaceWidgets={handleToggleWorkspaceWidgets}
      workspaceWidgetsSelectedId={workspaceWidgetsSelectedId}
      onSelectWorkspaceWidgets={handleSelectWorkspaceWidgets}
      onSettingsVisibilityChange={handleSettingsVisibilityChange}
      onSelectMasterLayout={(mode) => {
        const nextLayout = mode === "classic" ? "classic" : "modern";
        try {
          localStorage.setItem("lastManualMasterLayout", nextLayout);
        } catch { }
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          masterLayout: nextLayout,
        }));
      }}
      onToggleShowSeconds={(val) => {
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            showSeconds: !!val,
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: { ...(prev.widgets || {}), showSeconds: !!val },
        }));
      }}
      onToggleTwentyFourHour={(val) => {
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            twentyFourHour: !!val,
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: { ...(prev.widgets || {}), twentyFourHour: !!val },
        }));
      }}
      onToggleUnits={(isF) => {
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            units: isF ? "imperial" : "metric",
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: { ...(prev.widgets || {}), units: isF ? "imperial" : "metric" },
        }));
      }}
      onSelectClockPreset={(preset) => {
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            clockPreset: preset,
            layoutPreset: undefined,
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            clockPreset: preset,
            layoutPreset: undefined,
          },
        }));
      }}
      onSelectWeatherPreset={(preset) => {
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            weatherPreset: preset,
            layoutPreset: undefined,
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            weatherPreset: preset,
            layoutPreset: undefined,
          },
        }));
      }}
      onToggleWeatherHoverDetails={(val) => {
        const newValue = !!val;
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            weatherShowDetailsOnHover: newValue,
          }));
          // Also update base settings to ensure persistence
          setSettings((prev) => ({
            ...prev,
            widgets: {
              ...(prev.widgets || {}),
              weatherShowDetailsOnHover: newValue,
            },
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            weatherShowDetailsOnHover: newValue,
          },
        }));
      }}
      onChangeSubTimezones={(list) => {
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            subTimezones: Array.isArray(list)
              ? list
              : (widgetsProfile?.subTimezones || []),
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            subTimezones: Array.isArray(list)
              ? list
              : (prev.widgets?.subTimezones || []),
          },
        }));
      }}
      onSelectWidgetsFontPreset={(id) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, fontPreset: id },
        }))
      }
      onChangeWidgetsColorPrimary={(hex) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, colorPrimary: hex },
        }))
      }
      onChangeWidgetsColorAccent={(hex) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, colorAccent: hex },
        }))
      }
      onToggleWidgetsP2OutlineSubTimes={(v) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, p2OutlineSubTimes: !!v },
        }))
      }
      onToggleWidgetsP2ShadeSubTimes={(v) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, p2ShadeSubTimes: !!v },
        }))
      }
      onToggleWidgetsP2OutlineMainTime={(v) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, p2OutlineMainTime: !!v },
        }))
      }
      onToggleWidgetsP2ShadeMainTime={(v) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, p2ShadeMainTime: !!v },
        }))
      }
      onToggleWidgetsP2OutlineWeek={(v) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, p2OutlineWeek: !!v },
        }))
      }
      onToggleWidgetsP2ShadeWeek={(v) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, p2ShadeWeek: !!v },
        }))
      }
      onToggleWidgetsRemoveOutlines={(v) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, removeOutlines: !!v },
        }))
      }
      onToggleWidgetsRemoveBackgrounds={(v) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, removeBackgrounds: !!v },
        }))
      }
      onChangeWidgetsVerticalOffset={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...(prev.widgets || {}), verticalOffset: Number(val) || 0 },
        }))
      }
      onToggleClockWeatherSeparator={(v) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, clockWeatherSeparator: !!v },
        }))
      }
      onToggleEnableNotes={(val) => {
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            enableNotes: !!val,
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: { ...(prev.widgets || {}), enableNotes: !!val },
        }));
      }}
      onToggleEnableClock={(val) => {
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            enableClock: !!val,
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: { ...(prev.widgets || {}), enableClock: !!val },
        }));
      }}
      onToggleEnableWeather={(val) => {
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            enableWeather: !!val,
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: { ...(prev.widgets || {}), enableWeather: !!val },
        }));
      }}
      emailAccounts={emailAccounts}
      onAddEmailAccount={handleAddEmailAccount}
      onRemoveEmailAccount={handleRemoveEmailAccount}
      onUpdateEmailAccountWorkspace={handleUpdateEmailAccountWorkspace}
      onSelectNotesMode={(mode) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesMode:
              mode === "center" || mode === "widget" ? mode : "auto",
          },
        }))
      }

      onToggleNotesLinkSpeedDialBlur={(val) =>
        setSettings((prev) => {
          const nextWidgets = {
            ...(prev.widgets || {}),
            notesLinkSpeedDialBlur: !!val,
          };
          if (val) {
            nextWidgets.notesBlurEnabled = true;
          }
          return { ...prev, widgets: nextWidgets };
        })
      }
      onToggleNotesBlurEnabled={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesBlurEnabled: !!val,
          },
        }))
      }
      onChangeNotesBlurPx={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesBlurPx: Number.isFinite(Number(val))
              ? Math.max(0, Math.min(40, Number(val)))
              : prev.widgets?.notesBlurPx ?? 18,
          },
        }))
      }
      onToggleNotesRemoveBackground={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesRemoveBackground: !!val,
          },
        }))
      }
      onToggleNotesRemoveOutline={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesRemoveOutline: !!val,
          },
        }))
      }
      onChangeSearchBarPushDirection={(direction) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            searchBarPushDirection: direction === 'up' ? 'up' : 'down',
          },
        }))
      }
      onToggleNotesSimpleButtons={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesSimpleButtons: !!val,
          },
        }))
      }
      onToggleNotesGlowShadow={(enabled) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...(prev.widgets || {}), notesGlowShadow: !!enabled },
        }))
      }
      onToggleNotesAutoExpandOnHover={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesAutoExpandOnHover: !!val,
          },
        }))
      }
      onToggleNotesEnhancedWorkspaceId={(enabled) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesEnhancedWorkspaceId: !!enabled,
          },
        }))
      }
      onToggleNotesDynamicBackground={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesDynamicBackground: !!val,
          },
        }))
      }
      onToggleNotesHoverPreview={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesHoverPreview: !!val,
          },
        }))
      }
      onToggleNotesDynamicSizing={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...(prev.widgets || {}),
            notesDynamicSizing: !!val,
          },
        }))
      }
      onToggleOpenInNewTab={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), openInNewTab: !!val },
        }))
      }
      onToggleAnimatedOverlay={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          animatedOverlay: !!val,
        }))
      }
      onChangeAnimatedOverlaySpeed={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          animatedOverlaySpeed: Math.max(0.5, Math.min(10, Number(val) || 2)),
        }))
      }
      onToggleMirrorLayout={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          mirrorLayout: !!val,
        }))
      }
      onToggleSwapClassicTabsWithPageSwitcher={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          swapClassicTabsWithPageSwitcher: !!val,
        }))
      }
      onToggleSwapModernTabsWithPageSwitcher={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          swapModernTabsWithPageSwitcher: !!val,
        }))
      }
      // Search bar appearance
      onToggleSearchBarOutline={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            outline: !!val,
          },
        }))
      }
      onToggleSearchBarShadow={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            shadow: !!val,
          },
        }))
      }
      onToggleSearchBarTransparent={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            transparentBg: !!val,
          },
        }))
      }
      onSelectSearchBarPosition={(mode) =>
        applyAppearanceEdit((appearanceProfile) => {
          const allowed = [
            "bottom",
            "center-unfixed",
            "center-fixed",
            "top-fixed",
          ];
          const normalized =
            typeof mode === "string" ? mode.toLowerCase() : "bottom";
          const nextMode = allowed.includes(normalized) ? normalized : "bottom";
          const nextCentered =
            nextMode === "center-unfixed" || nextMode === "center-fixed";
          const nextTrulyFixed = nextMode === "center-fixed";
          return {
            ...(appearanceProfile || {}),
            searchBar: {
              ...(appearanceProfile?.searchBar || {}),
              positionMode: nextMode,
              centered: nextCentered,
              trulyFixed: nextTrulyFixed,
            },
          };
        })
      }
      onSelectSearchBarBlurPreset={(preset) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            blurPreset: preset,
          },
        }))
      }
      onChangeSearchBarBlurPx={(px) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            blurPx: Number(px),
          },
        }))
      }
      onChangeSearchBarWidthScale={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            widthScale: Number(val),
          },
        }))
      }
      onChangeSearchBarMaxGlow={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            maxGlow: Number(val),
          },
        }))
      }
      onToggleSearchBarMatchSpeedDialMaxGlow={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            matchSpeedDialMaxGlow: !!val,
          },
        }))
      }
      onToggleSearchBarLinkSpeedDialBlur={(val) =>
        setSettings((prev) => {
          const state = normalizeAppearanceWorkspaceState(prev.appearanceWorkspaces);
          if (state?.enabled && applyAppearanceEditRef.current) {
            // Use applyAppearanceEdit to update workspace-specific appearance
            applyAppearanceEditRef.current((appearanceProfile) => ({
              ...(appearanceProfile || {}),
              searchBarLinkSpeedDialBlur: !!val,
            }));
            return prev;
          }
          return {
            ...prev,
            appearance: {
              ...(prev.appearance || {}),
              searchBarLinkSpeedDialBlur: !!val,
            },
          };
        })
      }
      onToggleSearchBarGlowByUrl={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            glowByUrl: !!val,
          },
        }))
      }
      onToggleSearchBarGlowTransient={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            glowTransient: !!val,
          },
        }))
      }
      onToggleSearchBarInlineAiGlow={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            inlineAiButtonGlow: !!val,
          },
        }))
      }
      onToggleSearchBarRefocus={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            refocusByUrl: !!val,
          },
        }))
      }
      onToggleSearchBarHoverGlow={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            hoverGlow: !!val,
          },
        }))
      }
      onChangeSearchBarRefocusMode={(mode) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            refocusMode:
              mode === "pulse" || mode === "steady" ? mode : "letters",
          },
        }))
      }
      // System-wide glow max
      onChangeSystemGlowMaxIntensity={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          glowMaxIntensity: Math.max(0.1, Math.min(2.5, Number(val) || 1.0)),
        }))
      }
      // AI chat width scale
      onChangeAiStreamScale={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          chatWidthScale: Math.max(1, Math.min(2, Number(val) || 1)),
        }))
      }
      onChangeChatBubbleBlur={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          chatBubbleBlurPx: Math.max(0, Math.min(30, Number(val) || 0)),
        }))
      }
      // Inline results: return button position
      onSelectInlineReturnPos={(pos) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          inline: {
            ...(appearanceProfile?.inline || {}),
            returnPos: pos === "left" || pos === "right" ? pos : "center",
          },
        }))
      }
      // Soft-switch glow behavior
      onChangeSoftSwitchGlowBehavior={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, softSwitchGlowBehavior: val },
        }))
      }
      onToggleLastInEnabled={(val) =>
        setSettings((prev) => ({
          ...prev,
          theme: {
            ...prev.theme,
            lastIn: { ...(prev.theme?.lastIn || {}), enabled: !!val },
          },
        }))
      }
      onToggleLastInIncludeGlow={(val) =>
        setSettings((prev) => ({
          ...prev,
          theme: {
            ...prev.theme,
            lastIn: { ...(prev.theme?.lastIn || {}), includeGlow: !!val },
          },
        }))
      }
      // Theming: default outer glow
      onToggleDefaultOuterGlow={(val) =>
        setSettings((prev) => ({
          ...prev,
          theme: { ...(prev.theme || {}), includeGlow: !!val },
        }))
      }
      onToggleLastInIncludeTypography={(val) =>
        setSettings((prev) => ({
          ...prev,
          theme: {
            ...prev.theme,
            lastIn: { ...(prev.theme?.lastIn || {}), includeTypography: !!val },
          },
        }))
      }
      onToggleSearchBarUseDefaultFont={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            useDefaultFont: !!val,
          },
        }))
      }
      onToggleSearchBarUseDefaultColor={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            useDefaultColor: !!val,
          },
        }))
      }
      onToggleSearchBarDarkerPlaceholder={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          searchBar: {
            ...(appearanceProfile?.searchBar || {}),
            darkerPlaceholder: !!val,
          },
        }))
      }
      onSelectFontPreset={(id) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          fontPreset: id,
        }))
      }
      onManualTextColorChange={(hex) =>
        setSettings((prev) => ({
          ...prev,
          theme: {
            ...prev.theme,
            colors: { ...prev.theme.colors, primary: hex },
          },
        }))
      }
      onManualAccentColorChange={(hex) =>
        setSettings((prev) => ({
          ...prev,
          theme: {
            ...prev.theme,
            colors: { ...prev.theme.colors, accent: hex },
          },
        }))
      }
      onToggleMatchWorkspaceTextColor={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          matchWorkspaceTextColor: !!val,
        }))
      }
      onToggleMatchWorkspaceAccentColor={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          matchWorkspaceAccentColor: !!val,
        }))
      }
      onToggleMatchWorkspaceFonts={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          matchWorkspaceFonts: !!val,
        }))
      }
      onToggleAiBubbleOutline={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          aiBubbleOutline: !!val,
        }))
      }
      onToggleAiBubbleShadow={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          aiBubbleShadow: !!val,
        }))
      }
      onChangeSpeedDialVerticalOffset={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...(prev.speedDial || {}),
            verticalOffset:
              (activeAppearance?.masterLayout || prev.appearance?.masterLayout) ===
                "classic"
                ? (prev.speedDial?.verticalOffset ?? 0)
                : Math.max(-240, Math.min(240, Number(val) || 0)),
            landscapeOffset:
              (activeAppearance?.masterLayout || prev.appearance?.masterLayout) ===
                "classic"
                ? Math.max(-360, Math.min(360, Number(val) || 0))
                : (prev.speedDial?.landscapeOffset ?? 0),
          },
        }))
      }
      onChangeSpeedDialBlur={(v) =>
        setSettings((prev) => {
          const newBlur = Number(v);
          // When master override is changed, update all workspace blur overrides to match
          const existingOverrides = prev.speedDial?.workspaceBlurOverrides || {};
          const updatedOverrides = {};
          // Update all existing workspace overrides to the new master value
          for (const workspaceId in existingOverrides) {
            updatedOverrides[workspaceId] = newBlur;
          }
          return {
            ...prev,
            speedDial: {
              ...prev.speedDial,
              blurPx: newBlur,
              workspaceBlurOverrides: updatedOverrides,
            },
          };
        })
      }
      onChangeSpeedDialMaxGlow={(val) =>
        setSettings((prev) => {
          const state = normalizeAppearanceWorkspaceState(
            prev.appearanceWorkspaces,
          );
          const anchorId = prev.speedDial?.anchoredWorkspaceId || null;
          // Use state.lastSelectedId instead of closure value to ensure we have current state
          const currentEditingTargetId = resolveAppearanceWorkspaceTargetId(
            state,
            state.lastSelectedId || DEFAULT_APPEARANCE_WORKSPACE_ID,
            anchorId,
          ) || DEFAULT_APPEARANCE_WORKSPACE_ID;
          const targetId = currentEditingTargetId;
          const numVal = Number(val);
          const next = {
            ...prev,
            speedDial: {
              ...(prev.speedDial || {}),
              maxGlowByWorkspace: {
                ...(prev.speedDial?.maxGlowByWorkspace || {}),
              },
            },
          };
          if (
            state.enabled &&
            targetId !== DEFAULT_APPEARANCE_WORKSPACE_ID &&
            targetId !== MASTER_APPEARANCE_ID
          ) {
            next.speedDial.maxGlowByWorkspace[targetId] = numVal;
          } else {
            next.speedDial.maxGlow = numVal;
            if (next.speedDial.maxGlowByWorkspace && targetId !== DEFAULT_APPEARANCE_WORKSPACE_ID) {
              delete next.speedDial.maxGlowByWorkspace[targetId];
            }
          }
          return next;
        })
      }
      onToggleAutoUrlDoubleClick={(val) =>
        setSettings((prev) => {
          const next = {
            ...prev,
            general: { ...(prev.general || {}), autoUrlDoubleClick: !!val },
          };
          if (!!val && !prev.general?.autoUrlDoubleClick) {
            next.speedDial = { ...(prev.speedDial || {}), glowByUrl: true };
          }
          return next;
        })
      }
      onToggleScrollToChangeWorkspace={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), scrollToChangeWorkspace: !!val },
        }))
      }
      onToggleScrollToChangeWorkspaceIncludeSpeedDial={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), scrollToChangeWorkspaceIncludeSpeedDial: !!val },
        }))
      }
      onToggleScrollToChangeWorkspaceIncludeWholeColumn={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), scrollToChangeWorkspaceIncludeWholeColumn: !!val },
        }))
      }
      onToggleScrollToChangeWorkspaceResistance={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), scrollToChangeWorkspaceResistance: !!val },
        }))
      }
      onChangeScrollToChangeWorkspaceResistanceIntensity={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), scrollToChangeWorkspaceResistanceIntensity: Number(val) },
        }))
      }
      onToggleSpeedDialTransparent={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, transparentBg: !!val },
        }))
      }
      onToggleSpeedDialOutline={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, outline: !!val },
        }))
      }
      onToggleSpeedDialShadow={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, shadow: !!val },
        }))
      }
      onToggleSpeedDialMatchHeaderColor={(val) =>
        setSettings((prev) => {
          const state = normalizeAppearanceWorkspaceState(
            prev.appearanceWorkspaces,
          );
          const anchorId = prev.speedDial?.anchoredWorkspaceId || null;
          // Use state.lastSelectedId instead of closure value to ensure we have current state
          const currentEditingTargetId = resolveAppearanceWorkspaceTargetId(
            state,
            state.lastSelectedId || DEFAULT_APPEARANCE_WORKSPACE_ID,
            anchorId,
          ) || DEFAULT_APPEARANCE_WORKSPACE_ID;
          const targetId = currentEditingTargetId;
          const next = { ...prev };
          next.speedDial = {
            ...(prev.speedDial || {}),
            matchHeaderColorByWorkspace: {
              ...(prev.speedDial?.matchHeaderColorByWorkspace || {}),
            },
          };
          if (state.enabled && targetId !== DEFAULT_APPEARANCE_WORKSPACE_ID && targetId !== MASTER_APPEARANCE_ID) {
            next.speedDial.matchHeaderColorByWorkspace[targetId] = !!val;
          } else {
            next.speedDial.matchHeaderColor = !!val;
          }
          return next;
        })
      }
      onToggleSpeedDialMatchHeaderFont={(val) =>
        setSettings((prev) => {
          const state = normalizeAppearanceWorkspaceState(
            prev.appearanceWorkspaces,
          );
          const anchorId = prev.speedDial?.anchoredWorkspaceId || null;
          // Use state.lastSelectedId instead of closure value to ensure we have current state
          const currentEditingTargetId = resolveAppearanceWorkspaceTargetId(
            state,
            state.lastSelectedId || DEFAULT_APPEARANCE_WORKSPACE_ID,
            anchorId,
          ) || DEFAULT_APPEARANCE_WORKSPACE_ID;
          const targetId = currentEditingTargetId;
          const next = { ...prev };
          next.speedDial = {
            ...(prev.speedDial || {}),
            matchHeaderFontByWorkspace: {
              ...(prev.speedDial?.matchHeaderFontByWorkspace || {}),
            },
          };
          if (state.enabled && targetId !== DEFAULT_APPEARANCE_WORKSPACE_ID && targetId !== MASTER_APPEARANCE_ID) {
            next.speedDial.matchHeaderFontByWorkspace[targetId] = !!val;
          } else {
            next.speedDial.matchHeaderFont = !!val;
          }
          return next;
        })
      }
      onToggleHeaderFollowsUrlSlug={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, headerFollowsUrlSlug: !!val },
        }))
      }
      onToggleSpeedDialGlow={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, glowEnabled: !!val },
        }))
      }
      onChangeSpeedDialGlowColor={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, glowColor: val },
        }))
      }
      onChangeSuggestionsBlurPx={(px) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          suggestionsBlurPx: Number(px),
        }))
      }
      onToggleSuggestionsMatchBarBlur={(val) =>
        applyAppearanceEdit((appearanceProfile) => {
          const nextAppearance = { ...(appearanceProfile || {}) };
          nextAppearance.suggestionsMatchBarBlur = !!val;
          if (val) {
            const searchBarConfig = nextAppearance.searchBar || {};
            nextAppearance.suggestionsBlurPx =
              resolveSearchBarBlurPx(searchBarConfig);
          }
          return nextAppearance;
        })
      }
      onToggleSuggestionsRemoveBackground={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          suggestions: {
            ...(appearanceProfile?.suggestions || {}),
            removeBackground: !!val,
          },
        }))
      }
      onToggleSuggestionsRemoveOutline={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          suggestions: {
            ...(appearanceProfile?.suggestions || {}),
            removeOutline: !!val,
          },
        }))
      }
      onToggleSuggestionsUseShadows={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          suggestions: {
            ...(appearanceProfile?.suggestions || {}),
            useShadows: !!val,
          },
        }))
      }
      // Music player styling
      onChangeMusicBlurPx={(px) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          music: {
            ...(appearanceProfile?.music || {}),
            blurPx: Number(px),
          },
        }))
      }
      onToggleMusicRemoveBackground={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          music: {
            ...(appearanceProfile?.music || {}),
            removeBackground: !!val,
          },
        }))
      }
      onToggleMusicRemoveOutline={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          music: {
            ...(appearanceProfile?.music || {}),
            removeOutline: !!val,
          },
        }))
      }
      onToggleMusicUseShadows={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          music: {
            ...(appearanceProfile?.music || {}),
            useShadows: !!val,
          },
        }))
      }
      onToggleMusicMatchTextColor={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          music: {
            ...(appearanceProfile?.music || {}),
            matchWorkspaceTextColor: !!val,
          },
        }))
      }
      onToggleMusicMatchSearchBarBlur={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          music: {
            ...(appearanceProfile?.music || {}),
            matchSearchBarBlur: !!val,
          },
        }))
      }
      onToggleMusicLinkSpeedDialBlur={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          music: {
            ...(appearanceProfile?.music || {}),
            linkSpeedDialBlur: !!val,
          },
        }))
      }
      onToggleMusicDisableButtonBackgrounds={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          music: {
            ...(appearanceProfile?.music || {}),
            disableButtonBackgrounds: !!val,
          },
        }))
      }
      onToggleMusicGlowShadow={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          music: {
            ...(appearanceProfile?.music || {}),
            glowShadow: !!val,
          },
        }))
      }
      onToggleEnableMusicPlayer={(val) => {
        if (workspaceWidgetsEnabled && applyWidgetsEditRef.current) {
          applyWidgetsEditRef.current((widgetsProfile) => ({
            ...(widgetsProfile || {}),
            enableMusicPlayer: !!val,
          }));
          return;
        }
        setSettings((prev) => ({
          ...prev,
          widgets: { ...(prev.widgets || {}), enableMusicPlayer: !!val },
        }));
      }}
      onChangeWorkspaceGlowColor={(id, val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            workspaceGlowColors: {
              ...(prev.speedDial.workspaceGlowColors || {}),
              [id]: val,
            },
          },
        }))
      }
      onToggleGlowByUrl={(checked) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, glowByUrl: !!checked },
        }))
      }
      onToggleIconThemingEnabled={(val) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: { ...(prev.iconTheming || {}), enabled: !!val },
        }))
      }
      onSelectIconThemingMode={(mode) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: { ...(prev.iconTheming || {}), mode: mode },
        }))
      }
      onChangeIconThemingColor={(color) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: { ...(prev.iconTheming || {}), color: color },
        }))
      }
      onChangeIconThemingOpacity={(val) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: { ...(prev.iconTheming || {}), opacity: Number(val) },
        }))
      }
      onChangeIconThemingGrayscaleIntensity={(val) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: { ...(prev.iconTheming || {}), grayscaleIntensity: Number(val) },
        }))
      }
      onToggleIconThemingLinkOpacity={(val) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: { ...(prev.iconTheming || {}), linkWorkspaceOpacity: !!val },
        }))
      }
      onToggleIconThemingLinkGrayscale={(val) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: { ...(prev.iconTheming || {}), linkWorkspaceGrayscale: !!val },
        }))
      }
      onToggleIconThemingFollowSlug={(val) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: { ...(prev.iconTheming || {}), followSlug: !!val },
        }))
      }
      onChangeWorkspaceIconThemeMode={(wsId, mode) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: {
            ...prev.iconTheming,
            workspaces: {
              ...(prev.iconTheming.workspaces || {}),
              [wsId]: {
                ...(prev.iconTheming.workspaces?.[wsId] || {}),
                mode,
              },
            },
          },
        }))
      }
      onChangeWorkspaceIconThemeGrayscaleIntensity={(wsId, intensity) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: {
            ...prev.iconTheming,
            workspaces: {
              ...(prev.iconTheming.workspaces || {}),
              [wsId]: {
                ...(prev.iconTheming.workspaces?.[wsId] || {}),
                grayscaleIntensity: Number(intensity),
              },
            },
          },
        }))
      }
      onChangeWorkspaceIconThemeColor={(wsId, color) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: {
            ...prev.iconTheming,
            workspaces: {
              ...(prev.iconTheming.workspaces || {}),
              [wsId]: {
                ...(prev.iconTheming.workspaces?.[wsId] || {}),
                color,
              },
            },
          },
        }))
      }
      onChangeWorkspaceIconThemeOpacity={(wsId, opacity) =>
        setSettings((prev) => ({
          ...prev,
          iconTheming: {
            ...prev.iconTheming,
            workspaces: {
              ...(prev.iconTheming.workspaces || {}),
              [wsId]: {
                ...(prev.iconTheming.workspaces?.[wsId] || {}),
                opacity,
              },
            },
          },
        }))
      }
      onToggleGlowWorkspaceColorOnDoubleClick={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            glowWorkspaceColorOnDoubleClick: !!val,
          },
        }))
      }
      onToggleGlowTransient={(checked) =>
        setSettings((prev) => {
          const state = normalizeAppearanceWorkspaceState(
            prev.appearanceWorkspaces,
          );
          const anchorId = prev.speedDial?.anchoredWorkspaceId || null;
          // Use state.lastSelectedId instead of closure value to ensure we have current state
          const currentEditingTargetId = resolveAppearanceWorkspaceTargetId(
            state,
            state.lastSelectedId || DEFAULT_APPEARANCE_WORKSPACE_ID,
            anchorId,
          ) || DEFAULT_APPEARANCE_WORKSPACE_ID;
          const targetId = currentEditingTargetId;
          const next = { ...prev };
          next.speedDial = {
            ...(prev.speedDial || {}),
            glowTransientByWorkspace: {
              ...(prev.speedDial?.glowTransientByWorkspace || {}),
            },
          };
          if (state.enabled && targetId !== DEFAULT_APPEARANCE_WORKSPACE_ID && targetId !== MASTER_APPEARANCE_ID) {
            next.speedDial.glowTransientByWorkspace[targetId] = !!checked;
          } else {
            next.speedDial.glowTransient = !!checked;
          }
          return next;
        })
      }
      onToggleGlowHover={(checked) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, glowHover: !!checked },
        }))
      }
      onSelectHeaderAlign={(align) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, headerAlign: align },
        }))
      }
      onSelectHeaderEffectMode={(mode) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, headerEffectMode: mode },
        }))
      }
      onToggleHeaderBannerColor={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            headerBannerMatchWorkspaceColor: !!val,
          },
        }))
      }
      onToggleHeaderBannerStatic={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, headerBannerStatic: !!val },
        }))
      }
      onToggleHeaderBannerOverscan={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, headerBannerOverscan: !!val },
        }))
      }
      onToggleHeaderBannerEnhancedWrap={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, headerBannerEnhancedWrap: !!val },
        }))
      }
      onChangeHeaderBannerScale={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, headerBannerScale: val },
        }))
      }
      onToggleHeaderBannerBold={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, headerBannerBold: !!val },
        }))
      }
      onChangeHeaderBannerSpeed={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            headerBannerScrollSeconds: Number(val),
          },
        }))
      }
      onToggleHeaderBannerFontOverride={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            headerBannerFontOverrideEnabled: !!val,
          },
        }))
      }
      onSelectHeaderBannerFont={(font) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            headerBannerFont: String(font || ""),
          },
        }))
      }
      onToggleHeaderBannerReverseDirection={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, headerBannerReverseDirection: !!val },
        }))
      }
      onToggleHeaderBannerFlipOnDoubleClick={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            headerBannerFlipOnTabDoubleClick: !!val,
          },
        }))
      }
      onToggleHeaderBannerAlternateOnSlug={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, headerBannerAlternateOnSlug: !!val },
        }))
      }
      onToggleTabsRect={(checked) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            tabsShape: checked ? "rect" : "pill",
          },
        }))
      }
      onToggleTabsInside={(checked) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            tabsPlacement: checked ? "inside" : "outside",
          },
        }))
      }
      onToggleTabsDivider={(checked) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, tabsDivider: !!checked },
        }))
      }
      onToggleTabHoverShade={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            tabHoverShade: !!val,
            tabHoverStyle: !!val
              ? prev.speedDial.tabHoverStyle &&
                prev.speedDial.tabHoverStyle !== "none"
                ? prev.speedDial.tabHoverStyle
                : "shade-color"
              : "none",
          },
        }))
      }
      onSelectTabHoverStyle={(style) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            tabHoverStyle: style,
            tabHoverShade: style !== "none",
          },
        }))
      }
      onSelectTabsMode={(mode) =>
        setSettings((prev) => {
          const next = { ...prev };
          next.speedDial = { ...(prev.speedDial || {}) };
          next.speedDial.tabsMode = mode;
          next.speedDial.tabsModeVersion = 2;
          if (mode === "tabs" || mode === "tight" || mode === "cyber") {
            next.speedDial.tabsShape = "pill";
            next.speedDial.tabsPlacement = "outside";
          } else if (mode === "buttons_inside") {
            next.speedDial.tabsShape = "rect";
            next.speedDial.tabsPlacement = "inside";
          } else if (mode === "buttons_outside") {
            next.speedDial.tabsShape = "rect";
            next.speedDial.tabsPlacement = "outside";
          }
          return next;
        })
      }
      // Workspace strip button styles
      onToggleWsButtonBackground={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            wsButtons: {
              ...(prev.speedDial.wsButtons || {}),
              background: !!val,
            },
          },
        }))
      }
      onToggleWsButtonShadow={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            wsButtons: { ...(prev.speedDial.wsButtons || {}), shadow: !!val },
          },
        }))
      }
      onToggleWsButtonBlur={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            wsButtons: { ...(prev.speedDial.wsButtons || {}), blur: !!val },
          },
        }))
      }
      onToggleWsButtonMatchDialBlur={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            wsButtons: {
              ...(prev.speedDial.wsButtons || {}),
              matchDialBlur: !!val,
            },
          },
        }))
      }
      onChangeWorkspaceTextColor={(id, val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            workspaceTextColors: {
              ...(prev.speedDial.workspaceTextColors || {}),
              [id]: val,
            },
          },
        }))
      }
      onChangeWorkspaceTextFont={(id, val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            workspaceTextFonts: {
              ...(prev.speedDial.workspaceTextFonts || {}),
              [id]: val,
            },
          },
        }))
      }
      onChangeWorkspaceAccentColor={(id, val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            workspaceAccentColors: {
              ...(prev.speedDial.workspaceAccentColors || {}),
              [id]: val,
            },
          },
        }))
      }
      onChangeWorkspaceBlurOverride={(id, val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: {
            ...prev.speedDial,
            workspaceBlurOverrides: {
              ...(prev.speedDial.workspaceBlurOverrides || {}),
              [id]: Number(val),
            },
          },
        }))
      }
      onToggleWorkspaceTextByUrl={(checked) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, workspaceTextByUrl: !!checked },
        }))
      }
      onToggleWorkspaceHoverPreview={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, workspaceHoverPreview: !!val },
        }))
      }
      onToggleColorlessPreview={(val) =>
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, colorlessPreview: !!val },
        }))
      }
      onChangeMusicBackend={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), musicBackend: String(val || "") },
        }))
      }
      onChangeMusicToken={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), musicToken: String(val || "") },
        }))
      }
      // Voice settings (General)
      onChangeVoiceProvider={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              provider: String(val || "local-stt"),
            },
          },
        }))
      }
      onChangeVoiceLocalBase={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              serverBase: String(val || ""),
            },
          },
        }))
      }
      onChangeVoiceTtsBase={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              tts: {
                ...(prev.general?.voice?.tts || {}),
                baseUrl: String(val || ""),
              },
              xttsBase: undefined,
            },
          },
        }))
      }
      onChangeVoiceApiUrl={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              apiUrl: String(val || ""),
            },
          },
        }))
      }
      onChangeVoiceApiKey={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              apiKey: String(val || ""),
            },
          },
        }))
      }
      onChangeVoiceSttBase={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              stt: {
                ...(prev.general?.voice?.stt || {}),
                baseUrl: String(val || ""),
              },
            },
          },
        }))
      }
      onChangeVoiceSttToken={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              stt: {
                ...(prev.general?.voice?.stt || {}),
                token: String(val || ""),
              },
            },
          },
        }))
      }
      onChangeVoiceSttModel={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              stt: {
                ...(prev.general?.voice?.stt || {}),
                model: String(val || ""),
              },
            },
          },
        }))
      }
      onChangeVoiceSttLanguage={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              stt: {
                ...(prev.general?.voice?.stt || {}),
                language: String(val || ""),
              },
            },
          },
        }))
      }
      onToggleVoiceSttVad={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              stt: { ...(prev.general?.voice?.stt || {}), vad: !!val },
            },
          },
        }))
      }
      onToggleVoiceSttDiarization={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              stt: { ...(prev.general?.voice?.stt || {}), diarization: !!val },
            },
          },
        }))
      }
      onSelectVoiceSttTimestamps={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: {
            ...(prev.general || {}),
            voice: {
              ...(prev.general?.voice || {}),
              stt: {
                ...(prev.general?.voice?.stt || {}),
                timestamps: String(val || "word"),
              },
            },
          },
        }))
      }
      onToggleAllowScroll={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), allowScroll: !!val },
        }))
      }
      onToggleMusicCompact={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          musicCompact: !!val,
        }))
      }
      onToggleChatSolidUser={(val) =>
        applyAppearanceEdit((appearanceProfile) => ({
          ...(appearanceProfile || {}),
          chatSolidUser: !!val,
        }))
      }
    />
  );

  if (!mounted) {
    return null; // Prevent hydration mismatch
  }

  const iconThemingWorkspaceId =
    settings.iconTheming?.followSlug === false
      ? activeWorkspaceId
      : (hardWorkspaceId || activeWorkspaceId);

  return (
    <>
      {/* Wire SettingsButton events to settings updates */}
      <IconThemeFilters
        settings={settings}
        activeWorkspaceId={iconThemingWorkspaceId}
        anchoredWorkspaceId={settings?.speedDial?.anchoredWorkspaceId}
        workspaceThemingEnabled={workspaceThemingEnabled}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
        (function(){
          window.addEventListener('app-change-search-engine', function(e){ try { localStorage.setItem('searchSettings', JSON.stringify({ engine: e.detail })) } catch {} });
          window.addEventListener('app-set-soft-switch-glow-behavior', function(e){
            try {
              const current = JSON.parse(localStorage.getItem('speedDialSettings') || '{}');
              current.softSwitchGlowBehavior = e.detail;
              localStorage.setItem('speedDialSettings', JSON.stringify(current));
              window.dispatchEvent(new CustomEvent('app-settings-changed'));
            } catch {}
          });
        })();
      `,
        }}
      />
      <ErrorBoundary>
        <div
          id="ui-scale-root"
          className="fixed inset-0 overflow-hidden"
          style={{
            backgroundColor: "black",
            imageRendering: "crisp-edges",
            fontFamily: 'var(--font-family), "Courier New", monospace',
            color: "rgb(var(--text-rgb, 255,255,255))",
            ...layoutCssVars,
            transform: `scale(${uiScale})`,
            transformOrigin: "top left",
            width: uiScale === 1 ? "100vw" : `calc(100vw / ${uiScale})`,
            height: uiScale === 1 ? "100vh" : `calc(100vh / ${uiScale})`,
          }}
        >
          {/* HTML-based background for stability */}
          <BackgroundRenderer
            src={activeBackgroundSrc}
            placeholderSrc={activeBackgroundPlaceholder}
            deferLoad={shouldDeferActiveBackground}
            mode={settings.background.mode || "cover"}
            zoom={(() => {
              if (workspaceBackgroundsEnabled && backgroundWorkspaceId) {
                const entry = workspaceBackgrounds[backgroundWorkspaceId];
                if (entry?.meta?.zoom !== undefined) {
                  return Number(entry.meta.zoom);
                }
              }
              return settings.background.zoom || 1;
            })()}
            isVideo={activeBackgroundMeta?.mime?.startsWith('video/')}
          />
          {/* Optional animated overlay (scan lines). Other universal overlays removed for clarity */}
          {activeAppearance?.animatedOverlay && (
            <div
              className="absolute inset-0 opacity-5 pointer-events-none"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 255, 0.3) 2px, rgba(0, 255, 255, 0.3) 4px)",
                animation: `scan ${activeAppearance?.animatedOverlaySpeed ?? 2}s linear infinite`,
              }}
            />
          )}

          {/* Background dim overlay removed for full brightness */}

          {/* Main content - 3 column master layout */}
          <div
            className={`relative z-10 h-full w-full flex ${isMirrorLayout ? "flex-row-reverse" : ""}`}
          >
            {/* Left column - Clock and Weather */}
            <div
              id="app-left-column"
              className="h-full flex flex-col p-4 gap-4 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar shrink"
              style={{
                width: "var(--widgets-column-width)",
                minWidth: "clamp(12rem, 18vw, 16rem)",
                maxWidth: "var(--widgets-column-width)",
                flexBasis: "var(--widgets-column-width)",
              }}
            >
              {showClockWidget && (
                <div className={clockPreset === "preset2" ? "mt-6" : ""}>
                  <ClockWidget settings={resolvedClockSettings} />
                </div>
              )}
              {showClockWeatherSeparator && showClockWidget && showWeatherWidget && (
                <div className="mt-3 mb-2 mx-1" aria-hidden="true">
                  <div
                    className="h-px w-full rounded-full"
                    style={{
                      background: separatorGradient,
                      boxShadow: `0 0 20px rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.35)`,
                    }}
                  />
                </div>
              )}
              {showWeatherWidget && (
                <div className={weatherMarginClass} style={weatherMarginStyle}>
                  <WeatherWidget settings={resolvedWeatherSettings} />
                </div>
              )}
              {(showNotesWidget || showEmailWidget || showMusicPlayer) && (
                <div className="flex-1 min-h-0 flex flex-col gap-4 mt-3">
                  {showNotesWidget && (
                    <NotesWidget
                      settings={resolvedNotesSettings}
                      entries={filteredNotesEntries}
                      activeId={activeNoteId}
                      activeNoteTitle={editingNote?.title || ""}
                      inlineEditing={notesInlineEditing}
                      draftValue={notesDraft}
                      onDraftChange={setNotesDraft}
                      onTitleChange={handleNoteTitleChange}
                      onCreateInline={() => handleNoteCreate("widget")}
                      onCreateCenter={() => handleNoteCreate("center")}
                      onSelectNote={(id, loc) => handleNoteSelect(id, loc)}
                      onInlineBack={handleInlineBack}
                      onPromoteToCenter={handlePromoteActiveNoteToCenter}
                      activeLocation={activeNoteLocation}
                      listStyle="pill"
                      filterMode={notesFilterMode}
                      filterWorkspaceId={notesFilterWorkspaceId}
                      onChangeFilter={handleNotesFilterChange}
                      workspaces={workspaces}
                      workspaceMeta={workspaceMetaMap}
                      currentWorkspaceId={resolvedWorkspaceForFilter}
                      activeNoteWorkspaceId={editingNote?.workspaceId || null}
                      onAssignWorkspace={handleAssignWorkspaceToNote}
                      onHoverNote={handleNoteHoverPreview}
                      onDeleteNote={handleDeleteNoteById}
                      onPinNote={handlePinNote}
                      linkSpeedDialBlur={!!settings?.widgets?.notesLinkSpeedDialBlur}
                      linkedBlurPx={currentSpeedDialBlurPx}
                      autoExpandOnHover={!!settings?.widgets?.notesAutoExpandOnHover}
                      enhancedWorkspaceId={settings.widgets.notesEnhancedWorkspaceId}
                      hoverPreviewEnabled={!!settings?.widgets?.notesHoverPreview}
                      emailAccounts={emailAccounts}
                      onRefreshNotes={() => refreshNotesFromVault(true)}
                      onComposeEmail={() => {
                        // TODO: Implement compose email functionality
                        console.log('Compose email')
                      }}
                      onRefreshEmails={() => {
                        // TODO: Implement refresh emails functionality
                        console.log('Refresh emails')
                      }}
                      onPromoteEmailToCenter={handlePromoteEmailToCenter}
                      emailsCenterOpen={emailsCenterOpen}
                      onEmailClick={handleEmailClick}
                      onWidgetAlternatorToggle={handleWidgetAlternatorToggle}
                      widgetAlternatorMode={widgetAlternatorMode}
                      emailWidgetShownIndependently={showEmailWidget && widgetAlternatorMode === 'none'}
                      className="flex-1 min-h-[240px]"
                    />
                  )}
                  {showEmailWidget && (
                    <EmailWidget
                      settings={resolvedNotesSettings}
                      emailAccounts={emailAccounts}
                      onComposeEmail={() => {
                        // TODO: Implement compose email functionality
                        console.log('Compose email')
                      }}
                      onRefreshEmails={() => {
                        // TODO: Implement refresh emails functionality
                        console.log('Refresh emails')
                      }}
                      onPromoteEmailToCenter={handlePromoteEmailToCenter}
                      emailsCenterOpen={emailsCenterOpen}
                      onEmailClick={handleEmailClick}
                      filterMode={emailCenterFilterMode}
                      filterWorkspaceId={emailCenterFilterWorkspaceId}
                      onChangeFilter={handleEmailCenterFilterChange}
                      workspaces={workspaces}
                      currentWorkspaceId={resolvedWorkspaceForFilter}
                      onWidgetAlternatorToggle={handleWidgetAlternatorToggle}
                      widgetAlternatorMode={widgetAlternatorMode}
                      className="flex-1 min-h-[240px]"
                    />
                  )}
                  {showMusicPlayer && (
                    <div className="mt-auto mb-12 shrink-0 relative z-10">
                      <MusicController
                        backendBase={
                          settings?.general?.musicBackend || "/music/api/v1"
                        }
                        token={settings?.general?.musicToken || ""}
                        styleConfig={resolvedMusicStyleConfig}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Center column - Main content area */}
            <div
              className={`flex-1 flex flex-col justify-start items-center p-6 ${isClassicLayout ? "pt-20" : "pt-48"} main-center relative`}
            >
              {isClassicLayout && (
                <div
                  id="classic-speed-dial-anchor"
                  className="w-full flex justify-center px-4"
                  style={{
                    pointerEvents: "auto",
                    zIndex: 5,
                    position: "relative",
                    marginTop: isSearchBarTopPinned
                      ? "clamp(2.5rem, 5vw, 3.5rem)"
                      : "0",
                  }}
                >
                  <div
                    id="classic-speed-dial-body"
                    className="w-full max-w-5xl"
                    style={{
                      transform: `translateX(${dialLandscapeOffsetPx}px) scale(${dialScale})`,
                      transformOrigin: "top center",
                      pointerEvents: "auto",
                    }}
                  >
                    {renderSpeedDial()}
                  </div>
                </div>
              )}
              {isClassicLayout &&
                settings.speedDial?.tabsMode === "classic" && (
                  <div className="mt-6 w-full flex justify-center px-6">
                    <div className="max-w-4xl w-full">
                      <WorkspaceStrip
                        items={workspaces}
                        activeId={activeWorkspaceId}
                        onSelect={handleWorkspaceSelect}
                        onDoubleSelect={handleWorkspaceDoubleSelect}
                        onAdd={handleWorkspaceAdd}
                        onRemove={handleWorkspaceRemove}
                        onReorder={handleWorkspaceReorder}
                        onRename={handleWorkspaceRename}
                        onChangeIcon={handleWorkspaceChangeIcon}
                        wsButtonStyle={settings.speedDial?.wsButtons}
                        onHoverChange={setHoveredWorkspaceId}
                        anchoredWorkspaceId={
                          settings.speedDial?.anchoredWorkspaceId || null
                        }
                        onAnchor={handleWorkspaceAnchor}
                        settings={runtimeSettings}
                      />
                    </div>
                  </div>
                )}
              <div
                className="w-full flex flex-col items-center space-y-8 center-column-host"
                style={{
                  maxWidth:
                    "min(var(--center-column-width), var(--center-column-max-width))",
                  paddingLeft: "var(--center-floating-padding)",
                  paddingRight: "var(--center-floating-padding)",
                  marginTop: isClassicLayout ? "2rem" : undefined,
                }}
              >
                {/* Pinned search box container */}
                <div id="pinned-search-container" className="w-full"></div>
                {/* Search results will be displayed here */}
                <div id="search-results" className="w-full"></div>
                {showEmailWidget && emailsCenterOpen && (
                  <div className="w-full flex justify-center px-2 notes-overlay-slot" style={{ paddingTop: '3rem', paddingBottom: '4rem', maxHeight: 'calc(100vh - 8rem)' }}>
                    <div
                      className="w-full"
                      style={{
                        maxWidth:
                          "calc(min(clamp(720px, 72vw, 1000px), var(--center-column-width, 1000px)) + 8px)",
                        marginRight: "-8px",
                      }}
                    >
                      <EmailOverlay
                        settings={resolvedNotesSettings}
                        onClose={() => {
                          handleEmailCenterClose()
                          setEmailCenterEmailId(null)
                          setEmailCenterEmailAccount(null)
                        }}
                        emailAccounts={emailAccounts}
                        selectedEmailId={emailCenterEmailId}
                        selectedEmailAccount={emailCenterEmailAccount}
                        workspaces={workspaces}
                        currentWorkspaceId={resolvedWorkspaceForFilter}
                        currentWorkspace={workspaces.find(w => w.id === resolvedWorkspaceForFilter) || null}
                        filterMode={emailCenterFilterMode}
                        filterWorkspaceId={emailCenterFilterWorkspaceId}
                        onChangeFilter={handleEmailCenterFilterChange}
                        onComposeEmail={() => {
                          console.log('Compose email')
                        }}
                        onRefreshEmails={() => {
                          console.log('Refresh emails')
                        }}
                      />
                    </div>
                  </div>
                )}
                {showNotesWidget && notesCenterNoteId && editingNote && (
                  <div className="w-full flex justify-center px-2 notes-overlay-slot">
                    <div
                      className="w-full"
                      style={{
                        maxWidth:
                          "calc(min(clamp(720px, 72vw, 1000px), var(--center-column-width, 1000px)) + 8px)",
                        marginRight: "-8px",
                      }}
	                    >
	                      <NotesOverlay
	                        settings={resolvedNotesSettings}
	                        note={editingNote}
	                        draftValue={notesDraft}
	                        onDraftChange={setNotesDraft}
	                        onTitleChange={handleNoteTitleChange}
                        onClose={handleCenterClose}
                        onPopInline={() => {
                          setNotesCenterNoteId(null);
                          setNotesInlineEditing(true);
                        }}
                        workspaces={workspaces}
                        workspaceMeta={workspaceMetaMap}
                        noteWorkspaceId={editingNote?.workspaceId || null}
                        onAssignWorkspace={handleAssignWorkspaceToNote}
                        emailAccounts={emailAccounts}
                      />
                    </div>
                  </div>
                )}
                {showNotesWidget &&
                  !notesCenterNoteId &&
                  hoverPreviewNote &&
                  settings?.widgets?.notesHoverPreview && (
                    <div className="w-full flex justify-center px-2 notes-overlay-slot pointer-events-none">
                      <div
                        className="w-full"
                        style={{
                          maxWidth:
                            "calc(min(clamp(720px, 72vw, 1000px), var(--center-column-width, 1000px)) + 8px)",
                          marginRight: "-8px",
                        }}
                      >
	                        <NotesOverlay
	                          settings={resolvedNotesSettings}
	                          note={hoverPreviewNote}
	                          draftValue={hoverPreviewNote?.content || ""}
	                          onDraftChange={() => { }}
                          onClose={() => { }}
                          previewMode
                          workspaces={workspaces}
                          workspaceMeta={workspaceMetaMap}
                          noteWorkspaceId={hoverPreviewNote?.workspaceId || null}
                          onAssignWorkspace={() => { }}
                        />
                      </div>
                    </div>
                  )}
              </div>
              {/* Search results will be displayed here */}
              {isClassicLayout && (
                <div
                  className={`absolute bottom-8 z-20 flex gap-3 ${isMirrorLayout ? "left-8" : "right-8"}`}
                >
                  {settingsButtonElement}
                </div>
              )}
            </div>

            {/* Right column - Workspace strip + Speed Dial (fixed 448px to match external) */}
            {!isClassicLayout && (
              <div
                id="app-right-column"
                className="w-[448px] shrink-0 h-full flex flex-col p-1 mt-4 pb-28 relative"
                style={{
                  width: "var(--dial-column-width)",
                  flexBasis: "var(--dial-column-width)",
                }}
              >
                {/* Speed Dial area - moved downward toward upper-middle */}
                <div
                  className="w-full"
                  style={{
                    transform: `scale(${dialScale})`,
                    transformOrigin: "top right",
                    marginTop: `calc(6rem + ${dialVerticalOffsetPx}px)`,
                  }}
                >
                  {renderSpeedDial()}
                </div>
                {/* Workspaces strip - Classic mode */}
                {settings.speedDial?.tabsMode === "classic" && (
                  <div className="mt-auto self-end mr-2 mb-28">
                    <WorkspaceStrip
                      items={workspaces}
                      activeId={activeWorkspaceId}
                      onSelect={handleWorkspaceSelect}
                      onDoubleSelect={handleWorkspaceDoubleSelect}
                      onAdd={handleWorkspaceAdd}
                      onRemove={handleWorkspaceRemove}
                      onReorder={handleWorkspaceReorder}
                      onRename={handleWorkspaceRename}
                      onChangeIcon={handleWorkspaceChangeIcon}
                      wsButtonStyle={settings.speedDial?.wsButtons}
                      onHoverChange={setHoveredWorkspaceId}
                      anchoredWorkspaceId={
                        settings.speedDial?.anchoredWorkspaceId || null
                      }
                      onAnchor={handleWorkspaceAnchor}
                      settings={runtimeSettings}
                    />
                  </div>
                )}
                <div
                  className={`absolute bottom-8 z-20 flex gap-3 ${isMirrorLayout ? "left-8" : "right-8"}`}
                >
                  {settingsButtonElement}
                </div>
              </div>
            )}
          </div>

          {/* Search box - bottom center */}
          <div
            className="fixed bottom-16 transform -translate-x-1/2 z-20 px-4"
            style={{
              left: "50%",
              width: isClassicLayout
                ? "min(clamp(760px, 80vw, 1100px), var(--center-column-max-width, 1200px))"
                : "min(clamp(680px, 70vw, 960px), var(--center-column-width, 100vw))",
              maxWidth: isClassicLayout
                ? "min(1100px, var(--center-column-max-width, 1200px))"
                : "var(--center-column-max-width, 1200px)",
              ...layoutCssVars,
            }}
          >
            {!((showEmailWidget && emailsCenterOpen) || (showNotesWidget && notesCenterNoteId)) && (
              <SearchBox
                ref={searchBoxRef}
                settings={runtimeSettings}
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
                urlWorkspaceId={hardWorkspaceId}
                layoutMode={masterLayoutMode}
                searchBarBlurPx={searchBarBlurPx}
                suggestionsBlurPx={effectiveSuggestionsBlurPx}
                centerContentOpen={!!((showNotesWidget && notesCenterNoteId) || (showEmailWidget && emailsCenterOpen))}
                workspaceThemingEnabled={workspaceThemingEnabled}
                resolvedGlowColor={resolvedGlowColorForShadows}
              />
            )}
          </div>
        </div>
      </ErrorBoundary>

      {/* Dynamic Global Styles */}
      <style jsx global>{`
        :root {
          --font-family: ${globalFontFamily};
          --color-primary: ${globalPrimaryColor};
          --color-secondary: ${settings.theme.colors.secondary};
          --color-accent: ${globalAccentColor};
          --transparency-global: ${settings.theme.transparency};
          --transparency-speed-dial: ${settings.speedDial.transparency};
          --glass-blur: ${settings.theme.glassEffect ? "16px" : "0px"};
          --glass-border: ${settings.theme.borders
          ? "1px solid rgba(255, 255, 255, 0.2)"
          : "none"};
        }

        .glass-morphism {
          backdrop-filter: blur(var(--glass-blur));
          background: rgba(
            255,
            255,
            255,
            var(--transparency-global, 0.1)
          ) !important;
          border: var(--glass-border) !important;
        }

        .speed-dial-glass {
          backdrop-filter: blur(var(--glass-blur));
          background: rgba(
            255,
            255,
            255,
            var(--transparency-speed-dial, 0.1)
          ) !important;
          border: var(--glass-border) !important;
        }
        .speed-dial-scope,
        .speed-dial-scope * {
          font-family: var(--speed-dial-font, var(--font-family)) !important;
        }
        .speed-dial-banner-override,
        .speed-dial-banner-override * {
          font-family: var(
            --banner-font-family,
            var(--speed-dial-font, var(--font-family))
          ) !important;
        }

        * {
          font-family: var(--font-family), system-ui, sans-serif !important;
        }

        /* Industrial JP-inspired font utility */
        .font-industrial-jp {
          font-family:
            var(--font-family), "Meiryo", "Noto Sans JP",
            "Hiragino Kaku Gothic ProN", system-ui, sans-serif !important;
          font-weight: 600;
          letter-spacing: 0.06em;
          font-feature-settings:
            "tnum" 1,
            "ss01" 1,
            "case" 1;
        }

        .text-primary {
          color: var(--color-primary) !important;
        }

        .text-accent {
          color: var(--color-accent) !important;
        }

        .bg-accent {
          background-color: var(--color-accent) !important;
        }

        .settings-force-white,
        .settings-force-white * {
          color: #fff !important;
          --text-rgb: 255, 255, 255 !important;
          font-family:
            "Inter", "SF Pro Text", "Segoe UI", system-ui, sans-serif !important;
          text-shadow: none !important;
        }

        .border-accent {
          border-color: var(--color-accent) !important;
        }

        /* Smooth transitions for all theme changes */
        * {
          transition:
            background-color 0.3s ease,
            color 0.3s ease,
            border-color 0.3s ease,
            backdrop-filter 0.3s ease !important;
        }

        /* Override text colors to use theme colors */
        .text-white {
          color: rgb(var(--text-rgb, 255, 255, 255)) !important;
        }

        .text-white\\/90 {
          color: rgba(var(--text-rgb, 255, 255, 255), 0.9) !important;
        }
        .text-white\\/80 {
          color: rgba(var(--text-rgb, 255, 255, 255), 0.8) !important;
        }
        .text-white\\/70 {
          color: rgba(var(--text-rgb, 255, 255, 255), 0.7) !important;
        }
        .text-white\\/60 {
          color: rgba(var(--text-rgb, 255, 255, 255), 0.6) !important;
        }
        .text-white\\/50 {
          color: rgba(var(--text-rgb, 255, 255, 255), 0.5) !important;
        }

        /* Scrolling behavior */
        /* Prevent page scrollbar when not in fullscreen; allow in fullscreen */
        html,
        body {
          overscroll-behavior: none;
        }
        html:not(:fullscreen),
        body:not(:fullscreen) {
          overflow: hidden !important;
          height: 100dvh !important;
          position: fixed !important;
          width: 100% !important;
        }
        html:fullscreen,
        body:fullscreen {
          overflow: auto !important;
          height: auto !important;
          position: static !important;
          width: auto !important;
        }
        /* Safari/WebKit fullscreen fallback */
        :-webkit-full-screen {
          overflow: auto !important;
        }
        /* PWA fullscreen mode */
        @media (display-mode: fullscreen) {
          html,
          body {
            overflow: auto !important;
            height: auto !important;
            position: static !important;
            width: auto !important;
          }
        }

        /* Allow scrolling only in AI chat areas */
        .ai-chat-container {
          overflow-y: auto !important;
        }

        /* No-scrollbar helper */
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        /* Scan line animation */
        @keyframes scan {
          0% {
            transform: translateY(-100%);
          }
          100% {
            transform: translateY(100vh);
          }
        }

        /* Raise center content when inline search is active */
        body.inline-active .main-center {
          padding-top: 1rem !important;
        }
      `}</style>
    </>
  );
}

export default App;
