import React from 'react';
import {
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
} from './context-menu';

export function HeaderColorContextMenu({
  workspaceId = null,
  workspaceName = 'Base',
  selectedMode = 'text', // 'text' | 'accent' | 'glow'
  onModeChange,
}) {
  const handleChange = (val) => {
    const mode = String(val);
    if (onModeChange) {
      onModeChange(mode);
    }
  };

  // Normalize workspace name for display
  const displayName = workspaceName || (workspaceId ? 'Workspace' : 'Base');

  return (
    <div>
      <ContextMenuLabel className="px-2 py-1.5 text-sm font-medium text-white/90">
        {displayName}
      </ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuRadioGroup value={selectedMode} onValueChange={handleChange}>
        <ContextMenuRadioItem 
          value="text"
          className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-white/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-white/5"
        >
          Text Color
        </ContextMenuRadioItem>
        <ContextMenuRadioItem 
          value="accent"
          className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-white/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-white/5"
        >
          Accent Color
        </ContextMenuRadioItem>
        <ContextMenuRadioItem 
          value="glow"
          className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-white/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-white/5"
        >
          Outer Glow Color
        </ContextMenuRadioItem>
      </ContextMenuRadioGroup>
    </div>
  );
}
