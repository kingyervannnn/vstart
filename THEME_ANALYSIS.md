# Theme Integration Analysis

## Current State Analysis

### 1. Font Integration Logic

**Current Implementation:**
- Font presets defined in `WORKSPACE_FONT_PRESETS` in App.jsx
- Workspace-specific fonts stored in `settings.speedDial.workspaceTextFonts`
- Global font resolution through `globalFontFamily` variable
- Widgets use their own font resolution logic with `resolvedFontFamily` fallback

**Issues Identified:**
- Inconsistent font application across components
- Multiple font resolution paths creating confusion
- Clock/Weather widgets don't fully conform to workspace font switching

### 2. Text Color Integration Logic

**Current Implementation:**
- Base primary color in `settings.theme.colors.primary`
- Workspace-specific text colors in `settings.speedDial.workspaceTextColors`
- Global text color resolution through `globalPrimaryColor` variable
- URL-based text color switching via `workspaceTextByUrl` setting

**Issues Identified:**
- Complex conditional logic for text color resolution
- Inconsistent application across UI components
- Speed Dial popup, Settings, and AI model selector don't maintain unchangeable colors

### 3. Accent Color Integration Logic

**Current Implementation:**
- Base accent color in `settings.theme.colors.accent`
- Workspace-specific accent colors in `settings.speedDial.workspaceAccentColors`
- Global accent color resolution through `globalAccentColor` variable
- Glow colors can override accent colors in some contexts

**Issues Identified:**
- Accent color logic intertwined with glow color logic
- Inconsistent accent application in widgets
- Complex fallback chains causing unpredictable behavior

### 4. Glow Integration Logic

**Current Implementation:**
- Global glow settings in `settings.speedDial.glowEnabled`
- Workspace-specific glow colors in `settings.speedDial.workspaceGlowColors`
- URL-based glow switching via `glowByUrl` setting
- Transient glow effects via `glowTransient` setting

**Issues Identified:**
- Glow logic scattered across multiple components
- Inconsistent glow application timing
- Background switching doesn't properly respect glow settings

### 5. Workspace Switching Logic

**Current Implementation:**
- Single click vs double click modes controlled by `autoUrlDoubleClick`
- Hard vs soft switching logic in `handleWorkspaceSelect` and `handleWorkspaceDoubleSelect`
- URL slug generation and history management
- Theme application happens through various effect hooks

**Issues Identified:**
- Switching logic is complex and hard to follow
- Theme application is not synchronized with switching
- Background changes only on hard switches but logic is unclear
- Slug setting interaction with double-click mode is confusing

## Refactoring Requirements

### 1. Centralized Theme Token Management
- Create a unified theme token resolver
- Separate workspace-specific overrides from base tokens
- Ensure consistent token application across all components

### 2. Simplified Switching Logic
- Clarify hard vs soft switch behaviors
- Ensure theme tokens apply consistently based on switch type
- Maintain background changes only on hard switches

### 3. Component Guardrails
- Speed Dial popup must maintain unchangeable font and text color
- Settings panel must maintain unchangeable font and text color
- AI model selector must maintain unchangeable font and text color

### 4. Widget Conformance
- Clock/Weather widgets must fully conform to main + accent theming
- Ensure proper fallback to default when no workspace theme is set

### 5. Glow Synchronization
- Ensure glow effects are properly synchronized with theme switching
- Maintain transient vs sustained glow behaviors
- Proper cleanup of glow effects during rapid switching
