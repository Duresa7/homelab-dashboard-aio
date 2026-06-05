# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY client ./client
COPY server ./server
RUN npm run build

# Clean production-only install (the toolchain here compiles better-sqlite3) so
# the runtime image can copy a consistent node_modules — the runtime stage ships
# no compiler. A clean `npm ci` avoids the partial/mixed tree `npm prune` leaves.
RUN npm ci --omit=dev


FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# Reuse the production node_modules (with natively-compiled better-sqlite3) from
# the builder instead of reinstalling — the runtime image ships no compiler.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

RUN mkdir -p /app/data /home/node/.ssh \
  && chown -R node:node /app /home/node/.ssh \
  && chmod 700 /home/node/.ssh

USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
# Run the TypeScript server directly via tsx's loader (tsx is a prod dependency).
CMD ["node", "--import", "tsx", "server/src/index.ts"]
