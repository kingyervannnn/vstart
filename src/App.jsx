import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import "./App.css";
import VivaldiSpeedDial from "./components/VivaldiSpeedDial";
import WorkspaceStrip from "./components/WorkspaceStrip";
import SearchBox from "./components/SearchBox";
import ClockWidget from "./components/ClockWidget";
import WeatherWidget from "./components/WeatherWidget";
import MusicController from "./components/MusicController";
import SettingsButton from "./components/SettingsButton";
import BackgroundRenderer from "./components/BackgroundRenderer";
import ErrorBoundary from "./components/ErrorBoundary";
import {
  getBackgroundURLById,
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

const normalizeAppearanceWorkspaceState = (raw) => {
  const enabled = !!raw?.enabled;
  const overrides =
    raw && typeof raw.overrides === "object" && raw.overrides
      ? raw.overrides
      : {};
  const lastSelectedId =
    typeof raw?.lastSelectedId === "string" && raw.lastSelectedId
      ? raw.lastSelectedId
      : DEFAULT_APPEARANCE_WORKSPACE_ID;
  return { enabled, overrides, lastSelectedId };
};

const resolveAppearanceWorkspaceTargetId = (
  state,
  requestedId,
  anchoredWorkspaceId,
) => {
  if (!state?.enabled) return DEFAULT_APPEARANCE_WORKSPACE_ID;
  if (requestedId === MASTER_APPEARANCE_ID) return MASTER_APPEARANCE_ID;
  const normalized =
    typeof requestedId === "string" && requestedId
      ? requestedId
      : DEFAULT_APPEARANCE_WORKSPACE_ID;
  if (
    normalized === DEFAULT_APPEARANCE_WORKSPACE_ID ||
    (anchoredWorkspaceId && normalized === anchoredWorkspaceId)
  ) {
    return DEFAULT_APPEARANCE_WORKSPACE_ID;
  }
  return normalized;
};

const resolveAppearanceProfileForWorkspace = (
  baseAppearance,
  state,
  workspaceId,
  anchoredWorkspaceId,
) => {
  if (!state?.enabled) return baseAppearance;
  const masterOverride = state?.overrides?.[MASTER_APPEARANCE_ID] || null;
  const overrides = state?.overrides || {};
  if (workspaceId === MASTER_APPEARANCE_ID) {
    return masterOverride || baseAppearance;
  }
  const baseEffective = masterOverride || baseAppearance;
  if (
    !workspaceId ||
    workspaceId === DEFAULT_APPEARANCE_WORKSPACE_ID ||
    (anchoredWorkspaceId && workspaceId === anchoredWorkspaceId)
  ) {
    // For default/anchored workspaces, merge default override on top of master override
    const defaultOverride = overrides[DEFAULT_APPEARANCE_WORKSPACE_ID];
    if (defaultOverride) {
      return { ...baseEffective, ...defaultOverride };
    }
    return baseEffective;
  }
  if (overrides[workspaceId]) return overrides[workspaceId];
  return baseEffective;
};

function App() {
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
  const searchBoxRef = useRef(null);
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
    },
    widgets: {
      showSeconds: false,
      twentyFourHour: false,
      units: "imperial", // 'metric' (°C) | 'imperial' (°F)
      clockPreset: "preset2", // 'preset1' | 'preset2'
      weatherPreset: "preset3", // 'preset1' | 'preset2' | 'preset3'
      enableMusicPlayer: false,
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
        matchWorkspaceTextColor: true,
        matchSearchBarBlur: true,
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
    } catch {}
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

  const resolveBackgroundSource = useCallback(async (meta) => {
    if (!meta) return null;
    const type = String(meta.type || "").toLowerCase();
    if (type === "custom" && meta.id) {
      try {
        const url = await getBackgroundURLById(meta.id);
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
      if (!meta) {
        updateWorkspaceBackgroundState((prev) => {
          if (!prev[workspaceId]) return prev;
          const next = { ...prev };
          const entry = prev[workspaceId];
          if (entry?.meta?.type === "custom" && entry.src) {
            try {
              URL.revokeObjectURL(entry.src);
            } catch {}
          }
          delete next[workspaceId];
          return next;
        });
        return;
      }

      let resolvedMeta = meta;
      let src = hintUrl || null;

      if (!src) {
        const resolved = await resolveBackgroundSource(resolvedMeta);
        if (!resolved) {
          resolvedMeta = null;
        } else {
          src = resolved;
        }
      }

      if (!resolvedMeta || !src) {
        if (src && resolvedMeta?.type === "custom") {
          try {
            URL.revokeObjectURL(src);
          } catch {}
        }
        updateWorkspaceBackgroundState((prev) => {
          if (!prev[workspaceId]) return prev;
          const next = { ...prev };
          const entry = prev[workspaceId];
          if (entry?.meta?.type === "custom" && entry.src) {
            try {
              URL.revokeObjectURL(entry.src);
            } catch {}
          }
          delete next[workspaceId];
          return next;
        });
        return;
      }

      if (resolvedMeta.type !== "custom" && !resolvedMeta.url) {
        resolvedMeta = { ...resolvedMeta, url: src };
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
          } catch {}
        }
        next[workspaceId] = { meta: resolvedMeta, src };
        return next;
      });
    },
    [resolveBackgroundSource, updateWorkspaceBackgroundState],
  );

  // Keep stored suggestions blur aligned with search bar blur while Match Bar is enabled
  useEffect(() => {
    const raw = localStorage.getItem("vivaldi-workspace-backgrounds");
    if (!raw) return;
    try {
      const metaMap = JSON.parse(raw);
      if (!metaMap || typeof metaMap !== "object") return;
      Object.entries(metaMap).forEach(([id, meta]) => {
        if (meta) {
          setWorkspaceBackgroundMeta(id, meta).catch(() => {});
        }
      });
    } catch {}
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
    } catch {}
  }, []);


  // Load Widgets settings from localStorage on mount (if present)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("widgetsSettings");
      if (raw) {
        const parsed = JSON.parse(raw);
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, ...parsed },
        }));
      }
    } catch {}
  }, []);

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
    } catch {}
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
        } catch {}
        if (a?.searchBar) {
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
        setSettings((prev) => ({
          ...prev,
          appearanceWorkspaces: normalized,
        }));
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
        } catch {}
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
        } catch {}
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
    } catch {}
  }, []);

  // Persist Widgets settings when changed
  useEffect(() => {
    try {
      localStorage.setItem("widgetsSettings", JSON.stringify(settings.widgets));
    } catch {}
  }, [settings.widgets]);

  // Persist Appearance + manual text color + speed dial settings
  useEffect(() => {
    try {
      localStorage.setItem(
        "appearanceSettings",
        JSON.stringify(settings.appearance),
      );
    } catch {}
  }, [settings.appearance]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "appearanceWorkspaces",
        JSON.stringify(
          normalizeAppearanceWorkspaceState(settings.appearanceWorkspaces),
        ),
      );
    } catch {}
  }, [settings.appearanceWorkspaces]);
  useEffect(() => {
    try {
      localStorage.setItem("searchSettings", JSON.stringify(settings.search));
    } catch {}
  }, [settings.search]);
  useEffect(() => {
    try {
      localStorage.setItem("generalSettings", JSON.stringify(settings.general));
    } catch {}
  }, [settings.general]);
  useEffect(() => {
    try {
      localStorage.setItem("aiSettings", JSON.stringify(settings.ai || {}));
    } catch {}
  }, [settings.ai]);
  useEffect(() => {
    try {
      localStorage.setItem("manualTextColor", settings.theme.colors.primary);
    } catch {}
  }, [settings.theme.colors.primary]);

  // Persist manual accent color when changed
  useEffect(() => {
    try {
      localStorage.setItem("manualAccentColor", settings.theme.colors.accent);
    } catch {}
  }, [settings.theme.colors.accent]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "themeLastInSettings",
        JSON.stringify(settings.theme.lastIn || {}),
      );
    } catch {}
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
        }),
      );
    } catch {}
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
    } catch {}
  }, [workspaces, activeWorkspaceId]);

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
    } catch {}
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
    () =>
      resolveAppearanceWorkspaceTargetId(
        appearanceWorkspacesState,
        selectedWorkspaceId,
        anchoredWorkspaceId,
      ),
    [appearanceWorkspacesState, selectedWorkspaceId, anchoredWorkspaceId],
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
    () =>
      resolveAppearanceWorkspaceTargetId(
        appearanceWorkspacesState,
        appearanceWorkspacesState.lastSelectedId,
        anchoredWorkspaceId,
      ),
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
      return {
        ...settings,
        appearance: activeAppearance,
        speedDial: {
          ...(settings.speedDial || {}),
          matchHeaderColor: !!effectiveMatchHeaderColor,
          matchHeaderFont: !!effectiveMatchHeaderFont,
        },
      };
    },
    [
      settings,
      activeAppearance,
      resolveWorkspaceScopedToggle,
      appearanceRuntimeTargetId,
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
      return {
        ...settings,
        appearance: editingAppearance,
        speedDial: {
          ...(settings.speedDial || {}),
          matchHeaderColor: !!effectiveMatchHeaderColor,
          matchHeaderFont: !!effectiveMatchHeaderFont,
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
  // Create centralized theme token resolver
  const themeTokenResolver = useMemo(() => {
    return createThemeTokenResolver(runtimeSettings, workspaces, currentPath);
  }, [runtimeSettings, workspaces, currentPath]);

  const workspaceBackgroundsEnabled = settings.background?.workspaceEnabled !== false;
  const backgroundFollowSlug = !!settings.background?.followSlug;
  const backgroundCandidateWorkspaceId = backgroundFollowSlug
    ? selectedWorkspaceId
    : activeWorkspaceId;
  const backgroundWorkspaceId = useMemo(() => {
    if (!workspaceBackgroundsEnabled) return null;
    if (!backgroundCandidateWorkspaceId) return null;
    if (
      anchoredWorkspaceId &&
      backgroundCandidateWorkspaceId === anchoredWorkspaceId
    )
      return null;
    return backgroundCandidateWorkspaceId;
  }, [
    backgroundCandidateWorkspaceId,
    anchoredWorkspaceId,
    workspaceBackgroundsEnabled,
  ]);
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
  const globalThemeTokens = useMemo(() => {
    return themeTokenResolver.resolveTokens(selectedWorkspaceId);
  }, [themeTokenResolver, selectedWorkspaceId]);

  // Extract resolved tokens for backward compatibility
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
        // Theme tokens are automatically resolved through the resolver
        // Background changes are handled separately and only on hard switches
        if (applyBackground && isHardSwitch) {
          // Background switching logic would go here if needed
          // For now, backgrounds are managed separately
        }
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
    setWorkspaces((prev) => [
      ...prev,
      { id, name: "New", icon: "LayoutList", position: prev.length },
    ]);
    setSpeedDials((prev) => ({ ...prev, [id]: [] }));
    setActiveWorkspaceId(id);
    setHoveredWorkspaceId(null);
  };
  const handleWorkspaceRemove = (id) => {
    setWorkspaces((prev) =>
      prev.filter((w) => w.id !== id).map((w, i) => ({ ...w, position: i })),
    );
    setSpeedDials((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    setWorkspaceBackgroundMeta(id, null).catch(() => {});
    if (hoveredWorkspaceId === id) {
      setHoveredWorkspaceId(null);
    }
    if (activeWorkspaceId === id && workspaces.length > 1) {
      setActiveWorkspaceId(workspaces[0].id);
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
    } catch {}
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
    } catch {}
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
          } catch {}
        }
        localStorage.setItem(onceKey, "1");
      } catch {}
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
          } catch {}
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
        } catch {}
        return;
      }
      try {
        const meta = JSON.parse(metaStr);
        if (meta?.type === "custom" && meta?.id) {
          try {
            const url = await getBackgroundURLById(meta.id);
            if (!url || cancelled) {
              // If custom background doesn't exist, fall back to default background
              if (!cancelled) {
                const fallbackMeta = { type: "builtin", id: "default-bg", url: defaultBackground };
                setGlobalBackgroundMeta(fallbackMeta);
                setCurrentBackground(defaultBackground);
                try {
                  localStorage.setItem("vivaldi-current-background-meta", JSON.stringify(fallbackMeta));
                } catch {}
              }
              return;
            }
            if (
              globalBackgroundObjectUrlRef.current &&
              globalBackgroundObjectUrlRef.current !== url
            ) {
              try {
                URL.revokeObjectURL(globalBackgroundObjectUrlRef.current);
              } catch {}
            }
            globalBackgroundObjectUrlRef.current = url;
            setGlobalBackgroundMeta(meta);
            setCurrentBackground(url);
          } catch {
            if (cancelled) return;
            // If custom background doesn't exist, fall back to default background
            const fallbackMeta = { type: "builtin", id: "default-bg", url: defaultBackground };
            setGlobalBackgroundMeta(fallbackMeta);
            setCurrentBackground(defaultBackground);
            try {
              localStorage.setItem("vivaldi-current-background-meta", JSON.stringify(fallbackMeta));
            } catch {}
          }
        } else if (meta?.url) {
          if (globalBackgroundObjectUrlRef.current) {
            try {
              URL.revokeObjectURL(globalBackgroundObjectUrlRef.current);
            } catch {}
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
    } catch {}
  }, [settings.background?.followSlug]);

  useEffect(() => {
    try {
      const value = settings.background?.workspaceEnabled === false ? "0" : "1";
      localStorage.setItem("vivaldi-background-workspaces-enabled", value);
    } catch {}
  }, [settings.background?.workspaceEnabled]);

  useEffect(
    () => () => {
      if (globalBackgroundObjectUrlRef.current) {
        try {
          URL.revokeObjectURL(globalBackgroundObjectUrlRef.current);
        } catch {}
      }
      Object.values(workspaceBackgroundsRef.current).forEach((entry) => {
        if (entry?.meta?.type === "custom" && entry.src) {
          try {
            URL.revokeObjectURL(entry.src);
          } catch {}
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
    } catch {}
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
        } catch {}
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
        } catch {}
        globalBackgroundObjectUrlRef.current = null;
      }

      setCurrentBackground(newBackground);
      setGlobalBackgroundMeta(meta || null);

      try {
        localStorage.setItem("vivaldi-current-background", newBackground);
      } catch {}

      try {
        if (meta) {
          localStorage.setItem(
            "vivaldi-current-background-meta",
            JSON.stringify(meta),
          );
        } else {
          localStorage.removeItem("vivaldi-current-background-meta");
        }
      } catch {}
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
        } catch {}
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
          } catch {}
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
            setWorkspaceBackgroundMeta(id, meta).catch(() => {});
          } else {
            setWorkspaceBackgroundMeta(id, null).catch(() => {});
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
      if (!workspaceId) return;
      setWorkspaceBackgroundMeta(workspaceId, meta, url).catch(() => {});
    },
    [setWorkspaceBackgroundMeta],
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
        } catch {}
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
        const initialTarget = enabled ? MASTER_APPEARANCE_ID : selectedWorkspaceId;
        const targetId = resolveAppearanceWorkspaceTargetId(
          state,
          initialTarget,
          anchorId,
        );
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
        const targetId = resolveAppearanceWorkspaceTargetId(
          state,
          workspaceId || state.lastSelectedId,
          anchorId,
        );
        const baseAppearance = prev.appearance || {};
        const overrides = state.overrides || {};
        const isMasterTarget = targetId === MASTER_APPEARANCE_ID;
        const useOverride =
          state.enabled && !isMasterTarget;
        // When editing master override, use existing master override if it exists, otherwise use base
        // When editing workspace override, use workspace override if it exists, otherwise use base
        const currentAppearance = isMasterTarget
          ? overrides[MASTER_APPEARANCE_ID] || baseAppearance
          : useOverride
            ? overrides[targetId] || baseAppearance
            : baseAppearance;
        const nextAppearance = mutator(currentAppearance) || currentAppearance;
        // When editing master override, ensure we merge with base to preserve all properties
        const finalAppearance = isMasterTarget && nextAppearance !== currentAppearance
          ? { ...baseAppearance, ...nextAppearance }
          : nextAppearance;
        const nextState = {
          ...state,
          lastSelectedId: workspaceId || targetId,
        };
        const applyEverywhere = isMasterTarget;
        if (
          finalAppearance === currentAppearance &&
          !applyEverywhere &&
          nextState.lastSelectedId === state.lastSelectedId &&
          nextState.enabled === state.enabled &&
          nextState.overrides === state.overrides
        ) {
          return prev;
        }
        if (applyEverywhere) {
          return {
            ...prev,
            appearanceWorkspaces: {
              ...nextState,
              overrides: {
                ...overrides,
                [MASTER_APPEARANCE_ID]: finalAppearance,
              },
            },
          };
        }
        if (useOverride) {
          return {
            ...prev,
            appearanceWorkspaces: {
              ...nextState,
              overrides: { ...overrides, [targetId]: finalAppearance },
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
    (mutator) =>
      updateAppearanceForWorkspace(appearanceEditingTargetId, mutator),
    [updateAppearanceForWorkspace, appearanceEditingTargetId],
  );
  useEffect(() => {
    applyAppearanceEditRef.current = applyAppearanceEdit;
  }, [applyAppearanceEdit]);

  const appearanceWorkspaceOptions = useMemo(() => {
    const anchoredWorkspace =
      workspaces.find((ws) => ws.id === anchoredWorkspaceId) || null;
    const baseLabel = anchoredWorkspace
      ? `Default / ${anchoredWorkspace.name || "Anchored"}`
      : "Default / Anchored";
    const items = [
      { id: MASTER_APPEARANCE_ID, label: "Master Override", anchored: false },
      {
        id: DEFAULT_APPEARANCE_WORKSPACE_ID,
        label: baseLabel,
        anchored: true,
      },
    ];
    workspaces.forEach((ws) => {
      if (anchoredWorkspaceId && ws.id === anchoredWorkspaceId) return;
      items.push({
        id: ws.id,
        label: ws.name || "Workspace",
        anchored: anchoredWorkspaceId === ws.id,
      });
    });
    return items;
  }, [workspaces, anchoredWorkspaceId]);

  // Apply theme styles to CSS custom properties for real-time updates
  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;

    // Font family from presets or workspace override
    root.style.setProperty("--font-family", globalFontFamily);

    const fallbackPrimary = stripAlphaFromHex(
      settings.theme.colors.primary || "#ffffff",
    );
    const manualRgb = hexToRgb(globalPrimaryColor) ||
      hexToRgb(fallbackPrimary) || { r: 255, g: 255, b: 255 };

    const applyAccent = () => {
      if (activeAppearance?.matchWorkspaceAccentColor) {
        root.style.setProperty("--color-accent", globalAccentColor);
        return;
      }
      root.style.setProperty("--color-accent", globalAccentColor);
    };

    const applyText = (hex) => {
      const normalized = stripAlphaFromHex(hex || fallbackPrimary);
      const rgb = hexToRgb(normalized) || manualRgb;
      root.style.setProperty("--color-primary", normalized);
      root.style.setProperty("--text-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
      applyAccent();
    };

    if (
      activeAppearance?.matchWorkspaceTextColor &&
      normalizedWorkspaceTextColor
    ) {
      applyText(globalPrimaryColor);
    } else {
      applyText(globalPrimaryColor);
    }

    root.style.setProperty(
      "--color-secondary",
      settings.theme.colors.secondary,
    );

    // Transparency values
    root.style.setProperty(
      "--transparency-global",
      String(settings.theme.transparency ?? 0.1),
    );
    root.style.setProperty(
      "--transparency-speed-dial",
      String(settings.speedDial.transparency ?? 0.1),
    );

    // Glass effect
    root.style.setProperty(
      "--glass-blur",
      settings.theme.glassEffect ? "16px" : "0px",
    );
    root.style.setProperty(
      "--glass-border",
      settings.theme.borders ? "1px solid rgba(255, 255, 255, 0.2)" : "none",
    );

    // Border style
    root.style.setProperty(
      "--border-radius",
      settings.theme.borderStyle === "rounded" ? "16px" : "4px",
    );
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

  // Resolve widget theme tokens with full workspace conformance
  const widgetThemeTokens = useMemo(() => {
    return themeTokenResolver.resolveWidgetTokens(selectedWorkspaceId);
  }, [themeTokenResolver, selectedWorkspaceId]);

  const legacyLayoutPreset = settings.widgets?.layoutPreset || "preset1";
  const clockPreset = settings.widgets?.clockPreset || legacyLayoutPreset;
  const weatherPreset = settings.widgets?.weatherPreset || legacyLayoutPreset;

  const rawMirror = !!activeAppearance?.mirrorLayout;
  const isMirrorLayout = rawMirror;

  const baseWidgetSettings = {
    ...settings.widgets,
    colorPrimary: widgetThemeTokens.textColor,
    colorAccent: widgetThemeTokens.accentColor,
    resolvedFontFamily: widgetThemeTokens.fontFamily,
    isMirrorLayout,
    verticalOffset: Number(settings?.widgets?.verticalOffset ?? 0),
  };

  const resolvedClockSettings = {
    ...baseWidgetSettings,
    layoutPreset: clockPreset,
  };

  const resolvedWeatherSettings = {
    ...baseWidgetSettings,
    layoutPreset: weatherPreset,
  };

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

  // Master layout with temporary (non-persistent) Modern override support
  const [tempModernOverride, setTempModernOverride] = useState(false);
  const baseMasterLayout =
    activeAppearance?.masterLayout === "classic" ? "classic" : "modern";
  const masterLayoutMode = tempModernOverride ? "modern" : baseMasterLayout;
  const isClassicLayout = masterLayoutMode === "classic";
  // Track current effective layout and manage temporary overrides to Modern when AI/Inline are active
  const layoutOverrideRef = useRef({ active: false, prev: null });
  const currentLayoutRef = useRef(masterLayoutMode);
  useEffect(() => {
    currentLayoutRef.current = masterLayoutMode;
  }, [masterLayoutMode]);
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
      onWorkspaceSelect={handleWorkspaceSelect}
      onWorkspaceDoubleSelect={handleWorkspaceDoubleSelect}
      onToggleAutoUrlDoubleClick={(val) =>
        setSettings((prev) => ({
          ...prev,
          general: { ...(prev.general || {}), autoUrlDoubleClick: !!val },
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

  const searchBarBlurPx = useMemo(() => {
    return resolveSearchBarBlurPx(activeAppearance?.searchBar || {});
  }, [activeAppearance?.searchBar?.blurPx, activeAppearance?.searchBar?.blurPreset]);

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
  const resolvedMusicStyleConfig = (() => {
    const base = musicMatchWorkspaceText
      ? {
          ...musicAppearanceCfg,
          resolvedTextColor: widgetThemeTokens.textColor,
          resolvedAccentColor: widgetThemeTokens.accentColor,
        }
      : musicAppearanceCfg;
    if (musicMatchSearchBarBlur && Number.isFinite(searchBarBlurPx)) {
      return { ...base, blurPx: searchBarBlurPx };
    }
    return base;
  })();

  const settingsButtonElement = (
    <SettingsButton
      onBackgroundChange={handleBackgroundChange}
      currentBackground={currentBackground}
      currentBackgroundMeta={globalBackgroundMeta}
      workspaceBackgrounds={workspaceBackgrounds}
      onWorkspaceBackgroundChange={
        workspaceBackgroundsEnabled
          ? handleWorkspaceBackgroundChange
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
      backgroundZoom={settings.background.zoom || 1}
      onBackgroundZoomChange={(zoom) =>
        setSettings((prev) => ({
          ...prev,
          background: { ...prev.background, zoom },
        }))
      }
      settings={appearancePanelSettings}
      workspaces={workspaces}
      widgetsSettings={settings.widgets}
      appearanceWorkspaceOptions={appearanceWorkspaceOptions}
      appearanceWorkspaceActiveId={appearanceEditingTargetId}
      appearanceWorkspacesEnabled={appearanceWorkspacesEnabled}
      isMasterAppearanceView={
        appearanceEditingTargetId === MASTER_APPEARANCE_ID ||
        !appearanceWorkspacesEnabled
      }
      onToggleAppearanceWorkspaces={handleToggleAppearanceWorkspaces}
      onSelectAppearanceWorkspace={handleSelectAppearanceWorkspace}
      onSettingsVisibilityChange={handleSettingsVisibilityChange}
      onSelectMasterLayout={(mode) =>
        applyAppearanceEdit((appearanceProfile) => {
          const nextLayout = mode === "classic" ? "classic" : "modern";
          try {
            localStorage.setItem("lastManualMasterLayout", nextLayout);
          } catch {}
          return {
            ...(appearanceProfile || {}),
            masterLayout: nextLayout,
          };
        })
      }
      onToggleShowSeconds={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, showSeconds: !!val },
        }))
      }
      onToggleTwentyFourHour={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, twentyFourHour: !!val },
        }))
      }
      onToggleUnits={(isF) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...prev.widgets, units: isF ? "imperial" : "metric" },
        }))
      }
      onSelectClockPreset={(preset) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...prev.widgets,
            clockPreset: preset,
            layoutPreset: undefined,
          },
        }))
      }
      onSelectWeatherPreset={(preset) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...prev.widgets,
            weatherPreset: preset,
            layoutPreset: undefined,
          },
        }))
      }
      onChangeSubTimezones={(list) =>
        setSettings((prev) => ({
          ...prev,
          widgets: {
            ...prev.widgets,
            subTimezones: Array.isArray(list)
              ? list
              : prev.widgets.subTimezones,
          },
        }))
      }
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
        setSettings((prev) => ({
          ...prev,
          speedDial: { ...prev.speedDial, blurPx: v },
        }))
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
          const targetId = resolveAppearanceWorkspaceTargetId(
            state,
            appearanceEditingTargetId,
            anchorId,
          );
          const next = { ...prev };
          next.speedDial = {
            ...(prev.speedDial || {}),
            matchHeaderColorByWorkspace: {
              ...(prev.speedDial?.matchHeaderColorByWorkspace || {}),
            },
          };
          if (appearanceWorkspacesEnabled && targetId !== DEFAULT_APPEARANCE_WORKSPACE_ID) {
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
          const targetId = resolveAppearanceWorkspaceTargetId(
            state,
            appearanceEditingTargetId,
            anchorId,
          );
          const next = { ...prev };
          next.speedDial = {
            ...(prev.speedDial || {}),
            matchHeaderFontByWorkspace: {
              ...(prev.speedDial?.matchHeaderFontByWorkspace || {}),
            },
          };
          if (appearanceWorkspacesEnabled && targetId !== DEFAULT_APPEARANCE_WORKSPACE_ID) {
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
      onToggleEnableMusicPlayer={(val) =>
        setSettings((prev) => ({
          ...prev,
          widgets: { ...(prev.widgets || {}), enableMusicPlayer: !!val },
        }))
      }
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
          const targetId = resolveAppearanceWorkspaceTargetId(
            state,
            appearanceEditingTargetId,
            anchorId,
          );
          const next = { ...prev };
          next.speedDial = {
            ...(prev.speedDial || {}),
            glowTransientByWorkspace: {
              ...(prev.speedDial?.glowTransientByWorkspace || {}),
            },
          };
          if (appearanceWorkspacesEnabled && targetId !== MASTER_APPEARANCE_ID) {
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

  return (
    <>
      {/* Wire SettingsButton events to settings updates */}
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
            zoom={settings.background.zoom || 1}
          />
          {/* Optional animated overlay (scan lines). Other universal overlays removed for clarity */}
          {activeAppearance?.animatedOverlay && (
            <div
              className="absolute inset-0 opacity-5 pointer-events-none"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 255, 0.3) 2px, rgba(0, 255, 255, 0.3) 4px)",
                animation: "scan 2s linear infinite",
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
              className="h-full flex flex-col p-4 space-y-4 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar shrink"
              style={{
                width: "var(--widgets-column-width)",
                minWidth: "clamp(12rem, 18vw, 16rem)",
                maxWidth: "var(--widgets-column-width)",
                flexBasis: "var(--widgets-column-width)",
              }}
            >
              <div className={clockPreset === "preset2" ? "mt-6" : ""}>
                <ClockWidget settings={resolvedClockSettings} />
              </div>
              {showClockWeatherSeparator && (
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
              <div className={weatherMarginClass} style={weatherMarginStyle}>
                <WeatherWidget settings={resolvedWeatherSettings} />
              </div>
              {/* Music controller sits near the bottom, slightly raised */}
              {settings?.widgets?.enableMusicPlayer !== false && (
                  <div className="mt-auto mb-12">
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

            {/* Center column - Main content area */}
            <div
              className={`flex-1 flex flex-col justify-start items-center p-6 ${isClassicLayout ? "pt-12" : "pt-32"} main-center relative`}
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
            <SearchBox
              ref={searchBoxRef}
              settings={runtimeSettings}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              urlWorkspaceId={hardWorkspaceId}
              layoutMode={masterLayoutMode}
              searchBarBlurPx={searchBarBlurPx}
              suggestionsBlurPx={effectiveSuggestionsBlurPx}
            />
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
