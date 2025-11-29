FROM python:3.10-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-rus \
    libtesseract-dev \
    libgl1 \
    libglib2.0-0 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server.py /app/server.py

RUN pip install --no-cache-dir \
    flask \
    pillow \
    pytesseract \
    opencv-python-headless \
    requests \
    apscheduler \
    pygments

EXPOSE 9001

CMD ["python3", "/app/server.py"]
