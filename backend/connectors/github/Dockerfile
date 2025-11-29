FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy shared code
COPY shared/ /app/shared/

# Copy connector requirements and install
COPY connectors/github/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy connector code
COPY connectors/github/ /app/

CMD ["python", "main.py"]
