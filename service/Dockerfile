FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.15 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY skillpool ./skillpool
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH"
USER nobody
# One process: batch progress and rate limits live in its memory.
# exec, so the host's stop signal reaches uvicorn and not the shell. No server header: nothing needs to know what runs here.
CMD ["sh", "-c", "exec uvicorn skillpool.api:app --host 0.0.0.0 --port ${PORT:-8000} --no-server-header"]
