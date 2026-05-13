import { Activity, BarChart3, Coins, Users } from "lucide-react";
import Link from "next/link";
import { AdminApiTrendChart } from "@/components/admin/AdminApiTrendChart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getAdminApiCallTrend,
  getAdminKpiSnapshot,
  getAdminRecentApiLogs,
} from "@/services/adminService";

function formatInt(n: number) {
  return n.toLocaleString("zh-CN");
}

function formatCredits(n: number) {
  return `${formatInt(n)} 积分`;
}

export default async function AdminDashboardPage() {
  const [kpis, trend, logs] = await Promise.all([
    getAdminKpiSnapshot(),
    getAdminApiCallTrend(7),
    getAdminRecentApiLogs(10),
  ]);

  const cards = [
    {
      title: "今日总调用量",
      value: formatInt(kpis.todayApiCalls),
      hint: "当日工作流提单 + ApiLog 条数",
      icon: Activity,
      accent: "from-violet-500/25 to-transparent",
    },
    {
      title: "今日总营收",
      value: formatCredits(kpis.todayRevenueCredits),
      hint: "当日 CONSUME 流水绝对值之和",
      icon: Coins,
      accent: "from-emerald-500/20 to-transparent",
    },
    {
      title: "今日预估利润",
      value: formatCredits(kpis.todayEstimatedProfitCredits),
      hint: "当日 ApiLog.profit 合计（无 ApiLog 则为 0）",
      icon: BarChart3,
      accent: "from-amber-500/20 to-transparent",
    },
    {
      title: "活跃用户",
      value: formatInt(kpis.activeUsers),
      hint: "当日有提单或流水记录的去重用户",
      icon: Users,
      accent: "from-sky-500/20 to-transparent",
    },
  ] as const;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">运营仪表盘</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          关键指标与 API 健康度一览。数据来自 Prisma 实时聚合（工作流提单、积分流水 CONSUME、ApiLog）。
        </p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link href="/admin/stats" className="font-medium text-primary underline-offset-4 hover:underline">
            工作流经营看板 →
          </Link>
          <Link href="/admin/users" className="font-medium text-primary underline-offset-4 hover:underline">
            用户与积分充值 →
          </Link>
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card
            key={c.title}
            className="relative overflow-hidden border-border/80 bg-card/90 ring-1 ring-border/60"
          >
            <div
              className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.accent} opacity-90`}
              aria-hidden
            />
            <CardHeader className="relative pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardDescription className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {c.title}
                </CardDescription>
                <c.icon className="size-4 text-muted-foreground" aria-hidden />
              </div>
              <CardTitle className="pt-1 font-mono text-2xl tabular-nums tracking-tight sm:text-3xl">
                {c.value}
              </CardTitle>
            </CardHeader>
            <CardContent className="relative pt-0">
              <p className="text-xs text-muted-foreground">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="border-border/80 bg-card/90 ring-1 ring-border/60">
        <CardHeader>
          <CardTitle className="text-base">近 7 天 API 调用趋势</CardTitle>
          <CardDescription>按自然日聚合的「工作流提单」次数（GenerationHistory）</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminApiTrendChart data={trend} />
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/90 ring-1 ring-border/60">
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">最近 API 请求</CardTitle>
            <CardDescription>最近 10 条 ApiLog（按创建时间倒序）</CardDescription>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-6">
          <div className="rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[100px] text-xs">时间</TableHead>
                  <TableHead className="text-xs">端点</TableHead>
                  <TableHead className="w-[72px] text-xs">耗时</TableHead>
                  <TableHead className="w-[80px] text-xs">状态</TableHead>
                  <TableHead className="w-[88px] text-right text-xs">利润</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      暂无 ApiLog。当前网关成功路径若未写入 api_logs，此表为空属正常。
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((row) => (
                    <TableRow key={row.id} className="text-xs">
                      <TableCell className="whitespace-nowrap font-mono text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate font-mono text-[11px] text-foreground/90">
                        {row.endpoint}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">{row.durationMs} ms</TableCell>
                      <TableCell>
                        {row.responseStatus != null && row.responseStatus >= 400 ? (
                          <Badge variant="destructive" className="text-[10px]">
                            {row.responseStatus}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            {row.responseStatus ?? "—"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-emerald-400/90">
                        {row.profitCredits == null ? "—" : `${row.profitCredits.toFixed(2)}`}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
