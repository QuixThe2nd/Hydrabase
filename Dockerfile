FROM oven/bun

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone https://github.com/QuixThe2nd/Hydrabase .
RUN bun install

CMD ["bun", "src"]