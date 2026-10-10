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
        'audio_url',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'sender' => MessageSender::class,
            'created_at' => 'datetime',
        ];
    }

    public function chatSession(): BelongsTo
    {
        return $this->belongsTo(ChatSession::class);
    }
}
