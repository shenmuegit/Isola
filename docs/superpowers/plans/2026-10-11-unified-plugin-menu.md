# Isola Unified Plugin Menu Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the end-to-end task below. Follow the existing worktree and Grove's main-only rules.

**Goal:** 一个宿主标题栏承担插件切换、市场返回及插件注册的业务菜单，并将 Grove 真实接入。

**Architecture:** 安装记录提供基础菜单入口，SDK 通过已有 MessageChannel 注册当前插件的业务操作。原生 Popover 和文件输入负责浏览器交互；插件继续拥有业务布局和数据。

**Tech Stack:** 现有 React、TypeScript、MessageChannel、HTML Popover、File、Vite 与 Playwright。

**Spec:** [统一菜单方案](../specs/2026-10-11-unified-plugin-menu-design.md)。

## Global Constraints

- 当前只验收 Web，Windows 使用 Web。
- 框架不能包含 Grove 标识、选择器、分支或专用调用。
- 保留现有版本检查、沙盒、凭据隔离、通道清理及失败恢复保护。
- 不增加依赖、HTTP 端点、服务端表或独立菜单注册服务。
- 框架复用现有 `feat/plugin-framework` 工作树；独立 Grove 副本只在 `main` 修改。
- 真实预览仅保留 Grove；测试包清理不得影响其数据或已有笔记业务库。

## Review Focus

- 菜单替换后的旧清理函数和异步回调：不得误清理或调用新菜单。
- 切换插件或重连后的旧端口：不得将文件或动作交给错误插件。
- 原生文件选择：保留用户手势、取消及同文件重试。
- 登录、升级和失败：菜单与该用户的真实安装一致。
- 移除 Grove 标题栏后：旧 DOM 监听不报错，全部笔记、全图、导入和原有编辑仍可用。

## Task 1: SDK、宿主与 Grove 完整接入

**Files:**

- SDK：`packages/plugin/src/{protocol,client,index}.ts`、`packages/plugin/package.json`、`packages/plugin/test/types.ts`。
- 宿主：`apps/client/src/{App,Market,PluginFrame}.tsx`、`apps/client/src/app.css`。
- 模板和验证：`examples/notes/src/App.tsx`、`e2e/framework.spec.ts`、必要的 `e2e/fixtures`、`e2e/market.spec.ts`。
- 公开说明：现有技术方案、实施计划、`docs/plugin-development.md` 和 `docs/acceptance.md`。
- 独立 Grove：`design-trials/grove-sites-prototype-20261008/{index.html,src/board.js,public/app.css,package.json,package-lock.json}` 和受影响的测试、接入说明。

**Interface:** 实现方案中的 `PluginMenuItem` 和 `PluginClient.registerMenu`。消息包含注册标识、条目数据及选择文件，函数留在插件；清理按注册标识匹配。宿主从绑定端口形成当前插件的可调用菜单，不接受插件指定的其他插件归属。

- [x] 写出并运行失败回归：注册、执行、替换、旧清理、注销、断开及重连；恶意条目和非当前 iframe 来源；文件和回调错误。
- [x] 实现 SDK 与 PluginFrame 的最小菜单扩展，运行相关新旧通道测试，保留原保护。
- [x] 将安装状态提升为宿主和市场共用的真实数据；实现唯一标题栏和菜单，删除旧标题栏与无用样式。安装结果注册入口，保留错误和加载路径。
- [x] 更新官方模板及受影响测试；打包 SDK 0.1.1 到独立测试证据目录，供 Grove 以文件依赖使用。
- [x] Grove 按公开接口注册三个原有操作，移除顶部栏和旧监听；构建、定向测试并生成 0.1.5 TGZ 与对应后端镜像。
- [x] 控制器更新本地宿主产物，通过真实市场安装 Grove 0.1.5，验证单标题栏、切换、返回、文件导入、错误和数据保留；清理临时测试插件。
- [x] 更新事实文档、检查类型和构建、提交目标文件；对本次两个仓库的源码变化进行一次新上下文复核并处理发现。

源码与产物已在隔离工作树和 Grove main 完成。实际预览升级、22 项真实界面检查和原生数据比较已通过，临时插件与导入笔记已清理。单次新上下文复核通过，无待修复发现。代码保留本地，证据归档在独立目录 `workdashboard-testing/isola-menu-20261011`。
