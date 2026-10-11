# Isola 首个可运行版本实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans according to the execution method selected by the user. Steps use checkbox syntax for tracking.

**Goal:** 交付公开插件规范、官方示例和开发模板，走通发布、市场安装与前后端调用。当前只验收 Web，Windows 使用 Web；原生客户端仅保留最小共用外壳配置。

**Architecture:** 插件按框架约定构建为同一份 React Web 产物，通过 iframe 和 MessageChannel 接入共用客户端。框架服务端提供市场、安装和业务接入，有后端的插件使用独立容器。Tauri 2 共用外壳通过原生 URL 配置加载同一宿主，原生运行未验证。

**Tech Stack:** Node.js 24、pnpm 10、TypeScript、React、Vite、Fastify、PostgreSQL、Docker、Tauri 2。会话接入使用 Better Auth 原生 Fastify 集成，归档使用 npm 打包格式和 node-tar；测试使用 Node 测试运行器及 Playwright。[^1][^2]

**Spec:** [Isola 技术方案](../specs/2026-10-10-react-plugin-framework-design.md)。用户已确认任务 4 由框架备份并恢复失败初始化的数据；最小实现沿用原生 PostgreSQL 与 Docker。实际通过项与未完成项见[验收记录](../../acceptance.md)。

## 📋 全局约束

- “插件开发者面向框架开发一次，客户端适配由框架维护者负责。”
- “插件遵守框架的导入与开发规则，符合规则后才能正确安装。”
- “用户从插件市场点击安装，安装完成后直接使用完整业务功能。”
- “框架定义插件规范，由插件作者适配规范；使用官方示例验证框架本身的能力。”
- “开发者决定业务布局，客户端适配由框架负责。”
- 客户端加载同一份插件前端产物，访问同一服务端业务数据；当前已验证 Web。
- 业务布局通过公开组件组合，区域内部使用普通 React 内容；系统差异留在框架代码中，`ListDetail` 是可选组件。
- 仅成功安装才写入安装记录；按用户确认的原生数据库备份恢复失败初始化已提交的破坏性 SQL，保留已有安装版本与业务数据。
- 会话、容器、数据库权限、归档保护直接采用依赖的原生机制。

Web 开发需要 Node.js 24、pnpm 10 与 Docker Engine/Compose。代码提交显式暂存本计划涉及的文件，保留其他工作区内容。

## 🔍 重点验收条件

| 条件 | 预期行为 | 对应任务 |
| --- | --- | --- |
| 错误清单、缺失入口、越界归档路径 | 拒绝发布或安装，已有文件保留 | 任务 3 |
| 其他 iframe 或伪造插件标识发起调用 | 不能改变调用归属；宿主凭据不传给插件 | 任务 2、4 |
| 重复点击安装、后端启动失败 | 安装记录唯一；失败保留已有版本和数据 | 任务 4 |
| 自定义多列、嵌套、窄屏、软键盘和尺寸变化 | 按当前容器排版，区域可达，草稿和编辑节点保留；可选返回操作可用 | 任务 2、7 |
| 当前客户端范围 | Web 验收，Windows 使用 Web；原生与真机未验证 | 任务 7 |

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
  | { type: 'disconnect' }
  | { type: 'request'; id: string; path: string; options?: RequestOptions }
  | { type: 'subscribe'; id: string; path: string }
  | { type: 'unsubscribe'; id: string }
  | { type: 'result'; id: string; data: unknown }
  | { type: 'event'; id: string; data: unknown }
  | { type: 'error'; id: string; message: string };
```

`connect(): Promise<PluginClient>` 获取绑定到当前 iframe 的通道。插件只提供相对业务路径和业务数据；普通对象按 JSON 请求体发送，`File` / `Blob` 保持浏览器原生请求体。宿主根据实际加载的插件确定调用目标；用户身份由框架服务端的原生会话接入提供。订阅使用服务端 SSE，宿主通过 MessageChannel 将事件送到插件。

连接初始化使用 `Window.postMessage` 发送 `{ type: 'isola:connect', apiVersion: 1 }`；宿主以相同标记和转交的 MessagePort 回应。双方检查实际父子窗口来源。业务响应采用 JSON，HTTP `204` 返回 `undefined`，非成功 HTTP 响应以明确错误拒绝请求。

插件离开时在已绑定的 MessageChannel 上发送 `disconnect`，宿主清理该通道的请求与订阅。

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

## 🔧 当前实现与验证

### 任务 1：插件契约

已实现 pnpm 工作区、清单 schema、API 版本 1、公开 SDK 类型和包导出；SDK 构建与根类型检查通过。SDK 尚未发布到 npm。

### 任务 2：布局与通道

已实现上述布局组件、iframe sandbox 与 MessageChannel。标准表单使用原生 `allow-forms`，保留不透明源；宿主凭据不传给插件。连接与请求超时为 30 秒，离开插件通过 `disconnect` 清理请求和订阅。布局、调用和生命周期用例已纳入任务 6 的三引擎浏览器测试。

### 任务 3：市场与静态产物

已实现 Better Auth 原生会话、TGZ 发布、市场列表和版本静态产物。使用 Fastify schema、node-tar 归档保护及所有插件静态资源的 CSP sandbox。发布与拒绝测试纳入任务 6 的 24 项核心服务测试。

### 任务 4：安装与后端

已实现安装记录、独立后端容器、插件 PostgreSQL 数据库/角色、业务请求和 SSE。每个插件使用原生 internal 网络连接核心、数据库与后端，后端另接普通 bridge 访问外部网络。同插件版本复用网络；数据与调用归属隔离已验证。

恢复实现沿用同插件 advisory lock：启动前停止原运行后端、禁用业务库连接并终止会话，用原生 `TEMPLATE` 建立受保护副本，复制数据库及角色在库设置。`plugins.backend_backup` 保存唯一待处理副本引用；安装记录与清除引用共用事务。启动或记录失败后，先移除候选，再原生恢复业务库及原运行后端；恢复失败保留副本并拒绝后续自动建库。验收覆盖破坏性初始化、安装记录失败、备份准备失败、原生恢复失败、候选移除失败和提交后清理失败，保留既有并发安装及跨用户旧版本测试。

### 任务 5：官方模板

`examples/notes` 已实现笔记创建、编辑、保存、重新打开与事件订阅；仅使用公开 SDK 和布局组件。已验证可打包 SDK 与模板供仓库外开发，笔记后端测试 6/6 通过。

### 任务 6：真实 Web 使用

已实现注册/登录、发布、市场安装、打开及返回市场。实际 TGZ、Better Auth、Docker 后端和 PostgreSQL 贯通，刷新后重新打开笔记保留内容。

按用户确认的覆盖安装规则，市场每个插件 `name` 只显示一张卡片；已安装版本保持可打开，最新版本在同一卡片更新。服务端按 npm SemVer 返回每个插件的最新发布，沿用原生唯一约束和 UPSERT 覆盖同一用户的安装记录；失败不改变原安装。

任务 6 既有结果：`pnpm test` 60/60（三引擎）、核心服务测试 24/24、笔记测试 6/6，类型检查和工作区构建通过。`pnpm dev` 已在 Linux Node/Docker 环境验证正常启动、真实市场使用、停止保留数据和启动中取消；原生 Windows 子进程取消/退出竞态另有 4/4 检查，不代表原生客户端或完整 Windows 开发启动验收。

### 任务 7：最小外壳与 Web 验收记录

已用官方 `@tauri-apps/cli` 2.12.2 初始化 `apps/client/src-tauri`，保留共用 Rust 入口与原生配置。`build.devUrl` 为 `http://localhost:5173`，`build.frontendDist` 为本地核心服务 `http://localhost:3000`；部署时改为实际服务 URL，使用 Tauri 原生配置机制。插件规范、产物和 SDK 不变。

当前只验收 Web，Windows 使用 Web。原生 Windows/macOS/iPhone 构建与运行未执行；页面缩放、真实软键盘和安全区域未验证。独立 Firefox 会话读取 Grove 同一安装版本与保存内容已验证。浏览器 WebKit 不等同于 Safari 或 iPhone。Grove 给定网页对应的原型已在独立测试副本中按公开规则安装。

具体命令、结果和未完成项见[验收记录](../../acceptance.md)。任务 7 只检查依赖安装、配置解析、类型和 Web 构建，不重复未变化的 60/24/6 用例。

[^1]: Better Auth. [Fastify integration](https://better-auth.com/docs/integrations/fastify)
[^2]: node-tar. [API and archive protections](https://github.com/isaacs/node-tar)
[^5]: React. [Preserving and resetting state](https://react.dev/learn/preserving-and-resetting-state)
[^6]: Radix Themes. [Layout](https://www.radix-ui.com/themes/docs/overview/layout)
[^7]: Every Layout. [The Sidebar](https://every-layout.dev/layouts/sidebar/)
[^8]: Radix Themes community. [Layout API ergonomics discussion](https://github.com/radix-ui/themes/discussions/96)
