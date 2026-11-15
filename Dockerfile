# Self-contained ShiftFlow demo: Next.js app, Python CP-SAT engine and an
# embedded PostgreSQL in one container. Data resets on every restart.
FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && useradd -m -u 1000 user

# Run as a non-root user (uid 1000, as Hugging Face expects).
# PostgreSQL refuses to run as root.
USER user
WORKDIR /home/user/app
ENV HOME=/home/user \
    NEXT_TELEMETRY_DISABLED=1

COPY --chown=user:user package.json package-lock.json ./
RUN npm ci

# Engine: pinned uv, pinned Python 3.12.16 and the locked dependencies.
COPY --chown=user:user backend ./backend
COPY --chown=user:user scripts ./scripts
RUN sh scripts/setup-engine.sh

COPY --chown=user:user . .
RUN npm run build

ENV PORT=7860
EXPOSE 7860
CMD ["sh", "scripts/start-demo.sh"]
