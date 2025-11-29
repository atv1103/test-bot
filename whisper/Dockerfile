FROM python:3.10-slim

WORKDIR /app

RUN apt update && apt install -y curl ffmpeg build-essential git && \
    rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/ggerganov/whisper.cpp && \
    cd whisper.cpp && \
    make

COPY server.py .
COPY models/ /app/models/

COPY requirements.txt .
RUN pip install -r requirements.txt


EXPOSE 8000

CMD ["python3", "server.py"]