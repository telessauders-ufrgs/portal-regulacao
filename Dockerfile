# syntax=docker/dockerfile:1

ARG NODE_VERSION=22-slim

# ---- base: imagem comum com pnpm habilitado via corepack ----
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- deps: instala todas as dependências (incl. devDependencies) para build ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: compila client (vite) e server (esbuild) ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- runner: imagem final ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=8090

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs appuser

COPY --from=build --link /app/node_modules ./node_modules
COPY --from=build --link /app/dist ./dist
COPY --link package.json ./

USER appuser

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8090)+'/', r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
