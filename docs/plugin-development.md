# Isola 插件接入规范

本规范对应插件 API 版本 `1`，统一说明 React 前端、可选业务后端、数据库、联调、构建与发布。插件开发者编写一次业务代码，客户端适配由框架负责。

本仓库的 `examples/notes` 是官方示例和可复制模板。前端只导入公开的 `@isola/plugin` 与 `@isola/plugin/ui`，构建为同一份 React Web 产物。

## 责任划分

| 对象 | 插件开发者负责 | Isola 负责 |
| --- | --- | --- |
| 界面 | React 业务、布局和菜单操作 | 宿主导航、布局组件与客户端适配 |
| 交付 | 前端包、对应版本的 Docker 镜像 | 市场发布记录、安装与入口加载 |
| 请求 | 相对业务路径及其处理逻辑 | 将当前插件的请求转发到用户已安装版本的后端 |
| 用户 | 按可信用户 ID 处理私有业务数据 | 登录会话、安装权限与用户上下文传入 |
| 数据库 | 业务表、索引、事务与表结构变更 | 创建独立插件 PostgreSQL 数据库、受限角色并提供连接地址 |
| 升级 | 保留数据并兼容仍在运行的旧版本 | 更新安装记录；安装失败时恢复原业务库与后端 |

## 1. 复制模板

需要 Node.js 24、pnpm 10；带业务后端时需要 PostgreSQL 18 和 Docker。SDK 尚未发布到 npm，仓库内使用工作区依赖：

```sh
pnpm install --frozen-lockfile
pnpm --filter @isola/plugin build
```

将 `examples/notes` 复制到 `examples/my-plugin`，修改 `package.json` 的 `name`、`version`、`description`、`isola.title` 和 `isola.server.image`，再从仓库根目录执行 `pnpm install`。`name` 唯一标识插件，镜像内也必须包含相同版本的 `package.json`。

仓库外开发时，先在本仓库运行 `pnpm --dir packages/plugin pack`，得到 `packages/plugin/isola-plugin-0.1.1.tgz`。将该包复制到插件的 `vendor/` 目录并随源码保存，把模板的 `dependencies["@isola/plugin"]` 改为 `file:vendor/isola-plugin-0.1.1.tgz`，再运行 `npm install` 并保存锁文件。SDK 包已包含 JS、类型、样式与 MIT LICENSE；相对依赖使其他机器克隆插件后也能安装，无需从 npm 下载尚未发布的 SDK。

清单沿用 npm 格式：

```json
{
  "name": "my-isola-plugin",
  "version": "0.1.0",
  "description": "My tool",
  "type": "module",
  "files": ["dist"],
  "isola": {
    "title": "我的工具",
    "apiVersion": 1,
    "entry": "dist/index.html",
    "server": { "image": "my-isola-plugin:0.1.0" }
  }
}
```

`name` 是插件唯一标识，`version` 使用 npm SemVer。同一名称与版本只能发布一次，更新须递增版本；同名插件由原发布者继续发布。

仅前端插件省略 `isola.server`。Vite 的 `base: './'` 使资源地址相对于安装后的入口。

有后端时，`isola.server.image` 指向独立 Docker 镜像，发布前准备好运行框架服务端的 Docker 引擎可取得的镜像。镜像包含运行依赖、业务代码、数据库初始化 SQL 及对应版本的清单。前端包与镜像内的插件名称、版本和 API 版本必须一致。

## 2. 声明业务布局

区域内部写普通 React 内容。布局组件由 `@isola/plugin/ui` 导出，并自动加载框架样式。

| 组件 | Props | 默认值与行为 |
| --- | --- | --- |
| `Stack` | `children: ReactNode`、`gap?: CSSProperties['gap']` | 纵向排列，`gap` 默认 `1rem` |
| `Columns` | `children: ReactNode`、`gap?: CSSProperties['gap']` | 横向排列并换行，`gap` 默认 `1rem`；直接业务区域使用 `Pane`，可使用数组、Fragment 和条件渲染 |
| `Pane` | `children: ReactNode`、必填 `label: string`、`flexBasis?: CSSProperties['flexBasis']`、`flexGrow?: number` | `label` 为区域可访问名称；`flexBasis` 默认 `20rem`、`flexGrow` 默认 `1`，只参与所在 `Columns` 的横向排版 |
| `ListDetail` | `list: ReactNode`、`detail: ReactNode`、`hasSelection: boolean`、`onBack: () => void` | 可选；按自身容器的 `48rem` 分界切换展示，窄屏返回按钮调用 `onBack` |

`gap` 使用合法非负 CSS 值；数字表示像素，字符串保留原生 CSS 单位。`flexBasis` 使用合法 CSS 值，数字表示像素。`flexGrow` 是有限、非负的无单位权重。区域可嵌套；尺寸变化保留 React 节点与 key。

纯组合布局无需 `ListDetail`：

```tsx
import { Columns, Pane, Stack } from '@isola/plugin/ui';

<Columns gap="1rem">
  <Pane label="编辑" flexBasis="28rem" flexGrow={2}>
    <Stack>{editor}{actions}</Stack>
  </Pane>
  <Pane label="辅助" flexBasis="16rem">{sidebar}</Pane>
</Columns>
```

需要列表导航时按业务选择状态组合：

```tsx
import { ListDetail } from '@isola/plugin/ui';

<ListDetail list={list} detail={editor}
  hasSelection={selected !== null} onBack={() => setSelected(null)} />
```

## 3. 写业务

`connect()` 取得绑定到当前 iframe 的 `PluginClient`。只传相对业务路径；宿主确定插件归属和后端地址，框架原生会话提供用户身份。

调用顺序为：React 插件 → 公开 SDK → 宿主 → 框架服务端 → 插件后端 → 插件数据库。

```tsx
import { connect } from '@isola/plugin';

const client = await connect();
const note = await client.request('/notes', {
  method: 'POST', body: { title: '示例', body: '内容' },
});
const stop = client.subscribe('/events', event => console.log(event));
// 在组件卸载时调用 stop()。
```

`/notes`、`/events` 是模板业务示例，插件自行定义业务路径。上例的 `/notes` 经 `/api/plugins/:releaseId/api/notes` 转发后，后端收到的仍是 `/notes`，查询参数随请求转发。

`request<T>(path, options?)` 支持 `GET`（默认）、`POST`、`PUT`、`DELETE`。普通对象作为 JSON，`File` / `Blob` 保持浏览器原生请求体。JSON 响应作为结果，HTTP 204 返回 `undefined`，非成功 HTTP 状态拒绝 Promise，请求超时为 30 秒。业务后端按此约定提供响应。

`subscribe(path, listener)` 接收 SSE 默认 `message` 事件，事件的 `data` 为 JSON，返回取消订阅函数；发生连接错误时当前订阅关闭。插件离开时内部通道发送 `disconnect`，宿主清理该通道的请求与订阅。

SDK 0.1.1 增加 `registerMenu(items: PluginMenuItem[]): () => void`，API 版本仍为 1。宿主从当前用户的安装记录显示插件入口；插件只注册当前业务操作：

```ts
import type { PluginMenuItem } from '@isola/plugin';

const items: PluginMenuItem[] = [
  { id: 'new', label: '新建', onSelect: () => createNote() },
  { id: 'import', label: '导入', file: { accept: '.md,.txt', multiple: true },
    onSelect: async files => { for (const file of files) await importNote(file.name, await file.text()); } },
];
const unregister = client.registerMenu(items);
// 组件卸载时调用 unregister()。
```

条目包含 `id`、`label`、可选 `disabled`、可选 `file: { accept: string; multiple?: boolean }` 及 `onSelect: (files: File[]) => void | Promise<void>`。每次注册替换当前菜单，旧注册的清理不会注销新菜单。普通操作收到 `[]`；文件操作由宿主菜单的原生文件输入取得 `File[]`，取消不调用，允许重选同一文件。函数留在插件内，只有条目数据经过绑定通道。同步和异步异常显示在宿主；替换或关闭后的旧选择与错误被忽略，断开及重载清除菜单。

宿主只有一个标题栏；原生 Popover 内分别显示市场与安装入口、当前插件操作和退出登录。插件内容占用标题栏下方区域，模板不再重复显示应用标题。

有后端时按下文[插件后端](#插件后端)与[数据库与升级](#数据库与升级)约定交付镜像和业务实现。

### 将已有 React 项目接入框架

已有项目按同一公开契约交付。开发者负责业务页面和后端，框架负责宿主、插件切换和请求转发。

| 接入部分 | 开发者需要落实的内容 |
| --- | --- |
| SDK 依赖 | 使用公开 `@isola/plugin`；仓库外采用上文的相对 TGZ 依赖并保存 SDK 包与锁文件，使其他贡献者克隆后能安装依赖 |
| 页面与布局 | 保留自己的 React 编辑器、业务布局与样式；可使用上文布局组件组合业务区域，以插件实际可用区域排版，同一份 Web 产物用于各宿主 |
| 导航与操作 | 应用标题、返回市场和插件切换由宿主提供；插件的导入、列表、全图等业务操作通过 `registerMenu` 注册，页面保留业务内容；卸载时注销菜单和订阅 |
| 业务请求 | 原有前端业务调用改为 `connect().request()` 的相对路径；文件操作使用宿主交付的 `File[]`，由插件读取文件或发送给自己的业务后端 |
| 既有后端 | 复用现有业务路由、SQL 和共享代码，在插件后端入口将可信用户 ID 接到现有路由使用的用户上下文；按下述规范交付镜像和数据库初始化 |
| 加载与保存 | 区分无记录与请求失败；如需初始示例，仅在无记录时显示，读取失败显示错误；保存失败保留草稿与重试所需的修改内容 |
| 发布产物 | 递增插件版本，前端入口及所有资源随 TGZ 交付，镜像内清单与包一致；发布的产物包含本次实际构建的代码 |

接入完成后，用真实市场安装产物验证：菜单打开及插件切换、同文件重选、导入原文、编辑保存及失败重试、刷新后重开，以及插件自身的布局与连续交互。带后端的数据迁移与隔离按[接入验收条件](#接入验收条件)验证。

完整代码示例见[官方笔记模板](../examples/notes/README.md)，市场和宿主的验证步骤见[验收指南](acceptance.md)。

## 插件后端

带业务后端的插件在同一交付版本中提供 Docker 镜像。可复制的 Node.js 实现见[官方笔记后端](../examples/notes/server/index.ts)。

### 启动与就绪

框架通过环境变量向容器提供：

| 环境变量 | 含义 |
| --- | --- |
| `PORT` | 当前为 `3000`，后端监听 `0.0.0.0:3000` |
| `DATABASE_URL` | 当前插件业务数据库的连接地址与受限角色凭据，仅供后端使用 |
| `ISOLA_PLUGIN_NAME` | 本次请求安装或运行的插件名称 |
| `ISOLA_PLUGIN_VERSION` | 本次请求安装或运行的插件版本 |

沿用模板的启动顺序：读取镜像内清单，核对名称和版本环境变量，完成数据库初始化，再提供 `GET /health`。初始化失败使启动失败；健康响应必须来自镜像内清单，返回成功 HTTP 状态和 JSON：

```json
{ "name": "my-isola-plugin", "version": "0.1.0", "apiVersion": 1 }
```

框架逐项比对健康信息与发布清单，通过后才完成安装记录写入。框架检查 `/health` 时不传入用户身份；业务路由使用下述用户上下文。

### 用户身份与既有路由

框架确认登录会话与当前用户的安装记录，再写入可信 `x-isola-user-id`。同时透传 `content-type`、`accept`、`last-event-id`；前端使用框架会话调用，数据库凭据留在后端。

后端沿用模板检查业务请求中的用户 ID，将其作为不透明字符串。用户私有记录写入时关联该 ID，读取、更新、删除及事件发送都按该 ID 限定；请求体或路径中的用户标识不能替代可信上下文。示例 SQL 见[笔记后端](../examples/notes/server/index.ts)。

已有后端可在插件入口直接注册原业务路由，并将可信 ID 赋给这些路由现有的用户上下文字段。镜像构建上下文须覆盖这些路由实际导入的源码、共享模块与 SQL，并保留运行时需要的相对目录；镜像就绪检查之后，通过公开 SDK 验证实际业务读写。

## 数据库与升级

在一套框架部署中，同一 `name` 使用同一个插件数据库和角色，各版本及用户共用该数据库。每个用户的私有业务数据由插件按用户 ID 区分。框架负责数据库与角色，插件负责其中的业务表和表结构变更；SQL 随镜像交付并在启动时执行。模板使用 PostgreSQL 原生事务初始化，失败回滚；重复启动须保留已有业务数据。

同一用户、同一插件名称只有一条安装记录，更新成功后该记录指向新版本。其他用户可以仍使用旧版本，旧后端会继续运行并访问同一业务库，因此表结构变更必须兼容这些版本。

### 已有业务数据迁移与保存

插件从旧存储结构接入正式业务表时，由插件在 PostgreSQL 原生事务中完成迁移并保存原记录与正式记录的对应关系。迁移保留原文、已有引用 ID 和界面状态；重复读取、重启及并发首次访问复用已迁入的正式记录。记录 ID 的查找和更新仍按可信用户 ID 限定。

业务正文和界面状态分开保存时，界面状态写入只更新实际修改的字段，不能把页面中旧的正文覆盖回正式业务表。如果现有接口提交整份业务对象，请求应明确标记实际编辑的业务字段；后端保留未标记字段的数据库当前值。前端失败后保留重试所需的编辑内容与字段标记。业务路径及字段由插件定义。

跨表保存使用同一事务和必要的原生行锁，业务内容、引用映射与界面状态一同提交或回滚。已映射的正式记录缺失时返回错误并回滚。业务中存在独立引用时，明确区分删除引用和删除原记录的行为。

### 框架安装失败恢复

框架启动新建或已停止的插件后端前，暂时停止同插件正在运行的后端，禁止业务库新连接并终止已有会话，再用 PostgreSQL `TEMPLATE` 创建管理员持有、禁止连接的副本。已运行且健康的后端直接复用。

副本保留到安装记录与 `plugins.backend_backup` 清除在同一事务提交后。启动或安装记录写入失败时，先移除候选容器，再恢复业务库、数据库设置、私有权限及之前运行的后端，保留原安装记录。恢复失败会保留副本与引用，并拒绝后续自动建库或启动，需管理员处理；提交后的副本清理失败只记录错误并保留副本。

安装失败恢复的可捕获故障场景和验证方法见[验收指南](acceptance.md#覆盖更新与失败恢复)。

## 4. 本地联调

准备 Node.js 24、pnpm 10、Docker Engine 和 Compose。复制根目录 `.env.example` 为 `.env`，为 `PGPASSWORD` 和 `BETTER_AUTH_SECRET` 设置各自私有的随机值。`PGPASSWORD` 留空时 Compose 会明确报错；它供 PostgreSQL 初始化管理员角色及核心的 node-postgres 连接使用，无需把密码拼进 `DATABASE_URL`。插件只收到自己的受限数据库连接地址。在仓库根目录运行：

```sh
pnpm dev
```

命令构建 SDK、Web 宿主和官方笔记包，构建笔记镜像并启动 Compose 核心服务及 PostgreSQL、Vite 宿主。打开 `http://localhost:5173`，注册或登录，选择 `examples/notes/isola-example-notes-0.1.0.tgz` 点击“发布”，再点击“安装”和“打开”。插件使用实际构建产物、真实会话和独立业务数据库；修改插件后重新构建并递增版本再发布。

Vite 代理 `/api` 和 `/plugins` 到核心服务；开发会话源为 `http://localhost:5173`。正式运行时由核心服务直接提供构建的宿主。`Ctrl+C` 关闭 Vite 并停止本次启动的核心、PostgreSQL 和插件容器；保留已有运行容器、数据库及归档卷。需要释放已停止容器时使用 Docker 原生命令，保留需要的数据卷。

如果本 Compose 项目的核心服务已运行，`pnpm dev` 会在构建或启动前报告冲突。可继续使用原服务及其已配置的地址，或明确执行 `docker compose stop server` 后再运行 `pnpm dev`。已停止的核心会按开发配置重新构建、启动，并在本次退出时停止。

已有 PostgreSQL 数据卷不会因环境变量变化而更改角色密码。若数据卷由旧配置初始化，先在 `.env` 设置新的私有 `PGPASSWORD`，并移除旧 `DATABASE_URL` 中的密码（node-postgres 优先使用 URI 内的显式密码），然后执行 `docker compose exec postgres psql -U isola -d isola`，在 psql 中用 `\password isola` 交互输入同一密码并用 `\q` 退出。再执行 `docker compose up -d --no-deps --force-recreate server` 让核心使用新凭据，或停止核心后运行 `pnpm dev`。此操作更改原生角色密码并保留数据卷。

从仓库根目录测试（默认测试 PostgreSQL 地址见示例 README）：

```sh
pnpm --filter @isola/example-notes test
```

单独运行后端，PowerShell 示例：

```powershell
$env:DATABASE_URL = 'postgresql://user:password@127.0.0.1:5432/my_plugin'
$env:PORT = '3000'
$env:ISOLA_PLUGIN_NAME = '@isola/example-notes'
$env:ISOLA_PLUGIN_VERSION = '0.1.0'
pnpm --filter @isola/example-notes start
```

这应使用专用于本插件的数据库。手动检查业务路由时可传入测试用户上下文；正常插件前端通过宿主通道调用。

`pnpm test` 使用已安装的 Playwright Chromium、Firefox、WebKit 与可用的标准 Docker CLI，实际启动隔离的市场服务、PostgreSQL 和插件容器并清理它们。若 Windows 测试使用 rootful WSL 引擎，可显式设置 `ISOLA_TEST_WSL_DISTRO` 为发行版名称；此测试适配以 root 访问该发行版的原生 Docker socket，并通过 `wslpath` 转换当前工作目录。未设置时始终使用标准 `docker`，不改变用户组或 socket 权限。`pnpm dev` 始终使用标准 Docker/Compose。

## 5. 构建

在仓库根目录：

```sh
pnpm --filter @isola/plugin build
pnpm --filter @isola/example-notes build
docker build -f examples/notes/server/Dockerfile -t isola-example-notes:0.1.0 examples/notes
pnpm --dir examples/notes exec npm pack --dry-run
pnpm --dir examples/notes pack
```

复制模板后用自己的包名和镜像标签替换命令。仓库外使用 `npm run build`、`npm pack`。前端包包含 `package.json` 与 `dist/index.html` 及其资源；后端随独立镜像提供，镜像可从运行框架服务端的 Docker 引擎取得。`package.json` 的 `isola.server.image` 必须指向这个镜像。

## 6. 发布

服务端已实现原生会话下的 `POST /api/market/releases`。将构建的 `.tgz` 作为 `application/octet-stream` 请求体发送；使用登录产生的会话 Cookie。以下为 Bash 的 HTTP 示例：

```sh
curl --fail-with-body --cookie session.cookies \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @examples/notes/isola-example-notes-0.1.0.tgz \
  http://localhost:3000/api/market/releases
```

也可直接在宿主“插件市场”选择 `.tgz`，点击“发布”。发布成功后点击“安装”，完成后点击“打开”。同一插件以 `name` 为唯一标识，市场只显示一张卡片；已安装时显示当前版本，新版本通过同一张卡片的“更新”操作覆盖安装。成功后原安装记录指向新版本，失败保留原版本与数据。`session.cookies` 需由同一框架服务端的登录会话取得。发布成功返回 HTTP 201 和 release `id`；`GET /api/market/releases` 按 npm SemVer 列出每个插件的最新发布版本，已登录用户可向 `POST /api/installations` 发送 `{ "releaseId": "返回的 id" }` 安装。

## 接入验收条件

按插件实际交付的能力验证以下条件：镜像、数据库及后端恢复项适用于带业务后端的插件，迁移和跨表项适用于相应数据结构。运行方法见[验收指南](acceptance.md)。

| 验收项 | 必须证明的结果 |
| --- | --- |
| 前端交付 | TGZ 包含清单中的入口及其资源，同一份 React Web 产物通过市场加载 |
| 布局与交互 | 宽窄容器下业务区域和操作可达，尺寸变化保留编辑节点与草稿 |
| 统一菜单 | 单个宿主标题栏；业务菜单随插件切换，文件取消、重选和注销符合 SDK 契约 |
| 交付与启动 | 前端包与镜像对应同一发布；数据库初始化成功后健康信息匹配清单，身份不匹配或初始化失败时安装失败 |
| 业务链路 | 在市场安装后，通过公开 SDK 完成实际业务读写；刷新并重新打开仍能读取数据库中的内容 |
| 用户数据 | 两个框架账号分别读写私有数据；按记录 ID 操作及订阅事件均遵守各自用户归属 |
| 重复启动 | 重启同一版本后，初始化可再次执行，已有数据保留且业务可用 |
| 已有数据迁移 | 涉及存储结构迁移时，逐项比较原文、引用与界面状态；重复及并发首次访问不重复创建正式记录，不同用户的旧同名 ID 保持隔离 |
| 正文与界面状态 | 分开存储时，正式接口修改正文后连续保存旧页面视角、其间再次读取，正文仍保持新值；实际编辑及失败重试能写入所修改字段 |
| 跨表事务 | 涉及跨表写入时，模拟迁移或保存中途失败，确认内容和映射一起回滚；缺失记录或其他用户的记录 ID 不导致误写 |
| 覆盖更新 | 同名更新保留单条用户安装记录，复用业务库并保留数据；仍安装旧版本的用户继续可用 |
| 安装失败 | 新版本启动或安装记录写入失败后，原安装记录、业务数据与原后端恢复可用 |
| 通道清理 | 取消订阅释放对应连接；离开插件或关闭通道后，请求与订阅均释放 |
| 通用接入 | 新插件沿用本规范、模板与公开 SDK 即可接入，框架源码保持通用 |

## 客户端配置

Web 和 Windows 使用同一 Web 客户端。浏览器与设备的验证方法见[验收指南](acceptance.md)。

`apps/client/src-tauri` 的 Tauri 2 外壳直接加载框架宿主：`build.devUrl` 为 `pnpm dev` 地址 `http://localhost:5173`，`build.frontendDist` 是本地核心服务 `http://localhost:3000`。前者用于开发，后者在发布构建时加载远程宿主，不将另一份插件前端打进外壳。

部署时直接把 `tauri.conf.json` 中这两个 URL 改为目标服务地址，也可使用 Tauri 原生 `--config` 合并 JSON 配置。保持 URL 对应服务端已配置的会话来源。开发时先在仓库根运行 `pnpm dev`，外壳无需另起 Vite。原生工程使用 Rust 2024、最低 Rust 1.90；构建与设备验证在对应平台完成。详见官方 [URL 配置](https://v2.tauri.app/reference/config/#buildconfig)和[配置合并](https://v2.tauri.app/develop/configuration-files/#extending-the-configuration)。
