import os
import queue
import re
import threading

from playwright.sync_api import TimeoutError as PwTimeout
from playwright.sync_api import sync_playwright

URL = "https://chat.zalo.me"

# Bộ chọn phần tử, dùng chung ID với Zalo PC
SEARCH_INPUT = "#contact-search-input"
RESULT_LIST = "#searchResultList"
FRIEND_ITEM = "[id^='friend-item-']"
COMPOSER = "#richInput"
HEADER = "#chatViewContainer #header"
BUBBLE = "#messageViewScroll [id^='bb_msg_id_']"

WAIT_RESULT_MS = 6000
WAIT_CHAT_MS = 6000
WAIT_SENT_MS = 5000
LOGIN_TIMEOUT_MS = 180000


def _clean(s):
    return " ".join((s or "").replace("\xa0", " ").split()).casefold()


def _digits(s):
    return re.sub(r"\D", "", s or "")


class ZaloWeb:
    def __init__(self, profile_dir):
        self.profile_dir = profile_dir
        self.jobs = queue.Queue()
        self.thread = None
        self.pw = None
        self.ctx = None
        self.page = None

    # Playwright bắt buộc chạy trên một luồng cố định
    def _worker(self):
        while True:
            fn, box, done = self.jobs.get()
            try:
                box["result"] = fn()
            except Exception as e:
                box["error"] = e
            finally:
                done.set()

    def _call(self, fn):
        if not self.thread:
            self.thread = threading.Thread(target=self._worker, daemon=True)
            self.thread.start()
        box, done = {}, threading.Event()
        self.jobs.put((fn, box, done))
        done.wait()
        if "error" in box:
            raise box["error"]
        return box["result"]

    def _open(self):
        if self.page and not self.page.is_closed():
            return
        if self.ctx:
            try:
                self.ctx.close()
            except Exception:
                pass
            self.ctx = None
        if not self.pw:
            self.pw = sync_playwright().start()
        os.makedirs(self.profile_dir, exist_ok=True)
        last = None
        for ch in ("chrome", "msedge", None):
            try:
                opts = {"headless": False, "no_viewport": True, "args": ["--start-maximized"]}
                if ch:
                    opts["channel"] = ch
                self.ctx = self.pw.chromium.launch_persistent_context(self.profile_dir, **opts)
                break
            except Exception as e:
                last = e
        if not self.ctx:
            raise RuntimeError(f"Không mở được trình duyệt Chrome/Edge: {last}")
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        self.page.goto(URL)

    def _wait_login(self):
        try:
            self.page.wait_for_selector(SEARCH_INPUT, timeout=LOGIN_TIMEOUT_MS)
        except PwTimeout:
            raise RuntimeError("Chưa đăng nhập Zalo Web. Hãy quét mã QR trong cửa sổ trình duyệt rồi chạy lại")

    def _find_result(self, phone):
        items = self.page.locator(f"{RESULT_LIST} {FRIEND_ITEM}")
        for i in range(items.count()):
            item = items.nth(i)
            text = item.inner_text()
            lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
            if any(_digits(ln).endswith(phone[1:]) and len(_digits(ln)) in (9, 10, 11) for ln in lines):
                name = next((ln for ln in lines if not ln.startswith("Số điện thoại") and not _digits(ln).endswith(phone[1:])), "")
                return item, name
        return None, None

    def _header_title(self):
        h = self.page.locator(HEADER).first
        if not h.count():
            return ""
        lines = [ln.strip() for ln in h.inner_text().split("\n") if ln.strip()]
        return lines[0] if lines else ""

    def _composer_text(self):
        c = self.page.locator(f"{COMPOSER} [id^='input_line_']")
        return "".join(c.all_inner_texts()).strip()

    def _bubbles(self):
        return set(self.page.locator(BUBBLE).evaluate_all("els => els.map(e => e.id)"))

    def _send(self, phone, messages, delay_message, dry_run=False):
        self._open()
        self._wait_login()
        page = self.page
        page.bring_to_front()

        search = page.locator(SEARCH_INPUT)
        search.click()
        search.fill("")
        search.type(phone, delay=30)

        item, name = None, None
        end = WAIT_RESULT_MS
        while end > 0:
            item, name = self._find_result(phone)
            if item:
                break
            page.wait_for_timeout(400)
            end -= 400
        if not item:
            search.fill("")
            return {"ok": False, "error": "Số chưa đăng ký Zalo hoặc không tìm thấy"}

        item.click()
        title = ""
        end = WAIT_CHAT_MS
        while end > 0:
            title = self._header_title()
            if page.locator(COMPOSER).count() and title and (not name or _clean(title) == _clean(name)):
                break
            page.wait_for_timeout(400)
            end -= 400
        if not page.locator(COMPOSER).count():
            return {"ok": False, "error": "Không mở được cuộc trò chuyện"}
        if name and _clean(title) != _clean(name):
            return {"ok": False, "error": f"Mở nhầm hội thoại ({title}), đã bỏ qua"}

        composer = page.locator(COMPOSER).first
        for i, msg in enumerate(messages):
            if i:
                page.wait_for_timeout(int(max(0, delay_message) * 1000))
            before = self._bubbles()
            composer.click()
            page.keyboard.press("ControlOrMeta+A")
            page.keyboard.press("Delete")
            for j, line in enumerate(msg.split("\n")):
                if j:
                    page.keyboard.press("Shift+Enter")
                if line:
                    page.keyboard.insert_text(line)
            page.wait_for_timeout(300)
            if not self._composer_text():
                return {"ok": False, "error": f"Không điền được tin nhắn {i + 1}", "partial": i}
            if dry_run:
                page.keyboard.press("ControlOrMeta+A")
                page.keyboard.press("Delete")
                continue
            page.keyboard.press("Enter")
            sent = False
            end = WAIT_SENT_MS
            while end > 0:
                if not self._composer_text() and (self._bubbles() - before):
                    sent = True
                    break
                page.wait_for_timeout(300)
                end -= 300
            if not sent:
                return {"ok": False, "error": f"Tin nhắn {i + 1} chưa được gửi đi", "partial": i}
        return {"ok": True, "name": name}

    def send(self, phone, messages, delay_message, dry_run=False):
        try:
            return self._call(lambda: self._send(phone, messages, delay_message, dry_run))
        except Exception as e:
            msg = str(e).split("\n")[0]
            fatal = "đăng nhập" in msg or "trình duyệt" in msg
            return {"ok": False, "error": msg, "fatal": fatal}

    def close(self):
        if not self.thread:
            return

        def _close():
            if self.ctx:
                self.ctx.close()
            if self.pw:
                self.pw.stop()

        try:
            self._call(_close)
        except Exception:
            pass
