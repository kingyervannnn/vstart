let settingsOpenFlag = false;

export function setSettingsOpen(open) {
  settingsOpenFlag = !!open;
}

export function isSettingsOpen() {
  return settingsOpenFlag;
}

