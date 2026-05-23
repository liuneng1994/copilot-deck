# Agent View

一个 ACP（Agent Client Protocol）多 session 管理器，目前接入 GitHub Copilot CLI，
通过浏览器 UI 与 agent 交互。第一版（M0）是流式聊天的最小骨架，后续按 `plan.md`
路线扩展（多 session、tool-call 时间线、diff、终端、权限弹窗等）。

## 结构（pnpm workspaces）

```
packages/
├── shared/    # 后端/前端共享的 WS 协议类型
├── server/    # Fastify + WebSocket + ACP 客户端 + spawn copilot --acp --stdio
└── web/       # Vite + React 前端
scripts/
└── smoke.mjs  # 端到端冒烟测试（Node 22 内置 WebSocket）
plan.md        # 完整方案、功能清单、里程碑
```

## 前置条件

- Node.js ≥ 22（用到内置 `WebSocket` / `Readable.toWeb`）
- pnpm ≥ 10
- 已安装并登录的 `copilot` CLI（`copilot --version` 能跑、`copilot --acp --stdio` 可用）

## 安装与开发

```bash
pnpm install

# 同时跑后端 (4000) + 前端 dev (5173)，Vite 已配代理转发 /api 和 /ws
pnpm dev
```

浏览器打开 http://localhost:5173 → 默认 cwd 是 `/root/agents`（可改）→
点击 **Create session** → 输入 prompt → 流式响应。

## 单独运行

```bash
pnpm --filter @agent-view/server dev   # 后端 http://127.0.0.1:4000
pnpm --filter @agent-view/web dev      # 前端 http://localhost:5173
```

## 冒烟测试（不开浏览器）

```bash
pnpm --filter @agent-view/server dev &   # 起后端
node scripts/smoke.mjs                   # 应当打出 "pong" 并 stopReason=end_turn
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `4000` | 后端监听端口 |
| `HOST` | `127.0.0.1` | 后端监听地址 |
| `COPILOT_CLI_PATH` | `copilot`（PATH 查找） | copilot 可执行文件路径 |

## M0 范围 / 已知限制

- 单 session、单 prompt 流；多 session UI 在 M2 实现
- 权限请求当前一律返回 `cancelled`（不会触发工具调用）
- 文件读写 / 终端 capabilities 暂未声明（agent 走自身执行能力）
- 无持久化；重启后会话丢失

详细路线见 [`plan.md`](./plan.md)。
