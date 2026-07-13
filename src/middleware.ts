import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Edge redirects — avoid RSC redirect() under client layouts (standalone manifest bug). */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/workbench/dashboard", request.url));
  }
  if (pathname === "/studio") {
    return NextResponse.redirect(new URL("/workbench/tools", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/studio"],
};
