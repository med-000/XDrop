FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:22-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
