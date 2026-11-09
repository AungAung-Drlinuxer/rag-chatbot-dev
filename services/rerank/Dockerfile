# CPU-only cross-encoder service. Small on purpose: one job, one model.
#
# Build (model is baked in at build time, so the pod needs no HuggingFace access):
#   docker build -t <registry>/rerank-svc:1.0.2 services/rerank/
#
# The torch wheel comes from the CPU index — the default wheel drags in ~2.5GB of
# CUDA libraries that this image can never use.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2

WORKDIR /svc

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
      -r requirements.txt

# Bake the model. Without this every fresh pod downloads ~1.1GB on its first
# request, which the caller sees as a timeout and silently degrades to vector order.
ARG RERANK_MODEL=BAAI/bge-reranker-base
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('${RERANK_MODEL}', device='cpu')" \
    && du -sh /models
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    RERANK_MODEL=${RERANK_MODEL}

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin svc \
    && chown -R svc:svc /svc /models
USER 10001

COPY --chown=10001:10001 app.py .

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
