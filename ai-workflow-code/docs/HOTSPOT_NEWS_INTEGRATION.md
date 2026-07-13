# 热点新闻对接设计文档

> 当前阶段：本地 JSON 文件交接（MVP）
> 文档版本：V1
> 对应开发规范：`docs/热点借势工作流开发规范.md`

---

## 一、整体架构

```text
新闻热点工作台
    ↓ 每日定时导出
    ↓ hotspot_tasks.json
    ↓
HotspotImportService（图片工作台后端）
    ↓ 校验 + 转换
    ↓
trending_news_tasks 表
    ↓
/workflows/trending-news（前端选热点）
    ↓
生成/精修/归档（复用 trending_workflows.py）
    ↓
成品图库「热点借势」
```

---

## 二、当前 MVP 实现（本地 JSON）

### 2.1 文件路径约定

```text
/Volumes/AIWork/projects/shared/news_hotspots/YYYY-MM-DD/hotspot_tasks.json
```

### 2.2 标准 JSON 结构

```json
{
  "schema_version": "1.0",
  "export_time": "2026-05-04 18:30:00",
  "source_system": "news_hotspot_workbench",
  "items": [
    {
      "task_id": "news_20260504_001",
      "title": "Gilas Pilipinas wins key match",
      "publish_time": "2026-05-04 10:30:00",
      "topic_type": "SPORTS_EVENT",
      "event_summary": "一句话摘要",
      "main_entities": ["Gilas Pilipinas", "basketball fans"],
      "event_action": "won a key match",
      "event_result": "fans are celebrating online",
      "emotion_direction": "HYPE",
      "risk_tags": ["NONE"],
      "local_relevance": "本地相关性说明",
      "source_name": "Rappler",
      "source_url": "https://example.com/news"
    }
  ]
}
```

### 2.3 导入服务

- 文件：`backend/app/services/hotspot_import_service.py`
- 路由：`backend/app/routers/hotspot_import.py`
- 上传端点：`POST /api/hotspot/import`
- 列表端点：`GET /api/hotspot/tasks`
- 详情端点：`GET /api/hotspot/tasks/{id}`

### 2.4 前端工作流

- 路由：`/workflows/trending-news`
- Step 1：从导入列表选热点（替代手动输入）
- Step 2 起：复用 trending 工作流逻辑

### 2.5 两个工作流并行

| 工作流 | 路由 | 适用场景 |
|--------|------|----------|
| 手动热点 | `/workflows/trending` | 新闻推送缺失时手动填写 |
| 新闻推送 | `/workflows/trending-news` | 新闻工作台每日推送 |

---

## 三、topic_type 枚举（完整版）

MVP 已实现5种，需扩展至12种：

| code | 说明 | 风险默认 |
|------|------|----------|
| BREAKING_NEWS | 突发新闻 | HIGH |
| SPORTS_EVENT | 体育赛事 | LOW |
| ENTERTAINMENT | 娱乐热点 | LOW |
| SOCIAL_TOPIC | 社会议题 | MEDIUM |
| HOLIDAY_EVENT | 节日事件 | LOW |
| POLITICS_GOVERNMENT | 政治政府 | HIGH |
| CRIME_ACCIDENT | 犯罪事故 | HIGH |
| DISASTER_EMERGENCY | 灾难紧急 | HIGH |
| ECONOMY_BUSINESS | 经济商业 | MEDIUM |
| TECH_GAMING | 科技游戏 | LOW |
| PUBLIC_FIGURE | 公众人物 | MEDIUM |
| VIRAL_TREND | 病毒传播趋势 | LOW |

## 四、risk_tags 枚举

```text
NONE / DEATH / INJURY / DISASTER / CRIME /
POLITICS / RELIGION / LEGAL / MINOR / SEXUAL /
HATE / PUBLIC_FIGURE / FINANCIAL_RISK / MEDICAL / MISINFORMATION_RISK
```

**risk_tags 覆盖规则：**
- `topic_type` 提供默认风险等级
- `risk_tags` 包含 `DEATH / INJURY / DISASTER / CRIME / POLITICS / RELIGION / LEGAL / MINOR / SEXUAL / HATE` 时强制升级为 `HIGH`，禁止游戏结合
- `risk_tags = [NONE]` 时使用 topic_type 默认值

---

## 五、Prompt 富字段使用

新闻推送工作流相比手动工作流，Prompt 更丰富：

```python
# 手动工作流（trending）
prompt 输入：title + selected_angle + selected_action

# 新闻推送工作流（trending-news）
prompt 输入：title + event_summary + main_entities +
            event_action + event_result + emotion_direction +
            selected_angle + selected_action
```

---

## 六、去重规则

导入时按以下优先级去重：
1. `task_id` 完全匹配 → 跳过
2. `title + publish_time` 组合匹配 → 跳过
3. `source_url` 匹配 → 跳过

---

## 七、线上升级路径（预备说明）

### 阶段 1（当前）：本地 JSON 文件
```text
新闻工作台导出 JSON → 手动放到共享目录 → 图片工作台导入
```

### 阶段 2：本地 HTTP API
```text
新闻工作台提供 localhost API
图片工作台通过 API 拉取
```
**改动范围：** 只新增 `ApiHotspotAdapter`，`HotspotImportService` 和业务层不变

### 阶段 3：线上 API
```text
新闻系统线上服务 → 图片工作台线上服务
```
**新增：** API 鉴权、分页、状态同步、重试机制

### 阶段 4：数据库 / 队列
```text
新闻热点任务入库 → 图片工作台消费任务
```
适合多人协作和自动化生产

**核心原则：升级时只替换 Adapter，不改 Prompt 生成和风控逻辑。**

---

## 八、线上升级时图片工作台需改动的文件

| 文件 | 改动内容 |
|------|----------|
| `backend/app/services/hotspot_import_service.py` | 新增 `ApiHotspotAdapter` / `DatabaseHotspotAdapter` |
| `backend/app/routers/hotspot_import.py` | 新增定时拉取端点或 webhook 接收端点 |
| `backend/app/models/trending_news.py` | 新增 `import_status` / `process_status` 状态字段 |
| `frontend/app/workflows/trending-news/page.tsx` | Step 1 改为实时从 API 拉取，加状态过滤 |

**不需要改动的文件：**
- `backend/app/routers/trending_workflows.py`
- `backend/app/services/trending_prompt.py`
- `backend/app/models/trending.py`
- `frontend/app/workflows/trending/page.tsx`

---

## 九、新闻工作台导出要求

新闻工作台导出时必须：
1. 按第 2.2 节 JSON 结构导出
2. `topic_type` 必须为第三节枚举值之一
3. `risk_tags` 必须为第四节枚举值之一或多个
4. `task_id` 格式建议：`news_YYYYMMDD_NNN`
5. 输出路径：`/Volumes/AIWork/projects/shared/news_hotspots/YYYY-MM-DD/hotspot_tasks.json`
