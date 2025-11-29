import subprocess

def transcribe_file(path: str) -> str:
    cmd = ["./main", "-m", "models/ggml-base.en.bin", "-f", path]
    out = subprocess.check_output(cmd).decode("utf8")
    return out
