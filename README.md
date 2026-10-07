# U&I Smart Put-away · Warehouse 6

## Chạy ứng dụng

```sh
npm install
npm run dev
```

Khi chưa cấu hình Supabase, ứng dụng chạy ở chế độ demo cũ: tài khoản `admin`, `mover`, `lifter` (mật khẩu mặc định `123456`), với dữ liệu lưu trong trình duyệt. Chế độ này không đồng bộ đa thiết bị.

## Bật đồng bộ Put-away đa thiết bị bằng Supabase

### 1. Tạo backend

1. Tạo một project Supabase.
2. Trong **Project Settings → API**, lấy Project URL và publishable/anon key. Không dùng `service_role` key trong ứng dụng trình duyệt.
3. Tạo file `.env.local` trong thư mục dự án theo mẫu `.env.example`, điền URL và key.
4. Mở **SQL Editor** trên Supabase và chạy toàn bộ [`supabase/schema.sql`](./supabase/schema.sql).
5. Trong **Authentication → Users**, tạo tài khoản cho Admin, Mover và Lifter; tắt public sign-up nếu người dùng không được tự đăng ký.
6. Thêm hồ sơ/role cho từng tài khoản trong SQL Editor, thay email bằng email vừa tạo:

```sql
insert into public.smart_location_users (user_id, username, display_name, role)
select id, 'admin', 'Nhân viên kiểm hàng', 'ADMIN'
from auth.users where email = 'admin@example.com';

insert into public.smart_location_users (user_id, username, display_name, role)
select id, 'mover', 'Nhân viên nâng chuyển', 'MOVER'
from auth.users where email = 'mover@example.com';

insert into public.smart_location_users (user_id, username, display_name, role)
select id, 'lifter', 'Nhân viên nâng hạ', 'LIFTER'
from auth.users where email = 'lifter@example.com';
```

7. Khởi động lại `npm run dev`, sau đó đăng nhập bằng email và mật khẩu Supabase. Người dùng chỉ truy cập được dữ liệu khi có hồ sơ trong `smart_location_users`.

Schema bật Row Level Security, chỉ Admin được tạo nhiệm vụ, Mover/Lifter chỉ được thực hiện bước chuyển trạng thái đúng vai trò; vai trò được đọc từ hồ sơ trong database, không tin role do trình duyệt gửi. Một unique index ngăn giữ cùng lúc một ô cho nhiều nhiệm vụ. Realtime publication cập nhật nhiệm vụ và báo cáo sự cố ở các thiết bị đang đăng nhập. Mật khẩu Supabase được đổi qua Supabase Auth trong mục Cài đặt.

### 2. Cấu hình GitHub Pages

Nếu deploy bằng workflow GitHub Pages, thêm repository Actions variables/secrets:

- Variable `VITE_SUPABASE_URL`: Project URL.
- Secret `VITE_SUPABASE_ANON_KEY`: publishable/anon key.

Sau đó deploy lại để các giá trị được đưa vào bundle build. Publishable/anon key được thiết kế để xuất hiện phía trình duyệt; an toàn dữ liệu dựa vào Auth và RLS, không dựa vào việc giấu key.

### Phạm vi đồng bộ

- Đồng bộ đa thiết bị: nhiệm vụ Put-away, trạng thái/nhật ký sự kiện của nhiệm vụ, báo cáo sự cố, ô đang được giữ chỗ và hàng/nhật ký được tạo khi nhiệm vụ hoàn thành.
- Các điều chỉnh tồn kho ngoài luồng Put-away (ví dụ xuất kho thủ công, khóa ô, báo sai lệch) vẫn dùng localStorage và chưa đồng bộ.
- Dữ liệu demo/localStorage đã có không tự tải lên Supabase. Hãy sao lưu và xử lý dữ liệu cũ trước khi chuyển sang chế độ Supabase; khi đã cấu hình Supabase, đăng nhập demo bị tắt.
- Nếu thiếu một trong hai biến Supabase, ứng dụng báo cấu hình không hợp lệ; nếu cả hai đều vắng mặt, ứng dụng chạy chế độ demo local.

## Luồng Put-away

1. Admin quét lô, chọn vị trí. Ô được giữ chỗ và lô chuyển sang `Chờ di chuyển`.
2. Mover đưa hàng đến ô nhưng chưa đặt lên kệ, xác nhận bàn giao. Lô chuyển sang `Chờ nâng hạ`.
3. Lifter bắt đầu nhiệm vụ, nâng hàng lên ô kệ được chỉ định, rồi xác minh mã vị trí hoặc xác nhận thủ công. Lô chuyển sang `Hoàn thành`; tồn kho và nhật ký Put-away được tạo từ nhiệm vụ.

Trong chế độ local, trạng thái được lưu bằng `localStorage` và đồng bộ giữa các tab cùng trình duyệt. Trong chế độ Supabase, trạng thái nhiệm vụ và sự cố dùng backend chung và realtime; các bước chuyển trạng thái dùng điều kiện trạng thái hiện tại để tránh ghi đè thao tác đồng thời.
