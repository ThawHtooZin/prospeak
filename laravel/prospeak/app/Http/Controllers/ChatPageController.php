<?php

namespace App\Http\Controllers;

use App\Models\ChatSession;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ChatPageController extends Controller
{
    public function show(Request $request, ChatSession $chat): Response
    {
        abort_unless($chat->user_id === $request->user()->id, 404);

        $chat->load(['messages' => fn ($query) => $query->orderBy('created_at')->orderBy('id')]);

        return Inertia::render('chats/show', [
            'chat' => [
                'id' => $chat->id,
                'title' => $chat->title,
                'topic' => $chat->topic,
                'pause_speed' => $chat->pause_speed->value,
                'websocket_url' => rtrim((string) config('services.prospeak.ws_url'), '/').'/ws/chat/'.$chat->id,
                'messages' => $chat->messages->map(fn ($message) => [
                    'id' => $message->id,
                    'sender' => $message->sender->value,
                    'content' => $message->content,
                    'created_at' => $message->created_at?->toIso8601String(),
                ]),
            ],
        ]);
    }
}
