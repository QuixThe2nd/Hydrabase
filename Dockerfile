# ---- deps stage ----
FROM oven/bun AS deps
WORKDIR /app
RUN chown bun:bun /app
USER bun
COPY --chown=bun:bun package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- release stage ----
FROM oven/bun AS release
WORKDIR /app
RUN chown bun:bun /app
USER bun

COPY --chown=bun:bun --from=deps /app/node_modules ./node_modules
COPY --chown=bun:bun . .

ENV NODE_ENV=production
EXPOSE 4545/tcp
EXPOSE 45454/udp
CMD bun src; sleep 3600
