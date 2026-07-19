# DMOX Business Roadmap

Status: draft for review
Date: 2026-07-19

## 1. Định hướng

```
Local First → Self-host Team → Enterprise → SaaS (chỉ nếu có demand thật)
```

DMOX hiện tại (Phase 1) là một local-first tool cho 1 developer: Git → DMOX →
Browser, tương đương Obsidian + GitHub Docs + Terminal. Mục tiêu tiếp theo là
Phase 2 "Team Edition" (5-100 developer/công ty), rồi Enterprise, và chỉ cân
nhắc SaaS multi-tenant nếu thị trường thật sự đòi hỏi.

**Quyết định: không multi-tenant.** Mỗi công ty chạy một instance riêng
(`docker compose up`), giống mô hình Gitea / Harbor / Vaultwarden / Plane /
Docmost / Wiki.js, thay vì một DMOX Cloud dùng chung cho nhiều org. Lý do:

- Security đơn giản hẳn — không cần tenant isolation, không noisy neighbor.
- Không cần billing/metering ngay.
- Backup/restore là backup 1 SQLite file + volume, không phải logic per-tenant.
- Khớp nhu cầu thị trường VN: nhiều doanh nghiệp không muốn tài liệu nội bộ
  rời khỏi hạ tầng của họ.
- Khớp sẵn với kiến trúc hiện tại: `data_dir` per-instance, config/docs mount
  runtime chứ không bake vào image (xem README "Docker").

Nếu sau này thật sự cần Cloud: thiết kế model là
`Workspace → Repository → Document Source`, không phải `Tenant`, để lúc đó
chỉ cần thêm một lớp `Organization` phía trên `Workspace` — không rewrite.

## 2. Ba loại ưu tiên — đừng gộp vào một backlog

| Loại | Định nghĩa | Ví dụ |
|---|---|---|
| **Foundation** | Nền mọi feature khác xây lên | Workspace, Repository, Source, Config, Storage, Indexer |
| **Gating** | Không tạo giá trị cạnh tranh, nhưng thiếu thì không thể release an toàn | Login, Session, Authorization, Terminal gate |
| **Moat** | Lý do khách hàng trả tiền | AI Context Engine, Document Graph, Semantic Search, Context Builder |

Auth/RBAC không cạnh tranh độ ưu tiên với AI Context Engine — chúng là hai
loại việc khác nhau (**permission to ship** vs. **reason customers buy**).
Nhầm hai loại này với nhau là lỗi phổ biến nhất khi roadmap một sản phẩm từ
local tool lên nhiều người dùng.

## 3. Bốn lane, mỗi sprint đều chạm cả 4

```
Lane A — Foundation : Workspace, Repository, Source, Indexer
Lane B — Security   : Auth, Authorization, Audit, Rate limit
Lane C — Product    : Viewer, Search, History, Webhook
Lane D — AI         : Context Engine, Knowledge Graph, Agent, MCP
```

Không sprint nào chỉ làm AI, không sprint nào chỉ làm Security.

## 4. Sprint plan

| Sprint | Nội dung |
|---|---|
| **1 – Foundation** | Refactor `Workspace → Repository → Source`; ổn định parser/indexer/config; refactor API theo model mới |
| **2 – Security Gate** | Local auth (login, session, bcrypt, SQLite); `Authorizer` (Grant model, xem §5); feature flags; gate Terminal + User Management + Workspace Management |
| **3 – Collaboration** | Git webhook (auto-sync khi push); workspace sync; search cải tiến; history/diff |
| **4 – Moat** | AI Context Engine v1; Document Graph v1; Context Builder |
| **5 – Extensibility** | Plugin SDK; MCP; tách Terminal thành plugin/service riêng nếu cần; Agent integration |
| **6+ – Enterprise** | OIDC/SAML/SCIM, Audit, multi-org — chỉ làm khi có khách hàng thật sự yêu cầu |

## 5. Authorization design (Sprint 2)

### 5.1 Không phải RBAC cứng, không phải capability security thật

Ban đầu cân nhắc gọi đây là "capability-based authorization", nhưng thực chất
đây là **permission-based access control** (permission linh hoạt, role chỉ là
bundle) — khác hẳn capability security thật (object-capability / macaroon:
sở hữu token không thể giả mạo *chính là* quyền, không cần tra bảng trung
tâm mỗi request, delegate/attenuate được). DMOX **không** cần capability
security thật ở giai đoạn này — permission-based là đủ và đơn giản hơn nhiều.

Không cần Keycloak, không cần OIDC/SAML ở Sprint 2. Chỉ cần:

```
users
sessions
grants (xem bên dưới)
```

Permission tối thiểu (DMOX vốn read-only, số thao tác mutate rất ít):

```
read_document
search
use_terminal
manage_user
manage_workspace
sync_git
```

### 5.2 Grant model — relationship-tuple, URN-style resource

Thay vì hai cột `resource_type` / `resource_id` (dễ tạo ambiguity: `NULL` ở
`resource_type=workspace` nghĩa là "tất cả workspace" hay "toàn instance"? ba
người sẽ code ba kiểu khác nhau), dùng một resource identifier dạng URN, kiểu
AWS ARN / Kubernetes `namespace/pod`:

```
workspace:engineering
repository:api
document:adr-001
terminal:instance
plugin:ai
```

```go
type Grant struct {
    PrincipalID string
    Permission  Permission
    Resource    string // URN: "workspace:engineering"
}
```

Đây là mô hình relationship-tuple `(subject, relation, object)` — cùng hình
dạng Google Zanzibar / OpenFGA / SpiceDB dùng cho Drive, Slack, GitHub
permissions. Không phải phát minh lại — chọn pattern đã kiểm chứng ở đúng bài
toán "nhiều loại resource, permission composable".

Ở Sprint 2: hầu hết grant sẽ ở dạng `instance:root` (toàn hệ thống). Chưa cần
UI quản lý workspace membership — nhưng resource identifier đã sẵn sàng scope
theo workspace/repository/document khi cần, **không cần migration**.

### 5.3 Resource hierarchy — vì sao cần `Parent()` ngay từ đầu

Grant là bảng phẳng, tự nó không trả lời được câu hỏi phân cấp: nếu Alice có
`manage_workspace` trên `workspace:engineering`, cô ấy có tự động có
`read_document` trên `repository:api` (thuộc workspace đó) không? Muốn `Can()`
trả lời đúng mà không phải insert một grant row cho từng repository/document
con, resource cần biết cha của chính nó:

```go
type Resource interface {
    ID() string
    Type() ResourceType
    Parent(ctx context.Context) (Resource, error)
}
```

`Authorizer` leo từ resource cụ thể lên tới root (`Document → Repository →
Workspace → Instance`), dừng ở grant đầu tiên tìm thấy. Đây chính là cách
Zanzibar giải quyết `Document → Folder → Drive → Organization` — permission
không copy xuống, resolver leo cây.

**Vì sao đây là quyết định "cheap now, expensive later":** đến Sprint 4, AI
Context Engine bắt buộc phải biết "user này đọc được document nào" để tránh
lộ dữ liệu xuyên workspace (VD: prompt trả lời gộp cả tài liệu HR lẫn
Engineering cho cùng một user không có quyền cả hai — đây là security bug,
không phải thiếu feature). Nếu không thiết kế `Parent()` từ Sprint 2, Sprint 4
sẽ phải làm lại toàn bộ resolver dưới áp lực có user/data thật.

### 5.4 Hai method, không phải một — vì Sprint 4 cần bulk filter, không phải point check

```go
type Authorizer interface {
    Can(ctx context.Context, principal Principal, perm Permission, res Resource) (bool, error)
    Filter(ctx context.Context, principal Principal, perm Permission, res []Resource) ([]Resource, error)
}
```

`Can()` phù hợp point check (gate Terminal, gate admin action — vài lần mỗi
request). Nhưng AI Context Engine hỏi kiểu khác: "trong 200 document ứng viên
cho prompt này, cái nào principal được đọc?" — đây là bulk filter. Nếu chỉ có
`Can()`, code Sprint 4 sẽ gọi nó trong vòng lặp N lần, khoá cứng đặc tính hiệu
năng của resolver (naive, leo cây từng bước) vào call site — đúng chỗ hiệu
năng gãy đầu tiên, và đúng chỗ là moat của sản phẩm.

Zanzibar/OpenFGA/SpiceDB tách hẳn `Check` khỏi `ListObjects`/`LookupResources`
vì đây là hai access pattern khác nhau trên cùng một model quan hệ. Resolver
mặc định của `Filter` ở Sprint 2 có thể implement tệ (loop gọi `Can()` — không
sao, chưa có traffic thật). Khi cần scale ở Sprint 4, chỉ thay implementation
của `Filter` (VD: một batch query "mọi document có workspace nằm trong tập
workspace principal đọc được") — code gọi ở AI Context Engine không đổi.

### 5.5 Nguyên tắc chốt: đóng băng API, không đóng băng implementation

- `Authorizer` chỉ là interface.
- `Resource` có khả năng biểu diễn quan hệ cha (`Parent()`).
- Resolver mặc định của DMOX là implementation đơn giản: leo từ resource hiện
  tại lên root, kiểm tra grant.
- Nếu sau này cần phân quyền phức tạp hơn (group, delegated access, sharing,
  computed relation) — có thể thay bằng OpenFGA/SpiceDB mà **không đổi code
  gọi `Authorizer.Can()`/`Filter()`**.

## 6. Terminal: feature flag trước, plugin thật sau

Terminal là feature nguy hiểm nhất hệ thống (PTY thật qua WebSocket, hiện
không auth). Có hai việc khác hẳn nhau về độ khó — cần tách rõ để không kẹt
lịch:

- **Sprint 2 (làm ngay):** `terminal.enabled=false` mặc định trong feature
  flags, admin bật, gate qua `Authorizer.Can(principal, use_terminal, ...)`
  tại WS handshake. Không đụng cấu trúc code hiện tại
  (`internal/terminal` vẫn nằm cùng binary/process).
- **Sprint 5 (sau, nếu cần):** tách thành plugin process thật (Plugin
  Manager load `dmox-terminal`, hoặc gRPC ra `terminal-service` riêng) — đây
  là việc của Plugin SDK, không phải điều kiện để Sprint 2 ship.

## 7. Feature flags — phân biệt edition không cần build nhiều bản

```yaml
features:
  terminal: false
  ai: true
  git: true
  webhook: false
  plugins: false
  audit: false
```

- **Community:** `terminal: false`
- **Developer:** `terminal: true`
- **Enterprise:** `terminal: false`, `plugins: true`, `audit: true`

Flag nên gate ở tầng route-mount (không đăng ký route khi tắt), không chỉ
check trong handler — thêm một lớp phòng thủ, khớp tinh thần tối thiểu diện
tích tấn công đã áp dụng trong Dockerfile hiện tại (chỉ cài `git` +
`ca-certificates`, không có gì thừa).

## 8. Việc tiếp theo cụ thể (Sprint 1)

1. Refactor `internal/config` + `internal/source` theo model
   `Workspace → Repository → Source` (hiện đang là `Workspace → Source`
   phẳng).
2. Rà `internal/doctree` / `internal/index` — sửa mọi chỗ giả định phẳng
   (không có khái niệm Repository).
3. Viết trước interface `Resource` (`ID()`, `Type()`, `Parent(ctx)`) ngay ở
   bước này — dù chưa dùng cho authorization — để `Repository`/`Workspace`
   implement nó từ đầu thay vì thêm sau.

## 9. Việc KHÔNG làm ở giai đoạn này

- Workspace membership UI/logic (chờ đến khi có khách hỏi HR/Engineering/
  Finance workspace riêng biệt — nhưng schema `Resource`/`Grant` đã sẵn sàng
  cho việc đó, không migration).
- OIDC/SAML/SCIM/Audit (Enterprise, chỉ khi có nhu cầu thực tế).
- Plugin architecture thật, tách process cho Terminal (Sprint 5).
- Bất kỳ hình thức multi-tenant / DMOX Cloud nào.
