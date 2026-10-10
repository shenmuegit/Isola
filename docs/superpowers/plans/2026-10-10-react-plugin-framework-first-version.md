# Isola 首个可运行版本实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans according to the execution method selected by the user. Steps use checkbox syntax for tracking.

**Goal:** 交付框架自己的插件规范、官方示例和开发模板，走通发布、市场安装、前后端调用及四端使用。

**Architecture:** 插件按框架约定构建为同一份 React Web 产物，通过 iframe 和 MessageChannel 接入共用客户端。框架服务端提供市场、安装和业务接入，有后端的插件使用独立容器。Tauri 2 承载 Windows、macOS 和 iPhone 客户端。

**Tech Stack:** Node.js 24、pnpm 10、TypeScript、React、Vite、Fastify、PostgreSQL、Docker、Tauri 2。会话接入使用 Better Auth 原生 Fastify 集成，归档使用 npm 打包格式和 node-tar；测试使用 Node 测试运行器及 Playwright。[^1][^2]

**Spec:** [Isola（栖屿）技术方案](../specs/2026-10-10-react-plugin-framework-design.md)。本文是待评审的实现约定，下面列出的代码文件、接口和命令均需要实现。

## 📋 全局约束

- “插件开发者面向框架开发一次，客户端适配由框架维护者负责。”
- “插件遵守框架的导入与开发规则，符合规则后才能正确安装。”
- “用户从插件市场点击安装，安装完成后直接使用完整业务功能。”
- “框架定义插件规范，由插件作者适配规范；使用官方示例验证框架本身的能力。”
- “开发者决定业务布局，四端适配仍由框架负责。”
- 四端加载同一份插件前端产物，访问同一服务端业务数据。
- 业务布局通过公开组件组合，区域内部使用普通 React 内容；系统差异留在框架代码中，`ListDetail` 是可选组件。
- 仅成功安装才写入安装记录，失败保留已有插件与业务数据。
- 会话、容器、数据库权限、归档保护直接采用依赖的原生机制。

实施前检查 Node.js 24、pnpm 10、Rust 工具链与 Docker 引擎。代码提交显式暂存本计划涉及的文件，保留其他工作区内容。

## 🔍 重点验收条件

| 条件 | 预期行为 | 对应任务 |
| --- | --- | --- |
| 错误清单、缺失入口、越界归档路径 | 拒绝发布或安装，已有文件保留 | 任务 3 |
| 其他 iframe 或伪造插件标识发起调用 | 不能改变调用归属；宿主凭据不传给插件 | 任务 2、4 |
| 重复点击安装、后端启动失败 | 安装记录唯一；失败保留已有版本和数据 | 任务 4 |
| 自定义多列、嵌套、窄屏、软键盘和尺寸变化 | 按当前容器排版，区域可达，草稿和编辑节点保留；可选返回操作可用 | 任务 2、7 |
| Windows WebView2 与 Apple WebKit 差异 | 同一产物完成同一业务用例；逐端记录真实结果 | 任务 7 |

## 📦 文件与接口范围

以下新增路径均相对于仓库根目录。

| 位置 | 职责 |
| --- | --- |
| `package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、`.gitignore` | 本计划需要的工作区、构建与检查命令 |
| `packages/plugin/src/manifest.ts`、`protocol.ts` | 清单格式和消息类型 |
| `packages/plugin/src/client.ts`、`ui.tsx`、`styles.css` | 插件调用接口、`Stack`、`Columns`、`Pane`、可选 `ListDetail` 与共用样式 |
| `apps/client/src/App.tsx`、`PluginFrame.tsx`、`Market.tsx`、`viewport.ts` | 宿主界面、加载、市场入口、可见区域处理 |
| `apps/server/src/app.ts`、`auth.ts`、`market.ts`、`install.ts`、`backend.ts` | HTTP 服务、原生会话接入、发布安装和后端请求 |
| `apps/server/sql/001-framework.sql`、`compose.yaml` | 框架元数据与开发所需 PostgreSQL |
| `apps/server/Dockerfile`、`.dockerignore` | 核心服务端的 Linux 容器运行与集成验证 |
| `examples/notes` | 按公开规范编写的官方示例，同时作为开发模板 |
| `apps/client/src-tauri` | Tauri CLI 生成并由框架维护的原生工程 |
| `e2e`、`docs/plugin-development.md`、`docs/acceptance.md`、`README.md` | 真实使用验证、贡献者说明和验收证据 |

### 最小插件清单

沿用 npm 的 `package.json` 和 `.tgz` 包，复用 `name`、`version`、`description`；框架信息位于 `isola` 字段：

```ts
type PluginManifest = {
  name: string;
  version: string;
  description: string;
  isola: {
    title: string;
    apiVersion: 1;
    entry: 'dist/index.html';
    server?: { image: string };
  };
};
```

`name` 是插件唯一标识，`title` 用于显示。首版接口版本为 `1`。插件包包含 `package.json` 和 `dist`；服务端镜像由可选的 `server.image` 指向。框架字段按上述格式检查，npm 自身字段继续使用 npm 的格式。

### 客户端调用约定

```ts
type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
};

interface PluginClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  subscribe(path: string, listener: (data: unknown) => void): () => void;
}

type BridgeMessage =
  | { type: 'request'; id: string; path: string; options?: RequestOptions }
  | { type: 'subscribe'; id: string; path: string }
  | { type: 'unsubscribe'; id: string }
  | { type: 'result'; id: string; data: unknown }
  | { type: 'event'; id: string; data: unknown }
  | { type: 'error'; id: string; message: string };
```

`connect(): Promise<PluginClient>` 获取绑定到当前 iframe 的通道。插件只提供相对业务路径和业务数据；普通对象按 JSON 请求体发送，`File` / `Blob` 保持浏览器原生请求体。宿主根据实际加载的插件确定调用目标；用户身份由框架服务端的原生会话接入提供。订阅使用服务端 SSE，宿主通过 MessageChannel 将事件送到插件。

连接初始化使用 `Window.postMessage` 发送 `{ type: 'isola:connect', apiVersion: 1 }`；宿主以相同标记和转交的 MessagePort 回应。双方检查实际父子窗口来源。业务响应采用 JSON，HTTP `204` 返回 `undefined`，非成功 HTTP 响应以明确错误拒绝请求。

### 插件自定义布局接口

以下接口从 `@isola/plugin/ui` 导出，与设计文档保持一致。组合方式及 CSS 属性命名参考 Radix 和 Every Layout，并结合公开讨论中对接口简洁与布局自由度的权衡。[^6][^7][^8]

```ts
import type { CSSProperties, ReactElement, ReactNode } from 'react';

export type StackProps = {
  gap?: CSSProperties['gap'];
  children: ReactNode;
};

export type ColumnsProps = {
  gap?: CSSProperties['gap'];
  children: ReactNode;
};

export type PaneProps = {
  label: string;
  flexBasis?: CSSProperties['flexBasis'];
  flexGrow?: number;
  children: ReactNode;
};

export type ListDetailProps = {
  list: ReactNode;
  detail: ReactNode;
  hasSelection: boolean;
  onBack: () => void;
};

export declare function Stack(props: StackProps): ReactElement;
export declare function Columns(props: ColumnsProps): ReactElement;
export declare function Pane(props: PaneProps): ReactElement;
export declare function ListDetail(props: ListDetailProps): ReactElement;
```

`Stack` 纵向排列；`Columns` 的直接业务区域使用 `Pane`，支持普通 React 数组、Fragment 与条件渲染，横向排列并自动换行；`Pane` 可嵌套两种布局。`gap` 沿用 React CSS gap 类型，默认 `1rem`，取合法非负值；`flexBasis` 沿用 React CSS flexBasis 类型，默认 `20rem`。这两项的数字沿用 React style 的 CSS 像素语义，字符串直接使用合法原生 CSS 值。`flexGrow` 默认 `1`，是有限且非负的无单位权重。`flexBasis` 与 `flexGrow` 只参与所在 `Columns` 的横向排版，`label` 是必填的区域可访问名称。

贡献者决定区域、顺序、嵌套与尺寸约束；框架实现 Flexbox 换行、同一行剩余空间分配、区域边界、滚动及输入适配。`Columns` 根据自身空间和子区域期望宽度换行；可选 `ListDetail` 内部使用 `48rem` 容器查询分界。尺寸适配保持 React 节点位置与 key，依照 React 原生规则保留状态。[^5]

## 🔧 逐项实施

### 任务 1：固定可构建的插件契约

**Files:** 创建根工作区配置、`packages/plugin/package.json`、`packages/plugin/tsconfig.json`、`packages/plugin/src/manifest.ts`、`packages/plugin/src/protocol.ts`、`packages/plugin/test/types.ts`。

**Interfaces:** 导出上文 `PluginManifest`、`RequestOptions`、`PluginClient`、`BridgeMessage`，以及 `PLUGIN_API_VERSION = 1` 和对应的 `manifestSchema`。后续任务复用它们。

- [ ] 创建 pnpm 工作区和 TypeScript 配置，使用当前 Node.js 24，依赖版本写入锁文件。
- [ ] 实现类型及 JSON Schema；清单的 `isola` 字段限定为上文约定，入口固定为 `dist/index.html`。
- [ ] 在 `packages/plugin/test/types.ts` 编写类型使用样例：合法清单可编译；使用接口版本 `2` 或添加客户端选择字段时，用 `@ts-expect-error` 验证类型拒绝。
- [ ] 运行 `pnpm --filter @isola/plugin build` 和根 `pnpm typecheck`，要求退出码为 `0`；此任务只有契约和配置，运行时导入检查由任务 3 验证。
- [ ] 显式暂存本任务文件和锁文件，提交 `feat: define React plugin contract`。

### 任务 2：实现共用组件与插件调用通道

**Files:** 创建 `packages/plugin/src/client.ts`、`packages/plugin/src/ui.tsx`、`packages/plugin/src/styles.css`、`apps/client/package.json`、`apps/client/index.html`、`apps/client/vite.config.ts`、`apps/client/src/main.tsx`、`apps/client/src/App.tsx`、`apps/client/src/PluginFrame.tsx`、`apps/client/src/viewport.ts`、`playwright.config.ts`、`e2e/layout.spec.ts`、`e2e/framework.spec.ts`、`e2e/fixtures/plugin`；修改根 `package.json`、插件包导出和 `packages/plugin/test/types.ts`。

**Interfaces:**

- 提供 `connect(): Promise<PluginClient>`。
- 在 `ui.tsx` 导出上文四组布局 Props 及对应组件，通过插件包 `./ui` 子路径提供。
- 提供 `PluginFrame({ releaseId, entryUrl })`，两项均为 `string`；iframe 的可访问标题为“插件”，请求发往任务 4 的业务入口。
- `viewport.ts` 提供 `bindViewport(element: HTMLElement): () => void`，返回事件清理函数。

- [ ] 安装本任务所需的 Playwright 开发依赖，创建配置及可构建的布局 fixture；配置 Chromium、Firefox、WebKit 和测试宿主启动入口。fixture 分别使用纯组合布局和可选 `ListDetail`，测试接口通过 Playwright 路由响应提供。
- [ ] 在 `e2e/layout.spec.ts` 写失败用例：业务声明导航、编辑、辅助三个区域，`flexBasis` 分别为 `240`、`480`、`240`，`flexGrow` 为 `1`、`2`、`1`，`gap` 为 `24`；容器宽 `1280px` 时三者同一行，`390px` 时按声明顺序换行，`260px` 时根页面无横向溢出。验证默认 `1rem` 间距与 `20rem` 期望宽度，根字体由 `16px` 增为 `20px` 后相应计算值变化且区域可达；嵌套依据父区域宽度而非外部窗口，尺寸变化保留编辑 DOM 节点和草稿。普通 React 条件渲染增加带稳定 key 的区域时，其他区域状态保留。另测 `ListDetail` 的窄屏返回、显隐和焦点。
- [ ] 在 `e2e/framework.spec.ts` 写失败用例：文件经过通道后内容不变；宿主收到其他窗口的连接消息时不建立通道。类型样例追加合法嵌套组件和拒绝客户端专用属性的检查。

  关键编辑状态断言：

  ```ts
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByLabel('内容').fill('未保存草稿');
  for (const width of [1280, 390, 260]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(plugin.getByLabel('内容')).toHaveValue('未保存草稿');
    const bounds = await plugin.locator('html').evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
  }
  ```

- [ ] 运行 `pnpm exec playwright test e2e/layout.spec.ts e2e/framework.spec.ts --project=chromium`，确认失败来自尚未实现的行为。
- [ ] 实现 `Stack`、`Columns`、`Pane`：直接使用 CSS Flexbox 列排列、行换行、间距和伸缩。`gap`、`flexBasis`、`flexGrow` 使用 React 对应 CSS 属性的原生值与上述默认值；`Pane` 在 `Columns` 中使用 `flex-shrink: 1`、`min-inline-size: 0`、`max-inline-size: 100%` 和 `box-sizing: border-box`，各行独立分配剩余宽度；在 `Stack` 中随纵向内容排版。区域按 `label` 提供可访问名称，保持 DOM 阅读顺序及超宽内容的区域内滚动。
- [ ] 实现可选 `ListDetail`：内部以容器宽度 `48rem` 为分界，宽屏并排，窄屏根据业务选择显隐区域并提供返回操作。内容保持挂载；隐藏区域退出焦点与可访问性树，切换时焦点落在可见区域。表单采用语义 HTML 和共用样式。
- [ ] 实现 iframe 原生 sandbox、MessageChannel 连接及消息对应关系。通道绑定实际 iframe，插件离开时关闭通道、请求与订阅；连接或请求在 30 秒内无结果时返回明确错误，不自动重发业务请求。
- [ ] 实现可见区域处理：宿主按实际视口及安全区域安排内容；软键盘引起高度变化时保持输入与操作可达。业务样式留在区域内部，框架尺寸适配保持 React 树和 key。运行 `pnpm exec playwright test e2e/layout.spec.ts e2e/framework.spec.ts` 及 `pnpm typecheck`，要求三种浏览器项目通过。
- [ ] 显式暂存本任务文件，提交 `feat: add shared plugin UI and messaging`。

### 任务 3：实现服务端市场发布与静态产物

**Files:** 创建 `apps/server/package.json`、`tsconfig.json`、`src/index.ts`、`app.ts`、`auth.ts`、`market.ts`、`sql/001-framework.sql`、`test/market.test.ts`、`test/fixtures.ts`，以及 `compose.yaml`、`.env.example`。

**Interfaces:**

- `buildApp({ db, dataDir, origin }): Promise<FastifyInstance>`；`db` 为 `pg.Pool`，其余为 `string`。
- `publishPackage(db: Pool, dataDir: string, userId: string, archive: Readable): Promise<PublishedRelease>`。
- `PublishedRelease = { id: string; manifest: PluginManifest; entryUrl: string }`。
- HTTP：`POST /api/market/releases` 接收插件包；`GET /api/market/releases` 返回已发布版本；`GET /plugins/:releaseId/*` 提供该版本静态产物。

- [ ] 在 `test/market.test.ts` 写失败测试，使用 Node `assert` 验证：合法 npm 包发布后入口可读；接口版本 `2`、缺失入口和含越界路径的归档返回错误；重复发布同一名称与版本返回 `409`；其他发布者不能给已有插件发布新版本；目录外的标记文件内容不变。

  对应 HTTP 结果和文件保留断言：

  ```ts
  assert.equal(published.statusCode, 201);
  assert.equal(invalidApi.statusCode, 400);
  assert.equal(missingEntry.statusCode, 400);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(otherPublisher.statusCode, 403);
  assert.equal(await readFile(outsideMarker, 'utf8'), '保留');
  ```

- [ ] 先确认 `docker info` 成功，再启动 `docker compose up -d postgres`；运行 `pnpm --filter @isola/server exec node --test test/market.test.ts`，确认用例失败。
- [ ] 创建框架元数据表 `plugins`、`releases`、`installations`；对插件名称、插件与版本、用户与插件分别建立唯一约束。插件归属绑定发布者，已有插件的新版本只能由该发布者发布。发布产物按服务端生成的 release UUID 存放，包内字符串不决定服务器存储目录。
- [ ] 会话直接按 Better Auth 官方 Fastify 集成接入，数据库表由其原生迁移生成；使用库的会话接口取得用户身份。框架接口不接受客户端自行填写的 `userId`。[^1]
- [ ] 使用 Fastify 自带 schema 校验机制检查清单，关闭对框架清单字段的自动删改和类型强转。通过 node-tar 原生严格解包处理 npm 包，保留默认越界保护；只接收普通文件和目录。发布成功才保存版本记录。插件 HTML 返回 CSP sandbox，静态资源允许沙盒加载，业务 API 保持宿主会话边界。[^2]
- [ ] 运行任务测试和 `pnpm typecheck`，要求发布、拒绝和目录外文件保留测试全部通过；显式提交 `feat: publish plugin packages through market`。

### 任务 4：实现安装、插件后端与数据归属

**Files:** 创建 `apps/server/src/install.ts`、`backend.ts`、`test/install.test.ts`、`test/fixtures/backend/Dockerfile`、`test/fixtures/backend/server.mjs`、`apps/server/Dockerfile`、`.dockerignore`；修改 `app.ts`、`001-framework.sql`、`compose.yaml`。

**Interfaces:**

- `installRelease(db: Pool, userId: string, releaseId: string): Promise<PublishedRelease>`。
- `startBackend(db: Pool, release: PublishedRelease): Promise<string>` 返回仅供框架访问的 HTTP 地址。
- HTTP：`POST /api/installations` 接收 `{ releaseId }`；`GET /api/installations` 返回当前用户已安装版本；`/api/plugins/:releaseId/api/*` 转发该插件业务和 SSE。
- 插件服务端约定 `GET /health` 返回 `{ name, version, apiVersion: 1 }`，模板在业务初始化完成后启动 HTTP 服务；安装时检查这些值与发布清单一致。

- [ ] 在 `test/install.test.ts` 先写失败测试：两次安装同一版本只有一条记录；无效后端镜像启动失败后安装记录为零；已有版本及业务数据保持原值；未安装用户不能调用；修改插件标识或上游用户请求头不能访问其他插件或其他用户数据。

  对应结果断言：

  ```ts
  assert.equal(duplicateInstallRows.length, 1);
  assert.equal(failedInstall.statusCode, 502);
  assert.equal(failedInstallRows.length, 0);
  assert.equal(currentReleaseId, previousReleaseId);
  assert.deepEqual(dataAfterFailure, dataBeforeFailure);
  assert.equal(notInstalled.statusCode, 403);
  ```

- [ ] 配置核心服务端 Linux 容器及 Docker CLI，用 Docker 原生命令连接同一引擎；运行 `docker compose run --rm server pnpm --filter @isola/server exec node --test test/install.test.ts`，确认目标行为尚未实现。
- [ ] 实现安装：检查发布版本与接口兼容性；无后端时直接写安装记录；有后端时调用 Docker 原生命令启动并确认初始化完成，再写记录。已有同版本健康后端复用，安装唯一性使用 PostgreSQL 约束处理。
- [ ] 后端按插件使用独立 Docker 网络，核心服务端及 PostgreSQL 接入对应网络；插件后端不发布宿主端口，不接入其他插件网络。为插件配置 PostgreSQL 独立角色及业务数据权限，版本变化保留插件业务数据。核心服务端取得安装所需的 Docker 引擎访问，插件容器不取得该访问。通过 `node:child_process.execFile` 传递 Docker 参数，不拼接 shell 命令。
- [ ] 转发目标由已安装发布记录确定。服务端使用自己的会话上下文覆盖上游身份头；将相对路径放入固定上游 URL 的 pathname，保持上游 origin 不受插件数据控制。SSE 连接随客户端断开清理，插件后端仅接受内部业务入口。
- [ ] 运行全部服务端测试和 `pnpm typecheck`，要求上述断言通过；显式提交 `feat: install plugins and connect backend services`。

### 任务 5：提供官方示例及可复用模板

**Files:** 创建 `examples/notes/package.json`、`vite.config.ts`、`index.html`、`src/App.tsx`、`server/index.ts`、`server/Dockerfile`、`server/001-notes.sql`、`test/notes.test.ts`、`README.md`；创建 `docs/plugin-development.md`。

**Interfaces:** 示例插件使用任务 1、2 的公开入口；后端提供任务 4 的 `GET /health`，以及 `GET /notes`、`POST /notes`、`PUT /notes/:id`、`GET /events`。记录结构为 `{ id: string; title: string; body: string }`。服务端从框架传入的可信上下文取得用户，数据库查询限定该用户的数据。

- [ ] 写 `test/notes.test.ts`，先断言创建、更新、重新读取内容一致；用户 B 读取不到用户 A 的记录；事件入口返回 SSE 并送出可识别事件。

  关键业务断言：

  ```ts
  assert.equal(reopened.body, '示例内容');
  assert.deepEqual(otherUserNotes, []);
  assert.equal(eventResponse.headers['content-type'].startsWith('text/event-stream'), true);
  assert.equal(firstEvent.type, 'ready');
  ```

- [ ] 运行 `pnpm --filter @isola/example-notes test`，确认失败后实现这些业务处理和数据库表。
- [ ] 前端使用公开 `Stack`、`Columns`、`Pane` 自行组合编辑及操作区域，需要列表导航时组合可选 `ListDetail`；使用 `connect()`、标准表单及框架样式完成业务。新建和保存按钮分别为“新建”“保存”，字段标签为“标题”“内容”，保存成功以 `role="status"` 显示“已保存”，列表记录以标题作为可访问名称。源码中不判断操作系统或客户端类型。服务端沿用模板的初始化和健康检查代码。
- [ ] 用模板配置完成 Vite 构建、可选后端镜像构建和 `npm pack`，包内包含约定入口。提供统一开发命令启动宿主、示例和必要后端；退出时清理本次启动的开发进程。
- [ ] 运行示例测试、构建及 `npm pack --dry-run`，确认输出文件；文档按“复制模板、声明业务布局、写业务、本地联调、构建、发布”描述实际命令，并列出布局 Props、默认值、纯组合布局和可选 `ListDetail` 的使用方式。
- [ ] 显式提交 `feat: add official React plugin example and template`。

### 任务 6：市场页面与真实安装联调

**Files:** 创建 `apps/client/src/Market.tsx`、`e2e/market.spec.ts`，修改 `App.tsx`、根 `package.json`、任务 2 创建的 `playwright.config.ts` 及 `README.md`。

**Interfaces:** 市场使用任务 3 的发布与查询接口；安装使用任务 4 的安装接口；成功后将 `PublishedRelease.id`、`entryUrl` 交给任务 2 的 `PluginFrame`。身份页面使用 Better Auth 客户端接口及普通表单。

- [ ] 在 `e2e/market.spec.ts` 写失败场景：通过发布入口上传任务 5 的真实包；用户点击安装后打开插件，创建并保存记录，重新打开内容仍一致；发布并安装纯组合布局 fixture，确认清单沿用同一格式、宿主正常加载；服务端失败时显示具体原因且没有成功入口。

  保存后重新打开的结果断言：

  ```ts
  const plugin = page.frameLocator('iframe[title="插件"]');
  await plugin.getByRole('button', { name: '新建', exact: true }).click();
  await plugin.getByLabel('标题').fill('验收记录');
  await plugin.getByLabel('内容').fill('市场安装后保存的内容');
  await plugin.getByRole('button', { name: '保存', exact: true }).click();
  await expect(plugin.getByRole('status')).toHaveText('已保存');
  await page.reload();
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await plugin.getByRole('button', { name: '验收记录', exact: true }).click();
  await expect(plugin.getByLabel('内容')).toHaveValue('市场安装后保存的内容');
  ```

- [ ] 运行 `pnpm exec playwright test e2e/market.spec.ts --project=chromium`，确认失败。
- [ ] 实现市场列表、包发布入口、安装操作、已安装入口和错误展示；安装和打开按钮分别为“安装”“打开”。安装请求以服务端最终结果更新界面；当前客户端接口不兼容时显示具体原因。插件页面错误时宿主仍可返回市场。
- [ ] 完成身份页面和会话接入，调用使用库提供的接口；插件页面不接收会话凭据。开发时由 Vite 代理框架接口，发布时由框架服务端提供宿主界面。
- [ ] 运行 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm exec playwright test`。浏览器项目为 Chromium、Firefox、WebKit；全部通过后显式提交 `feat: use plugins from the market`。

### 任务 7：Tauri 客户端及四端真实验收

**Files:** 创建 Tauri CLI 生成的 `apps/client/src-tauri` 工程、`docs/acceptance.md`；修改客户端包命令及 `README.md`。

**Interfaces:** 原生窗口加载同一套框架服务端的宿主界面，服务器地址为框架部署配置。插件清单、发布产物和 SDK 保持不变；原生工程不开放下载插件直接调用平台专有 API。

- [ ] 将任务 6 的业务用例及任务 2 的布局用例写入 `docs/acceptance.md`：市场安装、创建编辑保存、重新打开、接收事件、自定义区域顺序与占比、多列换行、嵌套、字体放大与页面缩放、可选窄屏返回、尺寸变化保留编辑节点、软键盘输入、跨客户端读取同一记录。未执行项保持未完成，不能以预览截图代替。
- [ ] 使用官方 Tauri CLI 初始化工程，并将启动地址接入框架部署配置；Windows、macOS、iPhone 共用前端代码。依赖系统 WebView 的能力按目标系统和实际引擎版本记录。
- [ ] Windows、macOS 分别运行 `pnpm --filter @isola/client tauri dev` 和 `pnpm --filter @isola/client tauri build`，要求实际客户端可用、构建退出码为 `0`。macOS 上运行 `pnpm --filter @isola/client tauri ios init`、`pnpm --filter @isola/client tauri ios dev`、`pnpm --filter @isola/client tauri ios build`，使用完整 Xcode、有效签名和 iPhone 执行业务验收。iOS 构建只能在 macOS 上进行。[^3]
- [ ] 每端记录实际系统、客户端和 WebView 版本、同一发布产物的校验值以及逐项结果。公开组件的适配失败在框架修复，复跑受影响用例。
- [ ] 需要浏览器之外的自动桌面验证时，采用 Tauri 官方文档支持的 WebdriverIO 集成；iPhone 软键盘和真实客户端操作仍需真机证据。[^4]
- [ ] 四端用例全部有通过证据后，才把本计划的“四端使用”验收标为完成；显式提交 `feat: verify plugin framework across four clients`。公开 App Store 分发另按设计文档已记录的 Apple 4.7 要求验收，由框架维护者负责。

## ✅ 执行与交付检查

- [ ] 契约在 SDK、模板、宿主、服务端和文档中一致。
- [ ] 包发布、安装失败、调用归属、数据保留及真实业务用例有验证结果。
- [ ] 官方示例仅依赖公开接口，贡献者可以据文档复制开发。
- [ ] 自定义布局的类型、默认值、适配规则在方案、SDK、测试、示例和贡献者文档中一致，布局选择由插件声明。
- [ ] Web、Windows、macOS、iPhone 分别记录真实验收结果，未验证项如实保留。
- [ ] 仅修改本计划涉及的代码和文档，显式暂存后提交。

[^1]: Better Auth. [Fastify integration](https://better-auth.com/docs/integrations/fastify)
[^2]: node-tar. [API and archive protections](https://github.com/isaacs/node-tar)
[^3]: Tauri. [Prerequisites, iOS](https://v2.tauri.app/start/prerequisites/#ios)
[^4]: Tauri. [WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/)
[^5]: React. [Preserving and resetting state](https://react.dev/learn/preserving-and-resetting-state)
[^6]: Radix Themes. [Layout](https://www.radix-ui.com/themes/docs/overview/layout)
[^7]: Every Layout. [The Sidebar](https://every-layout.dev/layouts/sidebar/)
[^8]: Radix Themes community. [Layout API ergonomics discussion](https://github.com/radix-ui/themes/discussions/96)
