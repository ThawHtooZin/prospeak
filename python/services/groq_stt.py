"""Groq Whisper speech-to-text client."""

from __future__ import annotations

import os

import httpx

GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


class SpeechToTextError(RuntimeError):
    pass


async def transcribe_audio(audio: bytes, filename: str = "speech.webm", mime: str = "audio/webm") -> str:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise SpeechToTextError("GROQ_API_KEY is not set. Add it to python/.env.")

    if not audio:
        raise SpeechToTextError("No audio was received.")

    model = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                GROQ_TRANSCRIPTIONS_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                data={"model": model, "response_format": "json", "language": "en"},
                files={"file": (filename, audio, mime or "application/octet-stream")},
            )
    except httpx.HTTPError as exc:
        raise SpeechToTextError(f"Could not reach Groq speech-to-text: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text[:400]
        raise SpeechToTextError(f"Groq speech-to-text failed ({response.status_code}): {detail}")

    text = (response.json().get("text") or "").strip()
    return text
