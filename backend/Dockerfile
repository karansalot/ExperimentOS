# ExperimentOS API. Serves the cached artifacts; row-level data is optional (needed only for retraining).
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 EXPERIMENTOS_ROOT=/app
COPY backend/pyproject.toml backend/pyproject.toml
COPY backend/experimentos backend/experimentos
RUN pip install --no-cache-dir ./backend
COPY artifacts artifacts
EXPOSE 8765
CMD ["uvicorn", "experimentos.api.main:app", "--host", "0.0.0.0", "--port", "8765"]
