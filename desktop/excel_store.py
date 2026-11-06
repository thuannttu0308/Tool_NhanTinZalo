import csv
import os

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font

STATUS_HEADER = "Trạng thái"
CONTENT_HEADER = "Nội dung tin nhắn đã gửi"


def _text(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _same(a, b):
    return _text(a).lower() == b.lower()


class ExcelStore:
    def __init__(self):
        self.path = None
        self.kind = None
        self.wb = None
        self.ws = None
        self.csv_rows = None
        self.status_col = -1
        self.content_col = -1

    def load(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext == ".xls":
            raise ValueError("File .xls cũ chưa hỗ trợ, hãy mở bằng Excel và lưu lại dạng .xlsx")
        self.path = path
        if ext == ".csv":
            return self._load_csv()
        return self._load_xlsx()

    def _load_xlsx(self):
        self.kind = "xlsx"
        self.wb = load_workbook(self.path, keep_vba=self.path.lower().endswith(".xlsm"))
        self.ws = self.wb.worksheets[0]
        ws = self.ws

        headers = [_text(c.value) for c in ws[1]]
        while headers and not headers[-1]:
            headers.pop()

        self.status_col = self._ensure_header(headers, STATUS_HEADER)
        self.content_col = self._ensure_header(headers, CONTENT_HEADER)

        rows = []
        for r in range(2, ws.max_row + 1):
            values = [_text(ws.cell(row=r, column=i + 1).value) for i in range(len(headers))]
            if any(values):
                rows.append({"row": r, "values": values})
        return headers, rows

    def _ensure_header(self, headers, title):
        for i, h in enumerate(headers):
            if _same(h, title):
                return i
        headers.append(title)
        idx = len(headers) - 1
        cell = self.ws.cell(row=1, column=idx + 1, value=title)
        left = self.ws.cell(row=1, column=idx) if idx > 0 else None
        if left is not None and left.has_style:
            cell.font = left.font.copy()
            cell.fill = left.fill.copy()
            cell.border = left.border.copy()
            cell.alignment = left.alignment.copy()
        else:
            cell.font = Font(bold=True)
        width = 45 if title == CONTENT_HEADER else 18
        self.ws.column_dimensions[cell.column_letter].width = width
        return idx

    def _load_csv(self):
        self.kind = "csv"
        with open(self.path, "r", encoding="utf-8-sig", newline="") as f:
            sample = f.read(4096)
            f.seek(0)
            try:
                dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
            except csv.Error:
                dialect = csv.excel
            self.csv_rows = [list(r) for r in csv.reader(f, dialect)]
        self.csv_delimiter = dialect.delimiter
        if not self.csv_rows:
            self.csv_rows = [[]]
        headers = [_text(h) for h in self.csv_rows[0]]

        def ensure(title):
            for i, h in enumerate(headers):
                if _same(h, title):
                    return i
            headers.append(title)
            return len(headers) - 1

        self.status_col = ensure(STATUS_HEADER)
        self.content_col = ensure(CONTENT_HEADER)
        self.csv_rows[0] = headers

        rows = []
        for i, raw in enumerate(self.csv_rows[1:], start=1):
            values = [_text(raw[c]) if c < len(raw) else "" for c in range(len(headers))]
            if any(values):
                rows.append({"row": i, "values": values})
        return headers, rows

    def update(self, row, status, content):
        if self.kind == "csv":
            line = self.csv_rows[row]
            need = max(self.status_col, self.content_col) + 1
            line.extend([""] * (need - len(line)))
            line[self.status_col] = status
            line[self.content_col] = content
        else:
            self.ws.cell(row=row, column=self.status_col + 1, value=status)
            c = self.ws.cell(row=row, column=self.content_col + 1, value=content)
            c.alignment = Alignment(wrap_text=True, vertical="top")
        self.save()

    def save(self, path=None):
        path = path or self.path
        try:
            if self.kind == "csv":
                with open(path, "w", encoding="utf-8-sig", newline="") as f:
                    csv.writer(f, delimiter=self.csv_delimiter).writerows(self.csv_rows)
            else:
                self.wb.save(path)
        except PermissionError:
            raise PermissionError("File đang mở trong Excel, hãy đóng file rồi thử lại")
