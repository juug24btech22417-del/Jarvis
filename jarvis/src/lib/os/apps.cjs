// Launchable app catalog, shared by the phone broker (ARC REMOTE's APPS tab)
// and the presence automations (launch these when you get home).
//
// Kept as its own module so the broker can require it without starting a server.

const APPS = {
  spotify: { label: "Spotify", cmd: 'start "" "spotify:"' },
  chrome: { label: "Chrome", cmd: 'start "" chrome' },
  explorer: { label: "Files", cmd: 'start "" explorer' },
  terminal: { label: "Terminal", cmd: 'start "" cmd' },
  notepad: { label: "Notepad", cmd: 'start "" notepad' },
  calc: { label: "Calculator", cmd: 'start "" calc' },
  taskmgr: { label: "Task Manager", cmd: 'start "" taskmgr' },
};

module.exports = { APPS };
