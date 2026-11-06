(() => {
  'use strict';

  const STATUS_HEADER = 'Trạng thái';
  const CONTENT_HEADER = 'Nội dung tin nhắn đã gửi';
  const SENT = 'Đã gửi';
  const NAME_HEADER = 'Đơn vị kinh doanh';
  const STORE_KEY = 'zalo-tool-settings-v1';
  const TABLE_LIMIT = 300;

  const $ = id => document.getElementById(id);
  let sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s == null ? '' : s).normalize('NFC').trim().toLowerCase();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    fileName: '',
    headers: [],
    rows: [],
    phoneCol: -1,
    nameCol: -1,
    statusCol: -1,
    contentCol: -1,
    blocks: [['', '', '']],
    delayCustomer: 5,
    delayMessage: 2,
    limit: 0,
    target: 'app',
    running: false,
    paused: false,
    stopped: false,
    filter: 'all',
    currentRow: null,
    manualSkipped: new Set(),
    manualPicks: null,
  };

  // Lưu cài đặt
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      if (Array.isArray(s.blocks) && s.blocks.length) {
        const blocks = s.blocks.slice();
        while (blocks.length > 1 && blocks[blocks.length - 1].every(t => !String(t).trim())) blocks.pop();
        state.blocks = blocks;
      }
      if (s.delayCustomer != null) state.delayCustomer = s.delayCustomer;
      if (s.delayMessage != null) state.delayMessage = s.delayMessage;
      if (s.limit != null) state.limit = s.limit;
      if (s.target) state.target = s.target;
    } catch (e) {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        blocks: state.blocks,
        delayCustomer: state.delayCustomer,
        delayMessage: state.delayMessage,
        limit: state.limit,
        target: state.target,
      }));
    } catch (e) {}
  }

  function cellText(v) {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    return String(v).trim();
  }

  function normalizePhone(raw) {
    const first = cellText(raw).split(/[\/,;|]/)[0];
    let d = first.replace(/\D/g, '');
    if (d.startsWith('84') && d.length === 11) d = '0' + d.slice(2);
    if (d.length === 9 && !d.startsWith('0')) d = '0' + d;
    return /^0\d{9}$/.test(d) ? d : '';
  }

  // Đọc/ghi Excel: ExcelJS cho .xlsx (giữ định dạng), SheetJS cho .xls/.csv
  function ejText(v) {
    if (v == null) return '';
    if (v instanceof Date) return v.toLocaleDateString('vi-VN');
    if (typeof v === 'object') {
      if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('').trim();
      if (v.text != null) return ejText(v.text);
      if (v.result !== undefined) return ejText(v.result);
      if (v.error) return '';
      return '';
    }
    return cellText(v);
  }

  const Sheet = {
    engine: '',
    wb: null,
    ws: null,
    headerRow: 0,
    startCol: 0,
    bookType: 'xlsx',
    contentCol: -1,

    async parse(data, name) {
      const ext = (name.split('.').pop() || '').toLowerCase();
      if ((ext === 'xlsx' || ext === 'xlsm') && window.ExcelJS) {
        try { return await this.parseExcelJS(data, name); } catch (e) {}
      }
      return this.parseSheetJS(data, name, ext);
    },

    async parseExcelJS(data, name) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('File không có sheet nào');
      this.engine = 'exceljs';
      this.bookType = 'xlsx';
      this.wb = wb;
      this.ws = ws;

      const head = ws.getRow(1);
      const headers = [];
      for (let c = 1; c <= Math.max(ws.columnCount, head.cellCount); c++) headers.push(ejText(head.getCell(c).value));
      while (headers.length && !headers[headers.length - 1]) headers.pop();

      const ensure = title => {
        let i = headers.findIndex(h => norm(h) === norm(title));
        if (i >= 0) return i;
        headers.push(title);
        i = headers.length - 1;
        const cell = head.getCell(i + 1);
        cell.value = title;
        if (i > 0) cell.style = JSON.parse(JSON.stringify(head.getCell(i).style || {}));
        ws.getColumn(i + 1).width = title === CONTENT_HEADER ? 45 : 18;
        return i;
      };
      const statusCol = ensure(STATUS_HEADER);
      const contentCol = ensure(CONTENT_HEADER);
      this.contentCol = contentCol;

      const rows = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const values = headers.map((_, i) => ejText(row.getCell(i + 1).value));
        if (values.every(v => !v)) continue;
        rows.push({ row: r, values });
      }
      return { name, headers, rows, statusCol, contentCol };
    },

    parseSheetJS(data, name, ext) {
      this.engine = 'sheetjs';
      this.bookType = ext === 'csv' ? 'csv' : ext === 'xls' ? 'xls' : 'xlsx';
      if (ext === 'csv') {
        const text = new TextDecoder('utf-8').decode(data).replace(/^﻿/, '');
        this.wb = XLSX.read(text, { type: 'string', raw: true });
      } else {
        this.wb = XLSX.read(data, { type: 'array' });
      }
      this.ws = this.wb.Sheets[this.wb.SheetNames[0]];
      const range = XLSX.utils.decode_range(this.ws['!ref'] || 'A1');
      this.headerRow = range.s.r;
      this.startCol = range.s.c;

      const headers = [];
      for (let c = range.s.c; c <= range.e.c; c++) headers.push(this.get(range.s.r, c));
      while (headers.length && !headers[headers.length - 1]) headers.pop();

      let statusCol = headers.findIndex(h => norm(h) === norm(STATUS_HEADER));
      if (statusCol < 0) { headers.push(STATUS_HEADER); statusCol = headers.length - 1; this.setCell(this.headerRow, statusCol, STATUS_HEADER); }
      let contentCol = headers.findIndex(h => norm(h) === norm(CONTENT_HEADER));
      if (contentCol < 0) { headers.push(CONTENT_HEADER); contentCol = headers.length - 1; this.setCell(this.headerRow, contentCol, CONTENT_HEADER); }
      this.contentCol = contentCol;

      const rows = [];
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const values = headers.map((_, i) => this.get(r, range.s.c + i));
        if (values.every(v => !v)) continue;
        rows.push({ row: r, values });
      }
      return { name, headers, rows, statusCol, contentCol };
    },

    get(r, c) {
      const cell = this.ws[XLSX.utils.encode_cell({ r, c })];
      return cell ? cellText(cell.v) : '';
    },

    setCell(r, colIdx, value) {
      if (this.engine === 'exceljs') {
        const cell = this.ws.getRow(r).getCell(colIdx + 1);
        cell.value = value;
        if (colIdx === this.contentCol) cell.alignment = { wrapText: true, vertical: 'top' };
        return;
      }
      const c = this.startCol + colIdx;
      this.ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: value };
      const range = XLSX.utils.decode_range(this.ws['!ref'] || 'A1');
      if (c > range.e.c) range.e.c = c;
      if (r > range.e.r) range.e.r = r;
      this.ws['!ref'] = XLSX.utils.encode_range(range);
    },

    async toBytes() {
      if (this.engine === 'exceljs') return new Uint8Array(await this.wb.xlsx.writeBuffer());
      if (this.bookType === 'csv') {
        return new TextEncoder().encode('﻿' + XLSX.write(this.wb, { bookType: 'csv', type: 'string' }));
      }
      return new Uint8Array(XLSX.write(this.wb, { bookType: this.bookType, type: 'array' }));
    },

    async download(name) {
      if (!this.wb) return;
      const base = name.replace(/\.[^.]+$/, '');
      const isCsv = this.engine === 'sheetjs' && this.bookType === 'csv';
      const bytes = isCsv
        ? new Uint8Array(XLSX.write(this.wb, { bookType: 'xlsx', type: 'array' }))
        : await this.toBytes();
      const ext = this.engine === 'sheetjs' && this.bookType === 'xls' ? 'xls' : 'xlsx';
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${base}_ket_qua.${ext}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    },
  };

  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function readFileInput() {
    return new Promise((resolve, reject) => {
      const input = $('fileInput');
      input.value = '';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => {
          Sheet.parse(new Uint8Array(reader.result), file.name).then(resolve, reject);
        };
        reader.onerror = () => reject(new Error('Không đọc được file'));
        reader.readAsArrayBuffer(file);
      };
      input.click();
    });
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Lưu thư mục cài extension để lần sau cập nhật không phải chọn lại
  function idb(action, key, value) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('nhantinzalo', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('kv', action === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('kv');
        const req = action === 'get' ? store.get(key) : action === 'set' ? store.put(value, key) : store.delete(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      };
    });
  }

  // Tìm thư mục có manifest.json của tool, chấp nhận chọn thư mục cha
  async function findExtensionDir(dir, depth = 0) {
    try {
      const f = await (await dir.getFileHandle('manifest.json')).getFile();
      if (JSON.parse(await f.text()).name === chrome.runtime.getManifest().name) return dir;
    } catch (e) {}
    if (depth >= 2) return null;
    for await (const [, entry] of dir.entries()) {
      if (entry.kind !== 'directory') continue;
      const found = await findExtensionDir(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  // Ghi thử một file rồi đọc lại qua extension để chắc đây là thư mục Chrome đang chạy
  async function isRunningDir(dir) {
    const name = 'update-check.txt';
    const token = Math.random().toString(36).slice(2);
    try {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(token);
      await w.close();
      const res = await fetch(chrome.runtime.getURL(name) + '?t=' + Date.now(), { cache: 'no-store' });
      return res.ok && (await res.text()).trim() === token;
    } catch (e) {
      return false;
    } finally {
      try { await dir.removeEntry(name); } catch (e) {}
    }
  }

  // Cầu nối theo từng nền tảng
  const adapters = {
    desktop: {
      label: 'Máy tính',
      auto: true,
      targets: [{ id: 'app', label: 'Zalo App' }, { id: 'web', label: 'Zalo Web' }],
      async pickFile() {
        const r = await window.pywebview.api.pick_file();
        if (!r) return null;
        if (r.error) throw new Error(r.error);
        return r;
      },
      async saveRow(row, status, content) {
        const r = await window.pywebview.api.update_row(row.row, status, content);
        if (r && r.error) throw new Error(r.error);
      },
      async send(phone, messages) {
        return window.pywebview.api.send(state.target, phone, messages, Number(state.delayMessage) || 0);
      },
      async exportFile() {
        const r = await window.pywebview.api.export_file();
        if (!r) return false;
        if (r.error) throw new Error(r.error);
        return true;
      },
      async update(info) {
        const r = await window.pywebview.api.update(info.desktop && info.desktop.windows, info.page || '');
        if (r && r.error) throw new Error(r.error);
      },
    },

    android: {
      label: 'Android',
      auto: true,
      targets: [],
      pickFile() {
        return new Promise((resolve, reject) => {
          window.__onFilePicked = (name, b64, err) => {
            window.__onFilePicked = null;
            if (err) return reject(new Error(err));
            if (!name) return resolve(null);
            Sheet.parse(b64ToBytes(b64), name).then(resolve, reject);
          };
          window.Android.pickExcel();
        });
      },
      async saveRow(row, status, content) {
        Sheet.setCell(row.row, state.statusCol, status);
        Sheet.setCell(row.row, state.contentCol, content);
        const err = window.Android.saveExcel(bytesToB64(await Sheet.toBytes()));
        if (err) throw new Error(err);
      },
      send(phone, messages) {
        return new Promise(resolve => {
          const jobId = String(Date.now());
          const timer = setTimeout(() => finish(false, 'Hết thời gian chờ'), 120000);
          function finish(ok, error) {
            clearTimeout(timer);
            window.__onSendResult = null;
            const fatal = !!error && error[0] === '!';
            resolve({ ok, error: fatal ? error.slice(1) : error, fatal });
          }
          window.__onSendResult = (id, ok, error) => { if (id === jobId) finish(ok, error); };
          const err = window.Android.send(jobId, phone, JSON.stringify(messages), Math.round((Number(state.delayMessage) || 0) * 1000));
          if (err) finish(false, err);
        });
      },
      async exportFile() {
        const bytes = await Sheet.toBytes();
        const base = state.fileName.replace(/\.[^.]+$/, '');
        const ext = Sheet.engine === 'sheetjs' && Sheet.bookType !== 'xlsx' ? Sheet.bookType : 'xlsx';
        return new Promise((resolve, reject) => {
          window.__onExportResult = (ok, err) => (err ? reject(new Error(err)) : resolve(ok));
          window.Android.exportExcel(bytesToB64(bytes), `${base}_ket_qua.${ext}`);
        });
      },
      update(info) {
        return new Promise((resolve, reject) => {
          window.__onUpdateResult = err => (err ? reject(new Error(err)) : resolve());
          window.Android.installUpdate(info.android && info.android.apk);
        });
      },
    },

    extension: {
      label: 'Chrome · Zalo Web',
      auto: true,
      targets: [],
      fileHandle: null,
      async pickFile() {
        if (!window.showOpenFilePicker) return readFileInput();
        let handle;
        try {
          [handle] = await window.showOpenFilePicker({
            id: 'excel',
            types: [{ description: 'Excel', accept: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'],
              'application/vnd.ms-excel': ['.xls'],
              'text/csv': ['.csv'],
            } }],
          });
        } catch (e) {
          if (e.name === 'AbortError') return null;
          throw e;
        }
        const perm = await handle.requestPermission({ mode: 'readwrite' });
        this.fileHandle = perm === 'granted' ? handle : null;
        if (!this.fileHandle) toast('Không có quyền ghi file, hãy bấm Xuất file Excel sau khi gửi', 5000);
        const file = await handle.getFile();
        return Sheet.parse(new Uint8Array(await file.arrayBuffer()), file.name);
      },
      async saveRow(row, status, content) {
        Sheet.setCell(row.row, state.statusCol, status);
        Sheet.setCell(row.row, state.contentCol, content);
        if (!this.fileHandle) return;
        const bytes = await Sheet.toBytes();
        try {
          const w = await this.fileHandle.createWritable();
          await w.write(bytes);
          await w.close();
        } catch (e) {
          throw new Error('File đang mở trong Excel hoặc không ghi được, hãy đóng file rồi bấm Tiếp tục');
        }
      },
      send(phone, messages) {
        return chrome.runtime.sendMessage({ type: 'send', phone, messages, delayMessage: Number(state.delayMessage) || 0 });
      },
      sleep(ms) {
        return chrome.runtime.sendMessage({ type: 'sleep', ms });
      },
      async update(info) {
        const ext = info.extension;
        let dir = await idb('get', 'extDir');
        if (dir && (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') dir = null;
        if (!dir) {
          toast('Chọn thư mục đang cài tool, xem ở mục "Loaded from" trong trang chrome://extensions', 8000);
          dir = await window.showDirectoryPicker({ id: 'extdir', mode: 'readwrite' });
        }
        dir = await findExtensionDir(dir);
        if (!dir) {
          await idb('del', 'extDir');
          throw new Error('Thư mục chưa đúng, hãy chọn thư mục có file manifest.json của tool');
        }
        if (!(await isRunningDir(dir))) {
          await idb('del', 'extDir');
          throw new Error('Thư mục vừa chọn không phải thư mục Chrome đang dùng. Mở chrome://extensions, xem dòng "Loaded from" của Nhắn tin Zalo rồi bấm Cập nhật và chọn đúng thư mục đó');
        }
        await idb('set', 'extDir', dir);

        // Tải đủ file trước rồi mới ghi, manifest.json ghi cuối cùng
        const files = ext.files.slice().sort((a, b) => (a === 'manifest.json') - (b === 'manifest.json'));
        const blobs = [];
        for (const path of files) {
          const res = await fetch(ext.base + path, { cache: 'no-store' });
          if (!res.ok) throw new Error('Không tải được ' + path);
          blobs.push([path, await res.blob()]);
        }
        for (const [path, blob] of blobs) {
          const parts = path.split('/');
          let d = dir;
          for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
          const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
          await w.write(blob);
          await w.close();
        }
        chrome.runtime.reload();
      },
    },

    web: {
      label: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iOS · Thủ công' : 'Trình duyệt · Thủ công',
      auto: false,
      targets: [],
      pickFile: readFileInput,
      async saveRow(row, status, content) {
        Sheet.setCell(row.row, state.statusCol, status);
        Sheet.setCell(row.row, state.contentCol, content);
      },
    },
  };

  let adapter = adapters.web;

  function detectPlatform() {
    return new Promise(resolve => {
      if (window.Android) return resolve('android');
      if (location.protocol === 'chrome-extension:' && window.chrome && chrome.runtime && chrome.runtime.id) return resolve('extension');
      if (window.pywebview && window.pywebview.api) return resolve('desktop');
      const done = kind => { clearTimeout(t); resolve(kind); };
      window.addEventListener('pywebviewready', () => done('desktop'), { once: true });
      const t = setTimeout(() => resolve(window.pywebview ? 'desktop' : 'web'), 1200);
    });
  }

  // Trạng thái từng khách
  function statusOf(row) { return state.statusCol >= 0 ? cellText(row.values[state.statusCol]) : ''; }
  function nameOf(row) { return state.nameCol >= 0 ? cellText(row.values[state.nameCol]) : ''; }
  function phoneOf(row) { return state.phoneCol >= 0 ? normalizePhone(row.values[state.phoneCol]) : ''; }

  function classOf(row) {
    const s = norm(statusOf(row));
    if (s === norm(SENT)) return 'sent';
    if (s.startsWith('lỗi')) return 'error';
    return 'pending';
  }

  function fill(tpl, row) {
    return tpl.replace(/\{([^{}]+)\}/g, (m, key) => {
      const k = norm(key);
      if (k === 'tên' || k === 'ten') return nameOf(row);
      const idx = state.headers.findIndex(h => norm(h) === k);
      return idx >= 0 ? cellText(row.values[idx]) : m;
    });
  }

  function activeBlocks() {
    return state.blocks.map(b => b.filter(t => t.trim())).filter(b => b.length);
  }

  function pickMessages(row) {
    return activeBlocks().map(b => fill(b[Math.floor(Math.random() * b.length)], row).trim());
  }

  function formatContent(msgs) {
    if (msgs.length === 1) return msgs[0];
    return msgs.map((m, i) => `[Tin ${i + 1}] ${m}`).join('\n');
  }

  // Giao diện chung
  function toast(msg, ms = 2600) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function log(msg, type = '') {
    $('logCard').classList.remove('hidden');
    const el = $('log');
    const line = document.createElement('div');
    if (type) line.className = type;
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    line.innerHTML = `<time>${time}</time>${esc(msg)}`;
    el.appendChild(line);
    while (el.childNodes.length > 500) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  const ordinal = n => (n === 1 ? 'thứ nhất' : `thứ ${n}`);

  function renderBlocks() {
    const wrap = $('messageBlocks');
    wrap.innerHTML = '';
    $('btnAddBlock').textContent = `+ Thêm tin nhắn ${ordinal(state.blocks.length + 1)} muốn gửi`;
    state.blocks.forEach((tpls, bi) => {
      const block = document.createElement('div');
      block.className = 'msg-block';
      block.innerHTML = `
        <div class="msg-block-head">
          <h3>Tin nhắn ${ordinal(bi + 1)}</h3>
          ${bi > 0 ? '<button class="link-btn danger" data-act="remove-block">Xoá tin nhắn</button>' : ''}
        </div>
        <div class="msg-block-body"></div>`;
      const body = block.querySelector('.msg-block-body');

      tpls.forEach((text, ti) => {
        const tpl = document.createElement('div');
        tpl.className = 'tpl';
        tpl.innerHTML = `
          <div class="tpl-head">
            <span>Mẫu ${ti + 1}</span>
            <div class="tpl-tools">
              <button class="link-btn" data-act="insert-name">Chèn {Tên}</button>
              ${tpls.length > 1 ? '<button class="link-btn danger" data-act="remove-tpl">Xoá</button>' : ''}
            </div>
          </div>
          <textarea rows="3"></textarea>`;
        const ta = tpl.querySelector('textarea');
        ta.value = text;
        ta.placeholder = bi === 0 && ti === 0 ? 'Ví dụ: Chào {Tên}, em là ... bên Tmark ạ.' : 'Nhập nội dung mẫu tin nhắn';
        ta.addEventListener('input', () => { state.blocks[bi][ti] = ta.value; saveSettings(); refreshManual(); });
        tpl.querySelector('[data-act="insert-name"]').addEventListener('click', () => {
          const s = ta.selectionStart ?? ta.value.length;
          const e = ta.selectionEnd ?? ta.value.length;
          ta.setRangeText('{Tên}', s, e, 'end');
          ta.dispatchEvent(new Event('input'));
          ta.focus();
        });
        const rm = tpl.querySelector('[data-act="remove-tpl"]');
        if (rm) rm.addEventListener('click', () => { state.blocks[bi].splice(ti, 1); saveSettings(); renderBlocks(); refreshManual(); });
        body.appendChild(tpl);
      });

      const add = document.createElement('button');
      add.className = 'btn btn-outline btn-sm';
      add.textContent = '+ Thêm mẫu tin nhắn';
      add.addEventListener('click', () => {
        state.blocks[bi].push('');
        saveSettings();
        renderBlocks();
        const areas = wrap.querySelectorAll('.msg-block')[bi].querySelectorAll('textarea');
        areas[areas.length - 1].focus();
      });
      body.appendChild(add);

      const rb = block.querySelector('[data-act="remove-block"]');
      if (rb) rb.addEventListener('click', () => { state.blocks.splice(bi, 1); saveSettings(); renderBlocks(); refreshManual(); });

      wrap.appendChild(block);
    });
  }

  function fillSelect(sel, value, allowNone) {
    sel.innerHTML = (allowNone ? '<option value="-1">Không dùng</option>' : '') +
      state.headers.map((h, i) => `<option value="${i}">${esc(h || `Cột ${i + 1}`)}</option>`).join('');
    sel.value = String(value);
  }

  function guessColumns() {
    const h = state.headers.map(norm);
    const isMeta = i => i === state.statusCol || i === state.contentCol;
    let phone = h.findIndex((x, i) => !isMeta(i) && /(điện thoại|dien thoai|sđt|sdt|số đt|phone|mobile|^đt$|zalo)/.test(x));
    if (phone < 0) {
      phone = state.headers.findIndex((_, i) => !isMeta(i) && state.rows.slice(0, 20).filter(r => normalizePhone(r.values[i])).length >= Math.min(3, state.rows.length));
    }
    let name = h.findIndex(x => x === norm(NAME_HEADER));
    if (name < 0) name = h.findIndex((x, i) => !isMeta(i) && i !== phone && /(đơn vị|tên|ten|name|công ty|cong ty)/.test(x));
    state.phoneCol = phone;
    state.nameCol = name;
  }

  function renderStats() {
    const el = $('stats');
    if (!state.rows.length) { el.classList.add('hidden'); return; }
    let sent = 0, err = 0, pending = 0, invalid = 0;
    state.rows.forEach(r => {
      const c = classOf(r);
      if (c === 'sent') sent++; else if (c === 'error') err++; else pending++;
      if (!phoneOf(r)) invalid++;
    });
    el.innerHTML = `
      <span class="chip">Tổng <b>${state.rows.length}</b></span>
      <span class="chip">Đã gửi <b>${sent}</b></span>
      <span class="chip">Chưa gửi <b>${pending}</b></span>
      <span class="chip">Lỗi <b>${err}</b></span>
      ${invalid ? `<span class="chip">SĐT không hợp lệ <b>${invalid}</b></span>` : ''}`;
    el.classList.remove('hidden');
  }

  function renderTable() {
    if (!state.rows.length) { $('listCard').classList.add('hidden'); return; }
    $('listCard').classList.remove('hidden');
    const list = state.rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => state.filter === 'all' || classOf(r) === state.filter);
    const shown = list.slice(0, TABLE_LIMIT);
    $('tableBody').innerHTML = shown.map(({ r, i }) => {
      const c = classOf(r);
      const st = statusOf(r) || 'Chưa gửi';
      const phone = phoneOf(r) || cellText(r.values[state.phoneCol]) || '';
      return `<tr class="${r === state.currentRow ? 'current' : ''}">
        <td>${i + 1}</td>
        <td>${esc(phone)}</td>
        <td class="name">${esc(nameOf(r))}</td>
        <td><span class="badge ${c}" title="${esc(st)}">${esc(st)}</span></td>
      </tr>`;
    }).join('');
    $('tableMore').textContent = list.length > TABLE_LIMIT ? `Đang hiển thị ${TABLE_LIMIT}/${list.length} khách` : '';
  }

  // Xuất toàn bộ danh sách kèm Trạng thái và Nội dung đã gửi ra file mới
  async function exportExcel() {
    if (!state.rows.length) { toast('Hãy chọn file Excel trước'); return; }
    try {
      const done = adapter.exportFile ? await adapter.exportFile() : (await Sheet.download(state.fileName), true);
      if (done) toast('Đã xuất file Excel');
    } catch (e) {
      toast('Không xuất được file: ' + (e.message || e), 5000);
    }
  }

  function renderAll() {
    $('btnExport').classList.toggle('hidden', !state.rows.length);
    renderStats();
    renderTable();
    refreshManual();
  }

  function setProgress(done, total, text) {
    $('progressWrap').classList.remove('hidden');
    $('progressBar').style.width = total ? `${Math.round(done / total * 100)}%` : '0';
    $('progressText').textContent = text;
  }

  // Chọn file
  async function pickFile() {
    if (state.running) return;
    try {
      const data = await adapter.pickFile();
      if (!data) return;
      state.fileName = data.name;
      state.headers = data.headers;
      state.rows = data.rows;
      state.statusCol = data.statusCol;
      state.contentCol = data.contentCol;
      state.manualSkipped.clear();
      state.manualPicks = null;
      guessColumns();
      $('fileName').textContent = data.name;
      fillSelect($('selPhone'), state.phoneCol, false);
      fillSelect($('selName'), state.nameCol, true);
      $('columnPicker').classList.remove('hidden');
      renderAll();
      log(`Đã mở file ${data.name}: ${data.rows.length} khách`);
      if (state.phoneCol < 0) toast('Không tìm thấy cột số điện thoại, hãy chọn lại');
    } catch (e) {
      toast(e.message || 'Không đọc được file');
      log('Lỗi mở file: ' + (e.message || e), 'err');
    }
  }

  async function record(row, status, content) {
    row.values[state.statusCol] = status;
    row.values[state.contentCol] = content;
    for (;;) {
      try {
        await adapter.saveRow(row, status, content);
        return;
      } catch (e) {
        log('Không lưu được Excel: ' + e.message, 'err');
        if (!state.running) { toast('Không lưu được Excel: ' + e.message, 5000); return; }
        state.paused = true;
        updateRunButtons();
        toast('Không lưu được Excel. Đóng file trong Excel rồi bấm Tiếp tục', 6000);
        await waitWhilePaused();
        if (state.stopped) return;
      }
    }
  }

  function validate() {
    if (!state.rows.length) { toast('Hãy chọn file Excel trước'); return false; }
    if (state.phoneCol < 0) { toast('Hãy chọn cột số điện thoại'); return false; }
    if (!activeBlocks().length) { toast('Hãy soạn ít nhất 1 mẫu tin nhắn'); return false; }
    return true;
  }

  // Chạy tự động (PC, Android)
  async function waitWhilePaused() {
    while (state.paused && !state.stopped) await sleep(300);
  }

  async function pausableSleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !state.stopped) {
      await sleep(Math.min(250, end - Date.now()));
      await waitWhilePaused();
    }
  }

  function updateRunButtons() {
    $('btnStart').classList.toggle('hidden', state.running);
    $('btnPause').classList.toggle('hidden', !state.running);
    $('btnStop').classList.toggle('hidden', !state.running);
    $('btnPause').textContent = state.paused ? 'Tiếp tục' : 'Tạm dừng';
    $('btnPickFile').disabled = state.running;
  }

  async function start() {
    if (!validate()) return;
    if (window.Android && !window.Android.isServiceEnabled()) {
      updateServiceNotice();
      toast('Hãy bật quyền Trợ năng cho app trước');
      return;
    }
    let queue = state.rows.filter(r => classOf(r) !== 'sent');
    const limit = parseInt(state.limit, 10) || 0;
    if (limit > 0) queue = queue.slice(0, limit);
    if (!queue.length) { toast('Tất cả khách đã được gửi'); return; }

    state.running = true;
    state.paused = false;
    state.stopped = false;
    updateRunButtons();
    log(`Bắt đầu gửi cho ${queue.length} khách`);

    let ok = 0, fail = 0;
    for (let i = 0; i < queue.length; i++) {
      if (state.stopped) break;
      await waitWhilePaused();
      if (state.stopped) break;

      const row = queue[i];
      const phone = phoneOf(row);
      state.currentRow = row;
      setProgress(i, queue.length, `Đang gửi ${i + 1}/${queue.length}: ${phone || 'không có số'} ${nameOf(row)}`);
      renderTable();

      if (!phone) {
        await record(row, 'Lỗi: số điện thoại không hợp lệ', '');
        log(`Dòng ${i + 1}: số điện thoại không hợp lệ`, 'err');
        fail++;
        renderStats();
        continue;
      }

      const msgs = pickMessages(row);
      let res;
      try { res = await adapter.send(phone, msgs); } catch (e) { res = { ok: false, error: e.message || String(e) }; }
      res = res || { ok: false, error: 'Không có phản hồi' };

      if (res.ok) {
        ok++;
        await record(row, SENT, formatContent(msgs));
        log(`${phone} ${nameOf(row)}: đã gửi ${msgs.length} tin`, 'ok');
      } else {
        fail++;
        const done = msgs.slice(0, res.partial || 0);
        const note = done.length ? ` (đã gửi ${done.length}/${msgs.length} tin)` : '';
        await record(row, 'Lỗi: ' + res.error + note, done.length ? formatContent(done) : '');
        log(`${phone} ${nameOf(row)}: ${res.error}`, 'err');
        if (res.fatal) {
          toast(res.error, 5000);
          state.stopped = true;
        }
      }
      renderStats();
      renderTable();

      if (i < queue.length - 1 && !state.stopped) {
        const wait = Math.max(0, Number(state.delayCustomer) || 0) * 1000;
        if (wait) setProgress(i + 1, queue.length, `Nghỉ ${state.delayCustomer} giây trước khách tiếp theo...`);
        await pausableSleep(wait);
      }
    }

    const stoppedEarly = state.stopped;
    state.running = false;
    state.paused = false;
    state.stopped = false;
    state.currentRow = null;
    updateRunButtons();
    renderAll();
    const summary = `${stoppedEarly ? 'Đã dừng' : 'Hoàn tất'}: ${ok} thành công, ${fail} lỗi`;
    setProgress(ok + fail, queue.length, summary);
    log(summary, ok ? 'ok' : '');
    toast(summary);
  }

  // Chế độ thủ công (iOS, trình duyệt)
  function nextManualRow() {
    return state.rows.find(r => classOf(r) !== 'sent' && !state.manualSkipped.has(r));
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }

  function refreshManual() {
    if (adapter.auto) return;
    const card = $('manualCard');
    const empty = $('manualEmpty');
    if (!state.rows.length || state.phoneCol < 0 || !activeBlocks().length) {
      card.classList.add('hidden');
      empty.classList.remove('hidden');
      empty.textContent = 'Chọn file và soạn tin nhắn để bắt đầu.';
      return;
    }
    const row = nextManualRow();
    if (!row) {
      card.classList.add('hidden');
      empty.classList.remove('hidden');
      empty.textContent = 'Đã xử lý hết danh sách. Bấm "Xuất file Excel" để lưu kết quả.';
      return;
    }
    empty.classList.add('hidden');
    card.classList.remove('hidden');

    if (!state.manualPicks || state.manualPicks.row !== row) state.manualPicks = { row, msgs: pickMessages(row) };
    const phone = phoneOf(row);
    const remain = state.rows.filter(r => classOf(r) !== 'sent' && !state.manualSkipped.has(r)).length;
    $('mName').textContent = nameOf(row) || 'Khách hàng';
    $('mPhone').textContent = phone || 'Số điện thoại không hợp lệ';
    $('mCount').textContent = `Còn ${remain} khách`;
    $('mOpen').href = phone ? `https://zalo.me/${phone}` : '#';
    $('mOpen').classList.toggle('hidden', !phone);

    const box = $('mMessages');
    box.innerHTML = '';
    state.manualPicks.msgs.forEach((m, i) => {
      const item = document.createElement('div');
      item.className = 'manual-msg';
      item.innerHTML = `<div class="manual-msg-head"><span>Tin nhắn ${ordinal(i + 1)}</span><button class="link-btn">Sao chép</button></div><p></p>`;
      item.querySelector('p').textContent = m;
      item.querySelector('button').addEventListener('click', async () => {
        const ok = await copyText(m);
        toast(ok ? `Đã sao chép tin nhắn ${ordinal(i + 1)}`: 'Không sao chép được, hãy giữ để chọn chữ');
      });
      box.appendChild(item);
    });
  }

  async function manualDone() {
    const p = state.manualPicks;
    if (!p) return;
    const phone = phoneOf(p.row);
    if (phone) await record(p.row, SENT, formatContent(p.msgs));
    else await record(p.row, 'Lỗi: số điện thoại không hợp lệ', '');
    log(`${phone || 'Không có số'} ${nameOf(p.row)}: ${phone ? 'đã gửi' : 'bỏ qua do số không hợp lệ'}`, phone ? 'ok' : 'err');
    state.manualPicks = null;
    renderAll();
  }

  // Android: quyền Trợ năng
  function updateServiceNotice() {
    if (!window.Android) return;
    $('serviceNotice').classList.toggle('hidden', !!window.Android.isServiceEnabled());
  }

  // Kiểm tra phiên bản mới
  function compareVersion(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  async function checkUpdate() {
    if (!adapter.update || !window.UPDATE_URL) return;
    let info;
    try {
      const res = await fetch(window.UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' });
      info = await res.json();
    } catch (e) {
      return;
    }
    if (!info || compareVersion(info.version, window.APP_VERSION) <= 0) return;
    $('updateTitle').textContent = `Có phiên bản mới ${info.version}`;
    $('updateNotes').textContent = info.notes || '';
    $('updateBar').classList.remove('hidden');
    $('btnUpdate').onclick = async () => {
      if (state.running) { toast('Hãy dừng gửi tin trước khi cập nhật'); return; }
      const btn = $('btnUpdate');
      btn.disabled = true;
      btn.textContent = 'Đang cập nhật...';
      $('updateError').classList.add('hidden');
      try {
        await adapter.update(info);
      } catch (e) {
        if (e.name === 'AbortError') {
          toast('Đã huỷ cập nhật');
        } else {
          $('updateError').textContent = 'Cập nhật chưa thành công: ' + (e.message || e);
          $('updateError').classList.remove('hidden');
        }
        btn.disabled = false;
        btn.textContent = 'Cập nhật';
      }
    };
  }

  function bindSettings() {
    const bind = (id, key) => {
      const el = $(id);
      el.value = state[key];
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        state[key] = isNaN(v) || v < 0 ? 0 : v;
        saveSettings();
      });
    };
    bind('delayCustomer', 'delayCustomer');
    bind('delayMessage', 'delayMessage');
    bind('limit', 'limit');
  }

  function renderTargets() {
    const seg = $('targetSeg');
    if (!adapter.targets.length) { $('targetField').classList.add('hidden'); return; }
    if (!adapter.targets.some(t => t.id === state.target)) state.target = adapter.targets[0].id;
    $('targetField').classList.remove('hidden');
    seg.innerHTML = adapter.targets.map(t => `<button data-id="${t.id}" class="${t.id === state.target ? 'active' : ''}">${t.label}</button>`).join('');
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (state.running) return;
      state.target = b.dataset.id;
      saveSettings();
      renderTargets();
    }));
  }

  async function init() {
    loadSettings();
    renderBlocks();
    bindSettings();

    const kind = await detectPlatform();
    adapter = adapters[kind];
    if (adapter.sleep) sleep = ms => adapter.sleep(ms);
    document.body.dataset.platform = kind;
    $('platformLabel').textContent = adapter.label;
    $('versionLabel').textContent = window.APP_VERSION ? 'v' + window.APP_VERSION : '';
    renderTargets();
    checkUpdate();

    if (!adapter.auto) {
      $('autoActions').classList.add('hidden');
      $('manualPanel').classList.remove('hidden');
      $('delayCustomer').closest('.field').classList.add('hidden');
      $('delayMessage').closest('.field').classList.add('hidden');
      $('limit').closest('.field').classList.add('hidden');
      refreshManual();
    }

    if (kind === 'android') {
      updateServiceNotice();
      $('btnOpenService').addEventListener('click', () => window.Android.openAccessibilitySettings());
      window.__onResume = updateServiceNotice;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) updateServiceNotice(); });
    }

    $('btnPickFile').addEventListener('click', pickFile);
    $('btnAddBlock').addEventListener('click', () => {
      state.blocks.push(['']);
      saveSettings();
      renderBlocks();
      refreshManual();
      const areas = $('messageBlocks').querySelectorAll('textarea');
      areas[areas.length - 1].focus();
    });

    $('selPhone').addEventListener('change', e => { state.phoneCol = +e.target.value; state.manualPicks = null; renderAll(); });
    $('selName').addEventListener('change', e => { state.nameCol = +e.target.value; state.manualPicks = null; renderAll(); });

    $('btnStart').addEventListener('click', start);
    $('btnPause').addEventListener('click', () => {
      state.paused = !state.paused;
      updateRunButtons();
      log(state.paused ? 'Tạm dừng' : 'Tiếp tục');
    });
    $('btnStop').addEventListener('click', () => {
      state.stopped = true;
      state.paused = false;
      log('Đang dừng...');
    });

    $('filterSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.filter = b.dataset.f;
      $('filterSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      renderTable();
    }));

    $('btnClearLog').addEventListener('click', () => { $('log').innerHTML = ''; });

    $('mDone').addEventListener('click', manualDone);
    $('mSkip').addEventListener('click', () => {
      if (state.manualPicks) state.manualSkipped.add(state.manualPicks.row);
      state.manualPicks = null;
      refreshManual();
    });
    $('mReroll').addEventListener('click', () => { state.manualPicks = null; refreshManual(); });
    $('btnExport').addEventListener('click', exportExcel);

    window.addEventListener('beforeunload', e => {
      if (state.running) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  init();
})();
