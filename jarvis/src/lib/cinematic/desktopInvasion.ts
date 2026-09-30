"use client";

// ─── Desktop invasion — real Document-Picture-in-Picture hero windows ─────
//
// The in-page assault windows are the reliable, always-works layer. This
// helper is the bonus: it opens REAL always-on-top OS windows, each running a
// live hero HUD, so the sequence spills out of the browser tab and across the
// desktop. Document PiP requires transient user activation, so this is only
// ever called from a click (the ENGAGE button in HeroAssault) — never from the
// voice trigger, where activation is absent.
//
// Best-effort by design: Chrome may refuse additional windows, so we stop at
// the first failure rather than throwing.

export interface AssaultHero {
  id: string;
  name: string;
  tag: string;
  color: string;
}

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
    };
  }
}

function heroDoc(hero: AssaultHero): string {
  const c = hero.color;
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{height:100%;background:#04070d;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif}
    .wrap{position:relative;height:100%;display:flex;flex-direction:column;justify-content:space-between;
      padding:10px 12px;color:#e8f4ff;border:1px solid ${c}66;box-shadow:inset 0 0 40px ${c}22}
    .bar{display:flex;justify-content:space-between;align-items:center;font-size:10px;letter-spacing:.22em;
      color:${c};text-transform:uppercase}
    .name{font-size:20px;letter-spacing:.14em;font-weight:800;color:#fff;
      text-shadow:0 0 14px ${c},0 0 28px ${c}88}
    .tag{font-size:10px;letter-spacing:.24em;color:#9fc7e0;text-transform:uppercase}
    .scan{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,${c},transparent);
      animation:scan 2.4s linear infinite}
    @keyframes scan{0%{top:6%}100%{top:94%}}
    .grid{position:absolute;inset:0;opacity:.18;background-image:
      linear-gradient(${c}33 1px,transparent 1px),linear-gradient(90deg,${c}33 1px,transparent 1px);
      background-size:26px 26px;animation:drift 6s linear infinite}
    @keyframes drift{0%{background-position:0 0}100%{background-position:26px 26px}}
    .bars{display:flex;gap:3px;align-items:flex-end;height:26px}
    .bars i{width:4px;background:${c};box-shadow:0 0 8px ${c};animation:pulse 1s ease-in-out infinite}
    @keyframes pulse{0%,100%{height:20%}50%{height:100%}}
    .ring{position:absolute;top:50%;right:14px;width:52px;height:52px;margin-top:-26px;border-radius:50%;
      border:2px solid ${c}55;border-top-color:${c};animation:spin 1.8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style></head><body>
    <div class="wrap">
      <div class="grid"></div><div class="scan"></div>
      <div class="bar"><span>◈ J.A.R.V.I.S · ASSAULT LINK</span><span>LIVE</span></div>
      <div>
        <div class="name">${hero.name}</div>
        <div class="tag">${hero.tag}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div class="bars">${Array.from({ length: 9 })
          .map((_, i) => `<i style="animation-delay:${(i * 0.11).toFixed(2)}s"></i>`)
          .join("")}</div>
        <div class="tag">SIG 100%</div>
      </div>
      <div class="ring"></div>
    </div>
    <script>
      // Signature chatter so the window never looks static.
      setInterval(function(){
        var el=document.querySelector('.bars');
        if(!el) return;
        var kids=el.children;
        for(var i=0;i<kids.length;i++){
          kids[i].style.animationDuration=(0.6+Math.random()*0.9).toFixed(2)+'s';
        }
      }, 900);
    </script>
  </body></html>`;
}

/** Open up to `max` real PiP hero windows. Returns how many opened. */
export async function openAssaultWindows(
  heroes: AssaultHero[],
  max = 3
): Promise<number> {
  if (typeof window === "undefined") return 0;
  const dpip = window.documentPictureInPicture;
  if (!dpip) return 0;

  let opened = 0;
  for (const hero of heroes.slice(0, max)) {
    try {
      const win = await dpip.requestWindow({ width: 300, height: 210 });
      win.document.open();
      win.document.write(heroDoc(hero));
      win.document.close();
      opened++;
    } catch {
      // Activation consumed or window refused — keep whatever we already got.
      break;
    }
  }
  return opened;
}

export function assaultPiPSupported(): boolean {
  return typeof window !== "undefined" && !!window.documentPictureInPicture;
}
