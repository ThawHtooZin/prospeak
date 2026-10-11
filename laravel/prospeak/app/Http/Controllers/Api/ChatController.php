<?php

namespace App\Http\Controllers\Api;

use App\Enums\MessageSender;
use App\Enums\PauseSpeed;
use App\Http\Controllers\Controller;
use App\Models\ChatMessage;
use App\Models\ChatSession;
use App\Support\Topics;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ChatController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $chats = $request->user()
            ->chatSessions()
            ->latest('updated_at')
            ->get()
            ->map(fn (ChatSession $chat) => $this->summary($chat));

        return response()->json(['chats' => $chats]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'topic' => ['nullable', 'string', 'max:255'],
            'custom_topic' => ['sometimes', 'boolean'],
            'skip_topic' => ['sometimes', 'boolean'],
            'pause_speed' => ['required', Rule::enum(PauseSpeed::class)],
        ]);

        $skip = $request->boolean('skip_topic');
        $custom = $request->boolean('custom_topic');
        $topic = $skip ? null : trim((string) ($data['topic'] ?? ''));

        if (! $skip && $topic === '') {
            throw ValidationException::withMessages([
                'topic' => 'Choose a topic, write your own, or skip.',
            ]);
        }

        if (! $skip && ! $custom && ! in_array($topic, Topics::PRESETS, true)) {
            throw ValidationException::withMessages([
                'topic' => 'Choose one of the preset topics.',
            ]);
        }

        $chat = $request->user()->chatSessions()->create([
            'title' => $topic ? Str::limit($topic, 80, '') : 'Free conversation',
            'topic' => $topic,
            'pause_speed' => PauseSpeed::from($data['pause_speed']),
        ]);

        return response()->json([
            'chat_id' => $chat->id,
            'status' => 'created',
            'websocket_url' => $this->websocketUrl($chat),
        ], 201);
    }

    public function show(Request $request, ChatSession $chat): JsonResponse
    {
        $this->authorizeChat($request, $chat);
        $chat->load(['messages' => fn ($query) => $query->orderBy('created_at')->orderBy('id')]);

        return response()->json([
            ...$this->summary($chat),
            'websocket_url' => $this->websocketUrl($chat),
            'messages' => $chat->messages->map(fn (ChatMessage $message) => [
                ...$message->toClientArray(),
                'audio_url' => $message->audio_url,
            ]),
        ]);
    }

    public function updateSettings(Request $request, ChatSession $chat): JsonResponse
    {
        $this->authorizeChat($request, $chat);

        $data = $request->validate([
            'pause_speed' => ['required', Rule::enum(PauseSpeed::class)],
        ]);

        $chat->update([
            'pause_speed' => PauseSpeed::from($data['pause_speed']),
        ]);

        return response()->json([
            'chat_id' => $chat->id,
            'pause_speed' => $chat->pause_speed->value,
        ]);
    }

    public function destroy(Request $request, ChatSession $chat): Response
    {
        $this->authorizeChat($request, $chat);
        $chat->delete();

        return response()->noContent();
    }

    public function storeMessage(Request $request, ChatSession $chat): JsonResponse
    {
        $this->authorizeChat($request, $chat);

        $data = $request->validate([
            'sender' => ['required', Rule::enum(MessageSender::class)],
            'content' => ['required', 'string', 'max:5000'],
            'audio_url' => ['nullable', 'string', 'max:2048'],
            'vocabulary' => ['sometimes', 'array', 'max:6'],
            'vocabulary.*.phrase' => ['required', 'string', 'max:80'],
            'vocabulary.*.meaning' => ['required', 'string', 'max:160'],
        ]);

        $isFirstUserLine = $data['sender'] === MessageSender::User->value
            && $chat->topic === null
            && $chat->title === 'Free conversation'
            && $chat->messages()->doesntExist();

        $sender = MessageSender::from($data['sender']);
        $message = $chat->messages()->create([
            'sender' => $sender,
            'content' => trim($data['content']),
            'audio_url' => $data['audio_url'] ?? null,
            'vocabulary' => $sender === MessageSender::Assistant ? ($data['vocabulary'] ?? null) : null,
        ]);

        if ($isFirstUserLine) {
            $chat->title = Str::limit($message->content, 48, '');
        }

        $chat->touch();

        return response()->json($message->toClientArray(), 201);
    }

    public function updateVocabulary(Request $request, ChatSession $chat, string $message): JsonResponse
    {
        $this->authorizeChat($request, $chat);

        $record = $chat->messages()->whereKey($message)->firstOrFail();
        $data = $request->validate([
            'vocabulary' => ['present', 'array', 'max:6'],
            'vocabulary.*.phrase' => ['required', 'string', 'max:80'],
            'vocabulary.*.meaning' => ['required', 'string', 'max:160'],
        ]);

        $record->vocabulary = array_values($data['vocabulary']);
        $record->save();

        return response()->json($record->toClientArray());
    }

    private function authorizeChat(Request $request, ChatSession $chat): void
    {
        abort_unless($chat->user_id === $request->user()->id, 404);
    }

    private function websocketUrl(ChatSession $chat): string
    {
        return rtrim((string) config('services.prospeak.ws_url'), '/').'/ws/chat/'.$chat->id;
    }

    /**
     * @return array{id: string, title: string, topic: string|null, pause_speed: string, updated_at: string|null}
     */
    private function summary(ChatSession $chat): array
    {
        return [
            'id' => $chat->id,
            'title' => $chat->title,
            'topic' => $chat->topic,
            'pause_speed' => $chat->pause_speed->value,
            'updated_at' => $chat->updated_at?->toIso8601String(),
        ];
    }
}
