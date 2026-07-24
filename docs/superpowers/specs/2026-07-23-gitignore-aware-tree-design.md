# Respect `.gitignore` when building the tree — Design

Date: 2026-07-23
Status: approved, ready for implementation
Follows: General File Viewer (#7). Backlog: relates to "Ignore theo .gitignore" (Future enhancements) and #7.

## Vấn đề (phát hiện khi chạy #7 trên repo thật)

Sau #7, `LocalSource.List` trả **mọi file viewable**. Trên một source trỏ vào
repo code thật (workspace `myself` = toàn bộ repo dmox), tree phình lên ~12.5k
file vì `node_modules/`, `internal/webassets/dist/`, `bin/`… đều bị liệt kê.
`List` hiện chỉ skip dotfiles/dot-dirs, không biết `.gitignore`.

## Quyết định (brainstorm 2026-07-23)

- **Tôn trọng `.gitignore` đầy đủ** (không phải skip-set tên cứng).
- Dùng `github.com/go-git/go-git/v5/plumbing/format/gitignore` — **đã là dep**
  (go-git v5.19.1), không thêm dependency mới. Cùng họ với billy `osfs`
  (`go-git/go-billy/v5`, đã có).
- **Chỉ `LocalSource`**: nó đi bộ trên working dir thật *có* file bị ignore trên
  đĩa. `GitSource` là mirrored clone — git không clone file ignored nên không có
  vấn đề này; để nguyên.
- Đọc `.gitignore` **từ source root trở xuống** (nested, qua
  `gitignore.ReadPatterns`). Không đọc `.gitignore` repo cha *phía trên* source
  root, không global gitignore (Future).
- Giữ nguyên skip dotfiles hiện có; matcher chồng thêm.

## Kiến trúc

`internal/source/local.go`:

- Helper `ignoreMatcher(root string) gitignore.Matcher`:
  ```
  fs := osfs.New(root)
  ps, _ := gitignore.ReadPatterns(fs, nil)   // root + nested .gitignore
  return gitignore.NewMatcher(ps)
  ```
  Lỗi đọc → matcher rỗng (không ignore gì), không fail cả List — một source
  không phải repo là trạng thái bình thường.

- Helper `relComponents(root, p string) []string`: path tương đối của `p` so với
  `root`, tách theo separator, dạng `gitignore.Matcher.Match` cần
  (`["web","node_modules","x.js"]`).

- **`List` walk**: dựng matcher một lần đầu hàm. Trong callback:
  - Dir: nếu `matcher.Match(comps, true)` → `filepath.SkipDir` (rẻ, cắt cả cây).
  - File: nếu `matcher.Match(comps, false)` → bỏ qua (`return nil`) trước khi
    check `IsViewable`.
  - Skip dotfiles như cũ vẫn giữ.

- **`addRecursive` walk (watcher)**: cùng matcher; dir bị ignore → `SkipDir`,
  không đăng ký fsnotify watch (tránh watch hàng nghìn dir `node_modules`, và
  rủi ro chạm giới hạn inotify).

## Test

`internal/source` (thêm vào test file phù hợp):

1. Repo tạm: `src/main.go`, `node_modules/dep/index.js`, `dist/out.js`,
   `README.md`, và `.gitignore` chứa:
   ```
   node_modules/
   dist/
   ```
   → `List` trả `README.md` + `src/main.go`; **không** trả file trong
   `node_modules/` hay `dist/`.
2. Nested `.gitignore`: `sub/.gitignore` chứa `ignored.txt`; file
   `sub/ignored.txt` bị loại, `sub/keep.md` còn.
3. Source không có `.gitignore` (chỉ vài file md): List hoạt động y như trước
   (không ignore gì) — bảo đảm không regress workspace docs-only như `podzone`.

## Ngoài scope (Future)

- Global gitignore (`core.excludesFile`), `.gitignore` của repo cha phía trên
  source root, `.git/info/exclude`.
- Ignore theo cấu hình workspace (một danh sách glob trong `config.yaml`).

## Kết quả kỳ vọng

Workspace `myself` (source = repo root) rớt từ ~12.5k file xuống còn source thật
(vài trăm); `node_modules`/`dist`/`bin` biến mất khỏi tree. Workspace docs-only
không đổi.
