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
# shared/wire.ts holds the client<->server wire types; both `npm run build`
# (client) and the server import it, so it must be in the build context.
COPY shared ./shared
RUN npm run build

# Clean production-only install (the toolchain here compiles better-sqlite3) so
# the runtime image can copy a consistent node_modules — the runtime stage ships
# no compiler. A clean `npm ci` avoids the partial/mixed tree `npm prune` leaves.
RUN npm ci --omit=dev


FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client ca-certificates tini gosu \
  && rm -rf /var/lib/apt/lists/* \
  # The runtime never runs npm (deps are copied from the builder; the app launches
  # via `node`). Drop the bundled npm CLI so its vendored undici can't fail the
  # release CVE gate and to shrink the runtime attack surface.
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY package.json package-lock.json ./

# Reuse the production node_modules (with natively-compiled better-sqlite3) from
# the builder instead of reinstalling — the runtime image ships no compiler.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
# The server runs via tsx and references shared/wire.ts (type-only today, but
# copy it so the runtime tree mirrors the source layout).
COPY --from=builder /app/shared ./shared

# Privilege-dropping entrypoint: as root it makes the bind-mounted data dir
# writable, then runs the app as the unprivileged node user.
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/data /home/node/.ssh \
  && chown -R node:node /app /home/node/.ssh \
  && chmod 700 /home/node/.ssh

# No USER directive: the container starts as root so the entrypoint can fix the
# data-dir ownership on a fresh bind mount, then drops to the node user via gosu.

# Build metadata, injected by CI on release (see .github/workflows/release.yml).
# Left empty for local/dev builds — the server treats a missing APP_VERSION as a
# dev build and never shows the update indicator. Declared last so per-build
# values don't invalidate the cache of the heavy COPY layers above.
ARG APP_VERSION=""
ARG APP_COMMIT=""
ARG APP_BUILD_TIME=""
ENV APP_VERSION=$APP_VERSION \
    APP_COMMIT=$APP_COMMIT \
    APP_BUILD_TIME=$APP_BUILD_TIME
LABEL org.opencontainers.image.title="Homelab Dashboard" \
      org.opencontainers.image.source="https://github.com/Duresa7/homelab-dashboard-aio" \
      org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$APP_COMMIT \
      org.opencontainers.image.created=$APP_BUILD_TIME

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
# Run the TypeScript server directly via tsx's loader (tsx is a prod dependency).
CMD ["node", "--import", "tsx", "server/src/index.ts"]
