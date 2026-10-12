# 来源说明

项目最初由 Lovable 生成 V0.1 原型，之后脱离 Lovable credits，在本地 VS Code 继续迭代：

`Lovable V0.1 → 本地 V0.2 → 本地 V0.3 → 本地 V0.4`

- `legacy-v0.1/`：保留最初 Lovable 核心架构片段，用于对照。
- 根目录 `src/`：当前 V0.4，可直接在 VS Code 中继续开发。
- `server/`：V0.4 新增的服务端 AI Provider 与结构化认知 API。

V0.4 的重点不是视觉翻新，而是把真实大模型放进已有 Thinking Engine：模型负责结构化理解和语言生成，本地认知引擎仍然掌握 next_action。
