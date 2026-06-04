// Login-page autofill script. Pierces open shadow roots (Reddit's new
// login renders inside <faceplate-text-input> custom elements), has
// specific selectors for Reddit/X/Instagram/TikTok/RedGIFs, retries on
// a 250ms tick for 10 seconds, watches MutationObserver for the same
// window, sets values via the prototype setter so React/Vue/Lit accept
// the input event, and auto-clicks the platform's Next/Login button
// once both fields are filled.
//
// Shared by:
//   • the standalone single-account browser (src/main/index.js)
//   • the Oserus Browser locked-session tabs (src/renderer/browser/*)

function buildAutofillScript(safeUser, safePass) {
  return `
    (() => {
      if (window.__oserusAutofillActive) return;
      window.__oserusAutofillActive = true;
      const u = ${safeUser};
      const p = ${safePass};

      function deepQueryAll(root, sel) {
        const out = [];
        const walk = (node) => {
          if (!node) return;
          if (node.querySelectorAll) {
            try { out.push(...node.querySelectorAll(sel)); } catch {}
          }
          if (node.shadowRoot) walk(node.shadowRoot);
          const kids = node.children || [];
          for (let i = 0; i < kids.length; i++) walk(kids[i]);
        };
        walk(root);
        return out;
      }
      function deepFind(sel) {
        const all = deepQueryAll(document.documentElement, sel);
        return all.find((el) => el.offsetParent !== null && !el.disabled && !el.readOnly) || null;
      }
      function setVal(el, v) {
        if (!el || el.value === v) return false;
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, v); else el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        return true;
      }

      const host = location.hostname;
      const isReddit    = /(^|\\.)reddit\\.com$/.test(host);
      const isX         = /(^|\\.)(x|twitter)\\.com$/.test(host);
      const isInstagram = /(^|\\.)instagram\\.com$/.test(host);
      const isTikTok    = /(^|\\.)tiktok\\.com$/.test(host);
      const isRedGifs   = /(^|\\.)redgifs\\.com$/.test(host);

      const userSel = [
        isReddit && 'input#login-username',
        isReddit && 'input[name="username"]',
        isX && 'input[autocomplete="username"]',
        isX && 'input[name="text"]',
        isX && 'input[data-testid="ocfEnterTextTextInput"]',
        isInstagram && 'input[name="username"]',
        isInstagram && 'input[aria-label*="username" i]',
        isTikTok && 'input[name="username"]',
        isTikTok && 'input[type="text"][placeholder*="mail" i]',
        isTikTok && 'input[type="text"][placeholder*="sername" i]',
        isRedGifs && 'input[name="login"]',
        'input[autocomplete="username"]',
        'input[name="username"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[name="loginfmt"]',
        'input[id*="login" i][type="text"]',
        'input[placeholder*="sername" i]',
        'input[placeholder*="mail" i]',
      ].filter(Boolean);

      const passSel = [
        isReddit && 'input#login-password',
        isReddit && 'input[name="password"]',
        isX && 'input[autocomplete="current-password"]',
        isX && 'input[name="password"]',
        isInstagram && 'input[name="password"]',
        isInstagram && 'input[aria-label*="password" i]',
        isTikTok && 'input[type="password"]',
        isRedGifs && 'input[type="password"]',
        'input[autocomplete="current-password"]',
        'input[name="password"]',
        'input[type="password"]',
        'input[placeholder*="assword" i]',
      ].filter(Boolean);

      const submitSel = [
        isReddit && 'button[type="submit"]',
        isX && 'div[role="button"][data-testid="LoginForm_Login_Button"]',
        isX && 'button[data-testid="LoginForm_Login_Button"]',
        isX && 'div[role="button"][data-testid$="next_button"]',
        isInstagram && 'button[type="submit"]',
        isTikTok && 'button[type="submit"]',
        'button[type="submit"]',
        'button[data-testid*="login" i]',
      ].filter(Boolean);

      const filled = { user: false, pass: false, submitted: false };

      function findFirst(list) {
        for (const s of list) { const el = deepFind(s); if (el) return el; }
        return null;
      }

      function tryFill() {
        const uEl = findFirst(userSel);
        const pEl = findFirst(passSel);
        if (uEl && !filled.user) { if (setVal(uEl, u)) filled.user = true; }
        if (pEl && !filled.pass) { if (setVal(pEl, p)) filled.pass = true; }
        return filled.user && filled.pass;
      }

      function trySubmit() {
        if (filled.submitted) return;
        if (!filled.user || !filled.pass) return;
        const btn = findFirst(submitSel);
        if (!btn) return;
        try { btn.click(); filled.submitted = true; } catch {}
      }

      if (tryFill()) return;

      const start = Date.now();
      const t = setInterval(() => {
        const done = tryFill();
        if (done || Date.now() - start > 10000) clearInterval(t);
      }, 250);

      try {
        const mo = new MutationObserver(() => { tryFill(); });
        mo.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => mo.disconnect(), 10000);
      } catch {}
    })();
  `;
}

module.exports = { buildAutofillScript };
