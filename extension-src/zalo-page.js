// Giữ Zalo Web luôn ở trạng thái "đang hiển thị" để vẫn cập nhật giao diện khi tab chạy ngầm
(() => {
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.hasFocus = () => true;
    const stop = e => e.stopImmediatePropagation();
    document.addEventListener('visibilitychange', stop, true);
    window.addEventListener('blur', stop, true);

    const nativeRaf = window.requestAnimationFrame.bind(window);
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    const pending = new Map();
    let seq = 0;
    window.requestAnimationFrame = cb => {
      const id = ++seq;
      const raf = nativeRaf(t => { if (pending.has(id)) { pending.delete(id); cb(t); } });
      const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); nativeCancel(raf); cb(performance.now()); } }, 50);
      pending.set(id, { raf, timer });
      return id;
    };
    window.cancelAnimationFrame = id => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      nativeCancel(p.raf);
      clearTimeout(p.timer);
    };
  } catch (e) {}
})();
