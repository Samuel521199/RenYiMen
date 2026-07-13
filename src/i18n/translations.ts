/** 全量 UI 翻译字典 */
export const translations = {
  zh: {
    // ── 品牌 / 顶部导航 ──
    brandName: "创作工作室",
    brandBadge: "Beta",
    navAiStudio: "AI 创作",
    navWorkbench: "社媒工作台",
    pageTitle: "AI 创作工作室",
    pageSubtitle: "选择创作功能，上传素材，一键生成高质量 AI 内容",

    // ── Auth 区 ──
    loading: "加载中…",
    loginHint: "请登录后开始创作",
    registerBtn: "注册",
    loginBtn: "登录",
    signOutBtn: "退出",
    signIn: "登录",
    defaultUserName: "用户",

    // ── 磁盘容量 ──
    diskUsageLabel: "磁盘",
    diskUsageUnavailable: "磁盘容量暂不可用",
    diskUsageNormalTip: (path: string, free: string, total: string) =>
      `素材存储所在磁盘：${path}\n可用 ${free} / 共 ${total}`,
    diskUsageWarningTip: (free: string, total: string) =>
      `磁盘使用率已超过 80%（剩余 ${free} / ${total}）。建议清理旧素材/成品图，或扩容云盘。`,
    diskUsageCriticalTip: (free: string, total: string) =>
      `磁盘即将用尽（剩余 ${free} / ${total}）！请立即清理旧图片或升级阿里云硬盘，避免上传失败。`,

    // ── SKU 选择 ──
    selectFunction: "选择创作功能",
    selectFunctionHint: "请先选择一项创作功能以加载参数表单",
    catalogLoading: "加载工作流列表失败",
    catalogEmpty: "暂无可用功能，请联系管理员。",
    categoryPrompt: "提示词",
    categoryImage: "图片",
    categoryVideo: "视频",
    categoryEmpty: "该分类暂无可用功能",
    credits: "积分",

    // ── 表单操作 ──
    errFixFields: "请修正以下问题",
    submitBtn: "立即生成",
    submitBtnUploading: "上传中…",
    submitBtnSubmitting: "提交中…",
    autoSaveToAssetToggle: "生成完成后自动保存到素材库",
    autoSaveToAssetHint: "图片/视频会按工作流类型自动分类入库，并附带任务标签",
    autoSaveSaving: "正在自动入库…",
    autoSaveNoResult: "未解析到可入库结果，已跳过自动入库",
    autoSaveDone: (count: number) => `已自动入库 ${count} 个结果`,
    autoSavePartial: (saved: number, failed: number) => `自动入库完成：成功 ${saved}，失败 ${failed}`,
    autoSaveFailed: (reason: string) => `自动入库失败：${reason}`,
    resetBtn: "清空",
    closeTaskBtn: "关闭任务",
    estimateCreditsDynamic: (credits: number, sec: number, pps: number) =>
      `预计消耗约 ${credits.toLocaleString("zh-CN")} 积分（${sec}s × ${pps}，以实际结算为准）`,
    estimateCreditsFixed: (credits: number) =>
      `预计消耗约 ${credits} 积分（以实际结算为准）`,

    // ── 提交错误 ──
    errSelectSku: "请先选择一项创作功能",
    errIncomplete: "信息不完整，请检查必填项与图片是否已上传完成",
    errMissingSku: "请先在左侧重新选择一项创作功能，再点击生成",
    errServerAbnormal: "服务器返回异常，请稍后重试",
    errHttpFail: (status: number) => `提交失败（HTTP ${status}）`,
    errUnauthorized: "未登录",
    errLoginRequired: (msg: string) => `${msg}：请点击页面上方「登录」后重试。`,
    errNoTaskId: "未收到任务编号，请稍后重试或联系管理员",
    errNetwork: "网络异常",
    errConcurrentLimit: "您有过多正在进行的任务，请等待当前任务完成后再提交",
    errDbWriteFailed: (taskId: string) => `任务已提交但记录写入失败，请联系管理员（taskId: ${taskId}）`,

    // ── 积分组件 ──
    creditsLabel: "积分",
    creditsTooltip: "当前积分余额（任务完成后会立即同步，其余时间定时刷新）",

    // ── TaskStatusViewer ──
    idleWaiting: "等待生成任务…",
    idleHint: "在左侧配置参数并点击「生成」，任务进度与结果将显示于此画板。",
    statusQueued: "排队中",
    statusGenerating: "生成中",
    subtitleQueued: "任务已进入队列，即将分配算力…",
    subtitleGenerating: "上游未提供细粒度进度，下方进度为根据预计耗时的平滑估算。",
    progressElapsed: "已耗时",
    progressEstimated: "预计",
    progressPct: (pct: number) => `约 ${Math.round(pct)}%（预估，完成后将显示 100%）`,
    progressRendering: "正在渲染光影帧…",
    successLabel: "生成成功",
    successPrompt: "提示词已生成",
    successNoPreview: "预览地址缺失",
    successImage: "图片已就绪",
    successVideo: "视频已就绪",
    noPreviewUrl: "未提供预览地址",
    downloadBtn: "下载",
    downloadingBtn: "正在准备下载…",
    regenerateBtn: "重新生成",
    retryBtn: "使用相同参数重试",
    billingDone: (credits: number) => `✅ 任务完成，实扣 ${credits} 积分`,
    failureLabel: "生成失败",
    failureTitle: "未能完成本次任务",
    failureDefault: "发生未知错误，请稍后重试。",
    failureParamsTitle: "您刚才提交的参数（可对照修改后重试）",
    noResultParsed: "成功但未解析到可用的图片或视频地址",

    // ── DynamicForm ──
    fieldGroupUnknown: "参数组",

    // ── ImageUploadControl ──
    uploadNoPreview: "暂无预览",
    uploadSelectBtn: "选择图片",
    uploadChangeBtn: "更换图片",
    uploadClearBtn: "清除",
    uploadFromAssetLibraryBtn: "从素材库选择",
    uploadUploading: "正在上传至云端...",
    uploadWait: "请稍候，上传完成前无法提交生成",
    uploadFailed: "上传失败，点击重新上传",
    uploadFailedRetry: "上传失败",
    uploadFileName: (name: string) => `已选：${name}`,
    uploadRemoteUrl: (url: string) => `远端：${url}`,
    uploadZoomHint: "点击放大观看",

    // ── TextResultDisplay ──
    textResultTitle: "生成的提示词",
    textCopyBtn: "复制",
    textCopied: "已复制",
    textDownloadBtn: "下载 .txt",

    // ── 历史记录 ──
    historyAlt: "历史记录",

    // ── 画廊视图 ──
    backToGallery: "← 返回",
    startCreating: "开始创作",
    gallerySkeletonAlt: "加载中",
    allCategory: "全部",
  },

  en: {
    // ── Brand / Top Nav ──
    brandName: "Studio",
    brandBadge: "Beta",
    navAiStudio: "AI Studio",
    navWorkbench: "Workbench",
    pageTitle: "AI Creation Studio",
    pageSubtitle: "Choose a workflow, upload your assets, and generate high-quality AI content in one click.",

    // ── Auth ──
    loading: "Loading…",
    loginHint: "Sign in to start creating",
    registerBtn: "Register",
    loginBtn: "Sign In",
    signOutBtn: "Sign Out",
    signIn: "Sign In",
    defaultUserName: "User",

    diskUsageLabel: "Disk",
    diskUsageUnavailable: "Disk usage unavailable",
    diskUsageNormalTip: (path: string, free: string, total: string) =>
      `Storage disk: ${path}\n${free} free of ${total}`,
    diskUsageWarningTip: (free: string, total: string) =>
      `Disk usage is above 80% (${free} free of ${total}). Consider cleaning old assets or expanding disk.`,
    diskUsageCriticalTip: (free: string, total: string) =>
      `Disk almost full (${free} free of ${total})! Clean up old images or upgrade cloud disk immediately.`,

    // ── SKU Selection ──
    selectFunction: "Choose Workflow",
    selectFunctionHint: "Select a workflow to load its parameter form",
    catalogLoading: "Failed to load workflow list",
    catalogEmpty: "No workflows available. Please contact the admin.",
    categoryPrompt: "Prompt",
    categoryImage: "Image",
    categoryVideo: "Video",
    categoryEmpty: "No workflows in this category",
    credits: "Credits",

    // ── Form Actions ──
    errFixFields: "Please fix the following issues",
    submitBtn: "Generate",
    submitBtnUploading: "Uploading…",
    submitBtnSubmitting: "Submitting…",
    autoSaveToAssetToggle: "Auto-save results to asset library",
    autoSaveToAssetHint: "Images/videos are auto-categorized and tagged by workflow/task",
    autoSaveSaving: "Auto-saving to asset library…",
    autoSaveNoResult: "No storable result parsed, skipped auto-save",
    autoSaveDone: (count: number) => `Auto-saved ${count} result(s)`,
    autoSavePartial: (saved: number, failed: number) => `Auto-save completed: ${saved} succeeded, ${failed} failed`,
    autoSaveFailed: (reason: string) => `Auto-save failed: ${reason}`,
    resetBtn: "Clear",
    closeTaskBtn: "Close Task",
    estimateCreditsDynamic: (credits: number, sec: number, pps: number) =>
      `Estimated ${credits.toLocaleString("en-US")} credits (${sec}s × ${pps}, billed at actual usage)`,
    estimateCreditsFixed: (credits: number) =>
      `Estimated ${credits} credits (billed at actual usage)`,

    // ── Submit Errors ──
    errSelectSku: "Please select a workflow first",
    errIncomplete: "Incomplete fields — check required inputs and image uploads",
    errMissingSku: "Please re-select a workflow on the left before generating",
    errServerAbnormal: "Server returned an unexpected response. Please try again.",
    errHttpFail: (status: number) => `Submission failed (HTTP ${status})`,
    errUnauthorized: "Not signed in",
    errLoginRequired: (msg: string) => `${msg}: Please click "Sign In" at the top and try again.`,
    errNoTaskId: "No task ID received. Please retry or contact support.",
    errNetwork: "Network error",
    errConcurrentLimit: "Too many tasks in progress — please wait for the current task to finish before submitting another.",
    errDbWriteFailed: (taskId: string) => `Task submitted but record write failed. Please contact support (taskId: ${taskId}).`,

    // ── Credits Component ──
    creditsLabel: "Credits",
    creditsTooltip: "Current credit balance (synced immediately after tasks, refreshed periodically otherwise)",

    // ── TaskStatusViewer ──
    idleWaiting: "Waiting for a task…",
    idleHint: "Configure parameters on the left and click Generate — progress and results will appear here.",
    statusQueued: "Queued",
    statusGenerating: "Generating",
    subtitleQueued: "Task is in queue, computing resources will be allocated shortly…",
    subtitleGenerating: "No fine-grained progress from upstream — the bar below is a smooth estimate based on expected duration.",
    progressElapsed: "Elapsed",
    progressEstimated: "Est.",
    progressPct: (pct: number) => `~${Math.round(pct)}% (estimated, will show 100% on completion)`,
    progressRendering: "Rendering frames…",
    successLabel: "Success",
    successPrompt: "Prompt generated",
    successNoPreview: "Preview URL missing",
    successImage: "Image ready",
    successVideo: "Video ready",
    noPreviewUrl: "No preview URL provided",
    downloadBtn: "Download",
    downloadingBtn: "Preparing download…",
    regenerateBtn: "Regenerate",
    retryBtn: "Retry with same parameters",
    billingDone: (credits: number) => `✅ Task complete — ${credits} credits charged`,
    failureLabel: "Failed",
    failureTitle: "Task could not be completed",
    failureDefault: "An unknown error occurred. Please try again later.",
    failureParamsTitle: "Your submitted parameters (review and retry if needed)",
    noResultParsed: "Succeeded but no usable image or video URL was found",

    // ── DynamicForm ──
    fieldGroupUnknown: "Parameters",

    // ── ImageUploadControl ──
    uploadNoPreview: "No preview",
    uploadSelectBtn: "Choose Image",
    uploadChangeBtn: "Change Image",
    uploadClearBtn: "Remove",
    uploadFromAssetLibraryBtn: "From Asset Library",
    uploadUploading: "Uploading to cloud…",
    uploadWait: "Please wait — cannot submit until upload completes",
    uploadFailed: "Upload failed — click to retry",
    uploadFailedRetry: "Upload failed",
    uploadFileName: (name: string) => `Selected: ${name}`,
    uploadRemoteUrl: (url: string) => `Remote: ${url}`,
    uploadZoomHint: "Click to zoom",

    // ── TextResultDisplay ──
    textResultTitle: "Generated Prompt",
    textCopyBtn: "Copy",
    textCopied: "Copied",
    textDownloadBtn: "Download .txt",

    // ── History ──
    historyAlt: "History",

    // ── Gallery View ──
    backToGallery: "← Back",
    startCreating: "Start Creating",
    gallerySkeletonAlt: "Loading",
    allCategory: "All",
  },
} as const;

export type Locale = keyof typeof translations;

/** 将字面量字符串类型拓宽为 string，使 zh/en 两套字典都能赋值给同一类型 */
type Widen<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends (...args: infer A) => string
      ? (...args: A) => string
      : T[K];
};
export type TranslationDict = Widen<typeof translations.zh>;
