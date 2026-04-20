# syntax=docker/dockerfile:1.7-labs

# Keep digest pinning for reproducible builds. Bump tag+digest together intentionally.
ARG BUN_IMAGE=oven/bun:1.3.11-slim@sha256:478281fdd196871c7e51ba6a820b7803a8ae97042ec86cdbc2e1c6b6626442d9

FROM ${BUN_IMAGE} AS deps
WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt,sharing=locked \
	apt-get update \
	&& apt-get install -y --no-install-recommends g++ cmake make python3 git \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
	bun install --frozen-lockfile

FROM ${BUN_IMAGE} AS release
WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt,sharing=locked \
	apt-get update \
	&& apt-get install -y --no-install-recommends gosu \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
	&& chown -R 1000:1000 /app

ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true
ENV PUID=1000
ENV PGID=1000

ARG BRANCH=main
ENV BRANCH=$BRANCH

EXPOSE 4545/tcp
EXPOSE 4545/udp

VOLUME ["/app/data"]

USER root
ENTRYPOINT ["/entrypoint.sh"]
