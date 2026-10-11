# 开发 React 插件

本仓库的 `examples/notes` 是官方示例和可复制模板。前端只导入公开的 `@isola/plugin` 与 `@isola/plugin/ui`，构建为同一份 React Web 产物。

## 1. 复制模板

需要 Node.js 24、pnpm 10；带业务后端时需要 PostgreSQL 18 和 Docker。SDK 尚未发布到 npm，仓库内使用工作区依赖：

```sh
pnpm install --frozen-lockfile
pnpm --filter @isola/plugin build
```

将 `examples/notes` 复制到 `examples/my-plugin`，修改 `package.json` 的 `name`、`version`、`description`、`isola.title` 和 `isola.server.image`，再从仓库根目录执行 `pnpm install`。`name` 唯一标识插件，镜像内也必须包含相同版本的 `package.json`。

仓库外开发时，先在本仓库运行 `pnpm --dir packages/plugin pack`，得到 `packages/plugin/isola-plugin-0.1.0.tgz`。将模板的 `dependencies["@isola/plugin"]` 改为 `file:/实际绝对路径/isola-plugin-0.1.0.tgz`，再运行 `npm install`。SDK 包已包含 JS、类型、样式与 MIT LICENSE；无需从 npm 下载尚未发布的 SDK。

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

有后端时使用框架传入的 `DATABASE_URL` 访问独立插件 PostgreSQL 数据库。HTTP 监听 `PORT=3000`；业务查询按可信 `x-isola-user-id` 限定用户数据。直接沿用示例的原生事务初始化与 `/health`：先读取镜像内清单，核对 `ISOLA_PLUGIN_NAME` / `ISOLA_PLUGIN_VERSION`，初始化成功后由 `/health` 返回 `{ name, version, apiVersion }`。健康信息来自镜像内清单。

框架在启动新建或已停止的插件后端前，暂时停止该插件正在运行的后端，禁止业务库新连接并终止已有会话，再用 PostgreSQL `TEMPLATE` 创建管理员持有、禁止连接的备份。已运行且健康的后端直接复用。启动或安装记录写入失败时，先移除候选容器，再恢复业务库及之前运行的后端；原安装记录保留。数据库设置、序列和对象所有权随原生副本恢复，数据库访问沿用框架的私有权限。

备份保留到安装记录与 `plugins.backend_backup` 清除在同一事务提交后。恢复失败会返回保留副本名，并拒绝后续自动建库或启动，需管理员处理该副本和引用；成功提交后的副本清理失败只记录错误并保留副本。此验证覆盖安装过程中的可捕获故障，不代表进程崩溃或存储故障后的自动恢复。

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

也可直接在宿主“插件市场”选择 `.tgz`，点击“发布”。发布成功后点击“安装”，完成后点击“打开”。发布和安装错误显示服务端原因；安装成功前不提供打开入口。`session.cookies` 需由同一框架服务端的登录会话取得。发布成功返回 HTTP 201 和 release `id`；`GET /api/market/releases` 列出发布版本，已登录用户可向 `POST /api/installations` 发送 `{ "releaseId": "返回的 id" }` 安装。

## 客户端配置与验证范围

当前只验收 Web，Windows 使用同一 Web 客户端。Grove 给定网页对应的原型已在独立测试副本中按公开规则接入；SDK 未发布到 npm。浏览器证据与未完成项见[验收记录](acceptance.md)。

`apps/client/src-tauri` 由官方 Tauri 2 CLI 生成。外壳直接加载框架宿主：`build.devUrl` 为已验证的 `pnpm dev` 地址 `http://localhost:5173`，`build.frontendDist` 是本地核心服务 `http://localhost:3000`。前者用于开发，后者在发布构建时加载远程宿主，不将另一份插件前端打进外壳。

部署时直接把 `tauri.conf.json` 中这两个 URL 改为目标服务地址，也可使用 Tauri 原生 `--config` 合并 JSON 配置。保持 URL 对应服务端已配置的会话来源。开发时先在仓库根运行 `pnpm dev`，外壳无需另起 Vite。原生工程使用生成的 Rust 2024/最低 Rust 1.90 约定；本次未运行原生构建或设备。详见官方 [URL 配置](https://v2.tauri.app/reference/config/#buildconfig)和[配置合并](https://v2.tauri.app/develop/configuration-files/#extending-the-configuration)。
