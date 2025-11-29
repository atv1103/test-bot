from apscheduler.schedulers.background import BackgroundScheduler
import os, time

TMP = "/tmp/whisper"

def cleanup():
    now = time.time()
    for f in os.listdir(TMP):
        full = f"{TMP}/{f}"
        if now - os.path.getmtime(full) > 1800:
            os.remove(full)

def start_cleanup():
    s = BackgroundScheduler()
    s.add_job(cleanup, "interval", minutes=10)
    s.start()
