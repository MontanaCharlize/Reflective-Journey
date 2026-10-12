# 反思之旅 V0.5.3 — Dialogue Quality Stress Pass

V0.5 在真实 AI 接入的基础上，加入具体反馈、可选提示、用户确认的思考成果，以及现实验证与回看。

V0.5.3 在 V0.5.2 单轮质量基线之上加入 8 类问题、53 个用户轮次的连续对话压测，重点修复机制回答漏判、边界/证据/反例串位、局部条件覆盖总体判断、问题求解卡点误判，以及撤回旧理由后继续沿旧依据追问等多轮问题。混合模式下，AI 只有拿到经过校验的总体判断证据时才允许覆盖本地 `currentPosition`。

多轮压测详见：[V0.5.3 对话质量压测](docs/V0.5.3-DIALOGUE-STRESS.md)；上一版基线见：[V0.5.2 认知质量基线](docs/V0.5.2-COGNITIVE-QUALITY.md)。

V0.5.1 增加了全局随手记和停顿询问。右下角的随手记可以自由拖动、调整大小、展开、收起与导出；内容和窗口状态自动保存在此浏览器。回答区在 90 秒没有编辑活动后，温和地询问「这一刻，你的思绪到了哪里？」。

用户可以继续想、请求提示，或写下一个岔开的念头。这个念头可以放进回答草稿、追加到随手记，也可以另存新思考方向，并从新方向返回原问题。随手记的输入也会重新计时，页面隐藏、模型处理和成果整理时不询问。功能可关闭，近期同一道问题不会重复询问。

详见：[随手记与停顿询问说明](docs/QUICK-NOTES-AND-CHECKIN.md)。

本版可以：

- 从自己的问题开始，每次只推进一个思考动作。
- 看见对自己表达的简短回映，理解有偏差时可以在下一条回答里纠正。
- 点击「给我一点提示」或「换个问法」，不必因为卡住而放弃。
- 一次回答后即可整理，不要求改变观点，也不按固定轮数强制收尾。
- 回答提交时先保存原话，处理途中可以暂停；刷新后从首页继续这一轮。
- 自动保存回答、成果整理和回看的草稿。
- 确认当前判断、一个发现及尚待弄清的问题；可选地留下一个小尝试。
- 下次从首页找到待回看的尝试，追加实际观察和新的判断。

详细说明：[V0.5 设计](docs/V0.5-DESIGN.md) · [验证记录](docs/QA-V0.5.md) · [认知体验评估](evals/README.md)

### 本机验证

    npm test
    npm run stress:dialogue
    npm run build
    npm run dev

测试使用本地模拟 Provider，不消耗真实模型额度。真实模型生成质量及用户复访效果需要另行评估。

目录名保留 `reflective-journey-v0.4`，实际应用版本已升级为 V0.5.3，数据 schema 仍为 V0.5，已有 `.env.local` 配置可继续使用。

这一版最重要的原则没有改变：

> **模型不能决定产品的认知方向。认知引擎决定下一步要完成什么思考动作，模型只负责理解上下文、更新结构化认知状态，以及把这个动作问得更针对。**

因此 V0.4 不是：

```text
用户回答 → 大模型自由回复
```

而是：

```text
用户回答
  ↓
真实模型：结构化理解“用户刚刚表达了什么”
  ↓
Cognitive Engine：锁定 next_action
  ↓
真实模型：只把 next_action 改写成一个针对当前上下文的问题
  ↓
用户继续思考
  ↓
全过程保存
```

如果真实模型不可用，系统会自动退回 V0.3 的本地认知引擎，思考流程不会中断。

---

## 1. 在 VS Code 中启动

### 第一步：安装依赖

```bash
npm install
```

### 第二步：配置模型

复制：

```text
.env.example
```

为：

```text
.env.local
```

V0.4 默认按 DeepSeek 配置：

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的_API_Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
```

> API Key 只由 Vite 本地服务端插件读取，不会打包到浏览器 JS，也不会保存进 localStorage 或思考记录。

### 第三步：启动

```bash
npm run dev
```

浏览器打开终端显示的本地地址即可。

Windows 也可以运行 `启动项目.bat`（首次仍建议先确认 Node.js 已安装）。

---

## 2. 支持的 Provider

### DeepSeek

默认推荐，`.env.example` 已给出配置。

### OpenAI

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-luna
```

### GLM / 智谱

已做 OpenAI-compatible Provider 适配，但不同账号当前可用模型名可能不同，因此 `GLM_MODEL` 不写死：

```env
GLM_API_KEY=...
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=你控制台当前可用的模型名
```

### 其他 OpenAI-compatible Provider

使用 `CUSTOM_AI_*` 配置。

---

## 3. 模型实验室

桌面端右上角增加了一个很轻的「模型」入口，只用于开发阶段。

它可以：

- 查看当前服务端实际检测到的 Provider；
- 查看模型名；
- 在多个已配置 Provider 之间切换；
- 不显示、也不能读取 API Key。

移动端默认隐藏该开发入口，避免影响产品主体验。

---

## 4. 模型竞技场

如果你同时配置了两个以上 Provider：

1. 先运行：

```bash
npm run dev
```

2. 再开一个终端：

```bash
npm run arena
```

竞技场会给所有已配置模型**完全相同的用户上下文 + 完全相同的 next_action**，只比较它们生成的下一问。

建议人工评分：

- 上下文针对性
- 是否服从认知动作
- 是否泄露答案
- 是否重复用户已经完成的思考
- 是否一次只推进一个认知动作
- 用户是否容易回答
- 语言自然度
- 回答后能否明显推进认知状态

这比用通用排行榜选模型更符合「反思之旅」的真实任务。

---

## 5. 当前版本保存了什么

一次 Session 会完整保存：

- 用户原始问题；
- 问题认知类型；
- 用户每一次真实回答；
- 每轮结构化认知分析；
- Cognitive State 的变化；
- Cognitive Engine 每次选择的 next_action；
- 为什么此刻选择这个动作；
- 模型生成问题时使用的上下文锚点；
- 最终向用户展示的问题；
- Provider / Model；
- 每次 API 调用耗时；
- 模型调用失败与自动回退记录；
- 用户最终判断；
- 用户自己标记的观点变化与关键转折点。
- 用户使用过的提示和替代问法。
- 用户确认的收获与尚待弄清的问题。
- 用户自己保存的验证计划、实际观察及回看后的判断。

### 明确不保存的内容

V0.4 **不会要求、读取、导出或保存大模型的隐藏 Chain-of-Thought / reasoning_content**。

产品需要的是：

> 可解释、可审计、可复现的认知状态与策略决策。

而不是模型不可验证的内部草稿。

---

## 6. 关键代码

```text
src/lib/engine.ts
```

本地 Cognitive Engine：分类、认知动作序列、动作跳过、Planner、local fallback。

```text
src/lib/ai.ts
```

前端 AI Orchestrator：真实模型分析 → 本地 Planner → 真实模型问题生成 → 自动回退 → 全过程记录。

```text
server/ai-handler.mjs
```

服务端 AI API：Prompt 边界、结构化输出清洗、Arena。

```text
server/providers.mjs
```

Provider 抽象层。API Key 永远只在服务端。

```text
src/lib/types.ts
```

V0.4 Session Schema，包括 `aiEvents`、`aiRuntime`、`analyses`、`plannerRecords`。

```text
src/components/ProcessTrail.tsx
```

显示“用户说了什么 → 系统观察到什么 → 认知引擎为什么选择这个动作 → 问题由谁生成”。

---

## 7. API 调用次数

V0.4 默认每个用户回答最多调用模型 2 次：

1. **Response Analysis**：结构化认知状态更新；
2. **Question Generation**：认知引擎确定动作以后，生成针对性下一问。

这是刻意的架构选择。它比“一次模型调用自由决定全部事情”成本略高，但能够确保产品的认知逻辑掌握在我们自己的系统里。

后续可以进一步优化：

- Analyzer 使用更便宜模型；
- Question Generator 使用质量更高模型；
- 对稳定状态做缓存；
- 对简单轮次跳过 AI Analyzer；
- 通过 Eval 决定哪些 CognitiveMove 值得升级模型。

---

## 8. 本地数据升级

V0.5 使用：

```text
reflective-journey/v0.5/sessions
```

第一次运行时会自动尝试迁移 V0.4、V0.3、V0.2 的 localStorage 记录，并保留旧键的数据。迁移会根据实际用户回答重新推导已完成动作，修正旧版「问过就视为完成」的标记。

旧记录仍然能查看，但只有 V0.4 新产生的 Session 才具有真实模型调用和自动回退的完整记录。

---

## 9. 部署说明

`npm run dev` 和 `npm run preview` 都可以使用当前 Vite 服务端 AI 插件。

如果后续部署到纯静态托管（只上传 `dist/`），`/api/ai/*` 不会存在。正式公网版需要把 `server/` 中的逻辑迁移到：

- Vercel Functions；
- Cloudflare Workers；
- Netlify Functions；
- 独立 Node 后端；
- 或其他安全的 Serverless API。

不要把 API Key 写进 `VITE_*` 环境变量或浏览器源码。

---

## 10. 当前版本定位

V0.2 解决：

> 不应该从知识块开始，而应该从用户自己的问题开始。

V0.3 解决：

> 下一问应该来自用户刚才真实说过的话，并完整保存中间认知过程。

V0.4 解决：

> **把真实大模型放进我们自己的 Thinking Engine，而不是让产品退化成普通 AI 聊天页。**

V0.5 解决：

> 每次思考留下由用户确认的成果，并把一个想法带到真实经历中验证、回看。
