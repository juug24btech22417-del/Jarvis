// Bridge between the /orb page and the Electron shell that owns its window.
//
// The page cannot move, resize or makes itself click-through — those belong to
// the process that owns the window. Everything here is a request to the shell.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisOrb", {
  host: "electron",

  /**
   * Cursor streaming. The orb is always-on-top and almost never focused, so
   * the page gets no mousemove at all; the shell samples the OS cursor and
   * pushes it here, which is what makes the eyes follow you around the screen.
   */
  onCursor: (cb) => {
    const handler = (_e, point) => cb(point);
    ipcRenderer.on("orb:cursor", handler);
    return () => ipcRenderer.removeListener("orb:cursor", handler);
  },

  /** Stream OS-level clipboard text whenever user copies anything on Windows. */
  onClipboardChange: (cb) => {
    const handler = (_e, text) => cb(text);
    ipcRenderer.on("orb:clipboard-change", handler);
    return () => ipcRenderer.removeListener("orb:clipboard-change", handler);
  },

  /** Read current OS clipboard text directly without permission barriers. */
  getClipboard: () => ipcRenderer.invoke("orb:get-clipboard"),

  /** Pass the mouse through to whatever is behind the window (true), or accept it. */
  setIgnore: (ignore) => ipcRenderer.invoke("orb:set-ignore", ignore),

  /** Begin/end an OS-level drag. The shell owns the motion and reports whether
   *  the gesture actually moved, so a click is never mistaken for a drag. */
  dragStart: () => ipcRenderer.invoke("orb:drag-start"),
  dragEnd: () => ipcRenderer.invoke("orb:drag-end"),

  // ── Window Devourer ───────────────────────────────────────────────────
  /** The window the orb is currently hovering during a drag, or null. */
  onDevourTarget: (cb) => {
    const handler = (_e, target) => cb(target);
    ipcRenderer.on("orb:devour-target", handler);
    return () => ipcRenderer.removeListener("orb:devour-target", handler);
  },
  /** Fired once on mouse-up with the window that was under the orb. */
  onDevourDrop: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("orb:devour-drop", handler);
    return () => ipcRenderer.removeListener("orb:devour-drop", handler);
  },
  /** The captured frame for the window that was swallowed (arrives after drop). */
  onDevourCapture: (cb) => {
    const handler = (_e, capture) => cb(capture);
    ipcRenderer.on("orb:devour-capture", handler);
    return () => ipcRenderer.removeListener("orb:devour-capture", handler);
  },
  /** Which window is at a point (screen px). Omit the point for the cursor. */
  windowAt: (point) => ipcRenderer.invoke("orb:window-at", point || null),
  /** Snapshot one window by title. */
  captureWindow: (title) => ipcRenderer.invoke("orb:capture-window", title),
  /** True when the shell can hit-test windows on this platform. */
  devourSupported: () => ipcRenderer.invoke("orb:devour-supported"),

  hide: () => ipcRenderer.send("orb:hide"),
  quit: () => ipcRenderer.send("orb:quit"),
  /** Resize the orb companion window smoothly. */
  resize: (size) => ipcRenderer.invoke("orb:resize", size),
  /** Open an external URL in the default browser. */
  openExternal: (url) => ipcRenderer.send("orb:open-external", url),
  /** Open a file on disk with the default system application. */
  openPath: (filePath) => ipcRenderer.invoke("orb:open-path", filePath),
  /** Get all visible window titles on the desktop in ~5ms via native Electron DWM. */
  getActiveWindows: () => ipcRenderer.invoke("orb:get-active-windows"),
  /** Open the full JARVIS desktop (panels, dashboards) in the browser. */
  openApp: () => ipcRenderer.send("orb:open-app"),
  /** Native right-click menu: show/hide, open the full app, reload, quit. */
  menu: () => ipcRenderer.send("orb:menu"),
});
