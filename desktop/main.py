import os
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.request
import webbrowser

import webview

from excel_store import ExcelStore

APP_TITLE = "Nhắn tin Zalo"
DATA_DIR = os.path.join(os.path.expanduser("~"), ".nhantinzalo")


def resource(*parts):
    base = getattr(sys, "_MEIPASS", os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    return os.path.join(base, *parts)


class Api:
    def __init__(self):
        self._store = ExcelStore()
        self._web = None
        self._lock = threading.Lock()

    def pick_file(self):
        win = webview.windows[0]
        result = win.create_file_dialog(
            webview.OPEN_DIALOG,
            file_types=("Excel (*.xlsx;*.xlsm;*.csv)", "Tất cả (*.*)"),
        )
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        try:
            headers, rows = self._store.load(path)
        except Exception as e:
            return {"error": str(e)}
        return {
            "name": os.path.basename(path),
            "headers": headers,
            "rows": rows,
            "statusCol": self._store.status_col,
            "contentCol": self._store.content_col,
        }

    def export_file(self):
        if not self._store.path:
            return {"error": "Chưa chọn file"}
        base = os.path.splitext(os.path.basename(self._store.path))[0]
        ext = ".csv" if self._store.kind == "csv" else os.path.splitext(self._store.path)[1].lower()
        result = webview.windows[0].create_file_dialog(
            webview.SAVE_DIALOG,
            directory=os.path.dirname(self._store.path),
            save_filename=f"{base}_ket_qua{ext}",
        )
        if not result:
            return None
        path = result if isinstance(result, str) else result[0]
        try:
            self._store.save(path)
            return {"ok": True, "path": path}
        except Exception as e:
            return {"error": str(e)}

    def update_row(self, row, status, content):
        try:
            self._store.update(int(row), status, content)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def send(self, target, phone, messages, delay_message):
        with self._lock:
            if target == "web":
                if self._web is None:
                    from zalo_web import ZaloWeb
                    self._web = ZaloWeb(os.path.join(DATA_DIR, "zalo_web_profile"))
                return self._web.send(phone, messages, float(delay_message))
            import zalo_app
            return zalo_app.send(phone, messages, float(delay_message))

    def update(self, url, page=""):
        if not getattr(sys, "frozen", False) or sys.platform != "win32" or not url:
            if page:
                webbrowser.open(page)
            return {"error": "Hãy tải bản mới tại trang vừa mở"}
        exe = sys.executable
        new = exe + ".new"
        try:
            with urllib.request.urlopen(url, timeout=60) as r, open(new, "wb") as f:
                shutil.copyfileobj(r, f)
        except Exception as e:
            return {"error": f"Không tải được bản mới: {e}"}

        # Chờ app tắt hẳn rồi thay file và mở lại
        bat = os.path.join(tempfile.gettempdir(), "nhantinzalo_update.bat")
        with open(bat, "w", encoding="utf-8") as f:
            f.write(
                "@echo off\r\n"
                ":wait\r\n"
                f'tasklist /FI "PID eq {os.getpid()}" | find "{os.getpid()}" >nul && (timeout /t 1 /nobreak >nul & goto wait)\r\n'
                f'move /y "{new}" "{exe}" >nul\r\n'
                f'start "" "{exe}"\r\n'
                'del "%~f0"\r\n'
            )
        subprocess.Popen(["cmd", "/c", bat], creationflags=0x08000000 | 0x00000008, close_fds=True)
        threading.Timer(0.5, lambda: os._exit(0)).start()
        return {"ok": True}

    def _shutdown(self):
        if self._web:
            self._web.close()


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    api = Api()
    window = webview.create_window(
        APP_TITLE,
        resource("ui", "index.html"),
        js_api=api,
        width=1280,
        height=860,
        min_size=(380, 600),
    )
    window.events.closed += api._shutdown
    webview.start(private_mode=False, storage_path=os.path.join(DATA_DIR, "webview"))


if __name__ == "__main__":
    main()
