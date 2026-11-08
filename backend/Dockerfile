# it-help-chatbot backend — Python 3.12 + uv, slim runtime.
# Build:  docker build -t <registry>/it-help-chatbot-backend:0.1.0 backend/
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS base

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/app"

# 1) Install dependencies (cached layer)
# v1.0.1 — drop uv's download cache in the SAME RUN that creates it. `uv sync`
#    hardlinks from /root/.cache/uv into the venv, so deleting the cache here
#    costs nothing at runtime but removes ~1.3GB from the layer; deleting it in
#    a later RUN would not shrink the image at all (layer sizes are additive).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project && rm -rf /root/.cache/uv

# 4) v0.21.54 — bake the reranker model into the image. Without this, every fresh
#    pod re-downloads ~1.1GB from huggingface.co on the first chat request: CPU
#    spikes to 100% for 1-2 minutes, the HPA interprets that as load and spawns
#    MORE cold pods (feedback loop), and users see "chatbot not answering".
#    Loading from the local cache at startup takes ~5s instead.
# v0.22.x — layer ORDER fix: this RUN only needs the venv (step 1), not the app
#    code, so it sits BEFORE the COPY layers. Result: rebuilding after any code
#    change hits the cached model layer — no HF download, build takes seconds.
#    BAKE_RERANKER=0 skips it entirely once RERANK_MODE=remote is rolled out
#    (scoring then lives in rerank-svc) → ~1.1GB lighter image:
#      docker build --build-arg BAKE_RERANKER=0 ...
# v1.0.1 — prod has RERANK_MODE=remote in backend-config and rerank-svc is up,
#    so 1.0.1 is built with BAKE_RERANKER=0. Verified safe: app/rag/reranker.py
#    only reaches CrossEncoder when rerank_mode != "remote" (line 52 returns the
#    remote client first), and the import is lazy inside _get_model(), so nothing
#    touches /opt/hf-cache at startup. The ARG default stays 1 on purpose — a
#    plain `docker build` with RERANK_MODE=local would otherwise fail on
#    HF_HUB_OFFLINE=1 below.
ENV HF_HOME=/opt/hf-cache
# v0.21.54 — cgroup CPU limit is 2 cores. Torch/OMP default to the HOST core count
# (16+), so every inference call oversubscribes, gets throttled by the cgroup, and
# a 20-pair rerank batch that should take ~3s instead takes 49s. Pin to 2.
ENV OMP_NUM_THREADS=2
ENV MKL_NUM_THREADS=2
ARG BAKE_RERANKER=1
# Download the model ONLINE here (build layer), then flip to offline for runtime.
RUN if [ "$BAKE_RERANKER" = "1" ]; then \
      HF_HUB_OFFLINE=0 /app/.venv/bin/python -c "from sentence_transformers import CrossEncoder; CrossEncoder('BAAI/bge-reranker-base', device='cpu')" && \
      du -sh /opt/hf-cache; \
    fi
# v0.21.54 — model is baked in; forbid huggingface.co network checks at runtime.
# Without this, sentence-transformers does HEAD requests against the Hub on every
# first-use load (unauthenticated = rate-limited), which measured 150s+ inside
# _retrieve and made the chatbot feel dead.
ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1

# 2) Copy app + workers + hooks (AFTER the model-bake layer so code changes
#    never invalidate the cached 1.1GB download above)
COPY app ./app
COPY eval ./eval
COPY workers ./workers
COPY scripts ./scripts

# 3) Install the project itself
# v1.0.1 — the first sync already removed the cache, so this RUN recreates it
#    from scratch; clean it again in the same RUN for the same reason.
RUN uv sync --frozen --no-dev && rm -rf /root/.cache/uv

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000

# API
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
