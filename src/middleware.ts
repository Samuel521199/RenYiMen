import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Edge redirects — avoid RSC redirect() under client layouts (standalone manifest bug). */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === "/" ||
    pathname === "/studio" ||
    pathname === "/workbench" ||
    pathname === "/workbench/dashboard"
  ) {
    return NextResponse.redirect(new URL("/workbench/home", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/studio", "/workbench", "/workbench/dashboard"],
};
