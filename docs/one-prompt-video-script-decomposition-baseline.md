# 一句话成片剧本拆解基线样本与验收清单

本文对应 `one-prompt-video-script-decomposition-execution-plan.md` 的阶段 A。  
用途是固定后续重构期间的测试输入、预期结构和验收方式，避免每次只凭单个临时案例判断 planner 好坏。

## 1. 使用方式

每次改动剧本拆解、参考图选择、关键帧生成、视频 prompt 编译或最终合成逻辑后，至少跑 2 个样本；合并到主分支前建议跑完 6 个样本。

建议记录到 `reports/one-prompt-video-baseline/`，每次一份目录：

```text
reports/one-prompt-video-baseline/
  2026-07-17-v2-shadow/
    01-guofeng-skincare/
      input.md
      plan.json
      log.jsonl
      screenshots/
      notes.md
```

每个样本至少保留：

- 用户输入 prompt。
- 参考图数量和用途。
- 生成后的 `planJson`。
- 对应 `one-prompt-video.log` 片段。
- 关键帧审核页截图。
- 分镜审核页截图。
- 最终视频 prompt 抽样。
- 人工验收结论。

## 2. 固定测试样本

### 01. 国风护肤品广告

输入 prompt：

```text
做一条 30 秒国风护肤品广告，年轻东方女性在中式庭院中使用一瓶青瓷色精华，画面高级、安静、产品和人物从头到尾一致，最后出现产品定格展示。
```

参考图建议：

- 产品瓶身或包装参考图 1 张。
- 女主角参考图 1 张。
- 中式庭院或品牌视觉参考图 1-2 张。

期望 anchor：

- `protagonist_woman`：人物身份、脸型、发型、服装颜色、服装长短、花纹必须一致。
- `hero_skincare_bottle`：瓶身颜色、瓶型、盖子、标签位置、品牌视觉必须一致。
- `courtyard_layout`：庭院结构、石桌、门窗、竹子或植物位置应贯穿。
- `brand_visual_style`：国风、高级、低饱和、柔光。

期望 narrative events 数量：4-5。  
期望 segment 数量范围：5-7。  
最容易失败的点：

- 产品瓶身在不同镜头变形或换颜色。
- 女主服装袖长、花纹、发型变化。
- 一个 segment 内同时完成拿起产品、涂抹、特写展示，导致不是一镜到底。
- 字幕被图片或视频模型直接画进画面。

### 02. 游戏广告

输入 prompt：

```text
如图这个休闲卡牌游戏，我要做一个 30 秒广告宣传片，要求引人入胜，画面精良，前后主角、Logo、卡牌和游戏桌面保持一致，突出游戏简单好玩和胜利反馈。
```

参考图建议：

- 游戏 Logo 或主视觉 1 张。
- IP 角色参考图 1 张。
- 游戏桌面、卡牌或真实界面 1-2 张。

期望 anchor：

- `ip_mascot`：角色物种、体型、表情风格、帽子、外套、围巾、徽章等必须一致。
- `game_logo`：Logo 字体、颜色、图形元素必须一致。
- `card_set`：卡牌花色、尺寸、桌面摆放逻辑保持一致。
- `game_table_or_ui`：桌面形状、筹码、按钮、界面布局保持一致。

期望 narrative events 数量：4-6。  
期望 segment 数量范围：5-7。  
最容易失败的点：

- IP 角色毛色、服装或帽子变化。
- Logo 在不同帧中变字、变形或缺失。
- 卡牌数量和桌面布局无理由跳变。
- 游戏界面和现实桌面混乱切换。

### 03. 餐饮广告

输入 prompt：

```text
做一条 30 秒新中式餐饮广告，展示一家小店的招牌牛肉面，从厨师备餐、热汤浇入、牛肉铺面到顾客品尝，菜品诱人，门店和主厨形象保持一致。
```

参考图建议：

- 招牌菜品参考图 1 张。
- 门店环境参考图 1 张。
- 厨师或品牌服装参考图 1 张。
- 品牌色或菜单风格参考图 1 张。

期望 anchor：

- `hero_dish`：碗型、汤色、牛肉片、葱花、辣油、摆盘必须一致。
- `storefront_or_counter`：门店招牌、柜台、灯光和空间布局保持一致。
- `chef`：主厨服装、围裙、发型、动作风格保持一致。
- `steam_and_heat_state`：热气是合法动态状态，必须从出餐到上桌自然演进。

期望 narrative events 数量：4-5。  
期望 segment 数量范围：5-7。  
最容易失败的点：

- 菜品从牛肉面变成其他面或汤色变化。
- 厨师服装和门店装修跳变。
- 热气、浇汤、上桌状态没有连续路径。
- 食物特写和人物品尝被塞进同一个 segment，导致内部切镜。

### 04. 汽车广告

输入 prompt：

```text
做一条 30 秒新能源汽车广告，一辆银灰色 SUV 从城市清晨出发，驶上海边公路，展示外观、内饰和智能驾驶氛围，车辆外观、车牌位置、灯带和场景路线保持一致。
```

参考图建议：

- 车辆外观参考图 1 张。
- 内饰或中控参考图 1 张。
- 城市道路或海边公路参考图 1-2 张。

期望 anchor：

- `hero_car`：车型、车身颜色、灯带、轮毂、车牌区域、车顶线条必须一致。
- `driver`：如出现驾驶员，人物身份和服装保持一致。
- `route_context`：城市清晨到海边公路是合法场景进展，但每个 segment 内地点必须单一。
- `dashboard_ui`：中控屏、方向盘、氛围灯保持一致。

期望 narrative events 数量：4-6。  
期望 segment 数量范围：5-8。  
最容易失败的点：

- 车辆型号、颜色、灯带变化。
- 城市和海边在同一个 segment 内突然切换。
- 外观镜头和内饰镜头被混入同一段，破坏一镜到底。
- 尾帧被误当成 HappyHorse 的硬输入。

### 05. 无人物产品展示

输入 prompt：

```text
做一条 30 秒智能香薰机产品展示广告，没有人物，产品在现代客厅和桌面上展示，突出开机、灯光、雾化和摆放质感，产品外观和空间风格保持一致。
```

参考图建议：

- 产品外观参考图 1-2 张。
- 客厅或桌面空间参考图 1 张。
- 品牌色或材质参考图 1 张。

期望 anchor：

- `hero_diffuser`：产品形状、材质、按键、出雾口、灯带颜色必须一致。
- `living_room_table`：桌面材质、背景家具、灯光方向保持一致。
- `mist_state`：雾化从无到有是合法动态状态，需要写入状态时间线。
- `light_state`：灯光颜色可以按剧情变化，但不能随机跳色。

期望 narrative events 数量：3-5。  
期望 segment 数量范围：4-6。  
最容易失败的点：

- 模型误加人物。
- 产品外观和尺寸变化。
- 出雾状态没有连续变化，突然出现大量雾。
- 灯光颜色在不同帧无理由变化。

### 06. 无产品剧情短片

输入 prompt：

```text
做一条 30 秒雨夜剧情短片，没有产品，一位年轻男子在图书馆门口等人，女主撑伞出现，两人相视一笑后一起走入暖光室内，人物、伞、雨夜街景和图书馆入口保持一致。
```

参考图建议：

- 男主或女主角色参考图 1-2 张。
- 雨夜图书馆入口参考图 1 张。
- 情绪和光影风格参考图 1 张。

期望 anchor：

- `male_lead`：男主脸型、发型、外套颜色和长度保持一致。
- `female_lead`：女主脸型、发型、伞和外套保持一致。
- `umbrella`：伞的颜色、形状、握持状态保持一致。
- `library_entrance`：门口台阶、灯光、玻璃门、街景雨水保持一致。

期望 narrative events 数量：4-5。  
期望 segment 数量范围：5-7。  
最容易失败的点：

- 没有产品时仍强行生成产品 anchor。
- 两个人物身份混淆。
- 雨夜外景和暖光室内在一个 segment 内突变。
- 伞的位置和持有人无理由变化。

## 3. 固定验收指标

### 3.1 拆解结构验收

每个样本都检查：

- 三阶段拆解可以完成，不降级为本地保底分镜。
- `planJson` 能被旧项目读取逻辑兼容，不导致审核页崩溃。
- Stage 1 能解释任务类型、核心一致性元素、字幕需求和候选时间线。
- Stage 1 不把产品、人物、场景写死为固定类别，而是能根据任务发现额外一致性元素。
- 复杂状态变化进入动态状态时间线，而不是被误判为一致性漂移。
- Segment 数量和时长符合样本期望范围。

### 3.2 生成链路验收

每个样本至少抽查：

- 一致性 anchor 图先于普通关键帧生成。
- 普通关键帧引用的是已经完成的 anchor 参考图。
- 单段视频 prompt 不包含 `hard_cut`、`dissolve`、`match_cut` 等段内转场许可词。
- HappyHorse 只接收首帧硬输入；尾帧只作为文字软目标进入 prompt。
- 字幕由后期 overlay/burn-in 处理，不要求图片或视频模型在画面里生成字幕字形。
- 参考图数量不超过模型限制，且每张参考图用途清晰。

### 3.3 UI 验收

每个样本至少检查：

- 中文界面下用户可见文本、子分镜字段、提示词字段尽量保持中文。
- 英文界面下用户可见文本、子分镜字段、提示词字段尽量保持英文。
- 用户可以编辑字幕、关键帧、子分镜参考图和视频 prompt。
- 子分镜图片可以预览放大。
- 已生成项目可以继续生成、停止生成和回退审核。

### 3.4 命令验收

每批改动后运行：

```bash
git diff --check
npx tsc --noEmit --pretty false --allowImportingTsExtensions
```

## 4. 固定日志检查点

### 4.1 当前已有日志事件

当前代码已经能记录这些事件，可直接用于阶段 A：

- `aliyun.storyboard.three_stage.start`
- `aliyun.storyboard.planning_architect.request`
- `aliyun.storyboard.planning_architect.response`
- `aliyun.storyboard.storyboard_writer.request`
- `aliyun.storyboard.storyboard_writer.response`
- `aliyun.storyboard.prompt_detailer.request`
- `aliyun.storyboard.prompt_detailer.response`
- `aliyun.storyboard.three_stage.parsed`
- `image.submit.wait_consistency_references`
- `image.submit.batch`
- `aliyun.image.submit.prepare`
- `aliyun.i2v.submit.prepare`
- `clip.submit.batch`
- `compose.local.subtitles.prepare`
- `compose.local.subtitles.success`

阶段 A 验收时，至少要能从日志里看出：

- planner 使用了哪个文本模型和视觉理解模型。
- 三阶段是否都成功返回。
- 规划后有多少 anchor、keyframe、segment。
- 是否因为一致性参考图未完成而等待普通关键帧提交。
- 视频生成时使用的是 HappyHorse 首帧输入。
- 字幕是否进入本地合成烧录。

### 4.2 后续阶段必须补齐的日志事件

阶段 B 以后逐步补齐：

- `planner.stage1.normalized`
- `planner.stage2a.normalized`
- `planner.stage2b.normalized`
- `reference_selector.candidates`
- `reference_selector.selected`
- `prompt_compiler.video_prompt`
- `prompt_compiler.image_prompt`
- `single_take_audit.result`
- `split_repair.result`
- `quality_report.result`

## 5. 人工记录模板

```markdown
# 样本编号：

## 输入

- Prompt：
- 参考图：
- 语言：
- 模式：v1 / v2_shadow / v2

## Planner 结果

- Anchor 数量：
- Narrative events 数量：
- Segment 数量：
- 是否需要字幕：
- 是否出现非预期产品/人物/场景：

## 一致性检查

- 人物：
- 产品：
- 场景：
- 道具/Logo/车辆/菜品等：
- 动态状态是否合理：

## 一镜到底检查

- 高风险 segment：
- 是否包含段内转场词：
- 是否需要拆分：

## 参考图检查

- Anchor 图是否先生成：
- 普通关键帧是否引用 anchor 图：
- 参考图选择是否冲突：

## 最终结论

- 通过 / 不通过：
- 必须修复：
- 可后续优化：
```

