<?php

namespace App\Models;

use App\Enums\MessageSender;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ChatMessage extends Model
{
    use HasUuids;

    public const UPDATED_AT = null;

    protected $fillable = [
        'chat_session_id',
        'sender',
        'content',
        'vocabulary',
        'audio_url',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'sender' => MessageSender::class,
            'vocabulary' => 'array',
            'created_at' => 'datetime',
        ];
    }

    /**
     * @return array{id: string, sender: string, content: string, vocabulary: array<int, array{phrase: string, meaning: string}>|null, created_at: string|null}
     */
    public function toClientArray(): array
    {
        return [
            'id' => $this->id,
            'sender' => $this->sender->value,
            'content' => $this->content,
            'vocabulary' => $this->vocabulary,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }

    public function chatSession(): BelongsTo
    {
        return $this->belongsTo(ChatSession::class);
    }
}
