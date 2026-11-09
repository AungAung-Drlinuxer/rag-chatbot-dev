# Ollama with the embedding model baked in.
#
# The backend only uses Ollama for embeddings (`nomic-embed-text`); chat completions
# go to whatever provider is configured in Settings → AI service. Baking the model
# means:
#   * no PVC and no first-request download,
#   * the pod works on an air-gapped cluster,
#   * a restart is ready in seconds instead of minutes.
#
#   docker build -t <registry>/ollama:0.5.7-models infra/images/ollama/
#
# Model files land in /root/.ollama/models. Do NOT mount an empty volume over that
# path — it hides the baked models (that mistake cost a day: the pod reported ready
# and every embedding call failed).
FROM ollama/ollama:0.5.7

ARG EMBED_MODEL=nomic-embed-text
ENV OLLAMA_MODELS=/root/.ollama/models

# The CLI talks to the daemon, so the server has to be up for `ollama pull`.
RUN ollama serve >/tmp/ollama.log 2>&1 & \
    for i in $(seq 1 60); do \
      ollama list >/dev/null 2>&1 && break; \
      sleep 1; \
    done; \
    ollama pull "${EMBED_MODEL}"; \
    ollama list; \
    pkill -f "ollama serve" || true; \
    sleep 1; \
    du -sh /root/.ollama/models

EXPOSE 11434
