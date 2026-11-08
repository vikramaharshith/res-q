import { NextResponse, type NextRequest } from "next/server";

import {
  LOCAL_DEMO_COOKIE,
  isLoopbackHost,
  localDemoToken,
  requestArrivedThroughProxy,
} from "@/lib/approval/local-gate";

/**
 * Issues the httpOnly local-demo cookie. It is not an operator identity.
 * The approval route checks the cookie again and refuses proxied requests.
 * Next.js adds a loopback x-forwarded-for and x-forwarded-host on direct
 * requests; those are not treated as an external proxy.
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const host = request.headers.get("host") ?? "";
  const enabled = process.env.RESQ_LOCAL_APPROVALS === "1";
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || "";
  const throughProxy = requestArrivedThroughProxy({
    hostHeader: host,
    forwardedFor: request.headers.get("x-forwarded-for"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    realIp: request.headers.get("x-real-ip"),
    connectingIp: request.headers.get("cf-connecting-ip"),
  });
  if (!enabled || !secret || throughProxy || !isLoopbackHost(host)) {
    return response;
  }
  response.cookies.set({
    name: LOCAL_DEMO_COOKIE,
    value: localDemoToken(secret),
    httpOnly: true,
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
