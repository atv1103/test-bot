from flask import Flask, request, jsonify
import subprocess
import os
import uuid
import time
import requests
from apscheduler.schedulers.background import BackgroundScheduler
import logging

app = Flask(__name__)

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Конфигурация
MODEL = "/app/whisper.cpp/models/ggml-base.bin"
WHISPER = "/app/whisper.cpp/main"
ADMIN_ID = os.getenv("ADMIN_ID")
BOT_TOKEN = os.getenv("BOT_TOKEN")
TMP_DIR = "/tmp"

# Создаем временную директорию
os.makedirs(TMP_DIR, exist_ok=True)

def notify_admin(text: str) -> None:
    """Отправка уведомления админу в Telegram"""
    if not ADMIN_ID or not BOT_TOKEN:
        logger.warning("ADMIN_ID or BOT_TOKEN not set, skipping notification")
        return
    
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    try:
        response = requests.post(
            url,
            json={"chat_id": ADMIN_ID, "text": f"⚠️ Whisper: {text}"},
            timeout=5
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to notify admin: {e}")

def cleanup_tmp() -> None:
    """Очистка старых временных файлов"""
    try:
        now = time.time()
        max_age = 1800  # 30 минут
        cleaned_count = 0
        
        if not os.path.exists(TMP_DIR):
            return
            
        for filename in os.listdir(TMP_DIR):
            filepath = os.path.join(TMP_DIR, filename)
            try:
                if os.path.isfile(filepath):
                    file_age = now - os.path.getmtime(filepath)
                    if file_age > max_age:
                        os.remove(filepath)
                        cleaned_count += 1
                        logger.debug(f"Removed old file: {filename}")
            except OSError as e:
                logger.error(f"Error removing file {filename}: {e}")
        
        if cleaned_count > 0:
            logger.info(f"Cleanup: removed {cleaned_count} old files")
            
    except Exception as e:
        error_msg = f"Cleanup error: {str(e)}"
        logger.error(error_msg)
        notify_admin(error_msg)

# Настройка планировщика
scheduler = BackgroundScheduler()
scheduler.add_job(cleanup_tmp, 'interval', minutes=10)
scheduler.start()

@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "model": os.path.basename(MODEL),
        "tmp_files": len([f for f in os.listdir(TMP_DIR) if os.path.isfile(os.path.join(TMP_DIR, f))])
    })

@app.route("/stt", methods=["POST"])
def stt():
    """Speech-to-text endpoint"""
    ogg_path = None
    wav_path = None
    
    try:
        # Проверка наличия файла
        if "file" not in request.files:
            logger.warning("No file in request")
            return jsonify({"error": "no file"}), 400

        file = request.files["file"]
        
        # Генерация уникальных имен файлов
        file_id = str(uuid.uuid4())
        ogg_path = os.path.join(TMP_DIR, f"{file_id}.ogg")
        wav_path = os.path.join(TMP_DIR, f"{file_id}.wav")

        # Сохранение загруженного файла
        file.save(ogg_path)
        logger.info(f"Saved audio file: {ogg_path}")

        # Конвертация OGG → WAV с помощью ffmpeg
        try:
            conversion_result = subprocess.run(
                ["ffmpeg", "-i", ogg_path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if conversion_result.returncode != 0:
                error_msg = f"FFmpeg conversion failed: {conversion_result.stderr[:500]}"
                logger.error(error_msg)
                notify_admin(error_msg)
                return jsonify({"error": "ffmpeg_failed"}), 500
                
            logger.info(f"Converted to WAV: {wav_path}")
            
        except subprocess.TimeoutExpired:
            error_msg = "FFmpeg conversion timeout"
            logger.error(error_msg)
            notify_admin(error_msg)
            return jsonify({"error": "ffmpeg_timeout"}), 500

        # Проверка существования WAV файла
        if not os.path.exists(wav_path):
            error_msg = "WAV file not created after conversion"
            logger.error(error_msg)
            notify_admin(error_msg)
            return jsonify({"error": "conversion_failed"}), 500

        # Запуск Whisper.cpp
        try:
            whisper_result = subprocess.run(
                [WHISPER, "-m", MODEL, "-f", wav_path, "--no-timestamps"],
                capture_output=True,
                text=True,
                timeout=120
            )
            
            if whisper_result.returncode != 0:
                error_msg = f"Whisper.cpp error: {whisper_result.stderr[:500]}"
                logger.error(error_msg)
                notify_admin(error_msg)
                return jsonify({"error": "whisper_failed"}), 500
            
            # Извлечение текста
            text = whisper_result.stdout.strip()
            
            if not text:
                error_msg = "Whisper returned empty text"
                logger.warning(error_msg)
                notify_admin(error_msg)
                return jsonify({"error": "empty_text", "text": ""}), 200
            
            logger.info(f"Transcription successful: {len(text)} characters")
            return jsonify({"text": text})
            
        except subprocess.TimeoutExpired:
            error_msg = "Whisper processing timeout"
            logger.error(error_msg)
            notify_admin(error_msg)
            return jsonify({"error": "whisper_timeout"}), 500

    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        logger.error(error_msg, exc_info=True)
        notify_admin(error_msg)
        return jsonify({"error": "internal_error"}), 500
        
    finally:
        # Гарантированная очистка временных файлов
        for path in [ogg_path, wav_path]:
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                    logger.debug(f"Cleaned up: {path}")
                except OSError as e:
                    logger.error(f"Failed to remove {path}: {e}")

@app.errorhandler(Exception)
def handle_exception(e):
    """Глобальный обработчик ошибок"""
    logger.error(f"Unhandled exception: {str(e)}", exc_info=True)
    notify_admin(f"Unhandled exception: {str(e)}")
    return jsonify({"error": "internal_error"}), 500

if __name__ == "__main__":
    logger.info("Starting Whisper server...")
    logger.info(f"Model: {MODEL}")
    logger.info(f"Whisper binary: {WHISPER}")
    
    # Проверка наличия необходимых файлов
    if not os.path.exists(MODEL):
        logger.error(f"Model file not found: {MODEL}")
        exit(1)
    
    if not os.path.exists(WHISPER):
        logger.error(f"Whisper binary not found: {WHISPER}")
        exit(1)
    
    app.run(host="0.0.0.0", port=8000, debug=False)
