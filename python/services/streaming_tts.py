"""Streaming TTS with inter-sentence pause pacing."""

from __future__ import annotations

import math
import os
import struct
from array import array

import httpx

PAUSE_MS = {
    "fast": 0,
    "normal": 350,
    "slow": 1200,
}

# How much longer the spoken audio is. Beginner lands near 1.45x after overlap.
SPEECH_STRETCH = {
    "fast": 1.0,
    "normal": 1.0,
    "slow": 1.55,
}


class TextToSpeechError(RuntimeError):
    pass


def pause_milliseconds(pause_speed: str | None) -> int:
    return PAUSE_MS.get((pause_speed or "normal").lower(), PAUSE_MS["normal"])


def speech_stretch(pause_speed: str | None) -> float:
    return SPEECH_STRETCH.get((pause_speed or "normal").lower(), 1.0)


def stretch_pcm(pcm: bytes, factor: float) -> bytes:
    """Make speech longer without dropping the pitch. A higher factor is slower."""
    if factor <= 1.01 or len(pcm) < 4:
        return pcm

    samples = array("h")
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    total = len(samples)
    frame = 1200
    hop_in = 600
    hop_out = max(hop_in + 1, int(hop_in * factor))
    if total < frame * 2:
        return pcm

    window = [0.5 * (1 - math.cos(2 * math.pi * i / (frame - 1))) for i in range(frame)]
    starts = range(0, total - frame + 1, hop_in)
    out_len = (len(starts) - 1) * hop_out + frame
    mixed = [0.0] * out_len
    weight = [0.0] * out_len

    for index, pos in enumerate(starts):
        out_pos = index * hop_out
        for i in range(frame):
            mixed[out_pos + i] += samples[pos + i] * window[i]
            weight[out_pos + i] += window[i]

    stretched = array("h")
    for i in range(out_len):
        value = int(mixed[i] / weight[i]) if weight[i] else 0
        if value > 32767:
            value = 32767
        elif value < -32768:
            value = -32768
        stretched.append(value)
    return stretched.tobytes()


def pcm_to_wav(pcm: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    byte_rate = sample_rate * channels * sample_width
    block_align = channels * sample_width
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(pcm),
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        sample_rate,
        byte_rate,
        block_align,
        sample_width * 8,
        b"data",
        len(pcm),
    )
    return header + pcm


def append_silence(pcm: bytes, milliseconds: int, sample_rate: int) -> bytes:
    if milliseconds <= 0:
        return pcm
    sample_count = int(sample_rate * (milliseconds / 1000))
    return pcm + (b"\x00\x00" * sample_count)


async def synthesize_sentence(text: str, pause_speed: str | None) -> dict:
    """Return a browser-playable WAV payload with the selected pause appended."""
    provider = os.getenv("TTS_PROVIDER", "cartesia").strip().lower()
    spoken = text.strip()
    if not spoken:
        raise TextToSpeechError("Nothing to speak.")

    if provider == "deepgram":
        pcm, sample_rate = await _deepgram(spoken)
    elif provider == "elevenlabs":
        pcm, sample_rate = await _elevenlabs(spoken)
    else:
        pcm, sample_rate = await _cartesia(spoken)

    pcm = stretch_pcm(pcm, speech_stretch(pause_speed))
    paced = append_silence(pcm, pause_milliseconds(pause_speed), sample_rate)
    wav = pcm_to_wav(paced, sample_rate=sample_rate)
    return {
        "audio_wav": wav,
        "format": "wav",
        "sample_rate": sample_rate,
        "pause_ms": pause_milliseconds(pause_speed),
        "provider": provider if provider in {"deepgram", "elevenlabs"} else "cartesia",
    }


async def _cartesia(text: str) -> tuple[bytes, int]:
    api_key = os.getenv("CARTESIA_API_KEY", "").strip()
    if not api_key:
        raise TextToSpeechError("CARTESIA_API_KEY is not set. Add it to python/.env or switch TTS_PROVIDER.")

    sample_rate = int(os.getenv("CARTESIA_SAMPLE_RATE", "24000"))
    voice_id = os.getenv("CARTESIA_VOICE_ID", "a0e99841-438c-4a64-b679-ae501e7d6091")
    model = os.getenv("CARTESIA_MODEL", "sonic-2")
    payload = {
        "model_id": model,
        "transcript": text,
        "voice": {"mode": "id", "id": voice_id},
        "output_format": {
            "container": "raw",
            "encoding": "pcm_s16le",
            "sample_rate": sample_rate,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.cartesia.ai/tts/bytes",
                headers={
                    "X-API-Key": api_key,
                    "Cartesia-Version": "2024-11-13",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise TextToSpeechError(f"Could not reach Cartesia: {exc}") from exc

    if response.status_code >= 400:
        raise TextToSpeechError(f"Cartesia failed ({response.status_code}): {response.text[:400]}")

    return response.content, sample_rate


async def _deepgram(text: str) -> tuple[bytes, int]:
    api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
    if not api_key:
        raise TextToSpeechError("DEEPGRAM_API_KEY is not set.")

    model = os.getenv("DEEPGRAM_TTS_MODEL", "aura-asteria-en")
    sample_rate = 24000
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.deepgram.com/v1/speak",
                params={"model": model, "encoding": "linear16", "container": "none", "sample_rate": sample_rate},
                headers={"Authorization": f"Token {api_key}", "Content-Type": "application/json"},
                json={"text": text},
            )
    except httpx.HTTPError as exc:
        raise TextToSpeechError(f"Could not reach Deepgram: {exc}") from exc

    if response.status_code >= 400:
        raise TextToSpeechError(f"Deepgram failed ({response.status_code}): {response.text[:400]}")

    return response.content, sample_rate


async def _elevenlabs(text: str) -> tuple[bytes, int]:
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "").strip()
    if not api_key or not voice_id:
        raise TextToSpeechError("ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must both be set.")

    model = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")
    sample_rate = 24000
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream",
                params={"output_format": "pcm_24000"},
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json={"text": text, "model_id": model},
            )
    except httpx.HTTPError as exc:
        raise TextToSpeechError(f"Could not reach ElevenLabs: {exc}") from exc

    if response.status_code >= 400:
        raise TextToSpeechError(f"ElevenLabs failed ({response.status_code}): {response.text[:400]}")

    return response.content, sample_rate
