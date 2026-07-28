#!/usr/bin/env python3
"""speak.py — Edge neural TTS with clean stop support via signal file."""
import asyncio
import edge_tts
import tempfile
import sys
import os
import subprocess

VOICE     = "en-US-AriaNeural"
RATE      = "+0%"
STOP_FILE = os.path.join(tempfile.gettempdir(), "jv_speak_stop")

# Audio player runs as a child process.
# It polls for STOP_FILE and sends MCI stop/close before exiting —
# this is the only reliable way to flush the Windows audio buffer.
_PLAYER = r"""
import ctypes, sys, os, time

tmp       = sys.argv[1]
stop_file = sys.argv[2]

winmm = ctypes.WinDLL("winmm")
winmm.mciSendStringW(f'open "{tmp}" type mpegvideo alias tts', None, 0, 0)

buf = ctypes.create_unicode_buffer(256)
winmm.mciSendStringW('status tts length', buf, 255, 0)
try:    duration_ms = int(buf.value)
except: duration_ms = 300_000

winmm.mciSendStringW('play tts', None, 0, 0)   # non-blocking

elapsed = 0
while elapsed < duration_ms:
    if os.path.exists(stop_file):
        break
    time.sleep(0.05)
    elapsed += 50

# Graceful stop — this actually flushes the buffer
winmm.mciSendStringW('stop tts', None, 0, 0)
winmm.mciSendStringW('close tts', None, 0, 0)
try: os.unlink(tmp)
except: pass
"""

async def speak(text: str) -> None:
    # Clear any stale stop signal
    try: os.unlink(STOP_FILE)
    except: pass

    communicate = edge_tts.Communicate(text, VOICE, rate=RATE)
    tmp = tempfile.mktemp(suffix=".mp3")
    await communicate.save(tmp)

    proc = subprocess.Popen(
        [sys.executable, "-c", _PLAYER, tmp, STOP_FILE],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    proc.wait()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            text = f.read().strip()
    else:
        text = sys.stdin.read().strip()
    if text:
        asyncio.run(speak(text))
