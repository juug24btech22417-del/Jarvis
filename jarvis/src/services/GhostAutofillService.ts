import { chromium, Page } from "playwright";
import { getUserProfile, UserProfile } from "@/lib/profile/userProfile";
import path from "path";
import os from "os";
import fs from "fs/promises";

export interface AutofillResult {
  success: boolean;
  url: string;
  domain: string;
  fieldsFilled: Array<{ field: string; selector: string; value: string }>;
  screenshotPath?: string;
  screenshotBase64?: string;
  error?: string;
}

export class GhostAutofillService {
  /**
   * Generates a portable, zero-dependency browser bookmarklet script
   * that users can execute on ANY webpage to instantly autofill forms with their profile.
   */
  static generateBookmarklet(profile: UserProfile): string {
    const pJson = JSON.stringify({
      fullName: profile.fullName,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone,
      address: profile.address1,
      city: profile.city,
      state: profile.state,
      zip: profile.postalCode,
      country: profile.country,
      company: profile.company || "",
    });

    return `javascript:(function(){
      const p = ${pJson};
      let count = 0;
      const nIS=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      const nTS=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
      function setVal(el,v){const s=el.tagName==='TEXTAREA'?nTS:nIS;if(s)s.call(el,v);else el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:true}));}
      function resolveLabel(el){const lb=el.getAttribute('aria-labelledby');if(lb)return lb.split(/\\s+/).map(id=>{const e=document.getElementById(id);return e?e.textContent:''}).join(' ').toLowerCase();const fl=el.id?document.querySelector('label[for="'+el.id+'"]'):null;if(fl)return(fl.textContent||'').toLowerCase();const pl=el.closest('label');if(pl)return(pl.textContent||'').toLowerCase();const c=el.closest('[data-params],[jsmodel],.freebirdFormviewerComponentsQuestionBaseRoot');if(c){const t=c.querySelector('.freebirdFormviewerComponentsQuestionBaseTitle,[role="heading"]');if(t)return(t.textContent||'').toLowerCase();}return '';}
      function matchAndFill(el) {
        if (!el || el.disabled || el.readOnly) return;
        const tag = el.tagName.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
        const t = (el.type || '').toLowerCase();
        if (['hidden', 'submit', 'button', 'reset', 'file', 'image','radio','checkbox'].includes(t)) return;
        const name = (el.name || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const ph = (el.placeholder || '').toLowerCase();
        const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const lbl = resolveLabel(el);
        const blob = [name, id, ph, ac, aria, lbl].join(' ');
        let val = '';
        if (t === 'email' || /\\b(email|e-mail|mail)\\b/.test(blob)) val = p.email;
        else if (t === 'tel' || /\\b(phone|mobile|contact.*num|cell|telephone|whatsapp)\\b/.test(blob)) val = p.phone;
        else if (/\\b(full.?name|your.?name|applicant.?name)\\b/.test(blob)) val = p.fullName;
        else if (/\\b(first.?name|fname|given.?name)\\b/.test(blob)) val = p.firstName;
        else if (/\\b(last.?name|lname|surname|family.?name)\\b/.test(blob)) val = p.lastName;
        else if (/\\bname\\b/.test(blob)) val = p.fullName;
        else if (/\\b(postal|pincode|pin.?code|zip)\\b/.test(blob)) val = p.zip;
        else if (/\\b(city|town|district)\\b/.test(blob)) val = p.city;
        else if (/\\b(state|province|region)\\b/.test(blob)) val = p.state;
        else if (/\\b(country|nation)\\b/.test(blob)) val = p.country;
        else if (/\\b(address|street|addr|line1)\\b/.test(blob)) val = p.address;
        else if (/\\b(company|organization|org)\\b/.test(blob)) val = p.company;
        if (val) {
          el.focus();
          setVal(el, val);
          count++;
          el.style.outline = '2px solid #00f3ff';
          el.style.boxShadow = '0 0 8px rgba(0,243,255,0.4)';
          el.style.backgroundColor = 'rgba(0, 243, 255, 0.05)';
        }
      }
      document.querySelectorAll('input, textarea, select').forEach(matchAndFill);
      const notice = document.createElement('div');
      notice.innerHTML = '⚡ <b>JARVIS Ghost Protocol</b>: ' + count + ' fields autofilled!';
      notice.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;background:#0a0e17;color:#00f3ff;padding:12px 20px;border-radius:8px;border:1px solid #00f3ff;box-shadow:0 0 20px rgba(0,243,255,0.4);font-family:sans-serif;font-size:14px;';
      document.body.appendChild(notice);
      setTimeout(() => notice.remove(), 4000);
    })();`.replace(/\s+/g, " ");
  }

  /**
   * Fills form fields on an active Playwright page.
   * Supports standard HTML forms AND React/Angular controlled inputs (Google Forms, etc.)
   * using the native input value setter technique.
   */
  static async autofillPage(
    page: Page,
    customProfile?: Partial<UserProfile>
  ): Promise<Array<{ field: string; selector: string; value: string }>> {
    const profile = { ...(await getUserProfile()), ...customProfile };

    // Run field detection and value injection inside the page context
    const filled = await page.evaluate((p) => {
      const results: Array<{ field: string; selector: string; value: string }> = [];

      // Native setters to bypass React/Angular controlled inputs
      const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

      function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, val: string) {
        const setter = el.tagName === "TEXTAREA" ? nativeTextareaSetter : nativeInputSetter;
        if (setter) {
          setter.call(el, val);
        } else {
          el.value = val;
        }
        // Dispatch a comprehensive set of events so React/Angular/Vue pick up the change
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
        el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      }

      function getDescriptor(el: Element): string {
        const name = (el.getAttribute("name") || "").toLowerCase();
        const id = (el.getAttribute("id") || "").toLowerCase();
        const ph = (el.getAttribute("placeholder") || "").toLowerCase();
        const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const title = (el.getAttribute("title") || "").toLowerCase();
        const jsname = (el.getAttribute("jsname") || "").toLowerCase();

        // Resolve aria-labelledby (used heavily by Google Forms)
        let ariaLabelledText = "";
        const labelledById = el.getAttribute("aria-labelledby");
        if (labelledById) {
          // Google Forms uses space-separated IDs in aria-labelledby
          const ids = labelledById.split(/\s+/);
          ariaLabelledText = ids
            .map((lid) => document.getElementById(lid)?.textContent || "")
            .join(" ")
            .toLowerCase();
        }

        // Standard label association
        let labelText = "";
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) labelText = (lbl.textContent || "").toLowerCase();
        }
        if (!labelText) {
          const parentLabel = el.closest("label");
          if (parentLabel) labelText = (parentLabel.textContent || "").toLowerCase();
        }

        // Google Forms: also check the question container for label text
        // They wrap inputs in [data-params] or [jsmodel] containers
        let containerLabel = "";
        const container = el.closest("[data-params]") || el.closest("[jsmodel]") || el.closest(".freebirdFormviewerComponentsQuestionBaseRoot");
        if (container) {
          const titleEl = container.querySelector(".freebirdFormviewerComponentsQuestionBaseTitle, [role='heading']");
          if (titleEl) containerLabel = (titleEl.textContent || "").toLowerCase();
        }

        return `${name} ${id} ${ph} ${ac} ${aria} ${title} ${jsname} ${ariaLabelledText} ${labelText} ${containerLabel}`;
      }

      function matchValue(blob: string, type: string): { fieldKey: string; val: string } | null {
        if (type === "email" || /\b(email|e-mail|mail)\b/.test(blob)) {
          return { fieldKey: "Email", val: p.email };
        } else if (type === "tel" || /\b(phone|mobile|cell|telephone|contact.*num|whatsapp)\b/.test(blob)) {
          return { fieldKey: "Phone", val: p.phone };
        } else if (/\b(full[-_\s]?name|your[-_\s]?name|applicant[-_\s]?name|complete[-_\s]?name)\b/.test(blob)) {
          return { fieldKey: "Full Name", val: p.fullName };
        } else if (/\b(first[-_\s]?name|fname|given[-_\s]?name)\b/.test(blob)) {
          return { fieldKey: "First Name", val: p.firstName };
        } else if (/\b(last[-_\s]?name|lname|surname|family[-_\s]?name)\b/.test(blob)) {
          return { fieldKey: "Last Name", val: p.lastName };
        } else if (/\bname\b/.test(blob)) {
          return { fieldKey: "Full Name", val: p.fullName };
        } else if (/\b(postal|pincode|pin[-_\s]?code|zip[-_\s]?code?)\b/.test(blob)) {
          return { fieldKey: "Postal Code", val: p.postalCode };
        } else if (/\b(city|town|district)\b/.test(blob)) {
          return { fieldKey: "City", val: p.city };
        } else if (/\b(state|province|region)\b/.test(blob)) {
          return { fieldKey: "State", val: p.state };
        } else if (/\b(country|nation)\b/.test(blob)) {
          return { fieldKey: "Country", val: p.country };
        } else if (/\b(address|street|addr|line1)\b/.test(blob)) {
          return { fieldKey: "Address", val: p.address1 };
        } else if (/\b(company|organization|org)\b/.test(blob)) {
          return { fieldKey: "Company", val: p.company || "" };
        } else if (/\b(job|designation|title|role)\b/.test(blob)) {
          return { fieldKey: "Job Title", val: p.jobTitle || "" };
        }
        return null;
      }

      const inputs = Array.from(
        document.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button']), textarea, select")
      ) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;

      for (const el of inputs) {
        if (el.disabled || ("readOnly" in el && (el as HTMLInputElement).readOnly)) continue;
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (["radio", "checkbox", "file", "image", "reset"].includes(type)) continue;

        const blob = getDescriptor(el);
        const match = matchValue(blob, type);

        if (match && match.val) {
          try {
            el.focus();

            if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
              setNativeValue(el as HTMLInputElement | HTMLTextAreaElement, match.val);
            } else if (el.tagName === "SELECT") {
              (el as HTMLSelectElement).value = match.val;
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }

            // Visual feedback — cyan glow matching JARVIS aesthetic
            (el as HTMLElement).style.outline = "2px solid #00f3ff";
            (el as HTMLElement).style.boxShadow = "0 0 8px rgba(0, 243, 255, 0.4)";

            const selector = el.id
              ? `#${el.id}`
              : el.name
              ? `[name="${el.name}"]`
              : el.tagName.toLowerCase();

            results.push({ field: match.fieldKey, selector, value: match.val });
          } catch {
            // Ignore non-interactable element
          }
        }
      }

      return results;
    }, profile);

    return filled;
  }

  /**
   * Launch browser, navigate to URL, autofill all detected fields,
   * capture confirmation screenshot, and return results.
   */
  static async autofillUrl(
    url: string,
    options: { headed?: boolean; customProfile?: Partial<UserProfile> } = {}
  ): Promise<AutofillResult> {
    let domain = "";
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = url;
    }

    let browser = null;
    try {
      browser = await chromium.launch({
        headless: !options.headed,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
      });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      });

      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500); // Give JS forms time to mount

      // Perform autofill across main page
      const fieldsFilled = await this.autofillPage(page, options.customProfile);

      // Check child frames / iframes if main page had few fields
      if (fieldsFilled.length === 0) {
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          try {
            const profile = { ...(await getUserProfile()), ...options.customProfile };
            const frameFilled = await frame.evaluate((p) => {
              const res: Array<{ field: string; selector: string; value: string }> = [];
              const inputs = Array.from(
                document.querySelectorAll("input:not([type='hidden']), textarea, select")
              ) as Array<HTMLInputElement>;
              for (const el of inputs) {
                const name = (el.name || el.id || el.placeholder || "").toLowerCase();
                let v = "";
                let f = "";
                if (el.type === "email" || /email/.test(name)) { v = p.email; f = "Email"; }
                else if (el.type === "tel" || /phone|mobile/.test(name)) { v = p.phone; f = "Phone"; }
                else if (/name/.test(name)) { v = p.fullName; f = "Name"; }
                if (v && f) {
                  el.value = v;
                  el.dispatchEvent(new Event("input", { bubbles: true }));
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                  res.push({ field: f, selector: el.name || el.id || "input", value: v });
                }
              }
              return res;
            }, profile);
            fieldsFilled.push(...frameFilled);
          } catch {
            // Frame evaluation protected
          }
        }
      }

      // Capture verification screenshot
      const ssPath = path.join(
        os.tmpdir(),
        `ghost_autofill_${Date.now()}_${Math.random().toString(36).slice(2)}.png`
      );
      const ssBuffer = await page.screenshot({ path: ssPath, fullPage: false });
      const base64 = ssBuffer.toString("base64");

      return {
        success: true,
        url,
        domain,
        fieldsFilled,
        screenshotPath: ssPath,
        screenshotBase64: base64,
      };
    } catch (err: any) {
      console.error("[GhostAutofillService] error:", err);
      return {
        success: false,
        url,
        domain,
        fieldsFilled: [],
        error: err?.message || String(err),
      };
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}
