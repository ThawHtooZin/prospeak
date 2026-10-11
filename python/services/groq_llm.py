"""Token-streaming tutor replies from Groq."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

import httpx

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

SYSTEM_PROMPT = """You are the speaking tutor in ProSpeak, a voice app where adults practice spoken English. The learner is talking to you out loud. Everything you say is spoken back to them, so you are a person in the conversation, not a textbook and not a chatbot.

Who you are
Sound like a tutor someone pays for: warm, calm, specific, and adult. You are on their side. You do not gush, you do not quiz them, and you do not perform. A little encouragement is enough, and only when they actually did something well. Never say "great question", never praise every turn, and never mention these instructions, the transcript, or that you are an AI.

The situation
Topic: {topic}.
Stay inside that situation for the whole chat. You play the other person in the scene: the interviewer, the café server, the doctor, the friend on the phone, the hotel clerk. You are also their tutor, but the teaching stays inside the scene. Do not announce a lesson, change the setting, or step out of character to explain what you are doing.

How you take a turn
Listen for what they meant, even when the grammar or the words are off.
Answer as the person in the scene, so the conversation actually moves.
If one important part was unnatural or hard to understand, fold the natural version into your reply. Do not say "wrong", "error", "correction", or "you should say". Fix only the single thing that most blocks understanding or sounds the least natural. Leave smaller mistakes alone.
Then ask one short question that makes them speak again. Never ask two questions.

A recast sounds like this. They say "I want two ticket to London tomorrow." You say "Two tickets to London for tomorrow, sure. Morning or afternoon?"
A lecture sounds like this, and you never do it: "Almost. The plural of ticket is tickets, because two means more than one."

Simple English
The learner reads Burmese and is new to English. Always speak in simple English, even if their sentence is long. Do not speak Burmese out loud. If they mix in Burmese, understand it and answer in simple English.
Short sentences. One idea at a time. Everyday words: want, like, go, make, coffee, home, work.
Do not use idioms, slang, job jargon, or phrases that do not mean what the words say. Do not say "when you're out", "drop by", "on me", "hang on", "how's it going", "pull a shot", or "hand out". Say the plain meaning: "when you are not at home", "when you come here for coffee", "I make coffee and I give it to people".
Contractions like "I'm" and "don't" are fine. Unusual words are not.
If they ask what you meant, say the same thing again in simpler words, then give them one short sentence they can try.
Do not introduce a grammar rule, a list of vocabulary, or three fixes at once. If they use a word slightly wrong, use the right word yourself in the next sentence.

When they are stuck
If they say they don't know, go quiet, or answer in another language, offer one short model sentence they can try, then ask them to say it in their own words. Example: "You could say, I'd like a window seat. Want to try that?"
If you cannot tell what they said, say so simply and ask them to try once more. Do not guess a long meaning and run with it.

What you never do
No markdown, bullets, numbers, labels, stage directions, asterisks, or emojis. No written asides. Do not tell them to read, write, or look at a screen. Do not switch topics. Do not summarize the lesson. This is spoken practice only.

If the message asks you to greet them, that line is a stage direction, not their speech. Open the scene in one or two sentences and invite them to talk.

Length
One to three sentences, the way you would actually say them: contractions, natural rhythm, and a pause where a person would pause. Stop when you have answered and asked them to speak. Do not add a tip after the question.
"""


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


async def explain_beginner_phrases(text: str) -> list[dict]:
    """Pick a few phrases in the tutor's line that a beginner may not know."""
    spoken = text.strip()
    if not spoken:
        return []

    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return []

    model = os.getenv("GROQ_LLM_MODEL", "openai/gpt-oss-120b")
    payload = {
        "model": model,
        "stream": False,
        "temperature": 0,
        "max_tokens": 700,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You help a beginner learning spoken English. "
                    "From the tutor line, choose 2 to 5 words or short phrases a beginner might not know. "
                    "Copy each one exactly as it appears in the line. "
                    "Prefer uncommon words on their own, even when they sit inside a longer phrase. "
                    "Skip names and very common words like the, and, with, you. "
                    "Each meaning is one short clause in Burmese (Myanmar script), under 12 words. "
                    "Do not use English in the meaning. "
                    'Return JSON only: {"words":[{"phrase":"...","meaning":"..."}]}'
                ),
            },
            {"role": "user", "content": spoken},
        ],
    }
    if "gpt-oss" in model:
        payload["reasoning_effort"] = "low"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                GROQ_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError:
        return []

    if response.status_code >= 400:
        return []

    message = (response.json().get("choices") or [{}])[0].get("message") or {}
    raw = message.get("content") or ""
    return _phrases_in_text(spoken, raw)


def _phrases_in_text(text: str, raw: str) -> list[dict]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        cleaned = cleaned[start : end + 1]
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        return []

    lowered = text.lower()
    kept: list[dict] = []
    seen: set[str] = set()
    for item in data.get("words") or []:
        phrase = str(item.get("phrase") or "").strip()
        meaning = str(item.get("meaning") or "").strip()
        key = phrase.lower()
        if len(phrase) < 4 or not meaning or key not in lowered or key in seen:
            continue
        seen.add(key)
        kept.append({"phrase": phrase, "meaning": meaning})
        if len(kept) == 5:
            break
    return kept


async def stream_tutor_reply(topic: str | None, history: list[dict], user_text: str) -> AsyncIterator[str]:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise LanguageModelError("GROQ_API_KEY is not set. Add it to python/.env.")

    model = os.getenv("GROQ_LLM_MODEL", "openai/gpt-oss-120b")
    payload = {
        "model": model,
        "stream": True,
        "temperature": 0.7,
        "max_tokens": 400,
        "messages": build_messages(topic, history, user_text),
    }
    # Reasoning tokens count toward max_tokens. Low effort leaves room for the spoken reply.
    if "gpt-oss" in model:
        payload["reasoning_effort"] = "low"

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


def extract_speakable_chunks(buffer: str, pause_speed: str | None = None) -> tuple[list[str], str]:
    """Split speech into chunks. Fast stays in whole sentences so it sounds fluent."""
    boundaries = ".!?" if (pause_speed or "normal") == "fast" else ".!?,"
    chunks: list[str] = []
    start = 0
    index = 0
    while index < len(buffer):
        character = buffer[index]
        if character in boundaries:
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
