// Document Picture-in-Picture helper — opens a small ALWAYS-ON-TOP window
// (Chrome 116+) whose DOM nodes are moved out of the main page. While a
// Document-PiP window is open, Chrome keeps the opener page "visible", so
// requestAnimationFrame + camera inference keep running even when another
// app has focus — exactly what air-gestures need to control the whole
// laptop, not just the Jarvis tab.

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
    };
  }
}

/** Whether this browser supports Document PiP (Chrome/Edge 116+). */
export function pipSupported(): boolean {
  return typeof window !== "undefined" && !!window.documentPictureInPicture;
}

/** The open PiP window, if any. */
export function pipWindow(): Window | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __jarvisPip?: Window | null }).__jarvisPip ?? null;
}

/**
 * Open the always-on-top PiP window and move the given elements into it.
 * Elements are restored to their original spot when the PiP window closes.
 */
export async function openPiPWith(elements: HTMLElement[], size = { width: 320, height: 260 }) {
  if (!pipSupported()) throw new Error("Document Picture-in-Picture not supported (needs Chrome/Edge 116+)");

  const pip = await window.documentPictureInPicture!.requestWindow(size);
  (window as unknown as { __jarvisPip?: Window }).__jarvisPip = pip;

  // Basic dark styling so the moved nodes look right in the bare window.
  const style = pip.document.createElement("style");
  style.textContent = `
    html, body { margin: 0; background: #04070d; overflow: hidden; }
    ::-webkit-scrollbar { display: none; }
  `;
  pip.document.head.appendChild(style);

  for (const el of elements) {
    // Remember where the node came from so we can put it back.
    (el as HTMLElement & { __pipParent?: Node | null }).__pipParent = el.parentNode;
    pip.document.body.appendChild(el);
  }

  // On close, put everything back so React's DOM ownership stays intact.
  pip.addEventListener("pagehide", () => {
    for (const el of elements) {
      const parent = (el as HTMLElement & { __pipParent?: Node }).__pipParent;
      if (parent && el.parentNode === pip.document.body) parent.appendChild(el);
    }
    (window as unknown as { __jarvisPip?: Window | null }).__jarvisPip = null;
  });

  return pip;
}
