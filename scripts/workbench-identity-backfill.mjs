import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const DEFAULTS = {
  platformContainer: "workflow-db",
  platformDbUser: "postgres",
  platformDbName: "workflow",
  workbenchContainer: "workflow-workbench-db",
  workbenchDbUser: "ai_workbench",
  workbenchDbName: "ai_workbench",
  apply: false,
  createMissing: true,
  reportPath: resolve(
    process.cwd(),
    "reports",
    `workbench-identity-backfill-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  ),
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--no-create-missing") options.createMissing = false;
    else if (arg === "--create-missing") options.createMissing = true;
    else if (arg === "--platform-container") options.platformContainer = argv[++i] || options.platformContainer;
    else if (arg === "--platform-db-user") options.platformDbUser = argv[++i] || options.platformDbUser;
    else if (arg === "--platform-db-name") options.platformDbName = argv[++i] || options.platformDbName;
    else if (arg === "--workbench-container") options.workbenchContainer = argv[++i] || options.workbenchContainer;
    else if (arg === "--workbench-db-user") options.workbenchDbUser = argv[++i] || options.workbenchDbUser;
    else if (arg === "--workbench-db-name") options.workbenchDbName = argv[++i] || options.workbenchDbName;
    else if (arg === "--report") options.reportPath = resolve(process.cwd(), argv[++i] || options.reportPath);
    else if (arg === "--help" || arg === "-h") {
      printHelpAndExit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return options;
}

function printHelpAndExit(code) {
  console.log(`用法:
  node scripts/workbench-identity-backfill.mjs [选项]

选项:
  --dry-run                 仅生成报告（默认）
  --apply                   执行写库回填
  --create-missing          为未匹配的平台用户创建 workbench 账号（默认）
  --no-create-missing       不创建未匹配账号，仅报告
  --platform-container      主站 DB 容器名（默认 workflow-db）
  --platform-db-user        主站 DB 用户（默认 postgres）
  --platform-db-name        主站 DB 名（默认 workflow）
  --workbench-container     Workbench DB 容器名（默认 workflow-workbench-db）
  --workbench-db-user       Workbench DB 用户（默认 ai_workbench）
  --workbench-db-name       Workbench DB 名（默认 ai_workbench）
  --report <path>           报告输出路径
  -h, --help                显示帮助
`);
  process.exit(code);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "");
  return cleaned.slice(0, 50) || "user";
}

function usernameFromEmail(email) {
  const normalized = normalizeEmail(email);
  const localPart = normalized.includes("@") ? normalized.split("@", 1)[0] : normalized;
  return normalizeUsername(localPart || "user");
}

function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPsql({ container, dbUser, dbName, sql, unaligned = false }) {
  const args = ["exec", "-i", container, "psql", "-U", dbUser, "-d", dbName, "-v", "ON_ERROR_STOP=1"];
  if (unaligned) {
    args.push("-A", "-t");
  }
  args.push("-c", sql);
  return execFileSync("docker", args, { encoding: "utf8" });
}

function runJsonRows(queryOptions, sql) {
  const wrappedSql = `SELECT json_build_object('row', row_to_json(t))::text FROM (${sql}) t;`;
  const raw = runPsql({ ...queryOptions, sql: wrappedSql, unaligned: true });
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line);
      return parsed.row;
    });
}

function mapPlatformRoleToWorkbench(role) {
  return String(role || "").toUpperCase() === "ADMIN" ? "admin" : "operator";
}

function ensureUniqueUsername(base, existingLowerSet) {
  const root = normalizeUsername(base);
  if (!existingLowerSet.has(root)) {
    existingLowerSet.add(root);
    return root;
  }
  for (let i = 1; i <= 9999; i += 1) {
    const suffix = `_${i}`;
    const head = root.slice(0, Math.max(1, 50 - suffix.length));
    const candidate = `${head}${suffix}`;
    if (!existingLowerSet.has(candidate)) {
      existingLowerSet.add(candidate);
      return candidate;
    }
  }
  throw new Error(`无法为 ${base} 生成唯一用户名`);
}

function summarizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    platform_user_id: user.platform_user_id,
    role: user.role,
  };
}

function buildIndexes(workbenchUsers) {
  const byPlatformId = new Map();
  const byEmail = new Map();
  const byUsername = new Map();

  for (const user of workbenchUsers) {
    if (user.platform_user_id) {
      const key = String(user.platform_user_id);
      const arr = byPlatformId.get(key) || [];
      arr.push(user);
      byPlatformId.set(key, arr);
    }
    if (user.email) {
      const key = normalizeEmail(user.email);
      const arr = byEmail.get(key) || [];
      arr.push(user);
      byEmail.set(key, arr);
    }
    if (user.username) {
      const key = normalizeUsername(user.username);
      const arr = byUsername.get(key) || [];
      arr.push(user);
      byUsername.set(key, arr);
    }
  }

  return { byPlatformId, byEmail, byUsername };
}

function collectCandidates(platformUser, indexes) {
  const candidates = new Map();
  const reasons = [];

  const add = (user, reason) => {
    if (!user) return;
    const existing = candidates.get(user.id) || { user, reasons: [] };
    existing.reasons.push(reason);
    candidates.set(user.id, existing);
  };

  const pid = String(platformUser.id);
  const email = normalizeEmail(platformUser.email);
  const legacyUsername = usernameFromEmail(email);

  for (const user of indexes.byPlatformId.get(pid) || []) add(user, "platform_user_id");
  for (const user of indexes.byEmail.get(email) || []) add(user, "email");
  for (const user of indexes.byUsername.get(legacyUsername) || []) add(user, "legacy_username");

  const rows = [...candidates.values()];
  for (const row of rows) {
    reasons.push({ workbench_user_id: row.user.id, reasons: row.reasons });
  }
  return { rows, reasons, legacyUsername };
}

function buildUpdatePatch(platformUser, workbenchUser) {
  const patch = {};
  const desiredEmail = normalizeEmail(platformUser.email);
  const desiredName = String(platformUser.name || "").trim();
  const desiredRole = mapPlatformRoleToWorkbench(platformUser.role);

  if (!workbenchUser.platform_user_id || String(workbenchUser.platform_user_id) !== String(platformUser.id)) {
    patch.platform_user_id = String(platformUser.id);
  }
  if (desiredEmail && normalizeEmail(workbenchUser.email) !== desiredEmail) {
    patch.email = desiredEmail;
  }
  if (desiredName) {
    if (String(workbenchUser.display_name || "").trim() !== desiredName) {
      patch.display_name = desiredName;
    }
  } else if (!String(workbenchUser.display_name || "").trim()) {
    patch.display_name = workbenchUser.username;
  }
  if ((workbenchUser.auth_source || "") !== "platform_sso") {
    patch.auth_source = "platform_sso";
  }
  if (!workbenchUser.role_sync_strategy) {
    patch.role_sync_strategy = "platform_authoritative";
  }
  if (workbenchUser.role_sync_locked === null || workbenchUser.role_sync_locked === undefined) {
    patch.role_sync_locked = false;
  }
  if (desiredRole === "admin" && workbenchUser.role !== "admin") {
    patch.role = "admin";
  }
  if (Object.keys(patch).length > 0) {
    patch.role_last_source = "phase2_backfill";
    patch.role_last_synced_at = new Date().toISOString();
    patch.last_sso_at = new Date().toISOString();
  }
  return patch;
}

function patchToSqlSet(patch) {
  const parts = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === "last_sso_at") {
      parts.push(`${key} = ${sqlQuote(value)}::timestamp`);
    } else if (key === "role_last_synced_at") {
      parts.push(`${key} = ${sqlQuote(value)}::timestamp`);
    } else if (typeof value === "boolean") {
      parts.push(`${key} = ${value ? "TRUE" : "FALSE"}`);
    } else {
      parts.push(`${key} = ${sqlQuote(value)}`);
    }
  }
  return parts.join(", ");
}

function writeReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const platformDb = {
    container: options.platformContainer,
    dbUser: options.platformDbUser,
    dbName: options.platformDbName,
  };
  const workbenchDb = {
    container: options.workbenchContainer,
    dbUser: options.workbenchDbUser,
    dbName: options.workbenchDbName,
  };

  const platformUsers = runJsonRows(
    platformDb,
    `
SELECT id, email, name, role, created_at, updated_at
FROM users
WHERE email IS NOT NULL AND trim(email) <> ''
ORDER BY created_at ASC
`,
  );

  const workbenchUsers = runJsonRows(
    workbenchDb,
    `
SELECT id, username, email, display_name, role, status, platform_user_id, auth_source, last_sso_at, created_at
     , role_sync_strategy, role_sync_locked, role_last_source, role_last_synced_at
FROM users
ORDER BY id ASC
`,
  );

  const indexes = buildIndexes(workbenchUsers);
  const assignedWorkbench = new Map();
  const existingUsernameSet = new Set(workbenchUsers.map((u) => normalizeUsername(u.username)));

  const conflicts = [];
  const unmatchedPlatformUsers = [];
  const updateOps = [];
  const createOps = [];
  const unchanged = [];
  const matched = [];

  for (const platformUser of platformUsers) {
    const email = normalizeEmail(platformUser.email);
    if (!email) continue;

    const { rows, reasons, legacyUsername } = collectCandidates(platformUser, indexes);
    if (rows.length > 1) {
      conflicts.push({
        type: "multiple_candidate_workbench_users",
        platform_user: platformUser,
        candidates: reasons,
      });
      continue;
    }

    if (rows.length === 0) {
      if (!options.createMissing) {
        unmatchedPlatformUsers.push({ ...platformUser, legacy_username: legacyUsername });
        continue;
      }

      const desiredUsername = ensureUniqueUsername(legacyUsername, existingUsernameSet);
      const desiredDisplayName = String(platformUser.name || "").trim() || desiredUsername;
      const role = mapPlatformRoleToWorkbench(platformUser.role);
      const op = {
        platform_user_id: String(platformUser.id),
        email,
        username: desiredUsername,
        display_name: desiredDisplayName,
        role,
        auth_source: "platform_sso",
        role_sync_strategy: "platform_authoritative",
        role_sync_locked: false,
        role_last_source: "phase2_backfill",
        role_last_synced_at: new Date().toISOString(),
        status: true,
      };
      createOps.push(op);
      continue;
    }

    const workbenchUser = rows[0].user;
    const assigned = assignedWorkbench.get(workbenchUser.id);
    if (assigned && String(assigned) !== String(platformUser.id)) {
      conflicts.push({
        type: "workbench_user_matched_to_multiple_platform_users",
        platform_user: platformUser,
        conflicting_workbench_user: summarizeUser(workbenchUser),
        already_assigned_platform_user_id: assigned,
      });
      continue;
    }
    assignedWorkbench.set(workbenchUser.id, String(platformUser.id));

    const patch = buildUpdatePatch(platformUser, workbenchUser);
    const patchKeys = Object.keys(patch).filter((key) => key !== "last_sso_at");
    if (patchKeys.length === 0) {
      unchanged.push({ platform_user_id: platformUser.id, workbench_user_id: workbenchUser.id });
      matched.push({ platform_user_id: platformUser.id, workbench_user_id: workbenchUser.id, action: "unchanged" });
      continue;
    }
    updateOps.push({
      platformUser,
      workbenchUser,
      patch,
    });
    matched.push({ platform_user_id: platformUser.id, workbench_user_id: workbenchUser.id, action: "update" });
  }

  const linkedWorkbenchIds = new Set([
    ...[...assignedWorkbench.keys()].map((id) => Number(id)),
    ...updateOps.map((op) => Number(op.workbenchUser.id)),
    ...unchanged.map((item) => Number(item.workbench_user_id)),
  ]);
  const orphanWorkbenchUsers = workbenchUsers.filter((wb) => !linkedWorkbenchIds.has(Number(wb.id)));

  if (options.apply) {
    for (const op of updateOps) {
      const setSql = patchToSqlSet(op.patch);
      const sql = `UPDATE users SET ${setSql} WHERE id = ${Number(op.workbenchUser.id)};`;
      runPsql({ ...workbenchDb, sql });
    }

    for (const op of createOps) {
      const randomPassword = crypto.randomBytes(24).toString("base64url");
      const passwordHash = bcrypt.hashSync(randomPassword, 12);
      const sql = `
INSERT INTO users (
  username, password_hash, role, status, email, display_name, auth_source, last_sso_at, platform_user_id,
  role_sync_strategy, role_sync_locked, role_last_source, role_last_synced_at
) VALUES (
  ${sqlQuote(op.username)},
  ${sqlQuote(passwordHash)},
  ${sqlQuote(op.role)},
  TRUE,
  ${sqlQuote(op.email)},
  ${sqlQuote(op.display_name)},
  'platform_sso',
  NOW(),
  ${sqlQuote(op.platform_user_id)},
  ${sqlQuote(op.role_sync_strategy)},
  ${op.role_sync_locked ? "TRUE" : "FALSE"},
  ${sqlQuote(op.role_last_source)},
  ${sqlQuote(op.role_last_synced_at)}::timestamp
);`;
      runPsql({ ...workbenchDb, sql });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    options: {
      create_missing: options.createMissing,
      platform_container: options.platformContainer,
      workbench_container: options.workbenchContainer,
    },
    summary: {
      platform_users: platformUsers.length,
      workbench_users: workbenchUsers.length,
      matched: matched.length,
      unchanged: unchanged.length,
      updates_planned: updateOps.length,
      creates_planned: createOps.length,
      conflicts: conflicts.length,
      unmatched_platform_users: unmatchedPlatformUsers.length,
      orphan_workbench_users: orphanWorkbenchUsers.length,
      updates_applied: options.apply ? updateOps.length : 0,
      creates_applied: options.apply ? createOps.length : 0,
    },
    conflicts,
    unmatched_platform_users: unmatchedPlatformUsers,
    orphan_workbench_users: orphanWorkbenchUsers.map(summarizeUser),
    planned_updates: updateOps.map((op) => ({
      platform_user: {
        id: op.platformUser.id,
        email: op.platformUser.email,
        role: op.platformUser.role,
      },
      workbench_user_before: summarizeUser(op.workbenchUser),
      patch: op.patch,
    })),
    planned_creates: createOps,
  };

  writeReport(options.reportPath, report);

  console.log("=== Workbench Identity Backfill ===");
  console.log(`模式: ${options.apply ? "APPLY(写库)" : "DRY-RUN(仅报告)"}`);
  console.log(`平台用户数: ${report.summary.platform_users}`);
  console.log(`Workbench用户数: ${report.summary.workbench_users}`);
  console.log(`计划更新: ${report.summary.updates_planned}`);
  console.log(`计划创建: ${report.summary.creates_planned}`);
  console.log(`冲突数: ${report.summary.conflicts}`);
  console.log(`未匹配平台用户: ${report.summary.unmatched_platform_users}`);
  console.log(`孤儿Workbench用户: ${report.summary.orphan_workbench_users}`);
  console.log(`报告路径: ${options.reportPath}`);
}

main().catch((error) => {
  console.error("回填失败:", error?.message || error);
  process.exit(1);
});
