# Web build: the Vite app (and /demo/, which imports ../fixtures) → backend/app/static.
# Public VITE_* values come from frontend/.env.production (written by scripts/deploy.sh; git-ignored).
FROM node:22-slim AS web
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/
RUN cd frontend && pnpm install --frozen-lockfile
COPY frontend frontend
COPY fixtures fixtures
COPY shared shared
RUN mkdir -p backend/app && pnpm --dir frontend build

# API: FastAPI + the built web app, one Cloud Run service.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH" PORT=8080
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend backend
COPY prompts prompts
COPY --from=web /src/backend/app/static backend/app/static
RUN useradd --system --uid 10001 app
USER app
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT"]
