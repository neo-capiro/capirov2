# Clio analysis sandbox runner (assistant-parity F4).
#
# Pinned, minimal image: Node runner + Python with exactly the allowed
# analysis libraries. Runs non-root with a read-only root filesystem (set
# readonlyRootFilesystem + a tmpfs mount for /tmp in the task definition).
# The task role must have ZERO permissions and the security group ZERO
# egress (see docs/adr/0001-clio-analysis-sandbox-isolation.md).

FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && pip3 install --no-cache-dir --break-system-packages \
    pandas==2.2.3 numpy==2.1.3 matplotlib==3.9.2 \
  && apt-get purge -y python3-pip \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install -g typescript@5.6.2 \
  && tsc -p tsconfig.json \
  && cp src/harness.py dist/harness.py \
  && npm uninstall -g typescript

ENV NODE_ENV=production
USER node
EXPOSE 4100
CMD ["node", "dist/server.js"]
