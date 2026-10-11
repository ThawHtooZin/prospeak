"""Groq Whisper speech-to-text client."""

from __future__ import annotations

import os

import httpx

GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

# Whisper invents these on silence, room noise, and short clips.
_HALLUCINATIONS = {
    "you",
    "thank you",
    "thank you.",
    "thanks",
    "thanks.",
    "thanks for watching",
    "thanks for watching.",
    "thank you for watching",
    "thank you for watching.",
    "bye",
    "bye.",
    "okay",
    "okay.",
    "ok",
    "music",
    "[music]",
    "[applause]",
    "subtitles by the amara.org community",
}


class SpeechToTextError(RuntimeError):
    pass


def clean_transcript(payload: dict) -> str:
    """Keep segments Whisper is confident someone actually said."""
    segments = payload.get("segments") or []
    if not segments:
        text = (payload.get("text") or "").strip()
        return "" if _is_hallucination(text, no_speech=1.0, logprob=-1.0) else text

    kept: list[str] = []
    for segment in segments:
        text = (segment.get("text") or "").strip()
        if not text:
            continue
        no_speech = float(segment.get("no_speech_prob") or 0)
        logprob = float(segment.get("avg_logprob") or 0)
        compression = float(segment.get("compression_ratio") or 0)
        if no_speech > 0.6 or logprob < -1.0 or compression > 2.4:
            continue
        if _is_hallucination(text, no_speech=no_speech, logprob=logprob):
            continue
        kept.append(text)
    return " ".join(kept).strip()


def _is_hallucination(text: str, no_speech: float, logprob: float) -> bool:
    normalized = " ".join(text.lower().split())
    if normalized not in _HALLUCINATIONS:
        return False
    return no_speech > 0.25 or logprob < -0.4


async def transcribe_audio(audio: bytes, filename: str = "speech.wav", mime: str = "audio/wav") -> str:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise SpeechToTextError("GROQ_API_KEY is not set. Add it to python/.env.")

    if not audio:
        raise SpeechToTextError("No audio was received.")

    model = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo")
    form = {
        "model": model,
        "response_format": "verbose_json",
        "language": "en",
        "temperature": "0",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                GROQ_TRANSCRIPTIONS_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                data=form,
                files={"file": (filename, audio, mime or "application/octet-stream")},
            )
            if response.status_code >= 400 and "response_format" in response.text:
                form["response_format"] = "json"
                response = await client.post(
                    GROQ_TRANSCRIPTIONS_URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    data=form,
                    files={"file": (filename, audio, mime or "application/octet-stream")},
                )
    except httpx.HTTPError as exc:
        raise SpeechToTextError(f"Could not reach Groq speech-to-text: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text[:400]
        raise SpeechToTextError(f"Groq speech-to-text failed ({response.status_code}): {detail}")

    return clean_transcript(response.json())
