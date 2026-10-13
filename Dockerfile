FROM node:22-slim AS web
WORKDIR /src
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml* frontend/
RUN cd frontend && pnpm i
COPY frontend frontend
COPY shared shared
RUN mkdir -p backend/app && pnpm --dir frontend build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.8.0 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend backend
COPY prompts prompts
COPY --from=web /src/backend/app/static backend/app/static
ENV PORT=8080
CMD ["sh", "-c", "uv run --no-dev uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT"]
