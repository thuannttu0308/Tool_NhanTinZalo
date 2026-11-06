# Hướng dẫn cài đặt Nhắn tin Zalo (Chrome)

Dành cho nhân viên các phòng ban. Cài một lần, khoảng 1 phút.

## Cài đặt

1. Tải file **NhanTinZalo-extension.zip** tại: https://github.com/thuannttu0308/Tool_NhanTinZalo/releases/latest
2. Giải nén vào một thư mục cố định, ví dụ `D:\NhanTinZalo`. **Không xoá hay di chuyển thư mục này sau khi cài.**
3. Mở Chrome, gõ vào thanh địa chỉ: `chrome://extensions`
4. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
5. Bấm **Load unpacked** (Tải tiện ích đã giải nén), chọn thư mục `D:\NhanTinZalo\NhanTinZalo` (thư mục có file `manifest.json`).
6. Bấm biểu tượng mảnh ghép trên thanh Chrome, ghim **Nhắn tin Zalo** để tiện mở.

Dùng Microsoft Edge thì làm tương tự, địa chỉ là `edge://extensions`.

## Sử dụng

1. Mở https://chat.zalo.me và đăng nhập Zalo (chỉ cần làm một lần).
2. Bấm biểu tượng **Nhắn tin Zalo** trên thanh Chrome.
3. **01. Chọn file Excel**: chọn file danh sách khách, bấm **Cho phép** khi Chrome hỏi quyền chỉnh sửa file.
4. **02. Soạn tin nhắn mẫu**: nhập các mẫu tin, dùng `{Tên}` để chèn tên khách.
5. **03. Gửi tin nhắn**: bấm **Bắt đầu gửi**.

Tool gửi trong tab Zalo đã ghim, nhân viên vẫn dùng Chrome và máy làm việc khác bình thường. **Không đóng tab Zalo** trong lúc đang gửi.

Kết quả được ghi thẳng vào file Excel đã chọn, ở 2 cột **Trạng thái** và **Nội dung tin nhắn đã gửi**. Hãy **đóng file trong Excel** trong lúc tool chạy.

## Cập nhật phiên bản mới

Khi có bản mới, tool hiện thanh màu vàng **"Có phiên bản mới"** phía trên.

1. Bấm **Cập nhật**.
2. Lần đầu tiên, Chrome yêu cầu chọn thư mục đã cài tool: chọn lại thư mục `D:\NhanTinZalo\NhanTinZalo`, rồi bấm **Cho phép chỉnh sửa**.
3. Tool tự tải bản mới và khởi động lại. Mẫu tin nhắn và cài đặt vẫn giữ nguyên.

Từ lần sau chỉ cần bấm **Cập nhật** là xong.

## Câu hỏi thường gặp

- **Chrome hiện thông báo tắt tiện ích ở chế độ developer**: bấm đóng (X), không bấm "Tắt".
- **Báo "Chưa đăng nhập Zalo Web"**: đăng nhập ở tab Zalo vừa mở, rồi bấm Bắt đầu gửi lại.
- **Báo "File đang mở trong Excel"**: đóng file trong Excel rồi bấm **Tiếp tục**.
- **Không thấy Developer mode**: máy do IT quản lý đã khoá chế độ này, cần liên hệ IT.
