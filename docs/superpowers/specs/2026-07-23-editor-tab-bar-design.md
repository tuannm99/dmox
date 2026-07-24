# Editor Tab Bar (#9) — Design

Date: 2026-07-23
Status: approved, ready for implementation plan
Backlog: `docs/roadmap/2026-07-20-technical-backlog.md` #9
Tiền đề: #7 General File Viewer (đã xong) — mở được mọi file text, nên nhu cầu
mở nhiều file cùng lúc mới thành thật.

## 1. Vấn đề

Muốn xem nhiều file phải đóng file đang xem, hoặc mở thêm tab trình duyệt. Gián
đoạn việc đọc và đối chiếu. Không có tab, DMOX mãi là document viewer; có tab,
nó bắt đầu giống một knowledge workspace.

## 2. Quyết định đã chốt (brainstorm 2026-07-23)

| # | Fork | Chốt |
|---|------|------|
| 1 | Single click vào file chưa mở thì sao? | **Preview tab kiểu VS Code**: single click mở vào một tab preview dùng lại được (in nghiêng), click file khác **thay chỗ** nó; double click biến thành tab cố định. Duyệt nhanh 20 file không đẻ ra 20 tab. |
| 2 | Danh sách tab lưu ở đâu? | **`localStorage`** theo workspace — nhất quán với favorites/panel/expanded, sống qua restart trình duyệt. |
| 3 | Ai là source of truth cho tab đang active? | **URL**. Không lưu `activeTab` riêng. |
| 4 | Chuyển tab có giữ vị trí đọc không? | **Có** — đổi luật scroll restore (xem §4.3). |
| 5 | File bị xoá lúc đang mở tab? | **Giữ tab**, hiện banner sẵn có; không tự đóng. |

## 3. Kiến trúc — vì sao URL là source of truth

Phương án đã chọn: **active tab được suy ra từ URL**, tab list là state đi kèm.

- Click tab = `navigate()` tới path đó.
- Back/Forward đổi URL → active tab tự khớp. **Không thể lệch**, vì không có
  biến thứ hai để lệch.

Phương án bị loại: tab list giữ `activeId` riêng rồi sync URL — hai nguồn sự
thật, back/forward chắc chắn đá nhau (đúng rủi ro plan #7 đã cảnh báo). Cũng
loại: nhét danh sách tab vào query param — URL xấu và dài vô hạn.

**#9 thuần frontend.** Không đụng backend, không thêm method cho datasource nào.

## 4. Thành phần

### 4.1 `useTabs(workspaceId)` — `web/src/useTabs.ts` (mới)

State: `tabs: { path: string; preview: boolean }[]`, persist
`localStorage: dmox-tabs-${workspaceId}`.

Mirror pattern của `useActivePanel`: **đọc giá trị lưu trong lúc render**, và
mang `workspaceId` bên trong state object. Lý do y hệt: `WorkspaceLayout` không
remount khi đổi workspace, nên nếu đọc trong effect thì tab của workspace cũ sẽ
bị ghi vào key của workspace mới rồi mới tự sửa lại.

API:
- `ensureTab(path, { preview })` — thêm nếu chưa có. Nếu `preview` và đang có
  một tab preview khác → **thay chỗ** tab đó (giữ đúng vị trí trong hàng).
  Nếu path đã có sẵn → không tạo trùng.
- `promote(path)` — bỏ cờ preview (double click).
- `close(path)`, `closeOthers(path)`, `closeAll()`.

### 4.2 Truyền ý định qua `location.state`

Không cần state song song để biết "click kiểu gì":

- TreeView: `<Link to={...} state={{ preview: true }} onDoubleClick={() => promote(path)}>`.
  Giữ `<Link>` (không thay bằng button) để middle-click / ctrl-click vẫn đúng
  hành vi browser.
- `WorkspaceLayout` effect: URL đổi → `ensureTab(currentPath, { preview: location.state?.preview === true })`.
- Reload / back-forward không mang state → tab đã nằm sẵn trong list kèm cờ
  preview của nó, giữ nguyên, không bị "thăng cấp" nhầm.

### 4.3 Scroll — luật phải đổi

Hiện `FileViewerPage` restore scroll **chỉ khi `navigationType === 'POP'`**
(reload/back-forward), còn PUSH thì về đầu trang. Với tab bar, click sang một
tab đang mở là PUSH → sẽ về đầu trang, mâu thuẫn với yêu cầu "chuyển tab không
mất trạng thái đọc".

Luật mới: **restore khi `POP` HOẶC `location.state?.restoreScroll === true`.**
- Click tab → `navigate(path, { state: { restoreScroll: true } })` → restore.
- Mở file mới từ tree → không có cờ → bắt đầu ở đầu trang (giữ nguyên hành vi
  hiện tại, đúng kỳ vọng "đọc bài mới thì đọc từ đầu").

Vị trí scroll từng tab đã có sẵn nhờ `scrollMemory` (key theo `workspaceId:path`),
không cần lưu thêm gì.

### 4.4 `TabBar` — `web/src/components/TabBar.tsx` (mới)

- Hàng ngang, `overflow-x: auto`, mỗi tab: tên file + nút ✕.
- Tab preview: tên **in nghiêng**. Tab active: nổi bật.
- `title` = full path (phân biệt tạm khi trùng tên).
- Middle-click (`onAuxClick`, button === 1) đóng tab.
- Context menu: Close / Close Others / Close All / Copy Path / Reveal in Explorer.
  "Reveal" dùng lại `expandAncestors` + scroll-into-view đã có trong
  `WorkspaceLayout`.
- Đặt ngay trên vùng `.content`. Lưu ý ràng buộc trong `CLAUDE.md`: `box-sizing:
  border-box` toàn cục và `.content` dùng `height:100%` + padding — tab bar phải
  là một hàng chiều cao cố định trong flex column, không được làm `.content`
  tràn quá chỗ của nó (nếu không sẽ cụt dòng cuối).
- Giữ identity ổn định (không dựng lại map/render-prop mỗi render) theo đúng bài
  học `MarkdownView` — kèm test chống remount.

### 4.5 Đóng tab

- Đóng tab **không** active → chỉ xoá khỏi list, URL không đổi.
- Đóng tab **đang** active → `navigate` sang tab kề (ưu tiên bên phải, không có
  thì bên trái).
- Đóng tab cuối cùng → về `/w/:workspaceId`.

## 5. Testing

**`useTabs` (vitest):**
- Thêm tab mới; không tạo trùng khi path đã mở.
- Preview thay chỗ: mở A (preview) → mở B (preview) ⇒ chỉ còn B, đúng vị trí cũ.
- `promote` giữ tab lại khi mở file preview khác.
- `close` / `closeOthers` / `closeAll`.
- Persist + đọc lại; **cách ly theo workspace** (đổi workspaceId ra list khác).
- localStorage hỏng/JSON rác → không crash, coi như rỗng.

**`TabBar` (vitest):** render đúng số tab; tab active có styling; preview in
nghiêng; bấm ✕ gọi close; middle-click đóng; context menu gọi đúng handler;
không remount khi parent re-render.

**Tích hợp (vitest):** URL đổi → tab được thêm và thành active; click tab →
điều hướng; đóng tab active → nhảy sang tab kề; back/forward → active tab khớp
(bài test bảo vệ đúng rủi ro §3).

**Scroll:** click tab đang mở → restore vị trí đã lưu; mở file mới từ tree → ở
đầu trang.

## 6. Ngoài scope (Future — đúng draft backlog)

- Pin tab, drag & drop sắp xếp.
- Modified indicator (DMOX read-only, chưa có ý nghĩa).
- Phím tắt chuyển/đóng tab (hệ keymap đã có, thêm sau).
- Phân biệt tab trùng tên (`index.ts` × 5) bằng hậu tố thư mục — **khó chịu thật
  trên repo code**, nhưng để riêng cho gọn v1; hiện dựa vào `title` tooltip.
- Split view / nhiều nhóm tab.
