# ---- deps stage ----
FROM oven/bun AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- release stage ----
FROM oven/bun AS release
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production

EXPOSE 4545/tcp
EXPOSE 45454/udp

ARG PUID=99
ARG PGID=100

RUN \
    groupadd -f -g ${PGID} hydrabasegroup || true && \
    useradd -o -u ${PUID} -g ${PGID} -m hydrabase || true && \
    chown -R ${PUID}:${PGID} /app

USER ${PUID}:${PGID}

CMD bun src; sleep 3600
