# 第三方代码与协议来源

## dsh-pet（桌面宠物）

- 项目：`dsh-pet` — 一只住在 DeepSeek Harness 里的桌面宠物
- 仓库：https://github.com/PC2005-cloud/dsh-pet
- 许可证：MIT
- 版权：Copyright (c) 2026 PC2005-cloud

### 本项目合并了什么

只合并**协议常量与形状**（这些是"必须一致才能通讯"的部分），不复制其实现代码：

| 合并内容 | 上游位置 | 本项目位置 |
|---|---|---|
| 工作状态档位常量 `thinking/working/result/waiting/success/error` | `src/shared/work-status.ts` | `lib/pet-dsh.js` `WORK_STATES` |
| 工作状态快照形状 `{ state, task }` | `src/shared/work-status.ts` `WorkStatusSnapshot` | `lib/pet-dsh.js` `toWorkStatus()` |
| 气泡投喂形状 `{ text, durationMs }` | `src/host/routes/*` broadcast | `lib/pet-dsh.js` `broadcast()` |
| 点播动画形状 `{ name \| url, facing }` | `src/shared` anim 指令 | `lib/pet-dsh.js` `playAnim()` |
| 第三方菜单协议 `{ owner, labels, target }` 与 `{ label: target }` 事件 | `src/host/menu.ts` | `lib/pet-dsh.js` `registerMenu()` / `pollMenu()` |
| 占用锁 `lock` / `lockId` 语义 | `src/host/routes/*` lock | `lib/pet-dsh.js` `lock()` / `release()` |

### 为什么不整份合并

上游是完整独立产品：569 个源文件、72,581 行 TypeScript、109 段透明动画（52.7MB）、
自带 Electron 桌面模式与浏览器 overlay。整份复制进会议助手会带来：

1. **两份状态服务**：上游固定占用 `/dsh-pet-7340` 前缀与端口，复制会撞车；
2. **重复的渲染栈**：本插件客户端是单文件 IIFE，不能 import 本地模块，无法复用其 React 组件；
3. **维护分裂**：上游持续演进（100+ 动画、物理、多开），复制即分叉。

因此采用**依赖 + 协议对接**：宠物由 dsh-pet 负责"存在感"，会议助手负责"业务语义"，
两者通过下面这套协议通讯。若要离线可用，本插件内置的零依赖小窗口（`tools/pet.exe`）作为降级。

### MIT 许可证原文

```
MIT License

Copyright (c) 2026 PC2005-cloud

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
