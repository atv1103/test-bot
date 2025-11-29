from flask import Flask, request, jsonify
import pytesseract
from PIL import Image, ImageOps, ImageFilter
import cv2
import numpy as np
import uuid, os, time, requests
from apscheduler.schedulers.background import BackgroundScheduler
from pygments.lexers import guess_lexer, TextLexer
from pygments.util import ClassNotFound

app = Flask(__name__)

ADMIN = os.getenv("ADMIN_ID")
TOKEN = os.getenv("BOT_TOKEN")

def notify_admin(text):
    if ADMIN and TOKEN:
        try:
            requests.post(
                f"https://api.telegram.org/bot{TOKEN}/sendMessage",
                json={"chat_id": ADMIN, "text": f"⚠️ OCR: {text}"}, timeout=5
            )
        except:
            pass

# ---------------------------
# Очистка /tmp (APScheduler)
# ---------------------------
def cleanup_tmp():
    now = time.time()
    max_age = 1800  # 30 минут
    for f in os.listdir("/tmp"):
        p = os.path.join("/tmp", f)
        try:
            if os.path.isfile(p) and (now - os.path.getmtime(p) > max_age):
                os.remove(p)
        except Exception:
            pass

scheduler = BackgroundScheduler()
scheduler.add_job(cleanup_tmp, 'interval', minutes=10)
scheduler.start()

# ---------------------------
# Предобработка изображения
# ---------------------------
def preprocess_image(path):
    # читаем cv2
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("can't read image")

    # resize до разумной ширины (если очень большое)
    h, w = img.shape[:2]
    max_w = 2000
    if w > max_w:
        scale = max_w / w
        img = cv2.resize(img, (int(w*scale), int(h*scale)), interpolation=cv2.INTER_AREA)

    # конвертируем в серый
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # уменьшаем шум
    gray = cv2.fastNlMeansDenoising(gray, h=10)

    # увеличиваем контраст через CLAHE
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    gray = clahe.apply(gray)

    # пороговое (adaptive)
    th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                               cv2.THRESH_BINARY, 15, 9)

    # небольшой морфологический open для удаления точек
    kernel = np.ones((1,1), np.uint8)
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel)

    # записываем временный файл (PIL читается лучше)
    tmp_out = f"/tmp/pre_{uuid.uuid4().hex}.png"
    # используем imwrite с unicode-safe: numpy -> cv2.imencode -> tofile
    _, enc = cv2.imencode('.png', th)
    enc.tofile(tmp_out)
    return tmp_out

# ---------------------------
# Постобработка текста (исправления)
# ---------------------------
import re

COMMON_REPLACEMENTS = [
    # ligatures
    (r'ﬁ', 'fi'),
    (r'ﬂ', 'fl'),
    # long dash variants
    (r'—', '-'),
    (r'–', '-'),
    # weird quotes
    (r'[“”«»]', '"'),
    (r"[‘’‹›`]", "'"),
]

# исправления, специфичные для кода (простые эвристики)
def code_postfix(text):
    # удаляем управляющие и лишние символы (не печатные)
    text = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f]+', '', text)

    # заменить похожие символы: O -> 0, l -> 1 в контексте цифр/hex
    text = re.sub(r'(?<=\b0x)[Oo]+', '0', text)  # hex O->0 after 0x
    # общий: если слово состоит из 1 символа 'O' и рядом цифры, заменить на 0
    text = re.sub(r'(?<=\d)O(?=\d)', '0', text)

    # часто OCR заменяет '|' на 'I' или наоборот — ничего без контекста не трогаем
    # убираем множества лишних пробелов в конце строк
    lines = [re.sub(r'\s+$', '', l) for l in text.splitlines()]
    return '\n'.join(lines)

def postprocess(text):
    for pat, repl in COMMON_REPLACEMENTS:
        text = re.sub(pat, repl, text)
    text = code_postfix(text)
    # убрать повторяющиеся пустые строки больше чем 2
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

# ---------------------------
# Попытка определения языка (Pygments)
# ---------------------------
def detect_language(code_text):
    try:
        lexer = guess_lexer(code_text)
        name = lexer.name.lower()
        # сопоставление к расширению (упрощённо)
        mapping = {
            'python': 'py',
            'javascript': 'js',
            'typescript': 'ts',
            'java': 'java',
            'c++': 'cpp',
            'c': 'c',
            'c#': 'cs',
            'php': 'php',
            'ruby': 'rb',
            'go': 'go',
            'rust': 'rs',
            'shell': 'sh',
            'bash': 'sh',
            'perl': 'pl',
        }
        for key in mapping:
            if key in name:
                return mapping[key]
        # fallback: use first word of lexer name
        return re.sub(r'\W+', '', name.split()[0])[:6]
    except ClassNotFound:
        return 'txt'
    except Exception:
        return 'txt'

# ---------------------------
# API
# ---------------------------
@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.post("/ocr")
def ocr():
    if "file" not in request.files:
        return jsonify({"error": "no file"}), 400

    f = request.files["file"]
    in_path = f"/tmp/{uuid.uuid4().hex}"
    try:
        f.save(in_path)
    except Exception as e:
        notify_admin(f"OCR save error: {str(e)}")
        return jsonify({"error": "save_failed"}), 500

    preproc_path = None
    try:
        preproc_path = preprocess_image(in_path)
        # распознаём — указываем psm для блоков текста (6/11) - 6 = assume a uniform block of text
        custom_oem_psm = "--psm 6"
        text = pytesseract.image_to_string(Image.open(preproc_path), lang='eng+rus', config=custom_oem_psm)
        text = postprocess(text)
        lang = 'txt'
        if text.strip():
            lang = detect_language(text)
        # удаляем временные
        try:
            if os.path.exists(in_path): os.remove(in_path)
            if preproc_path and os.path.exists(preproc_path): os.remove(preproc_path)
        except: pass

        return jsonify({"text": text, "lang": lang})
    except Exception as e:
        notify_admin(f"OCR processing failed: {str(e)}")
        # cleanup best-effort
        try:
            if os.path.exists(in_path): os.remove(in_path)
            if preproc_path and os.path.exists(preproc_path): os.remove(preproc_path)
        except: pass
        return jsonify({"error": "ocr_failed"}), 500

if __name__ == "__main__":
    # ensure /tmp exists
    os.makedirs("/tmp", exist_ok=True)
    app.run(host="0.0.0.0", port=9001)
