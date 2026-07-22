# DMOX Backlog

Cập nhật: 2026-07-22

Trạng thái nhanh:

| # | Mục | Priority | Trạng thái |
|---|-----|----------|------------|
| 1 | Preserve UI state after reload | High | 🟡 Một phần — còn `activePanel` + scroll position |
| 2 | Improve docker-compose local mount | High | 🔴 Chưa làm |
| 3 | Git integration | High | 🔴 Mới có history + blame. Pha A đã có plan; pha write tách story riêng |
| 4 | Realtime sync local files | Critical | 🟢 Xong chiều Local → UI. Chiều UI → Local tách thành item riêng (cần editor) |
| 5 | Mermaid interaction UX | Medium | 🟢 Xong |
| 6 | Favorites in Tree View | Medium | 🟢 Xong (2 mục hoãn có chủ đích) |

---

## 1. Preserve UI state after reload
Priority: High — 🟡 **Một phần**

### Current issue
Reload page làm mất context hiện tại:
- Reset về page mặc định.
- Tree directory scroll về đầu.
- Không focus đúng file đang mở.

### Expected
- Giữ nguyên page hiện tại.
- Restore active tab.
- Restore selected file.
- Tree directory tự scroll tới đúng vị trí file hiện tại.
- Nếu đang preview/editor thì giữ nguyên cursor và scroll (nếu có).

### Đã làm
- Tree expand state persist theo workspace (`localStorage: dmox-expanded-${workspaceId}`,
  `web/src/useExpandedFolders.ts`), default collapsed toàn bộ.
- Reveal + scroll tree tới đúng file đang mở khi load (`WorkspaceLayout.tsx`,
  `expandAncestors` + `scrollIntoView({ block: 'nearest' })`).
- Sidebar width + right-panel width persist.
- Page hiện tại giữ nguyên sẵn nhờ routing (URL là source of truth).

### Còn lại

**1a. Persist `activePanel`**

`activePanel` đang là `useState` thuần (`WorkspaceLayout.tsx`), reload là mất.
Thêm key `dmox-panel-${workspaceId}`, dùng lại đúng pattern của
`useFavorites` / `useExpandedFolders`.

> ⚠️ Restore `terminal` đồng nghĩa **spawn một PTY shell mỗi lần load trang**.
> Đề xuất: chỉ auto-restore `search` / `ai-context`; `terminal` khôi phục ở
> trạng thái đóng, hoặc mở panel nhưng chờ user chủ động bấm "Start".

**1b. Restore scroll position của `.content`**

Lưu `scrollTop` (debounced) theo `workspaceId + path` vào `sessionStorage`.
Khôi phục sau khi file load xong, thay cho `resetScroll()` hiện tại trong
`FileViewerPage.tsx` — nhưng **chỉ khi là reload/back**; navigate sang file
khác thì vẫn phải về đầu như hiện nay.

> ⚠️ Đụng trực tiếp lớp bug đã fix ngày 2026-07-22: Mermaid render async, nên
> restore scroll trước khi diagram render xong sẽ rơi sai vị trí. Phải restore
> **sau** khi diagram settle, hoặc re-apply một lần trong `requestAnimationFrame`
> sau render. Xem "Ghi chú kỹ thuật" ở cuối file.

---

## 2. Improve docker-compose local mount
Priority: High — 🔴 **Chưa làm**

### Current issue
Volume mount chưa hoạt động ổn với nhiều shell/environment.

Ví dụ:
- bash
- zsh
- fish
- PowerShell
- Git Bash
- WSL
- Docker Desktop
- Linux native

### Expected
- Mount source code ổn định trên mọi môi trường.
- Không cần sửa compose theo từng OS.
- Auto detect workspace path.
- Hỗ trợ Windows + WSL + Linux.

### Nguyên nhân gốc
Path trong `config.yaml` resolve theo `WORKDIR /app` của container. Hệ quả:
mỗi workspace phải thêm tay một dòng mount ở `docker-compose.override.yml`
sao cho path trong container khớp path tương đối trong config — hardcode theo
từng máy, không portable.

### Plan
1. Thêm `workspace_root:` vào `config.yaml`, dùng để resolve các source path
   tương đối. Cắt hẳn ràng buộc với `WORKDIR`, host và container dùng chung
   một giá trị config.
2. `.env` (compose tự đọc, hoạt động trên Windows/WSL/mac) + mount **một**
   thư mục cha duy nhất: `${DMOX_ROOT}:/workspaces:ro`, thay cho N dòng mount.
3. Unit test resolve path trong `internal/config`.
4. Wrapper `make dev` sinh `.env` từ pwd nếu chưa có.

> Lưu ý Windows: Git Bash mangle path (`MSYS_NO_PATHCONV=1`), Docker Desktop
> cần bật drive sharing. Hai thứ này phải document — không auto-detect hết được.

---

## 3. Git integration
Priority: High — 🔴 **Mới có history + blame**

### Current issue
Git gần như chưa usable.

Hiện có: `GET /git/history`, `GET /git/blame` (`internal/gitsvc`).

Thiếu:
- Detect current repository.
- Branch hiện tại.
- Git status.
- Modified files.
- Diff.
- Stage/unstage.
- Commit.
- Checkout branch.
- Pull/Push.

### Expected
Agent có thể sử dụng git như IDE.

### Pha A — read-only (làm trước)

Khớp với định vị "read-only documentation browser" hiện tại, không mở bề mặt
ghi nào.

1. `internal/gitsvc`: thêm `Branch()`, `Status()`, `DiffWorkingTree()`.
2. API: `GET /workspaces/:id/git/branch`, `/git/status`, `/git/diff`.
3. Datasource: implement **cả hai** phía (`liveDataSource` + `staticDataSource`)
   — static export chỉ cần snapshot tại thời điểm build, không có working tree.
4. UI: badge `M` / `A` / `U` trên node trong TreeView, cộng một section
   **Git Changes** ở sidebar — trùng luôn với hướng "Workspace evolution"
   ở cuối file này.

> ⚠️ Chỉ có nghĩa với source `type: local` trỏ vào working dir thật. Source
> `type: git` là **mirrored clone**, không có working tree → phải xử lý riêng,
> không dùng chung code path được. API phải trả rõ "not applicable" thay vì lỗi.

### Pha B — write (stage/commit/checkout/pull/push)

**Tách thành story riêng, cần brainstorm trước khi code.** Lý do:

- Biến DMOX từ viewer thành công cụ **ghi** — đụng thẳng định vị trong `CLAUDE.md`.
- Mở bề mặt tấn công mới trong khi Terminal vẫn chưa có auth.
- Cần thiết kế riêng cho: xác nhận thao tác, xử lý conflict, credential cho
  pull/push, và phân quyền nếu đi theo hướng self-host nhiều người dùng
  (xem business roadmap, Sprint 2).

Không bắt đầu pha B cho tới khi có story + brainstorm riêng.

---

## 4. Realtime sync local files
Priority: Critical — 🟢 **Xong chiều Local → UI**

### Đã làm
- File watcher + SSE `GET /api/workspaces/:id/events`.
- Detect create / update / delete, cập nhật tree ngay.
- File đang mở thì refetch tại chỗ và **giữ nguyên scroll position**;
  file bị xoá thì hiện banner.
- `GET /api/workspaces/:id/file/diff` cho DiffModal.

### Chiều UI → Local
Chỉ có nghĩa khi DMOX có editor — hiện chưa có. **Tách ra khỏi mục này**
thành item riêng ("Inline editing", xem Future enhancements) thay vì để
mục Critical treo vô thời hạn. Mục 4 coi như đóng.

---

## 5. Mermaid interaction UX
Priority: Medium — 🟢 **Xong** (2026-07-22)

### Đã làm
- `user-select: none` + `preventDefault()` trên pointerdown, **chỉ khi đã zoom**
  — ở 100% không có gì để pan nên text trong diagram vẫn select/copy như
  nội dung bình thường.
- Cursor `grab` → `grabbing` trong suốt thao tác kéo.
- Ctrl/Cmd + Wheel zoom neo theo con trỏ (kiểu Excalidraw/Figma), pan được bù
  để điểm dưới con trỏ đứng yên. Bind bằng native listener `{ passive: false }`
  vì listener wheel của React ở root là passive, `preventDefault()` bị bỏ qua
  và browser sẽ zoom cả trang.
- Wheel không kèm modifier thì không đụng tới — diagram cao hơn viewport vẫn
  scroll qua bình thường.

Verify bằng headless Chromium thật: giữa lúc kéo `selection.length = 0`,
cursor `grabbing`, thả chuột vẫn giữ zoom/pan; Ctrl+Wheel 100% → 182% với điểm
neo lệch 0.2px × 0.7px và `devicePixelRatio` không đổi.

---

## 6. Favorites in Tree View
Priority: Medium — 🟢 **Xong**

### Đã làm
- Toggle ⭐ trên mọi node (file + folder), section **Favorites** ở đầu Tree View.
- Persist theo workspace: `localStorage: dmox-favorites-${workspaceId}`
  (`web/src/useFavorites.ts`) — không commit vào Git.
- Click favorite: mở file, hoặc expand folder tại chỗ (dùng chung expand state
  với tree chính).
- Nút xoá trực tiếp trên từng dòng favorite — không phải scroll tìm trong tree.
- Favorites fix position, `max-height: 220px` + scroll riêng khi danh sách dài.
- File bị xoá → hiện trạng thái "Missing".

### Hoãn có chủ đích
- Tự cập nhật khi file/folder bị rename hoặc di chuyển.
- Search trong Favorites.

Hai mục này chỉ đáng làm khi số lượng favorite thực sự lớn; hiện chưa có nhu cầu.

---

## Future enhancements

- **Inline editing** (tách từ mục 4 — điều kiện cần cho chiều UI → Local).
- File rename realtime.
- Folder rename realtime.
- Drag & drop.
- Multiple workspace.
- Git worktree support.
- Large repository optimization.
- Incremental tree refresh.
- File cache.
- Ignore theo .gitignore.

### Workspace evolution (sau Favorites)

Về lâu dài, Favorites có thể mở rộng thành một khu vực Workspace đầy đủ
(tương tự VS Code), giảm nhu cầu mở tree khi làm việc với repo lớn:

- Favorites
- Recent Files
- Pinned Files
- Open Editors
- Working Set
- Git Changes ← mục 3 pha A đóng góp trực tiếp phần này

---

## Priority order

Thứ tự đề xuất cho các mục còn lại:

1. **#1 phần còn lại** — nhỏ, cùng pattern đã có, làm gọn trong một lượt.
2. **#3 pha A (read-only git)** — giá trị lớn nhất cho người dùng, không đụng
   định vị sản phẩm.
3. **#2 docker mount** — nền tảng cho việc người khác chạy được DMOX.
4. **#3 pha B** — chỉ sau khi có story + brainstorm riêng.

> Nếu roadmap business (self-host per company) sắp tới gần thì **#2 phải nhảy
> lên đầu**: đó là thứ khách hàng chạm vào đầu tiên, trước cả tính năng.

---

## Ghi chú kỹ thuật (bug đã fix, tránh lặp lại)

Ba bug scroll trên trang có Mermaid, fix trong 2026-07-22 — hai cái đầu là
chẩn đoán sai, ghi lại để không đi lại vết xe đổ:

1. **`touch-action: none`** trên wrapper chặn scroll bằng touch/trackpad khi
   chưa zoom → sửa thành `pan-y` khi `scale === 1`. Thật, nhưng **không phải**
   nguyên nhân của bug được báo (bàn phím cũng bị, mà `touch-action` không
   ảnh hưởng gì tới scroll bằng bàn phím).

2. **Layout shift khi `mermaid.render()` resolve** — diagram phình từ ~0 lên
   hàng nghìn px. Có bù `scrollTop` trong `MermaidBlock`. Cũng thật, nhưng
   chỉ xảy ra một lần lúc load, không giải thích được việc bug lặp vô hạn.

3. **Nguyên nhân thật: `MarkdownView` remount toàn bộ document mỗi lần render.**
   Object `components` (và các function component bên trong) được tạo mới mỗi
   render; React so sánh element type bằng reference → react-markdown nhận type
   mới → unmount + remount cả cây. `MermaidBlock` remount theo, render lại async,
   diagram rỗng một frame, `.content` `scrollHeight` sụt đúng bằng chiều cao
   diagram, browser clamp `scrollTop`. Ngòi nổ là
   `setShowScrollTop(scrollTop > 300)` ở `WorkspaceLayout`.

   Điều kiện để lỗi hiện ra (đo trên build cũ, 5 trang):
   - Trang phải scroll qua được mốc 300px (mới có re-render), **và**
   - `scrollHeight − tổng chiều cao mermaid − clientHeight < vị trí đang đứng`.

   Nên trang ngắn mà diagram chiếm gần hết chiều cao thì chết
   (`collapsedMax = −24`), còn trang dài nhiều chữ thì dù có 5 diagram vẫn
   không sao (`collapsedMax = 2889`). Đó là lý do nó trông "hên xui theo màn".

**Rút ra:** bất cứ component nào nhận `components` / render-prop / callback map
đều phải giữ identity ổn định (module scope hoặc `useMemo`). Đã có regression
test trong `MarkdownView.test.tsx`.
