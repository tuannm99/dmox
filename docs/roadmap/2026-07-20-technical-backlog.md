# DMOX Backlog

Cập nhật: 2026-07-23

Trạng thái nhanh:

| # | Mục | Priority | Trạng thái |
|---|-----|----------|------------|
| 1 | Preserve UI state after reload | High | 🟢 Xong |
| 2 | Improve docker-compose local mount | High | 🔴 Chưa làm |
| 3 | Git integration | High | 🟡 Pha A (read-only) xong. Pha write tách story riêng, chưa bắt đầu |
| 4 | Realtime sync local files | Critical | 🟢 Xong chiều Local → UI. Chiều UI → Local tách thành item riêng (cần editor) |
| 5 | Mermaid interaction UX | Medium | 🟢 Xong |
| 6 | Favorites in Tree View | Medium | 🟢 Xong (2 mục hoãn có chủ đích) |

---

## 1. Preserve UI state after reload
Priority: High — 🟢 **Xong**

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

### Đã làm (đợt 2, 2026-07-23)

**1a. Persist `activePanel`** (`web/src/useActivePanel.ts`)

Panel đang mở được lưu theo workspace (`dmox-panel-${workspaceId}`) và mở lại
khi load, đánh dấu sẵn là "đã opened" để pane lazy-mount render được ngay.

**Terminal cố tình không restore**: mở panel đó là spawn một PTY shell thật,
restore nghĩa là mỗi lần load trang lại đẻ thêm một shell — kể cả những lần
reload mà user không hề nghĩ là "mở terminal". Chuyển sang Terminal vẫn xoá
giá trị đã lưu, để panel cũ không quay lại.

> Giá trị lưu được đọc trong lúc render, không đọc trong effect:
> `WorkspaceLayout` không remount khi đổi workspace, nên effect sẽ ghi panel
> của workspace cũ vào key của workspace mới rồi mới tự sửa lại.

**1b. Restore scroll position** (`web/src/scrollMemory.ts`)

Vị trí scroll lưu theo từng doc vào `sessionStorage`, khôi phục khi reload
hoặc back/forward (`navigationType === 'POP'`); click vào một doc là đọc mới
nên vẫn về đầu trang.

Khôi phục phải là **vòng lặp retry**, không phải gán một lần, vì hai lý do:

1. Chiều cao doc chưa chốt cho tới khi nội dung async render xong → gán sớm bị
   clamp và rơi thiếu.
2. `MermaidBlock` cố tình nudge `scrollTop` mỗi khi một diagram render xong —
   đúng cho người đang đọc, nhưng **sai** khi đang restore, vì offset đã lưu
   được đo trên layout hoàn chỉnh. Đo thực tế: không có vòng lặp thì vị trí
   trôi từ 3200 lên 4994.

Vòng lặp re-assert target cho tới khi chiều cao đứng yên, hết deadline, hoặc
user bắt đầu scroll — không bao giờ giành scroll với user.

Verify bằng Chromium thật trên doc có 5 diagram: lưu 3200 trong layout 6191px,
reload rơi vào 4102 lúc đang render rồi settle đúng 3200; nút back khôi phục
3200; click link vào doc thì bắt đầu ở 0. Mở terminal rồi reload: 0 websocket,
panel đóng.

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
Priority: High — 🟡 **Pha A xong** (2026-07-23)

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

### Pha A — read-only ✅ xong

Không có bề mặt ghi nào; giữ nguyên định vị "read-only documentation browser".

Đã làm:

1. `internal/gitsvc/worktree.go`: `WorkingTree()` (branch + status từng file) và
   `WorkingTreeDiff()` (on-disk vs HEAD).
2. API: `GET /workspaces/:id/git/status`, `GET /workspaces/:id/git/working-diff`.
   *Gộp branch vào `status`* thay vì tách `/git/branch` như plan ban đầu —
   branch một mình không dùng được gì, gộp lại thì UI chỉ cần một request.
3. Datasource: cả `liveDataSource` lẫn `staticDataSource` (static export không
   có working tree nên luôn báo không có gì).
4. UI: section **Git Changes** trên tree (branch, số lượng, mỗi doc một dòng,
   cap chiều cao + scroll riêng như Favorites), badge `M`/`A`/`D`/`U` trên node,
   và diff working-tree dùng lại `DiffModal` qua prop `kind`.

Hai điều chỉnh phát hiện khi chạy thật, không phải khi đọc code:

- **Cache bắt buộc**: `Status()` của go-git hash toàn bộ working tree, đo được
  **~2s** trên repo cỡ vừa. Kết quả được cache theo thư mục và **xoá ngay khi
  watcher báo có thay đổi** trong source đó. TTL 10s là lưới đỡ cho những gì
  watcher không thấy — chủ yếu là `git checkout` đổi branch, vì việc đó xảy ra
  bên trong `.git`.
- **Lọc theo file DMOX index**: source root chứa nhiều thứ ngoài docs. Ban đầu
  danh sách hiện cả `serve.go`, `config.yaml` — không có node tương ứng trong
  tree, click vào là 404.

> ⚠️ Chỉ có nghĩa với source `type: local` trỏ vào working dir thật. Source
> `type: git` là **mirrored clone**, không có working tree. API trả
> `applicable: false` thay vì lỗi.
>
> ⚠️ **Hệ quả với Docker**: nếu chỉ mount `docs/` (không mount cả repo), bên
> trong container không có `.git` để đi ngược lên → `applicable: false`, section
> Git Changes tự ẩn. Muốn dùng được thì phải mount repo root (hoặc ít nhất
> `.git`). Ràng buộc này nên gộp vào **mục 2** khi làm lại phần mount.

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

1. ~~#1 phần còn lại~~ — ✅ xong 2026-07-23.
2. ~~#3 pha A (read-only git)~~ — ✅ xong 2026-07-23.
3. **#2 docker mount** — nền tảng cho việc người khác chạy được DMOX. Giờ còn
   thêm lý do: không mount cả repo thì Git Changes không dùng được.
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
