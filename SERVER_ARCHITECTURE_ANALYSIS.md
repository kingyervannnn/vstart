# Server Architecture Analysis & Recommendations

## Current State

### Active Services (8 services)
1. **icons-api** (3100) - Icon upload/management
2. **ai-api** (3200) - LLM routing (LM Studio/OpenAI/OpenRouter)
3. **image-search-api** (3300) - Image search (OpenWeb Ninja, Yandex, TinEye)
4. **gmail-api** (3500) - Gmail OAuth & inbox fetching
5. **backgrounds-api** (3600) - Background upload/management
6. **workspace-profiles-api** (3700) - Workspace profile caching (created but not used)
7. **stt-api** (8090) - Speech-to-text (Whisper)
8. **tts-api** (8088) - Text-to-speech (optional profile)

### External Services Proxied
- SearXNG (host:8888)
- Firecrawl (host:3002)
- Music backend (host:26538)
- Open-Meteo (weather)

## Issues Identified

### 1. **Fragmentation**
- 8 separate services, each with its own port
- No unified API gateway
- Each service handles its own CORS/health checks
- Duplicate code patterns across services

### 2. **Unused Infrastructure**
- `workspace-profiles-api` exists but client doesn't use it
- Client still computes workspace profiles client-side
- Server-side caching opportunity wasted

### 3. **Performance Gaps**
- Workspace switching lag (theme/appearance resolution)
- No server-side precomputation of expensive operations
- Client does heavy computation that could be offloaded

### 4. **Organization**
- No logical grouping of related services
- Each service is independent (good for isolation, bad for cohesion)
- No shared utilities or middleware

## Recommendations

### Option A: Unified API Gateway (Recommended)

**Consolidate into 3 logical services:**

1. **`core-api`** (port 3001)
   - Workspace profiles (precompute appearance/themes)
   - Settings sync/validation
   - Workspace switching coordination
   - Shared utilities

2. **`media-api`** (port 3002)
   - Backgrounds management
   - Icons management
   - Image search
   - Media caching/optimization

3. **`integrations-api`** (port 3003)
   - AI/LLM routing
   - Gmail OAuth/inbox
   - STT/TTS
   - External service proxies

**Benefits:**
- Reduced complexity (3 services vs 8)
- Better resource utilization
- Shared middleware (auth, logging, caching)
- Easier to add features (workspace switching optimization)
- Single point for workspace profile precomputation

### Option B: Enhanced Current Architecture

**Keep separate services but add:**

1. **API Gateway** (port 3001)
   - Routes to all services
   - Unified CORS/health checks
   - Request batching
   - Workspace profile coordination

2. **Workspace Service** (enhance existing)
   - Precompute all workspace profiles on settings change
   - Cache theme token resolutions
   - Batch CSS custom property calculations
   - WebSocket for real-time workspace updates

3. **Shared Middleware Package**
   - Common logging
   - Error handling
   - Rate limiting
   - Health checks

### Option C: Hybrid Approach (Best for Performance)

**Keep critical services separate, add coordination layer:**

1. **`workspace-orchestrator`** (NEW - port 3001)
   - Precomputes workspace profiles
   - Manages workspace switching state
   - Coordinates theme/appearance resolution
   - WebSocket for real-time sync
   - Caches expensive computations

2. **Keep existing services** (icons, backgrounds, ai, gmail, etc.)
   - They work well independently
   - Just add workspace-orchestrator as coordinator

3. **Client Integration**
   - Fetch precomputed profiles from orchestrator
   - Fallback to client-side if server unavailable
   - Use WebSocket for instant workspace switches

## Specific Performance Improvements

### 1. Workspace Switching Optimization

**Current:** Client computes appearance/themes on every switch
**Proposed:** Server precomputes all workspace profiles

```javascript
// Server precomputes on settings change
POST /workspace-orchestrator/precompute
→ Computes all workspace profiles
→ Caches theme tokens
→ Stores CSS custom property maps
→ Returns immediately

// Client fetches on switch
GET /workspace-orchestrator/profile/:workspaceId
→ Returns precomputed profile instantly
→ No client-side computation needed
```

### 2. Batch Operations

**Current:** Multiple API calls for related operations
**Proposed:** Single batch endpoint

```javascript
POST /workspace-orchestrator/batch
{
  "operations": [
    { "type": "getProfile", "workspaceId": "1" },
    { "type": "getBackground", "workspaceId": "1" },
    { "type": "getTheme", "workspaceId": "1" }
  ]
}
```

### 3. WebSocket for Real-time Updates

**Current:** Polling or manual refresh
**Proposed:** WebSocket connection

```javascript
// Client connects once
ws://workspace-orchestrator/ws

// Server pushes updates
{
  "type": "workspaceProfileUpdated",
  "workspaceId": "1",
  "profile": { ... }
}
```

## Implementation Priority

### Phase 1: Quick Wins (1-2 days)
1. ✅ Enable workspace-profiles-api in client
2. ✅ Add batch endpoint to existing services
3. ✅ Implement WebSocket for workspace updates

### Phase 2: Organization (3-5 days)
1. Create workspace-orchestrator service
2. Move workspace profile logic to server
3. Add shared middleware package
4. Update client to use server-side profiles

### Phase 3: Optimization (1 week)
1. Precompute all profiles on settings change
2. Add Redis for distributed caching
3. Implement request batching
4. Add performance monitoring

## Recommendation

**Go with Option C (Hybrid Approach)** because:
- ✅ Minimal disruption to existing services
- ✅ Maximum performance gain for workspace switching
- ✅ Can be implemented incrementally
- ✅ Keeps services focused and maintainable
- ✅ Best ROI for the lag issue you're experiencing

The workspace-orchestrator would specifically solve your "theming falls behind during fast workspace switching" problem by precomputing everything server-side.


