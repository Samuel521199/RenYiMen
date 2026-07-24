import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const plannerPath = path.join(root, "src/services/video-orchestrator/three-stage-planner.ts");
const typesPath = path.join(root, "src/services/video-orchestrator/types.ts");
const outputPath = path.join(root, "docs/one-prompt-video-script-structures-and-system-prompts.md");
const planner = fs.readFileSync(plannerPath, "utf8");
const types = fs.readFileSync(typesPath, "utf8");

const lineOf = (source, offset) => source.slice(0, offset).split(/\r?\n/).length;
const prompts = [];
const promptPattern = /const\s+([A-Z0-9_]+_SYSTEM_PROMPT)\s*=\s*`([\s\S]*?)`;/g;
let promptMatch;
while ((promptMatch = promptPattern.exec(planner))) {
  prompts.push({
    name: promptMatch[1],
    text: promptMatch[2],
    start: lineOf(planner, promptMatch.index),
    end: lineOf(planner, promptPattern.lastIndex),
  });
}

const sourceFile = ts.createSourceFile(typesPath, types, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const typeDeclarations = sourceFile.statements.filter((statement) => {
  if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) return false;
  return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}).map((statement) => ({
  name: statement.name.text,
  text: types.slice(statement.getFullStart(), statement.getEnd()).trim(),
  start: lineOf(types, statement.getFullStart()),
  end: lineOf(types, statement.getEnd()),
}));

const promptRole = {
  JSON_REPAIR_SYSTEM_PROMPT: ["异常修复", "JSON-like 文本", "合法 JSON；不允许新增剧情"],
  STORY_QUALITY_REWRITE_SYSTEM_PROMPT: ["剧情质量重写（当前主流程未调用）", "质量问题 + 当前计划", "从 strategy / beat / storyboard 指定层重写"],
  PLANNING_ARCHITECT_SYSTEM_PROMPT: ["阶段 1：规划架构", "用户创意、时长、画幅、风格、参考图事实", "创意策略、事件、锚点、候选时间轴、planning_manifest"],
  STORYBOARD_ARTIST_SYSTEM_PROMPT: ["阶段 2A：剧情分镜", "planning_manifest + story context", "story beats、证据、分组、storyboard、camera graph、转场"],
  STORY_CONTRACT_REPAIR_SYSTEM_PROMPT: ["阶段 2A 修复", "合同报告 + 原分镜计划", "仅修因果 ID、证据与必需节拍"],
  REFERENCE_FACT_EXTRACTOR_SYSTEM_PROMPT: ["参考图预处理", "最多 9 张图", "客观人物、产品、场景、布局事实"],
  SHOT_DECOMPOSER_SYSTEM_PROMPT: ["阶段 2B：整片拆镜", "规划 + 分镜 + 锚点", "关键帧、片段、render contracts、micro shots、video prompt contract"],
  SHOT_DECOMPOSER_SEGMENT_SYSTEM_PROMPT: ["阶段 2B：逐段拆镜（默认多段路径）", "目标段 + 相邻上下文", "仅目标段及其边界帧、运动/终态合同"],
  PROMPT_DETAILER_SEGMENT_SYSTEM_PROMPT: ["阶段 3：逐段提示词编译", "已通过一镜到底审计的目标段", "目标段图片/视频/子分镜提示词"],
  SPLIT_REPAIR_SYSTEM_PROMPT: ["一镜到底修复", "审计问题 + 原拆镜计划", "简化动作或返回需要拆分的高风险段"],
  PROMPT_DETAILER_SYSTEM_PROMPT: ["阶段 3：整片提示词编译", "合并后的完整 storyboard plan", "所有关键帧、片段、子分镜提示词"],
};

const promptRows = prompts.map((item) => {
  const role = promptRole[item.name] ?? ["—", "—", "—"];
  return `| \`${item.name}\` | ${role[0]} | ${role[1]} | ${role[2]} | ${item.start}–${item.end} |`;
}).join("\n");

const typeRows = typeDeclarations.map((item) =>
  `| \`${item.name}\` | ${item.start}–${item.end} |`,
).join("\n");

const promptAppendix = prompts.map((item, index) => `### A.${index + 1} \`${item.name}\`

源文件：\`src/services/video-orchestrator/three-stage-planner.ts:${item.start}\`

\`\`\`text
${item.text}
\`\`\``).join("\n\n");

const typeAppendix = typeDeclarations.map((item, index) => `### B.${index + 1} \`${item.name}\`

源文件：\`src/services/video-orchestrator/types.ts:${item.start}\`

\`\`\`typescript
${item.text}
\`\`\``).join("\n\n");

const document = `# 一句话成片：剧本拆解结构、系统 Prompt 与 Bug 审计

> 本文由 \`scripts/generate-one-prompt-video-script-reference.mjs\` 从当前源码生成。  
> 审计基准：2026-07-24 当前工作区。代码变化后运行 \`node scripts/generate-one-prompt-video-script-reference.mjs\` 即可刷新原文附录。

## 1. 这套系统到底在做什么

用户输入一句创意、总时长、画幅、风格和可选参考图。系统不会直接把这句话交给视频模型，而是先构造一份可审核、可恢复、可逐段生成的 \`OnePromptVideoPlan\`。

\`\`\`text
参考图（可选）
  → Reference Fact Extractor：只提取客观视觉事实
用户创意 + 时长 + 画幅 + 风格
  → Planning Architect：创意策略、事件、资产锚点、时间轴合同
  → Storyboard Artist：剧情节拍、因果证据、分镜、机位与段间转场
  → Story Contract Gate：验证 beat/event/evidence/segment 引用
  → Asset Contract Gate：验证人物、产品、品牌、场景资产覆盖
  → Shot Decomposer：把每段变成可执行的一镜到底合同
  → Single-Take Audit：阻止段内切镜、跳场、不可达动作
      ↳ 失败时 Split Repair
  → Prompt Detailer：编译边界帧、片段和子分镜提示词
  → Story Quality Gate + Final Story Contract + Plan Validator
  → planJson → PLAN_REVIEW
\`\`\`

默认多段模式会让每个 segment 独立执行“拆镜 → 审计 → 提示词”，可并发、可检查点恢复；单段项目或 \`whole\` 模式走整片拆镜与整片提示词。

## 2. 时间与分段规则

- 项目总时长：3–180 秒。
- 单个 segment：3–15 秒，这是上游视频生成单元，不是整条视频的限制。
- 段数边界：\`ceil(total / 15)\` 到 \`floor(total / 3)\`，模型在范围内按剧情、空间、动作和机位连续性选择。
- 每段内部：一个连续、不切镜的 camera take。
- 段与段之间：允许 hard cut、match cut、dissolve 等最终剪辑转场。
- 边界关键帧：N 个 segment 对应 N+1 个时间轴关键帧；相邻段共享边界。

## 3. 分阶段输入/输出合同

| 阶段 | 主要输入 | 主要输出 | 硬门禁 |
|---|---|---|---|
| Reference Fact Extractor | 参考图 URL | 人物、产品、场景、布局客观事实 | 不得编故事、不得猜图外事实 |
| Planning Architect | user idea、aspect、duration、style、segment bounds、reference facts | creative strategy、narrative events、micro rules、anchor timeline、candidate timeline、planning manifest | 总时长精确相等；每段 3–15 秒；事件/锚点引用合法 |
| Storyboard Artist | planning manifest、story context、必需 story functions | beats、evidence registry、shot grouping、storyboard brief、camera graph、transition plans | 因果引用只能指向更早 beat；payoff 必须有先前证据；CTA 必须晚于 proof/payoff |
| Story Contract Gate | Artist 输出 + 合法 event/segment ID | gate report；必要时修复后的 Artist 输出 | 模板必需节拍、因果和证据引用均合法 |
| Asset Contract Gate | manifest + events + Artist 输出 + reference facts | asset contract、修正后的可见锚点映射 | 硬资产不能被空数组静默删掉 |
| Shot Decomposer | 目标段、相邻段、目标 beats、shot group、转场上下文 | keyframes、segments、render descriptions、micro shots、video prompt contract | 每段必须有合法 \`video_prompt_contract\`；首尾状态物理可达 |
| Single-Take Audit | 完整/目标段拆镜结构 | issues 或通过 | 段内切镜、叠化、瞬移、不可达路径、危险高风险均阻断 |
| Split Repair | audit issues + 原拆镜计划 | 修复后的目标段 | 不得用改写措辞掩盖切镜 |
| Prompt Detailer | 已批准的一镜到底合同 | keyframe/video/micro-shot prompts | 不改故事和时间轴；静态图片不得描述运动过程 |
| Final gates | 归一化后的完整 plan | quality report、validation issues | final story contract 和 generation validator 必须通过 |

## 4. 核心对象关系

\`\`\`text
creativeStrategy
  └─ narrativeEvents
      └─ storyBeats ← evidenceRegistry
          └─ shotGroupingPass
              └─ storyboardBrief
                  └─ timelineBlueprint / candidateTimeline
                      ├─ keyframes (N+1)
                      ├─ segments (N)
                      │   ├─ segmentRenderDescriptions
                      │   │   ├─ startFrameContract
                      │   │   ├─ endFrameContract
                      │   │   ├─ motionContract
                      │   │   ├─ singleTakeContract
                      │   │   └─ videoPromptContract
                      │   └─ microShots
                      └─ finalTransitionPlan (N-1)

consistencyManifest / assetContract / anchorStateTimeline
  └─ 横向约束 events、beats、keyframes、segments、microShots

cameraGraph
  └─ 横向约束机位继承、轴线、空间布局和转场参考图
\`\`\`

## 5. 系统 Prompt 清单

下表是 \`three-stage-planner.ts\` 中全部 11 个系统 Prompt。附录 A 为当前源码原文，不做翻译或删节。

| 常量 | 角色/路径 | 输入 | 输出 | 源码行 |
|---|---|---|---|---|
${promptRows}

注意：

- \`STORY_QUALITY_REWRITE_SYSTEM_PROMPT\` 有完整实现函数，但当前主流程没有调用该重写函数；它属于“存在于源码但当前不执行”的 Prompt。
- 图片/视频生成完成后的视觉质量评估另有 2 个 Prompt，位于 \`generation-quality-evaluator.ts\`，属于生成质检，不属于剧本拆解规划。
- 模型每次收到的是 system Prompt 加动态 user JSON。动态 user JSON 由 \`buildPlanningArchitectContent\`、\`buildShotDecomposerSegmentContent\`、\`buildPromptDetailerSegmentContent\` 等函数生成，不是固定 Prompt 常量。

## 6. 动态 user JSON 的关键内容

### 6.1 Planning Architect

\`\`\`json
{
  "user_idea": "用户原始创意",
  "aspect_ratio": "9:16 | 16:9 | 1:1",
  "duration_seconds": 30,
  "style_preset": "可选",
  "segment_count_min": 2,
  "segment_count_max": 10,
  "segment_duration_min_seconds": 3,
  "segment_duration_max_seconds": 15,
  "reference_facts": {},
  "reference_usage_rule": "参考图只约束身份、产品、场景和风格，不是故事时间轴"
}
\`\`\`

### 6.2 Storyboard Artist

包含 \`user_idea\`、画幅、总时长、归一化后的 \`planning_manifest\`、\`story_design_context\`、模板 ID、模板必需剧情功能、因果字段要求和证据注册要求。

### 6.3 Segment Shot Decomposer

只发送目标段及必要邻域：项目意图、风格、字幕策略、锚点、目标段前后相邻时间轴、目标 storyboard brief、目标 beats、目标 shot group、相关转场、camera graph 和已确认资产。这样减少单次上下文并允许多段并发。

### 6.4 Segment Prompt Detailer

发送目标段、该段已通过审计的拆镜合同、仅由该 worker 负责的 boundary keyframe 编号，以及相邻上下文。共享边界帧只允许一个 worker 产出 Prompt，避免相邻段互相覆盖。

## 7. 归一化、修复、缓存与最终执行

### 7.1 JSON 修复

阶段输出不是合法 JSON 时，会把最多 60,000 字符交给 JSON Repair Prompt。它只能修语法并保守闭合结构，不能新增剧情。

### 7.2 检查点

\`AliyunStoryboardPlannerCheckpoint\` 保存 reference facts、planning、Artist、逐段 Decomposer、审计后段和逐段 Prompt Detailer 结果。当前版本为 2，输入指纹包含用户输入和 \`STORYBOARD_PLANNER_CONTRACT_REVISION\`。Prompt/结构契约升级时必须同步修改 revision 或 checkpoint version。

### 7.3 最终视频 Prompt 的真实来源

Stage 3 的 \`segment.videoPrompt\` 不是最终 provider Prompt 的唯一来源。生成时 \`project-service.ts\` 会优先读取 \`segmentRenderDescription.videoPromptContract\`，用确定性编译器生成 HappyHorse Prompt；老项目没有合同时才走 compatibility contract。这一点对排查“界面 Prompt 和上游实际 Prompt 不一样”尤其重要。

## 8. Bug 审计

### 8.1 本次已修复

| 优先级 | Bug | 证据/影响 | 修复 |
|---|---|---|---|
| P0 | Prompt/结构升级后仍复用旧 checkpoint | 旧指纹只包含用户输入，不包含规划契约版本；新增 \`video_prompt_contract\` 后历史结果可绕过新 Prompt | checkpoint 升级到 v2；指纹加入显式 contract revision |
| P0 | 缓存的 Decomposer/审计结果未重新验证 \`video_prompt_contract\` | 新请求会校验，\`checkpoint_reused\` 分支此前直接放行 | 新鲜结果和复用结果统一执行 \`assertShotPlanVideoPromptContract\` |
| P1 | Split Repair 可能丢失 \`video_prompt_contract\` | Repair Prompt 原先只展示空的 \`segment_render_descriptions\`；代码又会在修复后强校验，模型遗漏时任务失败 | Repair Prompt 与输出 schema 现在要求保留/重建完整合同；修复结果继续执行硬校验 |
| P2 | 非 30 秒项目标题仍显示“30s 短片” | \`deriveTitle\` 把通用后缀写死为 30s | 改为使用实际 \`durationSeconds\` |
| P1 | 一镜到底审计把“禁止切镜”等负面约束误判为切镜指令 | 审计把所有深层字符串拍平，无法区分执行指令和 forbidden/negative 字段 | 已按字段路径审计并排除负面约束；错误信息显示命中路径 |
| P1 | 首个根机位被误判为缺少转场参考 | validator 对不存在父机位的首镜也要求 transition reference | 根机位允许无父级来源；alternate/new setup 仍严格校验 |

### 8.2 仍建议修复

| 优先级 | 问题 | 当前事实 | 建议 |
|---|---|---|---|
| P1 | Story Quality 自动重写是死路径 | \`rewriteStoryPlanUntilQualityPass\` 和对应 Prompt 存在，但主流程只记录 \`deferred_to_pre_shot_contract\`，没有调用；默认 \`ONE_PROMPT_VIDEO_STORY_GATE=off\` | 明确二选一：删除死代码/Prompt，或在 Shot Decomposer 前执行重写并重建下游合同；生产环境至少使用 warn，关键业务使用 strict |
| P1 | checkpoint 版本仍依赖开发者手动维护 | 本次加入 revision 后可失效，但未来改 Prompt 若忘记改 revision，问题会重现 | 构建时对 11 个 Prompt + schema 生成自动 hash，作为 checkpoint fingerprint 一部分 |
| P2 | JSON repair 对超长结果硬截 60,000 字符 | 尾部可能包含 segments/prompts；截断后 Repair 只能“保守闭合”，可能得到语法合法但语义残缺的对象 | 优先要求模型短输出；按 JSON 流增量恢复或重跑原阶段，不对已知被截断内容做语义性恢复 |
| P2 | 审计错误摘要只显示前 5 项 | 多段同时失败时，UI 只展示部分原因，容易误以为只坏了 5 段 | UI 展示总数并支持展开全部 issue；日志保留完整结构 |
| P2 | Prompt 与 schema 规模过大且重复 | Architect/Artist/Decomposer 合计数万字符，多处重复一镜到底、字幕和锚点规则 | 抽出版本化公共合同，阶段 Prompt 仅描述角色增量；以测试保证公共规则全部注入 |
| P2 | 归一化会把缺失/空 micro shots 替换为 fallback | 模型显式返回 \`[]\` 与字段缺失被视为同一种情况，可能隐藏模型判断 | 区分 undefined 与显式空数组；只有兼容旧数据时才使用 fallback，并记录 warning |
| P2 | 默认故事质量门禁关闭 | 结构合同会检查 ID 和引用合法性，但“故事好不好”默认不会阻断 | 为线上广告项目设置 warn/strict，并在审核 UI 显示 score、issue codes、rewrite required |

## 9. 给评审人的最短检查清单

1. 时间轴总和是否等于用户要求的总时长，每段是否 3–15 秒。
2. payoff 是否有更早的 trigger/proof/evidence，CTA 是否在 payoff 之后。
3. 每个可见人物、产品、品牌、场景是否有资产锚点或明确 exclusion。
4. 每个 segment 的首尾帧是否在同一空间和机位族内物理可达。
5. segment 内是否出现切镜、换场、蒙太奇、叠化、瞬移或大幅构图重置。
6. \`video_prompt_contract\` 是否包含至少一个 hard terminal requirement，且没有重复/超预算条目。
7. 页面展示的 Prompt、debug artifact 的 compiled Prompt、实际 provider 请求是否一致。
8. 失败重试时是否复用了同一 contract revision 下的有效 checkpoint，而不是旧版本缓存。

## 10. TypeScript 结构索引

附录 B 收录 \`types.ts\` 中全部导出的 type/interface 原文，以下是源码位置索引。

| 类型 | 源码行 |
|---|---|
${typeRows}

---

## 附录 A：全部系统 Prompt 原文

${promptAppendix}

---

## 附录 B：全部导出数据结构原文

${typeAppendix}
`;

fs.writeFileSync(outputPath, document, "utf8");
console.log(`Generated ${path.relative(root, outputPath)} with ${prompts.length} prompts and ${typeDeclarations.length} exported type declarations.`);
