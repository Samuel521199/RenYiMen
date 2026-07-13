# 新工作流开发规范 Checklist

> 每次新建工作流前必读。所有条目均来自实际开发踩坑总结。
> 开发完成后逐项打勾验证，全部通过才可进入业务测试。

---

## 一、后端必查项

### 1. 参考图接入
- [ ] `generate` 路由接收 `reference_asset_ids: list[int]`
- [ ] 路由内实现 `resolve_reference_image_urls` 函数，将 asset id 查库转为完整 URL（最多4张）
- [ ] `ai_gateway.generate_image` 调用时将 `reference_image_urls` 作为**第三个独立参数**传入，不能只放在 `ImageGenerateRequest` 对象里
- [ ] 验证：生成后 `docker-compose logs backend | grep "ref_images"` 确认值 ≥ 1

```python
# 标准实现
async def resolve_reference_image_urls(db, reference_asset_ids):
    if not reference_asset_ids:
        return []
    selected_ids = reference_asset_ids[:4]
    result = await db.execute(select(Asset).where(Asset.id.in_(selected_ids)))
    assets_by_id = {asset.id: asset for asset in result.scalars().all()}
    return [
        assets_by_id[aid].url
        for aid in selected_ids
        if aid in assets_by_id and assets_by_id[aid].url
    ]

# 调用方式（第三个参数必须显式传入）
generation = await ai_gateway.generate_image(db, generation_request, reference_image_urls)
```

### 2. 成品图库归档
- [ ] qc/archive 路由写入 `FinalImage` 表
- [ ] `source_type` 必须与 `backend/app/routers/gallery.py` 的 `SOURCE_TYPES` 里的 `code` **完全一致**，上线前先查：
  ```python
  SOURCE_TYPES = [
      {"code": "activity", "label": "活动图"},
      {"code": "share",    "label": "转发图"},
      {"code": "daily",    "label": "日常互动图"},
      {"code": "trending", "label": "热点借势"},
      {"code": "brand",    "label": "品牌故事"},
      {"code": "game",     "label": "游戏感知"},
  ]
  ```
- [ ] 同步更新 `GalleryTag` 的 `image_count`（存在则 +1，不存在则新建）
- [ ] 验证：归档后执行 `SELECT source_type, COUNT(*) FROM final_images GROUP BY source_type` 确认有数据

### 3. 生成接口超时
- [ ] 前端调用生成接口必须传第三个参数 `120000`（120秒）
- [ ] 禁止依赖默认 30 秒超时：`apiPost(url, body, 120000)`
- [ ] 验证：Network 面板确认请求未被 cancel，状态码为 200

### 4. Session 状态管理
- [ ] `generate` 路由不得用硬编码 JSON 字符串覆盖 session 的 `state_json`（会丢失前端完整状态）
- [ ] qc 归档完成后必须把 session `status` 改为 `completed`
- [ ] 验证：归档后 `/workflows` 任务列表该 session 出现在「已完成」而非「草稿」

### 5. 图片文字语言约束
- [ ] prompt 末尾必须包含语言约束，不加时模型会根据输入语言自动判断（中文输入 → 中文图片文字）
- [ ] 标准写法：
  ```python
  language_map = {
      "english": "English only",
      "taglish": "Taglish (Tagalog-English mix) only",
      "chinese": "Chinese (Simplified) only",
  }
  lang_label = language_map.get(job.image_language or "english", "English only")
  parts.append(f"IMPORTANT: All text visible in the image must be in {lang_label}.")
  parts.append("The image is for Filipino Facebook audience. Keep all on-image text casual and short.")
  ```

### 6. source_type 一致性（数据库）
- [ ] 写入 `final_images` 的 `source_type` 与 `SOURCE_TYPES code` 完全一致
- [ ] 新增 source_type 时同步更新 `gallery.py SOURCE_TYPES`
- [ ] 历史数据补录 SQL 单独维护，格式参考：
  ```sql
  INSERT INTO final_images (task_id, image_url, source_type, sub_category, created_by, created_at)
  SELECT j.task_id, j.generated_image_url, 'daily', t.template_type, j.created_by, j.updated_at
  FROM {workflow}_jobs j
  LEFT JOIN {workflow}_templates t ON t.id = j.template_id
  WHERE j.status IN ('archived', 'done')
    AND j.generated_image_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM final_images f
      WHERE f.image_url = j.generated_image_url AND f.source_type = 'daily'
    );
  ```

---

## 二、前端必查项

### 7. 多图生成
- [ ] Step 5 支持出图数量选择（1-4张，默认2张）
- [ ] 生成逻辑：循环调用 N 次，每完成一张立即 append，不等全部完成
- [ ] 生成中显示进度「生成中 N/total…」
- [ ] 支持重新生成（清空已有结果重新开始）

### 8. 参考图选择
- [ ] Step 4 包含参考图选择区块，从素材库选择角色参考图
- [ ] 选择结果存入 `workflowState.referenceAssetIds`
- [ ] generate payload 必须带 `reference_asset_ids`
- [ ] 支持标签筛选 + 多选 + 右侧已选预览

### 9. 图片尺寸选择
- [ ] 支持三种尺寸：FB 方图（1080x1080）/ TikTok 竖版（1080x1920）/ FB 横版（1080x566）
- [ ] `adSize` 存入 workflowState，generate payload 带 `size` 字段
- [ ] 默认值：`1080x1080`

### 10. 图片语言选择
- [ ] Step 3 包含语言选择（English / Taglish / 中文）
- [ ] 存入 `workflowState.imageLanguage`，Job 创建时带入 payload
- [ ] 默认值：`english`

### 11. 逐图审核（Step QC）
- [ ] 每张图独立操作：归档 / 发回精修 / 删除
- [ ] 图片状态：`pending / archived / refine / deleted`
- [ ] 完成条件：无 `pending/refine`，且至少1张 `archived`
- [ ] 已归档区单独展示，支持「撤回」回 pending
- [ ] 完成时显示完成面板 + 「查看成品图库」+ 「继续生产」按钮

### 12. 图片精修
- [ ] 每张图下方有独立精修输入框 + 精修按钮
- [ ] 精修完成后替换该位置图片，`reviewStatus` 重置为 `pending`
- [ ] 发回精修的图在生成步骤高亮显示黄色边框 + 「待精修」badge
- [ ] 生成步骤顶部有「返回审核」按钮

### 13. 模型选择位置
- [ ] 模型选择器只出现在**生成步骤**，不出现在配置步骤
- [ ] 使用共享 `ModelSelector` 组件

### 14. 自动保存草稿
- [ ] 每次切换步骤自动调用 autoSave
- [ ] 每张图生成完成后自动保存
- [ ] autoSave 成功后必须将返回的 `session_id` 写回 `workflowState.sessionId`（否则每步新建 session）
- [ ] Step QC 归档完成后 autoSave 传入 `status: "completed"`

### 15. Session 恢复
- [ ] 支持 `?session_id=` URL 参数
- [ ] 恢复时合并 state_json，跳到保存时的步骤
- [ ] 恢复中显示 loading 态
- [ ] 恢复失败时 inline 报错并回退到 Step 1 空白态

### 16. 枚举字段自定义
- [ ] 牛动作、背景、颜色等枚举字段不能写死，从数据库加载
- [ ] 支持「+ 自定义」入口，输入 value（英文，传给 AI）+ label_zh（中文，界面显示）
- [ ] 保存到对应配置表，成功后刷新列表并自动选中新选项
- [ ] 每类配置独立一张表：`{workflow}_bull_actions` / `{workflow}_backgrounds` / `{workflow}_color_moods`

### 17. 草稿清理
- [ ] 测试阶段产生的垃圾 session 上线前清理
- [ ] 清理前先查关联 job，保留有 job 关联的 session：
  ```sql
  SELECT ws.id, ws.current_step, j.id as job_id
  FROM workflow_sessions ws
  LEFT JOIN {workflow}_jobs j ON j.session_id = ws.id
  WHERE ws.workflow_type = '{workflow}' AND ws.status = 'draft'
  ORDER BY ws.created_at DESC;
  ```

---

## 三、模型兼容性

### 18. Gemini 模型
- [ ] Gemini 模型与部分工作流不兼容，使用前需单独验证
- [ ] 当前已验证可用：OpenAI GPT Image 系列
- [ ] 新工作流上线前用 Gemini 跑一次生成，确认是否报错

---

## 四、新工作流上线前验证清单

```bash
# 1. 后端测试
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests
# 期望：全部 pass，数量 ≥ 上次

# 2. 前端构建
cd frontend && npm run build
# 期望：构建成功，routes 数量正确

# 3. 容器重建
docker-compose up -d --build backend
docker-compose build --no-cache frontend && docker-compose up -d frontend

# 4. HTTP smoke
curl -s -o /dev/null -w "%{http_code}" http://localhost:3010/workflows/{new-workflow}
# 期望：200

# 5. 参考图验证
# 生成一张图后：
docker-compose logs backend --tail 5 | grep "ref_images"
# 期望：ref_images ≥ 1

# 6. 成品图库验证
# 归档后：
docker-compose exec db psql -U ai_workbench -d ai_workbench -c \
  "SELECT source_type, COUNT(*) FROM final_images GROUP BY source_type;"
# 期望：新 source_type 有数据

# 7. Session 验证
# 完成归档后进 /workflows，确认该 session 在「已完成」
```
