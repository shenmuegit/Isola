# 开发 React 插件

本仓库的 `examples/notes` 是官方示例和可复制模板。前端只导入公开的 `@isola/plugin` 与 `@isola/plugin/ui`，构建为同一份 React Web 产物。

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

仅前端插件省略 `isola.server`。Vite 的 `base: './'` 使资源地址相对于安装后的入口。

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

```tsx
import { connect } from '@isola/plugin';

const client = await connect();
const note = await client.request('/notes', {
  method: 'POST', body: { title: '示例', body: '内容' },
});
const stop = client.subscribe('/events', event => console.log(event));
// 在组件卸载时调用 stop()。
```

`request<T>(path, options?)` 支持 `GET`（默认）、`POST`、`PUT`、`DELETE`。普通对象作为 JSON，`File` / `Blob` 保持浏览器原生请求体。JSON 响应作为结果，HTTP 204 返回 `undefined`，非成功 HTTP 状态拒绝 Promise。`subscribe(path, listener)` 通过 SSE 接收 JSON 数据，返回取消订阅函数。插件离开时内部通道发送 `disconnect`，宿主清理该通道的请求与订阅。

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

有后端时按[插件后端接入规范](plugin-backend.md)交付 Docker 镜像，使用框架提供的 `DATABASE_URL` 与可信 `x-isola-user-id` 编写业务。该规范统一说明启动环境、`/health`、请求、数据库归属、升级兼容与失败恢复；本指南提供本地联调、构建和发布命令。

### 将已有 React 项目接入框架

已有项目按同一公开契约交付。下表整理 Grove 接入中已验证的做法，开发者负责业务页面和后端，框架负责宿主、插件切换和请求转发。

| 接入部分 | 开发者需要落实的内容 |
| --- | --- |
| SDK 依赖 | 使用公开 `@isola/plugin`；仓库外采用上文的相对 TGZ 依赖并保存 SDK 包与锁文件，使其他贡献者克隆后能安装依赖 |
| 页面与布局 | 保留自己的 React 编辑器、业务布局与样式；可使用上文布局组件组合业务区域，以插件实际可用区域排版，同一份 Web 产物用于各宿主 |
| 导航与操作 | 应用标题、返回市场和插件切换由宿主提供；插件的导入、列表、全图等业务操作通过 `registerMenu` 注册，页面保留业务内容；卸载时注销菜单和订阅 |
| 业务请求 | 原有前端业务调用改为 `connect().request()` 的相对路径；文件操作使用宿主交付的 `File[]`，由插件读取文件或发送给自己的业务后端 |
| 既有后端 | 复用现有业务路由、SQL 和共享代码，在插件后端入口将可信用户 ID 接到现有路由使用的用户上下文；按下述规范交付镜像和数据库初始化 |
| 加载与保存 | 区分无记录与请求失败；如需初始示例，仅在无记录时显示，读取失败显示错误；保存失败保留草稿与重试所需的修改内容 |
| 发布产物 | 递增插件版本，前端入口及所有资源随 TGZ 交付，镜像内清单与包一致；发布的产物包含本次实际构建的代码 |

编辑器、画布和文件处理仍是插件业务。Grove 的滚轮实现按输入幅度计算缩放，通过浏览器原生 `requestAnimationFrame` 过渡，尊重减少动态效果设置；连续缩放期间保持交互，结束后沿用业务写入队列保存视角。其写入按发起顺序完成，失败保留未保存提示。这些行为由插件实现，并通过公开 SDK 保存。

接入完成后，用真实市场安装产物验证：菜单打开及插件切换、同文件重选、导入原文、编辑保存及失败重试、刷新后重开，以及插件自身的布局与连续交互。带后端的数据迁移与隔离按[后端验收条件](plugin-backend.md#接入验收条件)验证。

已完成实例见 [Grove 0.1.7 接入说明](https://github.com/shenmuegit/Grove/blob/71c210727660dad8fa40bbd39ec9fb4e5e586118/design-trials/grove-sites-prototype-20261008/PLUGIN.md)与[本项目验收记录](acceptance.md#grove-017-正式后端与数据库接入)。其中的画板、笔记引用与缩放是 Grove 的业务实现；通用接入使用本指南与后端规范定义的契约。

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

## 客户端配置与验证范围

当前只验收 Web，Windows 使用同一 Web 客户端。Grove 给定网页对应的原型已在独立测试副本中按公开规则接入；SDK 未发布到 npm。浏览器证据与未完成项见[验收记录](acceptance.md)。

`apps/client/src-tauri` 由官方 Tauri 2 CLI 生成。外壳直接加载框架宿主：`build.devUrl` 为已验证的 `pnpm dev` 地址 `http://localhost:5173`，`build.frontendDist` 是本地核心服务 `http://localhost:3000`。前者用于开发，后者在发布构建时加载远程宿主，不将另一份插件前端打进外壳。

部署时直接把 `tauri.conf.json` 中这两个 URL 改为目标服务地址，也可使用 Tauri 原生 `--config` 合并 JSON 配置。保持 URL 对应服务端已配置的会话来源。开发时先在仓库根运行 `pnpm dev`，外壳无需另起 Vite。原生工程使用生成的 Rust 2024/最低 Rust 1.90 约定；本次未运行原生构建或设备。详见官方 [URL 配置](https://v2.tauri.app/reference/config/#buildconfig)和[配置合并](https://v2.tauri.app/develop/configuration-files/#extending-the-configuration)。
