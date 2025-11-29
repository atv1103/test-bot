from flask import Flask, request
import subprocess, os, uuid, ffmpeg, threading, requests
from apscheduler.schedulers.background import BackgroundScheduler

app = Flask(__name__)

MODEL = "/app/whisper.cpp/models/ggml-base.bin"
WHISPER = "/app/whisper.cpp/main"
ADMIN = os.getenv("ADMIN_ID")
BOT_TOKEN = os.getenv("BOT_TOKEN")

def notify_admin(text):
    if not ADMIN or not TOKEN:
        return
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    requests.post(url, json={"chat_id": ADMIN, "text": f"⚠️ Whisper: {text}"})

# --------------------
# Очистка /tmp
# --------------------
def cleanup_tmp():
    now = time.time()
    max_age = 1800  # 30 минут
    for f in os.listdir("/tmp"):
        path = os.path.join("/tmp", f)
        try:
            if now - os.path.getmtime(path) > max_age:
                os.remove(path)
        except: pass

scheduler = BackgroundScheduler()
scheduler.add_job(cleanup_tmp, 'interval', minutes=10)
scheduler.start()

@app.route("/health")
def health():
    return {"status": "ok"}


@app.post("/stt")
def stt():
    if "file" not in request.files:
        return {"error": "no file"}, 400

    f = request.files["file"]
    ogg_path = f"/tmp/{uuid.uuid4()}.ogg"
    wav_path = f"/tmp/{uuid.uuid4()}.wav"

    f.save(ogg_path)

    # Конвертация OGG → WAV
    try:
        ffmpeg.input(ogg_path).output(wav_path).run(quiet=True)
    except Exception as e:
        notify_admin(f"FFmpeg conversion failed: {str(e)}")
        return {"error": "ffmpeg failed"}

    # Whisper.cpp
    result = subprocess.run(
        [WHISPER, "-m", MODEL, "-f", wav_path],
        capture_output=True,
        text=True
    )
    os.remove(ogg_path)
    os.remove(wav_path)

    if result.returncode != 0:
        notify_admin(f"Whisper.cpp error: {result.stderr[:300]}")
        return {"error": "whisper failed"}

    if not result.stdout.strip():
        notify_admin("Whisper вернул пустой текст")
        return {"error": "empty_text"}

    return {"text": result.stdout.strip()}

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
