# V0.3 自检记录

## 已完成

- `src/lib/types.ts / engine.ts / storage.ts / export.ts` 使用 TypeScript strict 模式检查通过。
- 全部 `src/**/*.ts` 与 `src/**/*.tsx` 使用 JSX 类型 shim 做静态语法/类型联检通过。
- 认知引擎做了多类型模拟：因果解释、证据判断、决策权衡、问题求解、概念理解、多视角判断、自我反思、探索性问题。
- 核心集成测试通过：
  - 新建 V0.3 Session
  - 保存问题分类与诊断原因
  - 每轮用户回答产生 `ResponseAnalysis`
  - 每轮介入产生 `PlannerRecord`
  - 下一问引用用户当前上下文
  - localStorage 保存完整 Session
  - Markdown 导出包含完整问答和认知策略记录
- 对 V0.2 localStorage 增加一次性迁移逻辑。

## 重点验证样例

输入：`AI会不会让大学生越来越不会思考？`

系统识别为：`因果解释`

用户回答：`我觉得会，因为很多学生遇到问题第一反应就是直接问AI。`

下一问会直接引用该上下文，而不是使用完全固定问题。例如会继续追问该理由如何通过具体机制影响思考能力。

## 当前环境限制

容器内 `npm install` 在网络阶段超时，因此没有完成真实 Vite 浏览器构建。代码层已经完成上述静态检查和核心引擎集成测试。建议在本机 VS Code 解压后执行：

```bash
npm install
npm run dev
```
