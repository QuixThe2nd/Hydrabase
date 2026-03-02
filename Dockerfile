# ---- deps stage ----
FROM oven/bun AS deps
WORKDIR /app

RUN useradd --create-home --shell /bin/bash --uid 1000 hydrabase
ENV PUID=1000
ENV PGID=1000
ENV UMASK=022

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- release stage ----
FROM oven/bun AS release
WORKDIR /app
RUN chown bun:bun /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
EXPOSE 4545/tcp
EXPOSE 45454/udp
CMD bun src; sleep 3600
