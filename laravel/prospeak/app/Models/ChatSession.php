<?php

namespace App\Models;

use App\Enums\PauseSpeed;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ChatSession extends Model
{
    use HasUuids;

    protected $fillable = [
        'user_id',
        'title',
        'topic',
        'pause_speed',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'pause_speed' => PauseSpeed::class,
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ChatMessage::class);
    }
}
