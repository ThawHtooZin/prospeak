# Software Requirements Specification (SRS)
## Project Name: VoiceAI English Learning Platform (Codename: EchoTalk)

---

## 1. System Architecture Overview

```
[ Frontend: Web Browser ]
   │  ▲
   │  │ WebSockets / WebRTC Audio Stream
   ▼  │
[ Laravel Backend (Auth, History, Topics, State) ]
   │
   │ Microservice Call / Redis Queue / WebSocket Gateway
   ▼
[ Python FastAPI Microservice Engine ]
   ├── Groq API (STT - Whisper Large v3 Turbo)
   ├── Groq API (LLM - Llama 3 / Mixtral Streaming)
   └── Cartesia / Deepgram / ElevenLabs (Streaming TTS Engine)
```

* **Laravel Framework:** Manages authentication, user accounts, conversation history, topic storage, speed state, and session routing.
* **Python FastAPI Microservice:** Handles full-duplex audio processing, real-time chunking, sentence buffering, Groq LLM streaming, and streaming TTS delivery.
* **Database:** MySQL / PostgreSQL for relational app data; Redis for real-time WebSocket state management.

---

## 2. Core User Workflows & Technical Rules

### 2.1 User Onboarding & Chat Creation
1. **Auth:** Standard Laravel Breeze / Fortify setup (Register, Login, Password Reset).
2. **Dashboard:** Displays past chat history in a sidebar (similar to ChatGPT/Gemini).
3. **New Chat Trigger:**
   - User clicks **"New Chat"**.
   - Model Modal presents **10 Preset Topics** (e.g., *Job Interview*, *Travel & Airports*, *Ordering Food*, *Casual Small Talk*, etc.).
   - Includes a **Custom Topic** checkbox input field to let users type their own.
   - Option to **Skip Topic** (AI automatically detects topic dynamically from conversation context).
4. **Pause Speed Configuration Modal:**
   - After selecting or skipping the topic, the user sets the **Inter-Word Pause Speed** (Latency Pacing between sentence boundaries).
   - **Pause Speed Range Options:**
     - `Fast`: Minimal silence pause between sentences (~100ms).
     - `Normal`: Standard human conversational pause (~350ms).
     - `Slow / Beginner`: Extended pause between phrases (~700ms) to allow language learners time to digest spoken input.

---

### 2.2 Chat Interface Layout (Web UI)
* **Main Area:** Minimalist voice-first UI.
* **Center Bottom:** Prominent **Microphone Button** featuring an audio visualizer ring while listening or speaking.
* **Speed Adjuster Control:** Positioned directly beside the Microphone button for dynamic speed/pause adjustments mid-conversation.
* **Transcript Toggle (Optional):** Hidden by default to encourage pure listening practice, with a collapsible text view available if needed.

---

## 3. Real-Time Voice Pipeline Specification

### Step 1: Audio Capture (Client-Side JavaScript)
* Capture audio via standard `MediaRecorder` API using WebSockets or chunked WebRTC audio streaming to the Python service.
* **Voice Activity Detection (VAD):** Automatically detect when the user stops speaking for `> 800ms` and ship the buffer.

### Step 2: Speech-to-Text (Python -> Groq)
* Pass user audio blob to Groq Speech-to-Text API (`whisper-large-v3-turbo`).
* Average Latency Goal: **< 200ms**.

### Step 3: LLM Generation & Sentence Chunking (Python -> Groq)
* Stream response from Groq LLM endpoint.
* **System Prompt Constraints:**
  > *"You are an encouraging, polite English tutor. Engage in dynamic back-and-forth dialogue. Keep responses concise (1 to 3 sentences max). Topic: {selected_topic}."*
* **Dynamic Sentence Buffering Logic:**
  - Accumulate incoming tokens into a memory buffer.
  - Split text on punctuation triggers: `[. , ! ?]`.
  - Push completed sentence chunks immediately to the TTS Engine.

### Step 4: Streaming TTS Engine with Pause Pacing
* **Selected Provider:** Cartesia Sonic API or Deepgram Aura / ElevenLabs Flash.
* **Silence Injection:** Insert a synthesized or silent PCM buffer equal to the user's selected **Pause Speed** between each dispatched sentence chunk.
* Deliver base64 or binary PCM audio chunks back to frontend via WebSocket for low-latency client playback.

---

## 4. API & Data Schema

### 4.1 Database Schema (Laravel Migrations)

#### `users`
- `id` (UUID / Primary Key)
- `name` (String)
- `email` (String, Unique)
- `password` (Hashed String)
- `created_at`, `updated_at`

#### `chat_sessions`
- `id` (UUID / Primary Key)
- `user_id` (Foreign Key -> `users.id`)
- `title` (String)
- `topic` (String, Nullable)
- `pause_speed` (Enum: `fast`, `normal`, `slow`)
- `created_at`, `updated_at`

#### `chat_messages`
- `id` (UUID / Primary Key)
- `chat_session_id` (Foreign Key -> `chat_sessions.id`)
- `sender` (Enum: `user`, `assistant`)
- `content` (Text)
- `audio_url` (String, Nullable)
- `created_at`

---

### 4.2 Inter-Service API Contracts

#### Create Chat Session (`POST /api/v1/chats`)
**Request Body:**
```json
{
  "topic": "Ordering Coffee at Starbucks",
  "custom_topic": false,
  "pause_speed": "normal"
}
```
**Response:**
```json
{
  "chat_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status": "created",
  "websocket_url": "wss://api.domain.com/ws/chat/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

#### Speed State Update (`PATCH /api/v1/chats/{chat_id}/settings`)
**Request Body:**
```json
{
  "pause_speed": "slow"
}
```

---

## 5. Directory Structure Guidelines for Cursor

```text
/
├── laravel-backend/            # Main Web Platform
│   ├── app/
│   │   ├── Http/Controllers/Api/ChatController.php
│   │   └── Models/ChatSession.php
│   ├── database/migrations/
│   └── routes/api.php
│
├── python-service/             # Real-time Audio Engine
│   ├── main.py                 # FastAPI WebSocket entry point
│   ├── services/
│   │   ├── groq_stt.py        # Groq Speech-to-Text client
│   │   ├── groq_llm.py        # Token-streaming LLM client
│   │   └── streaming_tts.py   # TTS engine & pause handling
│   └── requirements.txt
│
└── frontend/                   # Blade / React / Tailwind Frontend
    ├── components/
    │   ├── MicButton.jsx
    │   ├── TopicSelectorModal.jsx
    │   └── SpeedControlSlider.jsx
    └── hooks/useAudioStream.js
```