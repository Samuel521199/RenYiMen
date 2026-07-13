import { PrismaAdapter } from "@auth/prisma-adapter";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { prisma } from "@/lib/prisma";

const authUrl = process.env.AUTH_URL?.trim() ?? "";
const isHttps = authUrl.startsWith("https://");

/**
 * HTTP 部署时必须把所有认证 cookie 的 secure 设为 false，
 * 否则浏览器不会存 CSRF token，导致登录 403 MissingCSRF。
 */
const cookieOptions = { secure: isHttps, sameSite: "lax" as const, path: "/" };

export const authConfig = {
  trustHost: true,
  useSecureCookies: isHttps,
  cookies: {
    sessionToken:      { options: { ...cookieOptions, httpOnly: true } },
    callbackUrl:       { options: { ...cookieOptions, httpOnly: false } },
    csrfToken:         { options: { ...cookieOptions, httpOnly: false } },
    pkceCodeVerifier:  { options: { ...cookieOptions, httpOnly: true } },
    state:             { options: { ...cookieOptions, httpOnly: true } },
    nonce:             { options: { ...cookieOptions, httpOnly: true } },
  },
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
  },
  providers: [
    ...(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
      ? [
          GitHub({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
          }),
        ]
      : []),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
          return null;
        }

        const emailNorm = email.trim().toLowerCase();
        if (!emailNorm) {
          return null;
        }

        let user: Awaited<ReturnType<typeof prisma.user.findUnique>> | null = null;
        try {
          user = await prisma.user.findUnique({ where: { email: emailNorm } });
        } catch (dbErr) {
          console.error("[auth/authorize] DB查询失败", { email: emailNorm, err: dbErr });
          return null;
        }

        if (!user) {
          console.warn("[auth/authorize] 用户不存在", { email: emailNorm });
          return null;
        }
        if (!user.passwordHash) {
          console.warn("[auth/authorize] 该账号未设置密码登录（可能是OAuth账号）", { email: emailNorm });
          return null;
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          console.warn("[auth/authorize] 密码错误", { email: emailNorm });
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        const row = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true },
        });
        token.role = row?.role ?? Role.USER;
      } else if (token.sub && token.role == null) {
        const row = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true },
        });
        token.role = row?.role ?? Role.USER;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = (token.role as Role | undefined) ?? Role.USER;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
