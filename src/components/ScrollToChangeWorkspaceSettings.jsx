import React from 'react'

export default function ScrollToChangeWorkspaceSettings({
  settings,
  onToggleScrollToChangeWorkspace,
  onToggleScrollToChangeWorkspaceIncludeSpeedDial,
  onToggleScrollToChangeWorkspaceIncludeWholeColumn,
  onToggleScrollToChangeWorkspaceResistance,
  onChangeScrollToChangeWorkspaceResistanceIntensity,
}) {
  const scrollEnabled = !!(settings?.general?.scrollToChangeWorkspace)
  const includeSpeedDial = !!(settings?.general?.scrollToChangeWorkspaceIncludeSpeedDial)
  const includeWholeColumn = !!(settings?.general?.scrollToChangeWorkspaceIncludeWholeColumn)
  const resistanceEnabled = !!(settings?.general?.scrollToChangeWorkspaceResistance)
  const resistanceIntensity = Number(settings?.general?.scrollToChangeWorkspaceResistanceIntensity ?? 100)

  return (
    <div className="p-4 bg-white/5 border border-white/15 rounded-lg">
      <div className="flex flex-col gap-4">
        {/* Main toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-white text-sm font-medium">Scroll to change workspace</div>
            <div className="text-white/60 text-xs">When enabled, scrolling over the workspace buttons area changes workspaces.</div>
          </div>
          <label className="inline-flex items-center cursor-pointer select-none">
            <input
              type="checkbox"
              checked={scrollEnabled}
              onChange={(e) => onToggleScrollToChangeWorkspace?.(e.target.checked)}
              className="peer absolute opacity-0 w-0 h-0"
            />
            <div className="w-11 h-6 bg-white/20 rounded-full relative transition-colors peer-checked:bg-cyan-500/60">
              <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-all peer-checked:left-5 shadow" />
            </div>
          </label>
        </div>

        {scrollEnabled && (
          <div className="flex flex-col gap-3 pt-3 border-t border-white/10">
            {/* Include speed dial */}
            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg">
              <div>
                <div className="text-white text-sm font-medium">Include speed dial</div>
                <div className="text-white/60 text-xs">Also change workspaces when scrolling anywhere in the speed dial area. When off, scrolling only works at the bottom of the speed dial.</div>
              </div>
              <input
                type="checkbox"
                checked={includeSpeedDial}
                onChange={(e) => onToggleScrollToChangeWorkspaceIncludeSpeedDial?.(e.target.checked)}
                className="w-4 h-4"
              />
            </div>

            {/* Include whole column */}
            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg">
              <div>
                <div className="text-white text-sm font-medium">Include whole column</div>
                <div className="text-white/60 text-xs">
                  {includeSpeedDial 
                    ? "When enabled, scrolling anywhere in the entire left column (workspace buttons + speed dial area) will change workspaces."
                    : "Requires 'Include speed dial' to be enabled. When enabled, scrolling anywhere in the entire left column of the page will change workspaces."}
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeWholeColumn}
                onChange={(e) => onToggleScrollToChangeWorkspaceIncludeWholeColumn?.(e.target.checked)}
                disabled={!includeSpeedDial}
                className="w-4 h-4"
                title={!includeSpeedDial ? "Enable 'Include speed dial' first" : undefined}
              />
            </div>

            {/* Resistance scrolling with intensity slider in same field */}
            <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-white text-sm font-medium">Resistance scrolling</div>
                  <div className="text-white/60 text-xs">Requires more scroll distance to change workspace, making it less reactive to accidental scrolls.</div>
                </div>
                <input
                  type="checkbox"
                  checked={resistanceEnabled}
                  onChange={(e) => onToggleScrollToChangeWorkspaceResistance?.(e.target.checked)}
                  className="w-4 h-4 flex-shrink-0"
                />
              </div>
              {resistanceEnabled && (
                <div className="flex items-center gap-3 pt-3 border-t border-white/10">
                  <div className="text-white/60 text-xs min-w-[4rem]">Intensity:</div>
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="range"
                      min="50"
                      max="500"
                      step="10"
                      value={resistanceIntensity}
                      onChange={(e) => onChangeScrollToChangeWorkspaceResistanceIntensity?.(Number(e.target.value))}
                      className="flex-1"
                      title="Resistance scrolling intensity (px)"
                    />
                    <span className="text-white/50 text-[11px] min-w-[3rem] text-right">
                      {resistanceIntensity}px
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

