import subprocess
import sys
import time

import pyperclip

IS_MAC = sys.platform == "darwin"


class ZaloAppError(Exception):
    def __init__(self, message, fatal=False):
        super().__init__(message)
        self.fatal = fatal


def _clean(s):
    return " ".join((s or "").replace("\xa0", " ").split()).casefold()


def _is_icon(s):
    s = (s or "").strip()
    return not s or all(0xE000 <= ord(ch) <= 0xF8FF for ch in s)


def _digits(s):
    return "".join(ch for ch in (s or "") if ch.isdigit())


def _same_phone(text, phone):
    d = _digits(text)
    return bool(d) and (d == phone or d.endswith(phone[1:]) and len(d) in (9, 10, 11))


if not IS_MAC:
    import ctypes
    from ctypes import wintypes

    import os

    import uiautomation as auto

    auto.Logger.SetLogFile(os.devnull)

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    # Thời gian chờ tối đa (giây)
    WAIT_RESULT = 6.0
    WAIT_CHAT = 6.0
    WAIT_SENT = 5.0

    NOT_FOUND = ("không tìm thấy", "chưa đăng ký", "không tồn tại", "chưa có tài khoản")

    def _process_name(hwnd):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        handle = kernel32.OpenProcess(0x1000, False, pid.value)
        if not handle:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(512)
            size = wintypes.DWORD(512)
            if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                return buf.value.rsplit("\\", 1)[-1].lower()
            return ""
        finally:
            kernel32.CloseHandle(handle)

    def _find_window():
        found = []

        def cb(hwnd, _):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                if buf.value.strip() == "Zalo" and _process_name(hwnd) == "zalo.exe":
                    found.append(hwnd)
                    return False
            return True

        user32.EnumWindows(EnumWindowsProc(cb), 0)
        return found[0] if found else None

    def _focus(hwnd):
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        # Cửa sổ hẹp thì Zalo ẩn danh sách khi mở chat, nên phóng to
        if rect.right - rect.left < 1100:
            user32.ShowWindow(hwnd, 3)
        user32.keybd_event(0x12, 0, 0, 0)
        user32.SetForegroundWindow(hwnd)
        user32.keybd_event(0x12, 0, 2, 0)
        time.sleep(0.6)
        if user32.GetForegroundWindow() != hwnd:
            raise ZaloAppError("Không đưa được Zalo lên màn hình chính", fatal=True)

    def _ensure_front(hwnd):
        if user32.GetForegroundWindow() != hwnd:
            raise ZaloAppError("Zalo bị chuyển khỏi màn hình chính, đã dừng để tránh gửi nhầm", fatal=True)

    def _by_id(parent, aid, depth=40, timeout=0.0):
        c = parent.Control(searchDepth=depth, AutomationId=aid)
        return c if c.Exists(timeout, 0.2) else None

    def _walk(parent, depth):
        for c, _ in auto.WalkControl(parent, maxDepth=depth):
            yield c

    def _texts(parent, depth=12):
        out = []
        for c in _walk(parent, depth):
            if c.ControlTypeName == "TextControl" and not _is_icon(c.Name):
                out.append(c.Name)
        return out

    def _find_result(root, phone):
        lists = root.Control(searchDepth=30, AutomationId="searchResultList")
        if not lists.Exists(0, 0):
            return None, None
        for c in _walk(lists, 20):
            if c.AutomationId.startswith("friend-item-"):
                texts = _texts(c)
                if any(_same_phone(t, phone) for t in texts):
                    name = next((t for t in texts if not t.strip().startswith("Số điện thoại") and not _same_phone(t, phone)), "")
                    return c, name.strip()
        joined = _clean(" ".join(_texts(lists, 20)))
        if any(k in joined for k in NOT_FOUND):
            return False, None
        return None, None

    def _header_title(root):
        box = _by_id(root, "chatViewContainer", 30)
        if not box:
            return ""
        header = _by_id(box, "header", 5)
        if not header:
            return ""
        texts = _texts(header)
        return texts[0] if texts else ""

    def _bubbles(root):
        scroll = _by_id(root, "messageViewScroll", 40)
        if not scroll:
            return set()
        return {c.AutomationId for c in _walk(scroll, 3) if c.AutomationId.startswith("bb_msg_id_")}

    # Chỉ đọc chữ trong các dòng input_line_*, bỏ qua chữ gợi ý
    def _composer_text(root):
        comp = _by_id(root, "richInput", 40)
        if not comp:
            return ""
        out = []
        for c in _walk(comp, 3):
            if c.AutomationId.startswith("input_line_"):
                out.extend(_texts(c, 6))
        return "".join(out).strip()

    def _clear_search(search):
        try:
            search.Click(simulateMove=False)
            auto.SendKeys("{Ctrl}a{Del}{Esc}", waitTime=0.05)
        except Exception:
            pass

    def _send_windows(phone, messages, delay_message, dry_run=False):
        hwnd = _find_window()
        if not hwnd:
            raise ZaloAppError("Không tìm thấy cửa sổ Zalo. Hãy mở và đăng nhập Zalo PC", fatal=True)
        _focus(hwnd)
        root = auto.ControlFromHandle(hwnd)

        search = _by_id(root, "contact-search-input", 30, 2)
        if not search:
            raise ZaloAppError("Không tìm thấy ô tìm kiếm của Zalo. Hãy mở Zalo ở màn hình Tin nhắn", fatal=True)

        # Tìm số điện thoại
        search.Click(simulateMove=False)
        auto.SendKeys("{Ctrl}a{Del}", waitTime=0.05)
        auto.SendKeys(phone, interval=0.02, waitTime=0.1)
        item, name = None, None
        end = time.time() + WAIT_RESULT
        while time.time() < end:
            _ensure_front(hwnd)
            item, name = _find_result(root, phone)
            if item:
                break
            time.sleep(0.4)
        if not item:
            _clear_search(search)
            return {"ok": False, "error": "Số chưa đăng ký Zalo hoặc không tìm thấy"}

        # Mở chat và kiểm tra đúng người
        _ensure_front(hwnd)
        item.Click(simulateMove=False)
        composer, title = None, ""
        end = time.time() + WAIT_CHAT
        while time.time() < end:
            title = _header_title(root)
            composer = _by_id(root, "richInput", 40)
            if composer and title and (not name or _clean(title) == _clean(name)):
                break
            time.sleep(0.4)
        if not composer:
            return {"ok": False, "error": "Không mở được cuộc trò chuyện"}
        if name and _clean(title) != _clean(name):
            return {"ok": False, "error": f"Mở nhầm hội thoại ({title}), đã bỏ qua"}

        # Gửi từng tin và xác nhận đã gửi
        for i, msg in enumerate(messages):
            if i:
                time.sleep(max(0.0, delay_message))
            _ensure_front(hwnd)
            before = _bubbles(root)
            composer = _by_id(root, "richInput", 40) or composer
            composer.Click(simulateMove=False)
            auto.SendKeys("{Ctrl}a{Del}", waitTime=0.05)
            pyperclip.copy(msg)
            auto.SendKeys("{Ctrl}v", waitTime=0.5)
            if not _composer_text(root):
                return {"ok": False, "error": f"Không dán được tin nhắn {i + 1} vào Zalo", "partial": i}
            if dry_run:
                auto.SendKeys("{Ctrl}a{Del}", waitTime=0.05)
                continue
            _ensure_front(hwnd)
            auto.SendKeys("{Enter}", waitTime=0.2)
            sent = False
            end = time.time() + WAIT_SENT
            while time.time() < end:
                if not _composer_text(root) and (_bubbles(root) - before):
                    sent = True
                    break
                time.sleep(0.3)
            if not sent:
                return {"ok": False, "error": f"Tin nhắn {i + 1} chưa được gửi đi", "partial": i}
        return {"ok": True, "name": name}

else:
    import pyautogui

    pyautogui.PAUSE = 0.05

    def _activate():
        r = subprocess.run(["osascript", "-e", 'tell application "Zalo" to activate'], capture_output=True)
        if r.returncode != 0:
            raise ZaloAppError("Không mở được Zalo. Hãy cài và đăng nhập Zalo cho Mac", fatal=True)
        time.sleep(0.8)

    def _front_is_zalo():
        r = subprocess.run(
            ["osascript", "-e", 'tell application "System Events" to get name of first process whose frontmost is true'],
            capture_output=True, text=True,
        )
        if not r.stdout.strip().lower().startswith("zalo"):
            raise ZaloAppError("Zalo bị chuyển khỏi màn hình chính, đã dừng để tránh gửi nhầm", fatal=True)

    def _paste(text):
        pyperclip.copy(text)
        time.sleep(0.15)
        pyautogui.hotkey("command", "v")

    def _send_mac(phone, messages, delay_message, dry_run=False):
        _activate()
        pyautogui.press("esc")
        pyautogui.hotkey("command", "f")
        time.sleep(0.5)
        pyautogui.hotkey("command", "a")
        _paste(phone)
        time.sleep(2.5)
        _front_is_zalo()
        pyautogui.press("enter")
        time.sleep(2.0)
        _front_is_zalo()
        for i, msg in enumerate(messages):
            if i:
                time.sleep(max(0.0, delay_message))
                _front_is_zalo()
            _paste(msg)
            time.sleep(0.4)
            if not dry_run:
                pyautogui.press("enter")
            time.sleep(0.8)
        return {"ok": True}


def send(phone, messages, delay_message, dry_run=False):
    try:
        if IS_MAC:
            return _send_mac(phone, messages, delay_message, dry_run)
        with auto.UIAutomationInitializerInThread():
            return _send_windows(phone, messages, delay_message, dry_run)
    except ZaloAppError as e:
        return {"ok": False, "error": str(e), "fatal": e.fatal}
    except Exception as e:
        return {"ok": False, "error": f"Lỗi điều khiển Zalo: {e}"}
