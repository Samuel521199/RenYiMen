/**
 * 占位：向第三方大模型发起推理请求。
 * 通过 body 中 `fail: true` 可模拟上游失败（用于测试退款与结算）。
 */
export async function fetchToMockProvider(body: unknown): Promise<{
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}> {
  await new Promise((resolve) => setTimeout(resolve, 80));

  const fail =
    body !== null &&
    typeof body === "object" &&
    "fail" in body &&
    (body as { fail?: unknown }).fail === true;

  if (fail) {
    return {
      ok: false,
      status: 502,
      error: "Mock provider: upstream rejected the request",
    };
  }

  return {
    ok: true,
    status: 200,
    data: { message: "mock generation succeeded", echo: body },
  };
}
