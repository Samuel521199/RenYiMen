/**
 * Application-facing API configuration. Values come from runtime env (Docker/K8s).
 */
export const appConfig = {
  apiBaseUrl:
    process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8080",
} as const;
