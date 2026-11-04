# RepostFlow — single image used by BOTH Railway services (web + worker).
# The web service runs `npm run start:web`; the worker runs `npm run start:worker`.
FROM node:22-slim AS base
ENV NODE_ENV=production
# ffmpeg/ffprobe for media inspection; openssl for Prisma; ca-certificates for TLS.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Dependencies (include dev deps; tsx runs the worker, prisma builds client) ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# ---- Build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npx next build

# ---- Runtime ----
FROM base AS runtime
ENV PORT=3000
# Bring the full app (node_modules includes tsx + prisma CLI + runtime deps).
COPY --from=build /app ./
EXPOSE 3000
# Default command is the web server; the worker service overrides it.
CMD ["npm", "run", "start:web"]
