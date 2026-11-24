# syntax=docker/dockerfile:1

# ---- build: compile TypeScript, keep production deps only ----
FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- assets: fetch the pinned dbd-assets commit (data/ + images/ only) ----
FROM node:24-bookworm-slim AS assets
ARG DBD_ASSETS_REF
RUN if [ -z "$DBD_ASSETS_REF" ]; then \
      echo "ERROR: build-arg DBD_ASSETS_REF is required (e.g. --build-arg DBD_ASSETS_REF=\$(cat dbd-assets.ref))" >&2; \
      exit 1; \
    fi
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init -q . \
 && git remote add origin https://github.com/shenapse/dbd-assets \
 && git fetch --depth 1 origin "$DBD_ASSETS_REF" \
 && git checkout -q FETCH_HEAD \
 && mkdir -p /opt/dbd-assets \
 && cp -r data images /opt/dbd-assets/ \
 && printf '%s\n' "$DBD_ASSETS_REF" > /opt/dbd-assets/.ref \
 && chmod -R a+rX /opt/dbd-assets

# ---- runtime ----
FROM node:24-bookworm-slim AS runtime
ARG DBD_ASSETS_REF
ARG VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/shenapse/balancing-sheet-generator" \
      org.opencontainers.image.title="balancing-sheet-generator" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      io.github.shenapse.dbd-assets.ref="${DBD_ASSETS_REF}"
ENV DBD_ASSETS_ROOT=/opt/dbd-assets \
    NODE_ENV=production
WORKDIR /app
COPY --from=build /build/dist ./dist
COPY --from=build /build/node_modules ./node_modules
COPY package.json ./
COPY fonts ./fonts
COPY --from=assets /opt/dbd-assets /opt/dbd-assets
# /work is normally bind-mounted; any uid may run the tool (nothing writes to /app or /opt).
RUN mkdir -p /work && chmod 777 /work
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["--help"]
