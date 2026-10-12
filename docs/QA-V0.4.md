# V0.4 QA 清单

## 安全

- [x] API Key 不在 src/ 下。
- [x] API Key 不通过 /api/ai/providers 返回。
- [x] `.env.local` 被 gitignore。
- [x] 不读取 provider 返回的 reasoning_content。
- [x] 不保存隐藏 Chain-of-Thought。

## 产品约束

- [x] 本地 Planner 仍决定 next_action。
- [x] Question API 不允许模型改变 move。
- [x] 每次只生成一个问题。
- [x] AI 不可用时自动回退 V0.3 本地引擎。
- [x] 用户全过程仍保存在 localStorage。

## 数据

- [x] schemaVersion 升级为 4。
- [x] V0.3 → V0.4 自动迁移。
- [x] V0.2 → V0.4 自动迁移。
- [x] 保存 Provider / Model / latency / fallback。
- [x] Markdown 和 JSON 导出包含模型调用记录。

## 静态检查

- [x] src/lib 核心 TypeScript 严格检查通过（无需 React 依赖）。
- [x] 全部 TS/TSX 使用 TypeScript transpileModule 做语法检查，无语法错误。
- [x] server/*.mjs、scripts/*.mjs、vite.config.mjs 通过 `node --check`。
- [x] 使用本地 Fake OpenAI-compatible Provider 做了 Analyze → Planner → Question Generation 服务端集成测试，流程通过。
- [ ] 完整 npm install + Vite build：当前执行环境 npm 下载超时，需在本机验证。
