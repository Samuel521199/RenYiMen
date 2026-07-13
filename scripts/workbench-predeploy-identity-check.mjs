import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULTS = {
  platformContainer: "workflow-db",
  platformDbUser: "postgres",
  platformDbName: "workflow",
  workbenchContainer: "workflow-workbench-db",
  workbenchDbUser: "ai_workbench",
  workbenchDbName: "ai_workbench",
  strict: true,
  sinceHours: 168,
  maxPlatformMissing: 0,
  maxPotentialConflicts: 0,
  maxUnboundWorkbench: 0,
  maxRoleDrift: 0,
  maxEmailDrift: 0,
  maxRecentConflictAuditLogs: 0,
  maxOpenConflictTickets: 0,
  reportPath: resolve(
    process.cwd(),
    "reports",
    `workbench-predeploy-identity-check-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  ),
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--strict") options.strict = true;
    else if (arg === "--no-strict") options.strict = false;
    else if (arg === "--since-hours") options.sinceHours = Number(argv[++i] || options.sinceHours);
    else if (arg === "--max-platform-missing") options.maxPlatformMissing = Number(argv[++i] || 0);
    else if (arg === "--max-potential-conflicts") options.maxPotentialConflicts = Number(argv[++i] || 0);
    else if (arg === "--max-unbound-workbench") options.maxUnboundWorkbench = Number(argv[++i] || 0);
    else if (arg === "--max-role-drift") options.maxRoleDrift = Number(argv[++i] || 0);
    else if (arg === "--max-email-drift") options.maxEmailDrift = Number(argv[++i] || 0);
    else if (arg === "--max-recent-conflict-audit-logs") options.maxRecentConflictAuditLogs = Number(argv[++i] || 0);
    else if (arg === "--max-open-conflict-tickets") options.maxOpenConflictTickets = Number(argv[++i] || 0);
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
  node scripts/workbench-predeploy-identity-check.mjs [选项]

选项:
  --strict / --no-strict
  --since-hours <n>                         最近冲突审计日志窗口（小时），默认 168
  --max-platform-missing <n>                平台未映射账号阈值（默认 0）
  --max-potential-conflicts <n>             潜在冲突阈值（默认 0）
  --max-unbound-workbench <n>               未绑定 workbench 账号阈值（默认 0）
  --max-role-drift <n>                      角色漂移阈值（默认 0）
  --max-email-drift <n>                     邮箱漂移阈值（默认 0）
  --max-recent-conflict-audit-logs <n>      最近冲突审计日志阈值（默认 0）
  --max-open-conflict-tickets <n>           未关闭冲突工单阈值（默认 0）
  --platform-container <name>
  --platform-db-user <name>
  --platform-db-name <name>
  --workbench-container <name>
  --workbench-db-user <name>
  --workbench-db-name <name>
  --report <path>
  -h, --help
`);
  process.exit(code);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 50);
}

function usernameFromEmail(email) {
  const normalized = normalizeEmail(email);
  const localPart = normalized.includes("@") ? normalized.split("@", 1)[0] : normalized;
  return normalizeUsername(localPart || "user");
}

function runPsql({ container, dbUser, dbName, sql, unaligned = false }) {
  const args = ["exec", "-i", container, "psql", "-U", dbUser, "-d", dbName, "-v", "ON_ERROR_STOP=1"];
  if (unaligned) args.push("-A", "-t");
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
    .map((line) => JSON.parse(line).row);
}

function writeReport(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
}

function mapPlatformRoleToWorkbench(role) {
  return String(role || "").toUpperCase() === "ADMIN" ? "admin" : "operator";
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

function evaluatePotentialConflicts(platformUsers, indexes) {
  const conflicts = [];
  for (const user of platformUsers) {
    const candidateIds = new Set();
    const reasons = [];
    const pid = String(user.id);
    const email = normalizeEmail(user.email);
    const legacyUsername = usernameFromEmail(email);

    for (const wb of indexes.byPlatformId.get(pid) || []) {
      candidateIds.add(wb.id);
      reasons.push({ workbench_user_id: wb.id, reason: "platform_user_id" });
    }
    for (const wb of indexes.byEmail.get(email) || []) {
      candidateIds.add(wb.id);
      reasons.push({ workbench_user_id: wb.id, reason: "email" });
    }
    for (const wb of indexes.byUsername.get(legacyUsername) || []) {
      candidateIds.add(wb.id);
      reasons.push({ workbench_user_id: wb.id, reason: "legacy_username" });
    }

    if (candidateIds.size > 1) {
      conflicts.push({
        platform_user_id: user.id,
        email: user.email,
        candidate_ids: [...candidateIds].sort((a, b) => Number(a) - Number(b)),
        reasons,
      });
    }
  }
  return conflicts;
}

function evaluateRoleDrift(platformUsers, indexes) {
  const drifts = [];
  for (const user of platformUsers) {
    const linked = (indexes.byPlatformId.get(String(user.id)) || [])[0];
    if (!linked) continue;
    const expectedRole = mapPlatformRoleToWorkbench(user.role);
    const strategy = String(linked.role_sync_strategy || "platform_authoritative").toLowerCase();
    const locked = Boolean(linked.role_sync_locked);
    let roleMismatch = linked.role !== expectedRole;
    if (locked) {
      roleMismatch = false;
    } else if (strategy === "preserve_workbench_admin") {
      roleMismatch = linked.role !== expectedRole && !(linked.role === "admin" && expectedRole !== "admin");
    } else if (strategy === "no_auto_downgrade") {
      roleMismatch = expectedRole === "admin" ? linked.role !== "admin" : false;
    }
    if (roleMismatch) {
      drifts.push({
        platform_user_id: user.id,
        email: user.email,
        expected_role: expectedRole,
        actual_role: linked.role,
        workbench_user_id: linked.id,
        workbench_username: linked.username,
        role_sync_strategy: strategy,
        role_sync_locked: locked,
      });
    }
  }
  return drifts;
}

function evaluateEmailDrift(platformUsers, indexes) {
  const drifts = [];
  for (const user of platformUsers) {
    const linked = (indexes.byPlatformId.get(String(user.id)) || [])[0];
    if (!linked) continue;
    const expectedEmail = normalizeEmail(user.email);
    const actualEmail = normalizeEmail(linked.email);
    if (expectedEmail !== actualEmail) {
      drifts.push({
        platform_user_id: user.id,
        expected_email: user.email,
        actual_email: linked.email,
        workbench_user_id: linked.id,
        workbench_username: linked.username,
      });
    }
  }
  return drifts;
}

function summarizeStatus(options, metrics) {
  const violations = [];
  if (metrics.platformMissing.length > options.maxPlatformMissing) {
    violations.push(`platform_missing=${metrics.platformMissing.length} > ${options.maxPlatformMissing}`);
  }
  if (metrics.potentialConflicts.length > options.maxPotentialConflicts) {
    violations.push(`potential_conflicts=${metrics.potentialConflicts.length} > ${options.maxPotentialConflicts}`);
  }
  if (metrics.unboundWorkbench.length > options.maxUnboundWorkbench) {
    violations.push(`unbound_workbench=${metrics.unboundWorkbench.length} > ${options.maxUnboundWorkbench}`);
  }
  if (metrics.roleDrift.length > options.maxRoleDrift) {
    violations.push(`role_drift=${metrics.roleDrift.length} > ${options.maxRoleDrift}`);
  }
  if (metrics.emailDrift.length > options.maxEmailDrift) {
    violations.push(`email_drift=${metrics.emailDrift.length} > ${options.maxEmailDrift}`);
  }
  if (metrics.recentConflictAuditLogs.length > options.maxRecentConflictAuditLogs) {
    violations.push(
      `recent_conflict_audit_logs=${metrics.recentConflictAuditLogs.length} > ${options.maxRecentConflictAuditLogs}`,
    );
  }
  if (metrics.openConflictTickets.length > options.maxOpenConflictTickets) {
    violations.push(`open_conflict_tickets=${metrics.openConflictTickets.length} > ${options.maxOpenConflictTickets}`);
  }
  return {
    pass: violations.length === 0,
    violations,
  };
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
SELECT id, email, role, name, created_at
FROM users
WHERE email IS NOT NULL AND trim(email) <> ''
ORDER BY created_at ASC
`,
  );
  const workbenchUsers = runJsonRows(
    workbenchDb,
    `
SELECT id, username, email, platform_user_id, role, status, auth_source, last_sso_at, created_at
     , role_sync_strategy, role_sync_locked
FROM users
ORDER BY id ASC
`,
  );

  const indexes = buildIndexes(workbenchUsers);
  const platformIds = new Set(platformUsers.map((u) => String(u.id)));
  const linkedPlatformIds = new Set(
    workbenchUsers
      .map((u) => (u.platform_user_id ? String(u.platform_user_id) : ""))
      .filter((id) => id && platformIds.has(id)),
  );

  const platformMissing = platformUsers.filter((u) => !linkedPlatformIds.has(String(u.id)));
  const unboundWorkbench = workbenchUsers.filter((u) => !u.platform_user_id || !platformIds.has(String(u.platform_user_id)));
  const potentialConflicts = evaluatePotentialConflicts(platformUsers, indexes);
  const roleDrift = evaluateRoleDrift(platformUsers, indexes);
  const emailDrift = evaluateEmailDrift(platformUsers, indexes);

  const sinceHours = Number.isFinite(options.sinceHours) && options.sinceHours > 0 ? Math.floor(options.sinceHours) : 168;
  const recentConflictAuditLogs = runJsonRows(
    workbenchDb,
    `
SELECT id, user_id, action, detail, created_at
FROM audit_logs
WHERE action = 'auth_sso_identity_conflict'
  AND created_at >= NOW() - interval '${sinceHours} hours'
ORDER BY created_at DESC
LIMIT 200
`,
  );
  const openConflictTickets = runJsonRows(
    workbenchDb,
    `
SELECT id, status, conflict_reason, platform_user_id, email, lookup_username, occur_count, updated_at
FROM identity_conflict_tickets
WHERE status = 'open'
ORDER BY updated_at DESC
LIMIT 200
`,
  );

  const status = summarizeStatus(options, {
    platformMissing,
    unboundWorkbench,
    potentialConflicts,
    roleDrift,
    emailDrift,
    recentConflictAuditLogs,
    openConflictTickets,
  });

  const linkedCount = linkedPlatformIds.size;
  const completeness = platformUsers.length > 0 ? Number((linkedCount / platformUsers.length).toFixed(6)) : 1;

  const report = {
    generated_at: new Date().toISOString(),
    options: {
      strict: options.strict,
      since_hours: sinceHours,
      thresholds: {
        max_platform_missing: options.maxPlatformMissing,
        max_potential_conflicts: options.maxPotentialConflicts,
        max_unbound_workbench: options.maxUnboundWorkbench,
        max_role_drift: options.maxRoleDrift,
        max_email_drift: options.maxEmailDrift,
        max_recent_conflict_audit_logs: options.maxRecentConflictAuditLogs,
        max_open_conflict_tickets: options.maxOpenConflictTickets,
      },
    },
    summary: {
      platform_users: platformUsers.length,
      workbench_users: workbenchUsers.length,
      linked_platform_users: linkedCount,
      mapping_completeness_rate: completeness,
      platform_missing_count: platformMissing.length,
      potential_conflicts_count: potentialConflicts.length,
      unbound_workbench_count: unboundWorkbench.length,
      role_drift_count: roleDrift.length,
      email_drift_count: emailDrift.length,
      recent_conflict_audit_log_count: recentConflictAuditLogs.length,
      open_conflict_ticket_count: openConflictTickets.length,
    },
    status,
    platform_missing_users: platformMissing,
    potential_conflicts: potentialConflicts,
    unbound_workbench_users: unboundWorkbench,
    role_drift: roleDrift,
    email_drift: emailDrift,
    recent_conflict_audit_logs: recentConflictAuditLogs,
    open_conflict_tickets: openConflictTickets,
  };

  writeReport(options.reportPath, report);

  console.log("=== Workbench Predeploy Identity Check ===");
  console.log(`平台用户: ${report.summary.platform_users}`);
  console.log(`Workbench用户: ${report.summary.workbench_users}`);
  console.log(`映射完整率: ${(report.summary.mapping_completeness_rate * 100).toFixed(2)}%`);
  console.log(`平台未映射: ${report.summary.platform_missing_count}`);
  console.log(`潜在冲突: ${report.summary.potential_conflicts_count}`);
  console.log(`未绑定Workbench: ${report.summary.unbound_workbench_count}`);
  console.log(`角色漂移: ${report.summary.role_drift_count}`);
  console.log(`邮箱漂移: ${report.summary.email_drift_count}`);
  console.log(`最近冲突审计日志(${sinceHours}h): ${report.summary.recent_conflict_audit_log_count}`);
  console.log(`未关闭冲突工单: ${report.summary.open_conflict_ticket_count}`);
  console.log(`报告路径: ${options.reportPath}`);
  console.log(`状态: ${status.pass ? "PASS" : "FAIL"}`);
  if (!status.pass) {
    for (const v of status.violations) console.log(`  - ${v}`);
  }

  if (options.strict && !status.pass) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("检查失败:", err?.message || err);
  process.exit(1);
});
