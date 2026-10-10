"""Token-streaming tutor replies from Groq."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

import httpx

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

SYSTEM_PROMPT = (
    "You are an encouraging, polite English tutor. Engage in dynamic back-and-forth dialogue. "
    "Keep responses concise (1 to 3 sentences max). "
    "Speak naturally, as if you are talking out loud. Do not use markdown, lists, or emojis. "
    "Topic: {topic}."
)


class LanguageModelError(RuntimeError):
    pass


def build_messages(topic: str | None, history: list[dict], user_text: str) -> list[dict]:
    topic_label = topic.strip() if topic and topic.strip() else (
        "Detect the topic dynamically from the conversation and stay with it."
    )
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT.format(topic=topic_label)},
    ]
    for turn in history[-12:]:
        role = "assistant" if turn.get("role") == "assistant" else "user"
        content = (turn.get("content") or "").strip()
        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_text})
    return messages


async def stream_tutor_reply(topic: str | None, history: list[dict], user_text: str) -> AsyncIterator[str]:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise LanguageModelError("GROQ_API_KEY is not set. Add it to python/.env.")

    model = os.getenv("GROQ_LLM_MODEL", "llama-3.3-70b-versatile")
    payload = {
        "model": model,
        "stream": True,
        "temperature": 0.7,
        "max_tokens": 180,
        "messages": build_messages(topic, history, user_text),
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                GROQ_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", errors="replace")[:400]
                    raise LanguageModelError(f"Groq chat failed ({response.status_code}): {body}")

                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    token = delta.get("content") or ""
                    if token:
                        yield token
    except httpx.HTTPError as exc:
        raise LanguageModelError(f"Could not reach Groq chat: {exc}") from exc


_ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "st", "prof", "jr", "sr", "etc", "vs"}


def _is_abbreviation(buffer: str, period_index: int) -> bool:
    start = period_index - 1
    while start >= 0 and buffer[start].isalpha():
        start -= 1
    word = buffer[start + 1 : period_index]
    return word.lower() in _ABBREVIATIONS or (len(word) == 1 and word.isupper())


def extract_speakable_chunks(buffer: str) -> tuple[list[str], str]:
    """Split completed clauses on . , ! ? and keep the unfinished tail."""
    chunks: list[str] = []
    start = 0
    index = 0
    while index < len(buffer):
        character = buffer[index]
        if character in ".!?,":
            previous = buffer[index - 1] if index else ""
            nxt = buffer[index + 1] if index + 1 < len(buffer) else ""
            if character == "." and _is_abbreviation(buffer, index):
                index += 1
                continue
            if character == "." and previous.isdigit() and nxt.isdigit():
                index += 1
                continue
            if nxt and not nxt.isspace() and nxt not in "\"'”’)]}":
                index += 1
                continue
            piece = buffer[start : index + 1].strip()
            if piece:
                chunks.append(piece)
            start = index + 1
            while start < len(buffer) and buffer[start].isspace():
                start += 1
            index = start
            continue
        index += 1
    return chunks, buffer[start:]
