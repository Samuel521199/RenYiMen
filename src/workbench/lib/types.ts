// frontend/lib/types.ts

export type UserRole = "admin" | "operator" | "reviewer" | "viewer";

export type TaskStatus =
  | "created"
  | "exploring"
  | "selecting"
  | "finalizing"
  | "reviewing"
  | "done"
  | "published"
  | "closed";

export type TaskScene = "Tongits" | "Pusoy" | "Payday" | "Holiday";
export type TaskSize = "1080x1350" | "1080x1920" | "1200x628" | "1080x1080";
export type ImageType = "draft" | "final";
export type ModelProvider = "openai" | "google" | "midjourney";
export type PromptMode = "draft" | "final";
export type AssetCategory =
  | "bull_reference"
  | "expression"
  | "action"
  | "game_content"
  | "holiday"
  | "hot_topic"
  | "background"
  | "props"
  | "logo";

export interface User {
  id: number;
  username: string;
  role: UserRole;
  status: boolean;
  /** 管理员已通过"权限"面板显式授权 → true；新用户或待授权 → false */
  permissions_granted?: boolean;
  created_at: string;
  daily_token_limit?: number;
  daily_cost_limit?: string;
  used_today_tokens?: number;
  used_today_cost?: string;
  usage_reset_date?: string | null;
}

export interface Task {
  id: number;
  title: string;
  scene: TaskScene;
  size: TaskSize;
  purpose?: string;
  budget: number;
  description?: string;
  status: TaskStatus;
  creator_id: number;
  created_at: string;
  updated_at: string;
  cost?: number; // 汇总成本，由后端计算
}

export interface TaskImage {
  id: number;
  task_id: number;
  image_url: string;
  type: ImageType;
  model_provider?: ModelProvider;
  model_name?: string;
  prompt_used?: string;
  token_used: number;
  cost: number;
  created_at: string;
}

export interface PromptTemplate {
  id: number;
  name: string;
  mode: PromptMode;
  content: string;
  active: boolean;
  created_at: string;
}

export interface Asset {
  id: number;
  filename: string;
  category: AssetCategory;
  tags?: string;
  url: string;
  use_count?: number;
  created_at: string;
}

export interface AssetStats {
  total: number;
  by_category: Record<string, number>;
}

export interface ReviewLog {
  id: number;
  image_id: number;
  reviewer_id: number;
  score: number;
  status: "pass" | "reject";
  reason?: string;
  tags?: string;
  created_at: string;
}

export interface DashboardStats {
  today_tasks: number;
  today_cost_usd: number;
  today_images: number;
  pending_reviews: number;
}

export interface ApiKey {
  id: number;
  provider: ModelProvider;
  daily_limit: number;
  used_today: number;
  active: boolean;
  created_at: string;
}
