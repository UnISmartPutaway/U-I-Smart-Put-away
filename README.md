# U&I Smart Put-away · Warehouse 6

## Chạy ứng dụng

```sh
npm install
npm run dev
```

## Tài khoản mô phỏng

Mật khẩu ban đầu của các tài khoản là `123456`; người dùng có thể đổi trong mục Cài đặt. Mật khẩu đã đổi được lưu dưới dạng PBKDF2 hash trong localStorage của trình duyệt này.

- `admin`: kiểm hàng, quét lô, chọn ô và tạo lệnh put-away.
- `mover`: xem lô đang chờ, chuyển hàng đến ô chỉ định và xác nhận hoàn tất bước nâng chuyển.
- `lifter`: xem lô đang chờ nâng hạ, cất hàng lên kệ và xác nhận hoàn tất.

Đây là đăng nhập demo phía giao diện, không dùng cho triển khai thực tế. Mỗi trình duyệt lưu tài khoản riêng, chưa có xác thực hoặc đồng bộ mật khẩu phía máy chủ.

## Luồng Put-away hiện tại

1. Admin quét lô, chọn vị trí. Ô được giữ chỗ và lô chuyển sang `Chờ di chuyển`.
2. Người nâng chuyển đưa hàng đến ô nhưng chưa đặt lên kệ, rồi xác nhận hoàn tất. Lô chuyển sang `Chờ nâng hạ`.
3. Người nâng hạ bắt đầu nhiệm vụ, nâng hàng từ vị trí Mover bàn giao lên ô kệ được chỉ định, rồi xác minh mã vị trí hoặc xác nhận thủ công. Lô chuyển sang `Hoàn thành`; lúc này hàng mới được ghi vào tồn kho và nhật ký Put-away.

Giao diện Mover có sơ đồ kho với ô đích được làm nổi bật, danh sách lọc nhiệm vụ, kiểm tra mã vị trí trước khi xác nhận bàn giao, bảng hoàn thành và báo cáo sự cố. Giao diện Lifter chỉ hiển thị hàng đã được Mover bàn giao, vị trí chờ trước khu vực kệ và ô đích; không hiển thị tuyến vận chuyển. Khi Lifter bắt đầu, trạng thái `LIFTING_ACTIVE` được lưu trong nhiệm vụ để giữ chỗ và đồng bộ giữa các tab. Chỉ hoàn tất sau khi mã quét khớp hoặc nhân viên xác nhận thủ công. Báo cáo sự cố của cả hai vai trò được lưu trong `smartLocationPutAwayIncidents` và hiển thị cho Admin. Thời điểm bàn giao, hoàn thành và nhân viên lấy từ các sự kiện của nhiệm vụ; ca làm, mức ưu tiên và dữ liệu chưa được lưu sẽ không được tự tạo.

Trạng thái, thông báo và nhật ký hiện được mô phỏng bằng `localStorage`. Các tab trong cùng trình duyệt được cập nhật qua sự kiện storage; dữ liệu chưa chia sẻ giữa thiết bị/trình duyệt khác. Chưa kết nối Supabase hoặc có xác thực/phân quyền phía máy chủ.
