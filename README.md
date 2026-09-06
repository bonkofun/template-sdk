<h1 align="center">Bonko Template SDK</h1>
<p align="center"><strong>Bonko 模板协议、包校验与隔离运行时的独立版本仓库。</strong></p>
<p align="center">
  <a href="https://github.com/bonkofun/template-sdk/actions/workflows/ci.yml"><img src="https://github.com/bonkofun/template-sdk/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <img src="https://img.shields.io/badge/SDK-0.2.1-E8A0B5?style=flat" alt="SDK 0.2.1" />
  <img src="https://img.shields.io/badge/TypeScript-5.7.3-3178C6?style=flat" alt="TypeScript 5.7.3" />
  <img src="https://img.shields.io/badge/Node.js-22.12.0-339933?style=flat" alt="Node.js 22.12.0" />
</p>

SDK 的唯一源码在本仓库。主站和 [Template Studio](https://github.com/bonkofun/template-studio) 都是消费者，使用同一个固定版本的发行包，不相互引用源码，也不要求开发者同时克隆三个仓库。

## 职责与边界

- TypeScript 类型、模板协议、文件清单与摘要、ZIP 导入导出和运行包校验。
- 浏览器端模板客户端、宿主消息协议、播放/暂停/等待/结束、静态入口和音频管理。
- 沙箱 HTML/CSP 生成、隔离网关、资源加载，以及 React 宿主组件。
- 不包含主站页面、数据库、账号系统、R2 凭证、模板创作 CLI 或模板素材。

Worker 使用网关入口返回隔离文档，上传的模板 JS 由接收者浏览器 iframe 执行。SDK 没有上传后自动安装 npm 依赖的功能。

## 本地开发

需要 Node.js 22.12.0+，锁定 pnpm 10.30.3。TypeScript 5.7.3、Vitest 4.1.11；React 19.2.8 和 Motion 13.1.1 为 peer dependencies，开发环境也安装相同版本。

```bash
git clone https://github.com/bonkofun/template-sdk.git template-sdk
cd template-sdk
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm package:check
corepack pnpm pack --pack-destination artifacts
```

产物为 `artifacts/bonko-template-sdk-0.2.1.tgz`，包含编译后的 JS、类型声明、包元数据和 README，不包含测试、源码目录、node_modules 或凭证。`dist/` 和打包结果不提交 Git。

## 导出入口

| 入口 | 用途 |
| --- | --- |
| `@bonko/template-sdk` | 共享类型、模板定义、播放及音频工具 |
| `/runtime-client` | 独立模板注册、互动和自定义静态呈现 |
| `/runtime-react` | React 宿主集成 |
| `/runtime-host` | 宿主生命周期、预算与消息处理 |
| `/runtime-messages` | 消息校验及协议类型 |
| `/runtime-assets` | 资源加载与清理 |
| `/runtime-document` | 隔离页面与脚本完整性 |
| `/runtime-gateway` | 独立运行网关、预览令牌与来源校验 |
| `/runtime-bundle` | v3 运行包打包和校验 |
| `/submission` | 提交清单、能力与资源约束 |
| `/node` | Node ZIP、摘要和包检查工具 |
| `/react` | 保留的 React 兼容接口 |

新模板通过 Studio 的 v3 工作流制作；保留兼容入口不表示重新开放旧模板创作流程。

## 发布版本

本仓库使用 Git tag + GitHub Release 维护版本，当前采用私有仓库的 `.tgz` 发行资产；没有配置 npm registry 发布，也不需要 npm token。`private: true` 用来防止误发布到 npm。

1. 修改实现并更新测试、`package.json` 版本与 `CHANGELOG.md`。涉及 SDK_VERSION 或协议兼容门禁时一起更新相应定义与消费者兼容策略。
2. 执行上面的检查并提交，经审查合并到 main。
3. 创建匹配 package.json 的 tag，例如下一次兼容修复使用 `v0.2.2`，推送该 tag。
4. CI 重新安装锁定依赖、类型检查、测试、构建与包校验；只有全部通过，才创建 Release 并上传 TGZ 和 `SHA256SUMS`。
5. 消费者显式升级、验证后提交，不自动跟随 main/latest。

已发布 tag 和资产不可覆盖。发布工作流不使用覆盖选项。修复已发布内容必须增加版本。主版本用于不兼容接口变更，次版本用于兼容功能，补丁用于兼容修复；0.x 期间也必须明确评估协议兼容性。

## 消费者升级

维护者在 SDK CI 通过后，从对应 Release 下载两个文件：

```bash
gh release download v0.2.1 --repo bonkofun/template-sdk --pattern 'bonko-template-sdk-0.2.1.tgz' --pattern SHA256SUMS --dir /tmp/bonko-sdk-release
cd /tmp/bonko-sdk-release
shasum -a 256 -c SHA256SUMS
```

将已校验的 TGZ 放入消费者 `vendor/`，并使用精确本地依赖：

```json
{ "dependencies": { "@bonko/template-sdk": "file:vendor/bonko-template-sdk-0.2.1.tgz" } }
```

执行消费者的 `pnpm install` 更新 lockfile，再跑类型检查与相关集成测试。Studio 升级还需更新工作区分发清单、依赖固定规则、模板兼容声明和示例检查；主站升级还需验证运行 Worker 与包导入。后续克隆消费者只需正常安装，不需要 GitHub Release 下载权限或 SDK 源码。

## CI 与维护

main 推送、PR 和手动触发执行 CI；`v*` tag 触发经过验证的 Release。普通 CI 只有只读权限，只有 tag 发布任务具有 contents write。Action 固定提交 SHA，无生产服务访问。

源码从主站 `packages/template-sdk` 迁出，初始版本为 0.2.1，保留原有运行行为；迁移前历史可在主站 Git 历史查询。测试现在由本仓库独立执行。主站仍负责自身集成测试，Studio 负责真实浏览器和模板打包测试。

当前代码为私有项目代码，`UNLICENSED`，不授予开源使用许可。

包版本 0.2.1 与运行协议标识分开管理：v3 manifest 的 `sdkVersion` 仍为 `0.2.0`（`RUNTIME_SDK_VERSION`），历史 v1 兼容协议仍为 `0.1.0`。此次补丁不改变模板协议，无需重写现有 manifest。
