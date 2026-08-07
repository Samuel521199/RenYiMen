# syntax=docker/dockerfile:1

FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl ffmpeg fontconfig font-noto-cjk blender-headless py3-numpy \
  && fc-cache -f \
  && fc-list | grep -q "Noto Sans CJK SC"

# --- Stage 1: deps — install dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Local development: hot reload (docker-compose profile `dev`) ---
FROM base AS development
ENV NODE_ENV=development
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
CMD ["npm", "run", "dev"]

# --- Stage 2: builder — Prisma client + Next.js production build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

RUN npx prisma generate
RUN npm run build

# --- Stage 3: durable production worker ---
FROM base AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
COPY config ./config
COPY public ./public
RUN npx prisma generate
CMD ["npm", "run", "worker:video-production"]

# --- Stage 4: runner — standalone server + static assets ---
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/config ./config
COPY --from=builder --chown=nextjs:nodejs /app/scripts/model-export-blender.py ./scripts/model-export-blender.py

USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV BLENDER_EXECUTABLE=/usr/bin/blender-headless

CMD ["node", "server.js"]
