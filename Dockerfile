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

RUN groupadd -g ${PGID} hydrabasegroup \
 && useradd -u ${PUID} -g ${PGID} -m hydrabase \
 && chown -R hydrabase:hydrabasegroup /app

USER hydrabase

CMD bun src; sleep 3600
