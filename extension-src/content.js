// Các thao tác đơn lẻ trên Zalo Web, việc chờ và kiểm tra do background.js điều phối
(() => {
  if (window.__nhanTinZalo) return;
  window.__nhanTinZalo = true;

  const $ = s => document.querySelector(s);
  const digits = s => String(s || '').replace(/\D/g, '');
  const isIcon = s => !s || [...s].every(ch => ch.codePointAt(0) >= 0xe000 && ch.codePointAt(0) <= 0xf8ff);
  const lines = el => (el ? el.innerText || '' : '').split('\n').map(s => s.trim()).filter(s => s && !isIcon(s));

  function samePhone(text, phone) {
    const d = digits(text);
    return !!d && (d === phone || (d.endsWith(phone.slice(1)) && [9, 10, 11].includes(d.length)));
  }

  function click(el) {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  }

  function key(el, name, code) {
    const o = { key: name, code: name, keyCode: code, which: code, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keypress', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  }

  function editor() {
    const box = $('#richInput');
    if (!box) return null;
    return box.isContentEditable ? box : box.querySelector('[contenteditable="true"]') || box;
  }

  function composerText() {
    const box = $('#richInput');
    if (!box) return '';
    return [...box.querySelectorAll('[id^="input_line_"]')].map(e => e.innerText).join('').trim();
  }

  function clearEditor(ed) {
    ed.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
  }

  const ops = {
    status() {
      return { loggedIn: !!$('#contact-search-input') };
    },

    search({ phone }) {
      const input = $('#contact-search-input');
      if (!input) return { ok: false };
      input.focus();
      input.select();
      if (!document.execCommand('insertText', false, phone) || input.value !== phone) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, phone);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return { ok: true, value: input.value };
    },

    clearSearch() {
      const input = $('#contact-search-input');
      if (!input) return { ok: false };
      input.focus();
      input.select();
      document.execCommand('delete');
      key(input, 'Escape', 27);
      return { ok: true };
    },

    findResult({ phone }) {
      const list = $('#searchResultList');
      if (!list) return { found: false };
      for (const item of list.querySelectorAll('[id^="friend-item-"]')) {
        const ls = lines(item);
        if (ls.some(l => samePhone(l, phone))) {
          const name = ls.find(l => !l.startsWith('Số điện thoại') && !samePhone(l, phone)) || '';
          return { found: true, id: item.id, name };
        }
      }
      return { found: false };
    },

    openResult({ id }) {
      const el = document.getElementById(id);
      if (!el) return { ok: false };
      click(el.firstElementChild || el);
      return { ok: true };
    },

    chatState() {
      const header = $('#chatViewContainer #header') || $('#header');
      const bubbles = [...document.querySelectorAll('#messageViewScroll [id^="bb_msg_id_"]')].slice(-40).map(e => e.id);
      return { title: lines(header)[0] || '', hasComposer: !!$('#richInput'), composerText: composerText(), bubbles };
    },

    typeMessage({ text }) {
      const ed = editor();
      if (!ed) return { ok: false };
      clearEditor(ed);
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return { ok: true };
    },

    typeFallback({ text }) {
      const ed = editor();
      if (!ed) return { ok: false };
      clearEditor(ed);
      text.split('\n').forEach((line, i) => {
        if (i) document.execCommand('insertLineBreak');
        if (line) document.execCommand('insertText', false, line);
      });
      return { ok: true };
    },

    clearComposer() {
      const ed = editor();
      if (ed) clearEditor(ed);
      return { ok: true };
    },

    pressEnter() {
      const ed = editor();
      if (!ed) return { ok: false };
      ed.focus();
      key(ed, 'Enter', 13);
      return { ok: true };
    },

    clickSend() {
      const area = $('#chat-input-right-layout-id') || $('#chatInput');
      if (!area) return { ok: false };
      const btn = [...area.querySelectorAll('div, button, span')].find(e => /^gửi$|^send$/i.test((e.innerText || '').trim()));
      if (!btn) return { ok: false };
      click(btn);
      return { ok: true };
    },
  };

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || !msg.op || !ops[msg.op]) return;
    try {
      respond(ops[msg.op](msg));
    } catch (e) {
      respond({ error: e.message });
    }
  });
})();
