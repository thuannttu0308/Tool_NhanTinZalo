const ZALO_URL = 'https://chat.zalo.me/';
const APP_PAGE = chrome.runtime.getURL('index.html');

const WAIT_LOAD = 30000;
const WAIT_RESULT = 7000;
const WAIT_CHAT = 7000;
const WAIT_SENT = 6000;

const wait = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({ url: APP_PAGE });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: APP_PAGE });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'sleep') {
    setTimeout(() => respond(true), Math.max(0, msg.ms || 0));
    return true;
  }
  if (msg.type === 'send') {
    sendToZalo(msg).then(respond, e => respond({ ok: false, error: e.message || String(e) }));
    return true;
  }
});

async function call(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabId, payload);
  }
}

// Chờ tới khi điều kiện đúng hoặc hết thời gian
async function until(fn, timeout, step = 400) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last && last.done) return last;
    await wait(step);
  }
  return last || {};
}

// Mở sẵn tab Zalo Web ở chế độ chạy ngầm
async function zaloTab() {
  let [tab] = await chrome.tabs.query({ url: 'https://chat.zalo.me/*' });
  if (!tab) tab = await chrome.tabs.create({ url: ZALO_URL, active: false, pinned: true });
  else if (tab.discarded) await chrome.tabs.reload(tab.id);
  await chrome.tabs.update(tab.id, { autoDiscardable: false });

  const r = await until(async () => {
    try {
      const st = await call(tab.id, { op: 'status' });
      return { done: st && st.loggedIn, st };
    } catch (e) {
      return { done: false };
    }
  }, WAIT_LOAD, 700);

  if (!r.done) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return null;
  }
  return tab;
}

async function sendToZalo({ phone, messages, delayMessage, dryRun }) {
  const tab = await zaloTab();
  if (!tab) {
    return { ok: false, fatal: true, error: 'Chưa đăng nhập Zalo Web. Hãy đăng nhập ở tab Zalo vừa mở rồi bấm Bắt đầu gửi lại' };
  }
  const id = tab.id;

  // Tìm đúng số điện thoại
  await call(id, { op: 'search', phone });
  const found = await until(async () => {
    const r = await call(id, { op: 'findResult', phone });
    return { done: r && r.found, ...r };
  }, WAIT_RESULT);
  if (!found.done) {
    await call(id, { op: 'clearSearch' });
    return { ok: false, error: 'Số chưa đăng ký Zalo hoặc không tìm thấy' };
  }

  // Mở chat và kiểm tra đúng người
  await call(id, { op: 'openResult', id: found.id });
  const chat = await until(async () => {
    const s = await call(id, { op: 'chatState' });
    const match = s.hasComposer && s.title && (!found.name || clean(s.title) === clean(found.name));
    return { done: match, ...s };
  }, WAIT_CHAT);
  if (!chat.hasComposer) return { ok: false, error: 'Không mở được cuộc trò chuyện' };
  if (!chat.done) return { ok: false, error: `Mở nhầm hội thoại (${chat.title || 'không rõ'}), đã bỏ qua` };

  // Gửi từng tin và xác nhận đã gửi
  for (let i = 0; i < messages.length; i++) {
    if (i) await wait(Math.max(0, delayMessage) * 1000);
    const before = new Set((await call(id, { op: 'chatState' })).bubbles);

    await call(id, { op: 'typeMessage', text: messages[i] });
    let typed = await until(async () => {
      const s = await call(id, { op: 'chatState' });
      return { done: !!s.composerText };
    }, 1500, 250);
    if (!typed.done) {
      await call(id, { op: 'typeFallback', text: messages[i] });
      typed = await until(async () => {
        const s = await call(id, { op: 'chatState' });
        return { done: !!s.composerText };
      }, 1500, 250);
    }
    if (!typed.done) return { ok: false, error: `Không điền được tin nhắn ${i + 1}`, partial: i };

    if (dryRun) {
      await call(id, { op: 'clearComposer' });
      continue;
    }

    const isSent = async () => {
      const s = await call(id, { op: 'chatState' });
      return { done: !s.composerText && s.bubbles.some(b => !before.has(b)) };
    };
    await call(id, { op: 'pressEnter' });
    let sent = await until(isSent, WAIT_SENT, 300);
    if (!sent.done) {
      const s = await call(id, { op: 'chatState' });
      if (s.composerText) {
        await call(id, { op: 'clickSend' });
        sent = await until(isSent, WAIT_SENT, 300);
      }
    }
    if (!sent.done) return { ok: false, error: `Tin nhắn ${i + 1} chưa được gửi đi`, partial: i };
  }
  return { ok: true, name: found.name };
}
