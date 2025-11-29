from flask import Flask, request, jsonify
from whisper import transcribe_file
from cleanup import start_cleanup
from queue import queue, enqueue
import os

app = Flask(__name__)

start_cleanup()  # APScheduler

@app.post("/recognize")
def recognize():
    f = request.files["file"]
    path = f"/tmp/whisper/{f.filename}"
    f.save(path)

    def job():
        return transcribe_file(path)

    text = queue(job)
    return jsonify({"text": text})
