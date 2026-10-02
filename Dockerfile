# GitLineage — production image.
#
# Single node, long-running process. Deliberately NOT a serverless image: an
# analysis of a large repository takes minutes of real work, so the runtime must
# have no request or process lifetime limit.
#
# Build:  docker build -t gitlineage:ff4af776 .
# Run:    docker run -d --name gitlineage \
#           -p 127.0.0.1:8080:8080 \
#           -v /srv/gitlineage/cache:/var/lib/gitlineage/cache \
#           -v /srv/gitlineage/jobs:/var/lib/gitlineage/jobs \
#           -v /srv/gitlineage/tmp:/tmp \
#           --env-file /srv/gitlineage/gitlineage.env \
#           gitlineage:ff4af776
#
# The volumes are the point. State lives outside the image and outside any
# checkout, so a redeploy never deletes an artifact.

# ---------------------------------------------------------------- build stage
FROM node:24-bookworm-slim AS build

WORKDIR /build

# Dependencies first, so a source-only change reuses the cached install layer.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

COPY tsconfig.json build.mjs ./
COPY src ./src
COPY schemas ./schemas

# The production client bundle. Built here so the image never ships a build
# toolchain, and so the artefact is exactly what `npm run build` produces.
RUN node build.mjs

# Prune to production dependencies only. The image still needs the git CLI, which
# the runtime stage installs.
RUN npm prune --omit=dev

# -------------------------------------------------------------- runtime stage
FROM node:24-bookworm-slim AS runtime

# git is a hard requirement, not an optional extra: the bounded git runner is one
# of the provenance signals, and `fetchShallowHistory` needs a real git binary.
RUN apt-get update \
 && apt-get install --no-install-recommends -y git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# State lives here, on volumes. Never inside the application directory.
RUN mkdir -p /var/lib/gitlineage/cache /var/lib/gitlineage/jobs /tmp/gitlineage
ENV GITLINEAGE_CACHE=/var/lib/gitlineage/cache \
    GITLINEAGE_JOB_STORE=/var/lib/gitlineage/jobs \
    GITLINEAGE_CLIENT_DIR=/app/dist/web \
    GITLINEAGE_HOST=0.0.0.0 \
    GITLINEAGE_PORT=8080 \
    TMPDIR=/tmp/gitlineage

WORKDIR /app
COPY --from=build /build/dist ./dist
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/src ./src
COPY --from=build /build/schemas ./schemas
COPY --from=build /build/package.json ./package.json

# The process runs unprivileged. The volumes must be owned by this user.
RUN chown -R node:node /var/lib/gitlineage /tmp/gitlineage
USER node

EXPOSE 8080

# Reports unhealthy without the artifact cache or the job registry, which are the
# two things a restart must not silently lose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.GITLINEAGE_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `--client` is explicit so the image serves the production bundle rather than
# whatever happens to be in the working tree.
CMD ["node", "src/web/serve.ts", "--client", "/app/dist/web"]