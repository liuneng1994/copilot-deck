# Agent View

基于 **ACP（[Agent Client Protocol](https://agentclientprotocol.com)）** 的多
session 管理器，把 GitHub Copilot CLI 包装成一个浏览器里使用的 agent 开发工具：
流式聊天 / tool-call 时间线 / diff & 终端预览 / 权限弹窗 / 持久化历史 / 模型切换 /
detach 后无缝 reattach。

> 协议：JSON-RPC 2.0 over stdio NDJSON · CLI 是 `copilot --acp --stdio` ·
> 客户端 SDK 用官方 `@agentclientprotocol/sdk`。

## 已实现功能

- **会话管理** — 多 cwd / 多 session 并行，sidebar 折叠分组，删除/重命名/搜索；
  detached session 重启后自动出现 ↻ Reattach 按钮，通过 ACP `loadSession` 让
  Copilot replay 历史并恢复 LLM 上下文（M-Reattach）
- **聊天流** — Markdown + 代码高亮（Shiki，多语言按需加载）；流式光标；⌘↵ 发送 /
  Esc 取消；输入框 `/` 触发 builtin + agent slash 补全，`@` 触发文件模糊匹配
- **Tool-call 时间线** — `tool_call` / `tool_call_update` 合并卡片，支持 diff
  （unified / split + Open in editor）、terminal、text、generic content blocks；
  Inspector 同源渲染并显示数量角标
- **权限请求** — 真实 PermissionBroker，5min 超时默认 deny，allow_always /
  reject_always 决策按 (cwd, toolName) 落 SQLite，重启沿用
- **持久化** — SQLite（sessions / messages / tool_calls / permissions /
  trace_events）+ WAL；WS 接入即推 `hydrate` 快照；客户端 ws-client 指数退避
  自动重连
- **模型切换** — `<SessionHeader>` Cpu 图标打开 picker，支持 curated 列表（Claude
  4.5–4.7 / Sonnet / Haiku / GPT 5.x / Codex / Gemini / Lark），切换时 kill 当前
  cwd 的 copilot child，下一个 prompt 用 `--model <id>` spawn
- **Slash 指令系统** — 20 个 builtin（view / session / system / help），HelpOverlay
  分类列出，`/clear` `/delete` `/copy` `/cancel` `/new` `/switch` `/models`
  `/reattach` `/files` `/trace` 等都可直接在 composer 触发
- **JSON-RPC trace drawer** — 实时显示进出站 ACP 消息，按 session / direction
  过滤，可展开 payload
- **崩溃边界** — copilot child 退出会广播 `child_exit`，相关 session 切到 error
  状态 + 红色 banner + 顶栏红点

## 架构

```
┌─────────────── Browser (Vite + React + Zustand) ──────────────┐
│  Sidebar · Conversation · Composer · Inspector · StatusBar    │
└────────────┬──────────────────────────────────────┬───────────┘
             │ WebSocket (typed ClientToServer ↔    │ REST /api/*
             ▼ ServerToClient messages)             ▼
┌─── Fastify (packages/server) ─────────────────────────────────┐
│  routes.ts  ─ /api/{health,sessions,models,files,file,        │
│                list-dir,git-info,trace,mkdir,open-in-editor}  │
│  ws-handlers.ts ─ Record<msgType, handler> dispatch           │
│  session-manager.ts ─ CopilotAgent per cwd, sessions, perm    │
│                       broker, listeners, hydrate, reattach    │
│  acp/persist.ts ─ sessionUpdate → SQLite 镜像                  │
│  acp/copilot-agent.ts ─ spawn + ACP ClientSideConnection      │
│  store.ts ─ better-sqlite3 (WAL)                              │
│  config.ts ─ PERMISSION_TIMEOUT_MS, readDefaultCopilotModel   │
└─────────────────────────────┬─────────────────────────────────┘
                              │ stdio NDJSON
                              ▼
                  copilot --acp --stdio --model <id>
```

## 仓库结构（pnpm workspaces）

```
packages/
├── shared/    后端/前端共享的 WS 协议类型 + curated model 列表
├── server/    Fastify + WebSocket + ACP 客户端 + SQLite
└── web/       Vite + React + Tailwind + shadcn/ui
scripts/
└── smoke.mjs  端到端冒烟（Node 22 内置 WebSocket）
plan.md        完整设计、UI 线框、里程碑
```

## 前置条件

- Node.js ≥ 22（内置 `WebSocket` / `Readable.toWeb`）
- pnpm ≥ 10
- 已安装并登录的 `copilot` CLI（`copilot --version` 可跑，`copilot --acp --stdio`
  可用）

## 开发

```bash
pnpm install
pnpm dev   # 后端 :4000 + Vite :5173（已代理 /api 和 /ws）
```

浏览器打开 http://localhost:5173 → 默认 cwd 是 `/root/agents`（可改 / 新建）→
**Create session** → 输入 prompt → 流式响应。

单独运行：

```bash
pnpm --filter @agent-view/server dev
pnpm --filter @agent-view/web dev
```

冒烟（不开浏览器）：

```bash
pnpm --filter @agent-view/server dev &
node scripts/smoke.mjs   # 期望: "pong" 且 stopReason=end_turn
```

校验：

```bash
pnpm lint        # biome check（0 errors）
pnpm typecheck   # tsc --noEmit, 三个 workspace
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `4000` | 后端监听端口 |
| `HOST` | `127.0.0.1` | 后端监听地址 |
| `COPILOT_CLI_PATH` | `copilot`（PATH 查找） | copilot 可执行文件路径 |
| `COPILOT_DEFAULT_MODEL` | `~/.copilot/settings.json::model` ?? `claude-sonnet-4.5` | spawn copilot 时的默认 `--model` |
| `AGENT_VIEW_DB` | `~/.agent-view/db.sqlite` | SQLite 持久化路径 |
| `AGENT_VIEW_TRACE_MAX` | `5000` | trace_events 轮转上限 |
| `AGENT_VIEW_EDITOR` | `code` | Open-in-editor 调用的命令 |

## 里程碑（已完成）

- **M0** — pnpm monorepo + Fastify/WS + ACP TS SDK + spawn copilot + 端到端冒烟
- **M1** — AppShell + 三栏布局 + 主题 + Sidebar/Inspector 折叠
- **M-Coding A/B/C** — PermissionBroker，Tool-call 内核，SlashPopover/ModeSelector，
  Shiki 代码高亮，DiffView (unified/split)，MentionPopover，Files / Terminal tab，
  StatusBar live wiring，崩溃边界 banner
- **M-Persist** — SQLite 五表 + hydrate 快照 + trace_events + WS 自动重连 +
  TraceDrawer + 删除会话
- **M-Commands** — 20 个 builtin slash 指令 + HelpOverlay + NoticeBanner
- **M-Models** — 页面内模型 picker，spawn-with-`--model` 切换
- **M-Reattach** — ACP `loadSession` 恢复 detach 会话 + LLM 上下文，replay 去重

详细设计、UI 线框、未来扩展（多 agent 类型、远程后端、Tauri 桌面壳、协作）见
[`plan.md`](./plan.md)。
