# syntax=docker/dockerfile:1
# Etapa builder: dependencias completas (incl. dev) para build y para `db:migrate` / `db:seed`.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# URL pública del servicio FastAPI (navegador → mismo host que abre la web).
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Solo para el análisis de rutas en build; en runtime Compose inyecta DATABASE_URL real.
ARG DATABASE_URL=postgresql://rag:rag@127.0.0.1:5432/rag_kb
ENV DATABASE_URL=$DATABASE_URL
RUN npm run build

# Imagen de producción: salida standalone de Next.js.
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update -y && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Volumen Docker suele montarse como root; uploads + app-settings requieren escritura.
RUN mkdir -p /app/storage

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
