# Nhắn tin Zalo

Tool gửi tin nhắn Zalo tự động theo danh sách khách hàng trong file Excel.

Tải bản mới nhất: https://github.com/thuannttu0308/Tool_NhanTinZalo/releases/latest

| Bản | File | Gửi qua | Ghi chú |
|---|---|---|---|
| **Chrome Extension** (khuyên dùng) | `NhanTinZalo-extension.zip` | Zalo Web | Chạy ngầm, cài 1 phút, Windows và Mac |
| Windows | `NhanTinZalo.exe` | Zalo PC hoặc Zalo Web | Không cần cài, chạy trực tiếp |
| Android / LDPlayer | `NhanTinZalo.apk` | App Zalo | Cần bật quyền Trợ năng |
| iOS | thư mục `ui` | Thủ công có hỗ trợ | Apple không cho tự động |

Hướng dẫn cài cho các phòng ban: [docs/HUONG_DAN_CAI_DAT.md](docs/HUONG_DAN_CAI_DAT.md)

## Chuẩn bị file Excel

- Dòng đầu tiên là tiêu đề cột. File mẫu: [docs/file_mau.xlsx](docs/file_mau.xlsx)
- Cần có cột số điện thoại (`Số điện thoại`, `SĐT`, `Phone`...). Tool tự nhận diện, có thể chọn lại.
- Cột `Đơn vị kinh doanh` dùng cho biến `{Tên}`.
- Tool tự thêm 2 cột `Trạng thái` và `Nội dung tin nhắn đã gửi` nếu chưa có. Khách đã `Đã gửi` sẽ được bỏ qua ở lần chạy sau.
- Số điện thoại được tự chuẩn hoá: `912345678`, `0912 345 678`, `+84912345678` đều thành `0912345678`.
- Định dạng của file (màu, độ rộng cột...) được giữ nguyên khi ghi kết quả.

## Soạn tin nhắn

- Mỗi tin nhắn (**thứ nhất, thứ 2, thứ 3...**) nằm trong một box riêng, khách nhận lần lượt các tin.
- Mỗi tin có nhiều **mẫu**, hệ thống chọn ngẫu nhiên 1 mẫu để gửi.
- Biến: `{Tên}` lấy theo cột đã chọn. Có thể dùng tên cột bất kỳ, ví dụ `{Địa chỉ}`.

## Cách tool xác nhận đã gửi

Tool chỉ ghi `Đã gửi` khi đã kiểm tra đủ 3 bước:

1. Kết quả tìm kiếm có đúng số điện thoại của khách.
2. Khung chat mở ra đúng tên người đó.
3. Ô nhập đã trống và tin nhắn mới đã hiện trong khung chat.

Nếu một bước không đạt, tool ghi `Lỗi: ...` kèm lý do. Nếu khách mới nhận được một phần, tool ghi thêm `(đã gửi 1/2 tin)`.

## Bản Windows (.exe)

1. Chạy `NhanTinZalo.exe`. Nếu Windows cảnh báo, bấm **More info → Run anyway**.
2. **Gửi qua Zalo App**: mở và đăng nhập Zalo PC. Tool tự phóng to Zalo. Trong lúc chạy không dùng chuột/bàn phím.
3. **Gửi qua Zalo Web**: lần đầu quét mã QR trong cửa sổ trình duyệt tool mở ra.
4. Đóng file Excel trong lúc tool chạy.

## Bản Android (máy thật, LDPlayer, BlueStacks, Nox)

1. Cài `NhanTinZalo.apk` (với giả lập: kéo thả file APK vào cửa sổ giả lập) và đăng nhập Zalo.
2. Mở app, bấm **Mở cài đặt Trợ năng**, bật **Nhắn tin Zalo - Tự động gửi**.
3. Chọn file Excel, soạn tin, bấm **Bắt đầu gửi**. Kết quả ghi thẳng vào file đã chọn.

Chạy trên LDPlayer thì máy tính vẫn làm việc khác được trong lúc gửi.

## iOS (bán tự động)

Đưa thư mục `ui` lên một trang web tĩnh, mở bằng Safari. Với mỗi khách: bấm **Mở chat Zalo**, **Sao chép** từng tin rồi dán gửi, bấm **Đã gửi, khách tiếp**. Xong bấm **Tải file Excel kết quả**.

## Cập nhật phiên bản

Mọi bản đều tự kiểm tra phiên bản mới khi mở và hiện nút **Cập nhật**:

- **Extension**: tự tải và ghi đè thư mục cài, lần đầu cần chọn thư mục và bấm Cho phép.
- **Windows**: tự tải `.exe` mới, thay file và mở lại.
- **Android**: tự tải APK mới và mở màn hình cài đặt.

## Lưu ý tránh bị Zalo hạn chế

- Không gửi quá nhiều khách lạ trong một ngày (nên dưới 30-50 khách/ngày/tài khoản).
- Dùng nhiều mẫu tin khác nhau, giãn cách hợp lý giữa các khách.
- Chạy thử với 1-2 số của mình trước khi chạy cả danh sách.

## Dành cho người phát triển

```
ui/              giao diện dùng chung mọi nền tảng
extension-src/   phần riêng của Chrome Extension (manifest, background, content script)
extension/       extension hoàn chỉnh, sinh tự động từ ui + extension-src
desktop/         bản Windows/macOS (Python)
android/         bản Android (Java)
tools/release.py script phát hành phiên bản
version.json     thông tin phiên bản mới nhất, các bản tool đọc file này để cập nhật
```

Phát hành phiên bản mới:

```
python tools/release.py 1.2.0 "Mô tả thay đổi" --build
git add -A && git commit -m "Phiên bản 1.2.0" && git tag v1.2.0 && git push && git push --tags
gh release create v1.2.0 dist/NhanTinZalo-extension.zip dist/NhanTinZalo.exe dist/NhanTinZalo.apk --title "v1.2.0" --notes "Mô tả thay đổi"
```

Khoá ký app Android nằm ở `android/keystore/` (không đưa lên Git). **Cần sao lưu thư mục này**, mất khoá thì các bản Android sau không cài đè lên bản cũ được.
