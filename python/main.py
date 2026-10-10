"""ProSpeak real-time voice engine.

WebSocket: /ws/chat/{chat_id}

Client messages (JSON):
  {"type": "config", "topic": "...", "pause_speed": "fast|normal|slow"}
  {"type": "audio", "audio": "<base64>", "mime": "audio/webm"}
  {"type": "interrupt"}

Server messages (JSON):
  {"type": "ready", "chat_id": "..."}
  {"type": "transcript", "role": "user"|"assistant", "text": "...", "final": true|false}
  {"type": "audio", "audio": "<base64 wav>", "format": "wav", "sentence": "..."}
  {"type": "turn_complete"}
  {"type": "error", "message": "..."}
"""

from __future__ import annotations

import asyncio
import base64
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from services.groq_llm import LanguageModelError, extract_speakable_chunks, stream_tutor_reply
from services.groq_stt import SpeechToTextError, transcribe_audio
from services.streaming_tts import TextToSpeechError, synthesize_sentence

load_dotenv()

sessions: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    sessions.clear()


app = FastAPI(title="ProSpeak Voice Engine", lifespan=lifespan)

origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def session_state(chat_id: str) -> dict:
    return sessions.setdefault(
        chat_id,
        {
            "topic": None,
            "pause_speed": "normal",
            "history": [],
            "cancel": False,
        },
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "stt_model": os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo"),
        "llm_model": os.getenv("GROQ_LLM_MODEL", "llama-3.3-70b-versatile"),
        "tts_provider": os.getenv("TTS_PROVIDER", "cartesia"),
    }


@app.websocket("/ws/chat/{chat_id}")
async def chat_socket(websocket: WebSocket, chat_id: str):
    await websocket.accept()
    state = session_state(chat_id)
    await websocket.send_json({"type": "ready", "chat_id": chat_id, "pause_speed": state["pause_speed"]})

    try:
        while True:
            incoming = await websocket.receive_json()
            kind = incoming.get("type")

            if kind == "config":
                if "topic" in incoming:
                    state["topic"] = incoming.get("topic") or None
                if incoming.get("pause_speed") in {"fast", "normal", "slow"}:
                    state["pause_speed"] = incoming["pause_speed"]
                await websocket.send_json(
                    {
                        "type": "config_ack",
                        "topic": state["topic"],
                        "pause_speed": state["pause_speed"],
                    }
                )
                if incoming.get("greet") and not state["history"] and not state.get("greeting"):
                    state["greeting"] = True
                    await stream_reply(
                        websocket,
                        state,
                        "Greet me briefly and invite me to start speaking.",
                        [],
                    )
                continue

            if kind == "interrupt":
                state["cancel"] = True
                await websocket.send_json({"type": "interrupted"})
                continue

            if kind == "audio":
                await handle_audio_turn(websocket, state, incoming)
                continue

            await websocket.send_json({"type": "error", "message": f"Unknown message type: {kind}"})
    except WebSocketDisconnect:
        return
    except Exception as exc:  # noqa: BLE001 — last-resort socket error
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            return


async def handle_audio_turn(websocket: WebSocket, state: dict, incoming: dict) -> None:
    state["cancel"] = False
    encoded = incoming.get("audio") or ""
    try:
        audio = base64.b64decode(encoded)
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": "Audio payload was not valid base64."})
        return

    mime = incoming.get("mime") or "audio/webm"
    filename = "speech.webm"
    if "wav" in mime:
        filename = "speech.wav"
    elif "ogg" in mime:
        filename = "speech.ogg"
    elif "mp4" in mime or "m4a" in mime:
        filename = "speech.mp4"

    try:
        transcript = await transcribe_audio(audio, filename=filename, mime=mime)
    except SpeechToTextError as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        return

    if not transcript:
        await websocket.send_json({"type": "turn_complete", "empty": True})
        return

    state["history"].append({"role": "user", "content": transcript})
    await websocket.send_json({"type": "transcript", "role": "user", "text": transcript, "final": True})

    await stream_reply(websocket, state, transcript, state["history"][:-1])


async def stream_reply(websocket: WebSocket, state: dict, user_text: str, prior: list[dict]) -> None:
    buffer = ""
    spoken: list[str] = []
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    send_lock = asyncio.Lock()

    async def emit(payload: dict) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    async def produce() -> None:
        nonlocal buffer
        try:
            async for token in stream_tutor_reply(state["topic"], prior, user_text):
                if state["cancel"]:
                    break
                buffer += token
                chunks, buffer = extract_speakable_chunks(buffer)
                for chunk in chunks:
                    spoken.append(chunk)
                    await queue.put(chunk)
                    await emit(
                        {
                            "type": "transcript",
                            "role": "assistant",
                            "text": " ".join(spoken),
                            "final": False,
                        }
                    )
            tail = buffer.strip()
            if tail and not state["cancel"]:
                spoken.append(tail)
                await queue.put(tail)
                await emit(
                    {
                        "type": "transcript",
                        "role": "assistant",
                        "text": " ".join(spoken),
                        "final": False,
                    }
                )
        except LanguageModelError as exc:
            await emit({"type": "error", "message": str(exc)})
        finally:
            await queue.put(None)

    async def consume() -> None:
        while True:
            chunk = await queue.get()
            if chunk is None or state["cancel"]:
                break
            try:
                spoken_audio = await synthesize_sentence(chunk, state["pause_speed"])
            except TextToSpeechError as exc:
                await emit({"type": "error", "message": str(exc)})
                state["cancel"] = True
                break
            if state["cancel"]:
                break
            await emit(
                {
                    "type": "audio",
                    "audio": base64.b64encode(spoken_audio["audio_wav"]).decode("ascii"),
                    "format": "wav",
                    "sentence": chunk,
                    "pause_ms": spoken_audio["pause_ms"],
                }
            )

    await asyncio.gather(produce(), consume())

    final_text = " ".join(spoken).strip()
    if final_text:
        state["history"].append({"role": "assistant", "content": final_text})
        await emit({"type": "transcript", "role": "assistant", "text": final_text, "final": True})
    await emit({"type": "turn_complete"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8001")),
        reload=True,
    )
