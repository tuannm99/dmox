# General File Viewer (#7) — Design

Date: 2026-07-23
Status: approved, ready for implementation plan
Backlog: `docs/roadmap/2026-07-20-technical-backlog.md` #7

## 1. Vấn đề

Toàn bộ pipeline của DMOX bị chặn ở một cổng duy nhất: `source.List()` chỉ trả
file `.md`/`.markdown` (qua `source.IsDocFile`). Hệ quả: file non-markdown
không vào tree, không được index, không có API — không xem được. Mở phạm vi từ
"README viewer" thành "trình duyệt mọi file text trong repo" là bước biến DMOX
thành Documentation Workspace (xem đường tiến hoá #7→#9→#8/#10 trong backlog).

Rendering hiện là **client-side**: backend trả *chuỗi nguồn markdown* trong
`FileView.Body`, `MarkdownView` (react-markdown) render ở browser. Thiết kế này
bám đúng pattern đó cho code file.

## 2. Quyết định đã chốt (brainstorm 2026-07-23)

| # | Fork | Chốt |
|---|------|------|
| 1 | Code file có vào FTS index không? | **Không** (v1). Tree mở, nhưng index giữ nguyên docs. Classification thiết kế sẵn để một cờ config sau này gộp code vào index, **không viết lại**. |
| 2 | Tree hiển thị gì? | **Allowlist** loại text đã biết (ext + tên như Dockerfile/Makefile). Không rác binary, không phình. |
| 3 | File lớn? | **Cap ~1MB + fallback plaintext**: dưới ngưỡng highlight đầy đủ; trên ngưỡng hiện raw plaintext + banner (highlight là phần đắt nhất). |
| 4 | Highlight ở đâu? | **Client-side** (highlight.js lazy-load). Khớp pattern render markdown hiện có; static export chỉ cần ship raw string. |
| 5 | `ClassDoc` gồm gì? | **Chỉ `.md/.markdown`** (y như hôm nay) → index + render markdown **không đổi, zero regression**. `.txt/.rst/.adoc/.mdx` xem dạng plaintext. |
| 6 | File diagram `.mmd/.puml`? | **v1 hiện source (code)**. Render nguyên file thành diagram = future. Inline-trong-markdown vẫn chạy như cũ. |

Nguyên tắc xuyên suốt: **#7 là additive**. Đường markdown + index không bị đụng;
mọi thứ mới đi qua nhánh code mới. Rủi ro regression tối thiểu.

## 3. Kiến trúc

### 3.1 Backend — phân loại file (`internal/source`)

Thay `IsDocFile(name) bool` bằng một phân loại ba nhánh:

```go
type FileClass int

const (
    ClassUnsupported FileClass = iota // binary / không rõ → ẩn khỏi tree
    ClassDoc                          // .md/.markdown → index + render markdown
    ClassText                         // text/code/config/diagram source → xem được, chưa index
)

func Classify(name string) FileClass
```

- **`Classify`** quyết định bằng ext (lowercase) và, cho file không ext, bằng
  basename: `Dockerfile`, `Makefile`, `Jenkinsfile`.
- Allowlist `ClassText`:
  - Docs-as-text: `.txt .rst .adoc .mdx`
  - Code: `.go .rs .ts .tsx .js .jsx .mjs .cjs .py .java .c .h .cpp .cc .hpp .hh .yaml .yml .json .toml .xml .sql .sh .bash .zsh`
  - Diagram source: `.mmd .puml .plantuml`
  - Config theo tên: `Dockerfile Makefile Jenkinsfile`
- `ClassDoc`: `.md .markdown` (không đổi).
- Còn lại → `ClassUnsupported`.

**Call sites đổi:**
- `LocalSource.List()` / `GitSource.List()`: giữ file khi `Classify != ClassUnsupported`
  (thay `if !IsDocFile(...) { return nil }`).
- `internal/index`: **guard mới, bắt buộc**. Hôm nay `Indexer.IndexSource` lấy
  danh sách thẳng từ `src.List()` (indexer.go:22) và index *mọi* file `List` trả
  — nó không tự lọc, chỉ dựa vào việc `List` vốn đã chỉ trả `.md`. Khi nới `List`
  thành "viewable", **nếu không thêm lọc thì code file sẽ lọt vào FTS index** —
  đúng thứ Quyết định #1 cấm. Nên `IndexSource` **và** `IndexFile` (đường reindex
  một file của watcher) phải bỏ qua file `Classify != ClassDoc`, qua helper
  `IsIndexed(name) = Classify(name) == ClassDoc`. Cờ tương lai chỉ nới helper này
  (ví dụ gộp `ClassText`) — call site không đổi.
- `internal/api` git status filter: đổi từ `IsDocFile` sang "viewable"
  (`Classify != ClassUnsupported`) → **code file thay đổi cũng hiện trong Git
  Changes** (khép lại một giới hạn của #3 pha A).

> `IsDocFile` bị xoá; mọi call site chuyển sang `Classify`/helper tương ứng.
> Grep xác nhận không còn tham chiếu trước khi hoàn tất.

### 3.2 Backend — `handleFile` rẽ nhánh (`internal/api`)

```
Classify(base):
  ClassDoc  → đường cũ: index.Parse → PlantUML.RenderBlocks → FileView{
                 kind:"markdown", Body: markdown-source, Headings, Frontmatter, IsAIContext }
  ClassText → đọc raw:
                 nếu len(raw) > maxHighlightBytes (~1MB):
                     FileView{ kind:"code", Body:string(raw), Language:lang,
                               TooLargeToHighlight:true }
                 ngược lại:
                     FileView{ kind:"code", Body:string(raw), Language:lang }
  ClassUnsupported → 404 (không có node trong tree)
```

`FileView` (trong `internal/render`) thêm trường:

```go
Kind                string `json:"kind"`               // "markdown" | "code"
Language            string `json:"language,omitempty"` // highlight.js id, "" nếu không rõ
TooLargeToHighlight bool   `json:"tooLargeToHighlight,omitempty"`
```

Trường cũ (`Headings`, `Frontmatter`, `IsAIContext`) rỗng với `kind:"code"`.

**Language map** (ext/tên → highlight.js id): bảng tra nhỏ, ví dụ `.go`→`go`,
`.ts`→`typescript`, `.py`→`python`, `Dockerfile`→`dockerfile`, `.yml`→`yaml`.
Ext không có trong bảng → `Language:""` (frontend hiện plaintext, không highlight).
`maxHighlightBytes` là hằng, có thể chỉnh sau.

### 3.3 Frontend — rẽ theo `kind`

`FileView` (datasource/types.ts) thêm `kind`, `language?`, `tooLargeToHighlight?`.

`FileViewerPage` rẽ:
- `kind === "markdown"` → `<MarkdownView>` (nguyên).
- `kind === "code"` → `<CodeView body language tooLargeToHighlight />` (mới).

`CodeView.tsx` (mới):
- `<pre>` + `<code>` với **số dòng** (gutter) và nút **copy**.
- Highlight bằng highlight.js **lazy-import** (ngoài main chunk); chỉ chạy khi
  `language` có trong tập đăng ký và `!tooLargeToHighlight`.
- **Referential-stable** theo đúng bài học `MarkdownView` (CLAUDE.md): kết quả
  highlight tính trong `useMemo`/effect ổn định theo `[body, language]`, không
  dựng lại node/handler mỗi render.
- `tooLargeToHighlight` → hiện raw plaintext + banner "file lớn, đã tắt
  highlight".
- Scroll-restore (#1b, key theo path) chạy sẵn, không cần thêm gì.

**In-file search**: Ctrl+F **native** của browser. Vì không virtualize, cả file
nằm trong DOM nên tìm được. Overlay search riêng = future.

### 3.4 Static build (`internal/staticbuild`)

- Tree tĩnh đã tự bao gồm code file (dùng chung `doctree.Build` → `List` đã nới).
- Ghi thêm cho mỗi `ClassText` file: JSON `FileView{ kind:"code", body, language,
  tooLargeToHighlight }` — cùng đường ghi doc hiện tại, chỉ khác payload.
- `staticDataSource.getFile` trả `kind` như `liveDataSource`.

## 4. Đơn vị & ranh giới

| Đơn vị | Trách nhiệm | Phụ thuộc |
|--------|-------------|-----------|
| `source.Classify` / `FileClass` | Phân loại tên file → doc/text/unsupported | (thuần) |
| `render`/language map | ext/tên → highlight id | — |
| `handleFile` | Rẽ doc vs code, cap kích thước | `Classify`, `index`, `render` |
| `CodeView.tsx` | Hiện code: số dòng, copy, highlight lazy, banner file lớn | highlight.js (lazy) |
| `languages.ts` (FE) | Đăng ký ngôn ngữ highlight.js theo allowlist | highlight.js |

Mỗi đơn vị test được độc lập: `Classify` là hàm thuần; `handleFile` test qua
API; `CodeView` test bằng vitest (số dòng, copy, banner file lớn, không remount).

## 5. Testing

**Backend (Go):**
- `Classify`: bảng case — .md→Doc, .go/.yml/.txt→Text, Dockerfile/Makefile→Text,
  .png/.zip/không rõ→Unsupported, phân biệt hoa/thường ext.
- `List` (local): thư mục trộn docs+code+binary → chỉ doc+text xuất hiện, binary
  bị bỏ, hidden dir vẫn skip.
- `handleFile`: (a) .md → kind:markdown, có headings; (b) .go → kind:code,
  language:go, body=raw; (c) file > cap → tooLargeToHighlight:true; (d) ext lạ →
  language:"" ; (e) unsupported → 404.
- Git status filter: đổi sang viewable → thêm case code file thay đổi thì hiện.
- Regression: index vẫn chỉ ingest .md (đếm doc được index không đổi khi thêm
  code file vào cây).

**Frontend (vitest):**
- `CodeView`: render số dòng đúng số dòng; nút copy gọi clipboard với đúng nội
  dung; `tooLargeToHighlight` → banner + plaintext, không gọi highlighter;
  **không remount** khi parent re-render (theo mẫu test của `MarkdownView`).
- `FileViewerPage`: `kind:"code"` render `CodeView`, `kind:"markdown"` render
  `MarkdownView`.
- Cả `liveDataSource` lẫn `staticDataSource` trả `kind`.

**Verify thật:** mở một file `.go` và một `.md` trong app chạy thật; mở một file
> 1MB xác nhận banner + không treo; đo không có remount khi scroll (như bug
Mermaid cũ).

## 6. Ngoài scope #7 (đúng draft backlog)

- Editor Tab Bar (#9) — single-pane ở #7.
- Minimap, collapse/fold, recent files, breadcrumb nâng cao.
- Render standalone diagram file thành hình (`.mmd/.puml` hiện source ở v1).
- Đưa code vào FTS index (đã chừa cờ, chưa bật).
- Overlay in-file search (dùng Ctrl+F native).
- reStructuredText/AsciiDoc render rich (hiện plaintext).

## 7. Rủi ro & giảm thiểu

- **Bundle phình vì highlight.js**: lazy-import, đăng ký đúng tập ngôn ngữ
  allowlist, không nạp vào main chunk.
- **Remount làm mất scroll** (bug Mermaid cũ): `CodeView` giữ identity ổn định,
  có regression test.
- **Tree phình trên repo lớn nhiều code**: allowlist + skip hidden giữ mức hợp
  lý; incremental tree refresh vẫn ở Future enhancements nếu cần.
- **File lớn treo browser**: cap + plaintext fallback; ngưỡng là hằng chỉnh được.
