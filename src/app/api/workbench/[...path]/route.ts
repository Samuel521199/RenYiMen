import { NextRequest, NextResponse } from "next/server";

import {
  buildStaticCacheControl,
  isWorkbenchStaticAssetPath,
  parseWorkbenchStaticCacheMaxAge,
  STATIC_UPSTREAM_HEADER_NAMES,
} from "@/lib/workbench-static-cache";

const WORKBENCH_BACKEND_URL =
  process.env.WORKBENCH_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

const STATIC_CACHE_MAX_AGE = parseWorkbenchStaticCacheMaxAge(
  process.env.WORKBENCH_STATIC_CACHE_MAX_AGE,
);

type RouteContext = { params: Promise<{ path: string[] }> };

function applyUpstreamHeaders(upstream: Response, responseHeaders: Headers, isStatic: boolean) {
  for (const name of STATIC_UPSTREAM_HEADER_NAMES) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  if (!isStatic) return;

  const upstreamCacheControl = upstream.headers.get("cache-control");
  responseHeaders.set(
    "Cache-Control",
    upstreamCacheControl || buildStaticCacheControl(STATIC_CACHE_MAX_AGE),
  );
}

async function proxyRequest(req: NextRequest, pathSegments: string[]) {
  const subPath = pathSegments.join("/");
  const targetUrl = new URL(`${WORKBENCH_BACKEND_URL}/${subPath}`);
  targetUrl.search = req.nextUrl.search;
  const isStatic = isWorkbenchStaticAssetPath(pathSegments);
  const isReadOnly = req.method === "GET" || req.method === "HEAD";

  const headers = new Headers();
  const authHeader = req.headers.get("authorization");
  if (authHeader) headers.set("Authorization", authHeader);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };

  if (!isReadOnly) {
    const body = await req.arrayBuffer();
    if (body.byteLength > 0) init.body = body;
  }

  const upstream = await fetch(targetUrl, init);
  const responseHeaders = new Headers();
  applyUpstreamHeaders(upstream, responseHeaders, isStatic);

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}

export async function HEAD(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}
