// Bridge from the /stealth page to the Electron shell that owns the window.
//
// The page must never claim to be capture-safe on its own — only the process
// that owns the window can know, so the shell reports the OS's answer and the
// page renders THAT. Same for opacity: transparency belongs to the window, not
// to CSS.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisOverlay", {
  /** True when running inside the protected Electron shell. */
  host: "electron",
  /** Real opacity of the window itself (0.15..1). */
  setOpacity: (value) => ipcRenderer.invoke("overlay:set-opacity", value),
  /** What the OS says about this window's capture affinity. */
  getStatus: () => ipcRenderer.invoke("overlay:status"),
  /** Current window geometry (in DIP) plus the display scale factor, so the
   * page's resize grip can turn cursor movement into window pixels. */
  getBounds: () => ipcRenderer.invoke("overlay:get-bounds"),
  /** Resize the window from the page's grip. The top-left corner stays put. */
  setSize: (size) => ipcRenderer.invoke("overlay:set-size", size),
  /** Resize AND reposition — what a west/north edge drag needs, where the edge
   * under the cursor is the one that has to follow it. */
  setBounds: (box) => ipcRenderer.invoke("overlay:set-bounds", box),

  /** Hide the HUD without quitting it (Esc). The overlay is always-on-top, so
   * hiding is the quiet way out during a call — Ctrl+Shift+H brings it back. */
  hide: () => ipcRenderer.send("overlay:hide"),
  /** Ask the shell to bring this window forward and focus it. */
  focus: () => ipcRenderer.send("overlay:focus"),
  /** OS-level clipboard write — works without window focus. */
  copy: (text) => ipcRenderer.invoke("overlay:copy", text),
  /** Fires when the WINDOW takes focus, so the page can focus its text box. */
  onFocus: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("overlay:focus", handler);
    return () => ipcRenderer.removeListener("overlay:focus", handler);
  },
  /**
   * Global shortcuts from the shell (Ctrl+Shift+L, M, A, R, E, S, D, P, C, X, K).
   *
   * They have to be registered in the main process: the overlay deliberately
   * sits behind the app the user is working in, and that app owns the keyboard
   * focus — so a key handler in this page would never fire. The command ids are
   * the same ones src/lib/overlay/shortcuts.ts renders in the ⌘ panel.
   */
  onCommand: (cb) => {
    const handler = (_e, command) => cb(String(command));
    ipcRenderer.on("overlay:command", handler);
    return () => ipcRenderer.removeListener("overlay:command", handler);
  },
  /** Report from the shell on load (fires once, plus on demand). */
  onStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on("overlay:status", handler);
    return () => ipcRenderer.removeListener("overlay:status", handler);
  },
  close: () => ipcRenderer.send("overlay:close"),
});
