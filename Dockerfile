# ---- deps stage ----
FROM oven/bun AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- release stage ----
FROM oven/bun AS release
WORKDIR /app
RUN chown bun:bun /app
USER bun

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production

EXPOSE 4545/tcp
EXPOSE 45454/udp

ENV PUID=99
ENV PGID=100

RUN set -eux; \
    if ! getent group ${PGID} >/dev/null; then \
        groupadd -g ${PGID} hydrabasegroup; \
    fi; \
    if ! id -u ${PUID} >/dev/null 2>&1; then \
        useradd -u ${PUID} -g ${PGID} -m hydrabase; \
    fi; \
    chown -R ${PUID}:${PGID} /app

USER ${PUID}:${PGID}

CMD bun src; sleep 3600
