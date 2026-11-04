<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 修改、审查与提交

- 每次完成明确的需求变更或 Bug 修复后，必须先进行代码审查（code review），检查实现是否满足需求、是否引入回归以及必要的验证是否通过。
- 审查未发现问题且相应验证通过后，自行暂存并创建 Git 提交，无需再次询问用户是否提交。提交应按独立需求或修复组织，并遵守项目的提交信息规范。
- 审查发现问题时，应主动向用户说明问题、影响和处理状态；先修复可解决的问题，再重新审查和验证。未解决的问题不得被描述为“审查通过”。
- 仅提交当前任务相关且已审查的文件，保留其他未提交改动，不覆盖或回退他人的工作。
