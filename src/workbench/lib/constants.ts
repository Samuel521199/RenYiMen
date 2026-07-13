// frontend/lib/constants.ts

import type { AssetCategory } from "./types";

export const TASK_SCENES = [
  { value: "Tongits", label: "Tongits" },
  { value: "Pusoy", label: "Pusoy" },
  { value: "Payday", label: "菲律宾发薪日" },
  { value: "Holiday", label: "节日活动" },
];

export const TASK_SIZES = [
  { value: "1080x1350", label: "FB 竖图 1080×1350" },
  { value: "1080x1920", label: "短视频 1080×1920" },
  { value: "1200x628", label: "横版广告 1200×628" },
  { value: "1080x1080", label: "方图 1080×1080" },
];

export const ACTIVITY_AD_SIZES = [
  { value: "1024x1024", label: "1024×1024（FB 方图，推荐）" },
  { value: "1088x1920", label: "1088×1920（TikTok 竖图）" },
  // Legacy values kept for restored sessions; backend normalizes 1080×* automatically.
  { value: "1080x1080", label: "1080×1080（自动映射为 1024×1024）" },
  { value: "1080x1920", label: "1080×1920（自动映射为 1088×1920）" },
] as const;

export const TASK_STATUS_LABELS: Record<string, string> = {
  created:    "待创建",
  exploring:  "探索中",
  selecting:  "待选图",
  finalizing: "定稿中",
  reviewing:  "待审核",
  done:       "已完成",
  published:  "已发布",
  closed:     "已关闭",
};

export const TASK_STATUS_COLORS: Record<string, string> = {
  created:    "bg-gray-100 text-gray-600",
  exploring:  "bg-blue-100 text-blue-700",
  selecting:  "bg-yellow-100 text-yellow-700",
  finalizing: "bg-purple-100 text-purple-700",
  reviewing:  "bg-orange-100 text-orange-700",
  done:       "bg-green-100 text-green-700",
  published:  "bg-emerald-100 text-emerald-700",
  closed:     "bg-red-100 text-red-600",
};

export const ASSET_CATEGORIES = [
  { value: "bull_reference", label: "牛标准图" },
  { value: "expression",     label: "表情" },
  { value: "action",         label: "动作" },
  { value: "game_content",   label: "游戏内容" },
  { value: "holiday",        label: "节日形象" },
  { value: "hot_topic",      label: "热点运营" },
  { value: "background",     label: "背景" },
  { value: "props",          label: "道具" },
  { value: "logo",           label: "Logo" },
] satisfies Array<{ value: AssetCategory; label: string }>;

export const DAILY_POST_TEMPLATE_TYPES = [
  { value: "emotion", label: "情绪互动" },
  { value: "game", label: "游戏日常" },
  { value: "choice", label: "二选一" },
  { value: "meme", label: "梗图互动" },
  { value: "local", label: "本地生活" },
  { value: "character", label: "角色日常" },
] as const;

export const DAILY_POST_BULL_ACTIONS = [
  { value: "happy", label: "开心" },
  { value: "helpless", label: "无奈" },
  { value: "sweating", label: "流汗" },
  { value: "umbrella", label: "撑伞" },
  { value: "payday", label: "拿工资" },
  { value: "celebrate", label: "庆祝" },
] as const;

export const DAILY_POST_BACKGROUNDS = [
  { value: "rain", label: "雨天" },
  { value: "home", label: "家里" },
  { value: "street", label: "街道" },
  { value: "jeepney", label: "jeepney" },
  { value: "basketball", label: "篮球场" },
] as const;

export const MODEL_PROVIDERS = [
  { value: "openai",      label: "OpenAI GPT Image" },
  { value: "google",      label: "Google Gemini" },
  { value: "midjourney",  label: "Midjourney" },
  { value: "kling_video", label: "Kling Video" },
  { value: "veo",         label: "Google Veo" },
  { value: "runway",      label: "Runway" },
];

export const PROMPT_MODES = [
  { value: "draft", label: "低价探索（Draft）" },
  { value: "final", label: "高价定稿（Final）" },
];

export const REVIEW_CHECKLIST = [
  { key: "face_ok",       label: "牛脸是否正确" },
  { key: "limbs_ok",      label: "手脚是否正常" },
  { key: "no_garbled",    label: "是否无乱码文字" },
  { key: "composition",   label: "构图是否可投放" },
  { key: "video_ready",   label: "是否适合转视频" },
  { key: "brand_unified", label: "是否品牌统一" },
];

type NavChild = {
  href: string;
  label: string;
};

type NavSingleItem = {
  href: string;
  label: string;
  single: true;
};

type NavGroupItem = {
  children: NavChild[];
  label: string;
};

export type NavItem = NavSingleItem | NavGroupItem;

export const NAV_GROUPS = [
  { href: "/workbench/dashboard", label: "首页看板", single: true },
  {
    label: "任务中心",
    children: [
      { label: "任务列表", href: "/workbench/workflows" },
      { label: "表情制作", href: "/workbench/workflows/expression" },
      { label: "活动图生产", href: "/workbench/workflows/activity" },
      { label: "日常互动图", href: "/workbench/workflows/daily-post" },
      { label: "转发图生产", href: "/workbench/workflows/share" },
      { label: "背景图生成", href: "/workbench/workflows/background" },
      { label: "多图融合", href: "/workbench/workflows/multi-fusion" },
    ],
  },
  {
    label: "模版中心",
    children: [
      { label: "指令库", href: "/workbench/instructions" },
      { label: "Prompt 模版", href: "/workbench/prompts" },
      { label: "活动图模版", href: "/workbench/admin/activity-templates" },
      { label: "转发图指令库", href: "/workbench/admin/share-instructions" },
    ],
  },
  { href: "/workbench/assets", label: "素材库", single: true },
  {
    label: "标签管理",
    children: [
      { label: "素材标签管理", href: "/workbench/assets/tags" },
      { label: "成品图标签管理", href: "/workbench/gallery/tags" },
    ],
  },
  { href: "/workbench/review", label: "审核中心", single: true },
  { href: "/workbench/gallery", label: "成品图库", single: true },
  { href: "/workbench/gallery/video", label: "🎬 视频成品库", single: true },
  { href: "/workbench/stats", label: "统计中心", single: true },
  { href: "/workbench/custom-config", label: "自定义配置", single: true },
  {
    label: "管理后台",
    children: [
      { label: "用户管理", href: "/workbench/admin/users" },
      { label: "模型配置", href: "/workbench/admin/models" },
      { label: "系统日志", href: "/workbench/admin/logs" },
      { label: "调用统计", href: "/workbench/admin/usage-stats" },
    ],
  },
  { href: "/workbench/tools", label: "工具", single: true },
] satisfies NavItem[];
