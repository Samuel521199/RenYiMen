# 一句话成片 Phase 0 基线执行记录

## 1. 执行结果

阶段0已完成，且没有修改一句话成片的生成、审核、重新生成或回退业务逻辑。

本阶段新增：

- 三套完全合成、匿名化的回归项目快照。
- 当前版本基线清单。
- 一句话成片阶段0专用回归测试。
- 独立测试命令 `npm run test:one-prompt-video`。

## 2. 基线版本

| 项目 | 当前值 |
|---|---|
| planJson schema | `plan-json` |
| planner architecture | `v2` |
| planner version | `v2` |
| prompt version | `v2` |
| compiler version | `prompt-compiler-v1` |
| person views | `front / side / back` |
| 单个媒体对象最大历史版本数 | 10 |

机器可读版本记录位于：

`src/services/video-orchestrator/__fixtures__/phase0/baseline-manifest.json`

## 3. 回归项目

| 文件 | 覆盖场景 |
|---|---|
| `single-character-game-ad.json` | 单人物游戏广告、人物三视图、关键帧、子分镜、片段和最终成片 |
| `character-product-ad.json` | 人物与产品同时锁定、单产品状态路径、人物和产品同时作为参考图 |
| `multi-scene-camera-ad.json` | 多场景、三个 camera setup、人物 front/side/back 和空间参考 |

三个项目均包含：

- 原始用户输入。
- 完整合成 `planJson` 快照。
- front/side/back 三视图记录。
- 边界关键帧记录。
- motion checkpoint 图片记录。
- 视频片段和最终成片记录。
- reference selector 输出。
- prompt debug artifact。
- generation quality report。
- media revision history。

媒体地址统一使用不可联网的 `fixture://` URI。这些快照用于冻结数据结构和生产行为，不冒充真实生成效果，也不会访问外部网络。

## 4. 隐私处理

回归项目全部为人工合成内容，没有从生产数据库导出项目。

自动测试会阻止以下内容进入快照：

- API Key、Secret、Authorization、Bearer Token。
- 用户邮箱和中国大陆手机号。
- HTTP/HTTPS 外部媒体地址。
- OSS 或其他云存储签名参数。

## 5. 已冻结的行为

自动化测试覆盖：

1. person 资产仍然产生 `front / side / back`。
2. 数据库中最新的用户编辑图片提示词仍是编译权威输入。
3. 关键帧、segment、motion checkpoint 和调试区仍有文本撤销入口。
4. keyframe image、micro-shot image、segment clip、final video 仍支持媒体版本回退。
5. 每个媒体对象仍最多保留10个历史版本。
6. 一致性资产没有批准前，普通边界关键帧仍被阻止生成。
7. 三个快照均包含完整生产链所需的基线记录。
8. 三个快照不包含用户数据、密钥或签名 URL。

## 6. 验证结果

```text
npm run test:one-prompt-video
12 tests passed, 0 failed
```

```text
NODE_OPTIONS=--max-old-space-size=8192 npm run build
build passed
```

第一次使用默认 Node 内存运行构建时，Next.js 在静态页面生成阶段的 worker 退出；增加 Node 内存上限后完整构建成功。现有项目仍会输出若干 React Hook ESLint warning，本阶段没有修改这些页面，也没有新增 warning 对应的业务代码。

直接执行 `npx tsc --noEmit` 仍会被两个已有测试文件的 `.ts` 扩展名导入规则阻止：

- `src/lib/disk-usage.test.ts`
- `src/lib/workbench-static-cache.test.ts`

正式 Next.js 构建中的类型检查已经通过，因此这不是阶段0新增测试产生的错误；后续可以单独统一测试 TypeScript 配置。

## 7. 后续阶段约束

从阶段1开始，每次修改一句话成片都必须运行：

```text
npm run test:one-prompt-video
```

任何导致 front/side/back 缺失、用户提示词降级、撤销入口消失、媒体回退失效或资产审核门禁失效的变更，都视为回归，不能进入下一阶段。
