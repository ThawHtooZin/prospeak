<?php

namespace Tests\Feature;

use App\Models\ChatSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class ChatSessionTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_create_a_chat_and_change_pause_speed(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/v1/chats', [
            'topic' => 'Ordering Food',
            'custom_topic' => false,
            'pause_speed' => 'normal',
        ]);

        $response->assertCreated()
            ->assertJsonPath('status', 'created')
            ->assertJsonStructure(['chat_id', 'websocket_url']);

        $chatId = $response->json('chat_id');

        $this->assertDatabaseHas('chat_sessions', [
            'id' => $chatId,
            'user_id' => $user->id,
            'topic' => 'Ordering Food',
            'pause_speed' => 'normal',
            'title' => 'Ordering Food',
        ]);

        $this->actingAs($user)->patchJson("/api/v1/chats/{$chatId}/settings", [
            'pause_speed' => 'slow',
        ])->assertOk()->assertJsonPath('pause_speed', 'slow');

        $this->actingAs($user)->postJson("/api/v1/chats/{$chatId}/messages", [
            'sender' => 'user',
            'content' => 'A table for two, please.',
        ])->assertCreated();

        $this->assertDatabaseHas('chat_messages', [
            'chat_session_id' => $chatId,
            'sender' => 'user',
            'content' => 'A table for two, please.',
        ]);
    }

    public function test_custom_and_skipped_topics_are_stored(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/v1/chats', [
            'topic' => 'Buying a train ticket',
            'custom_topic' => true,
            'pause_speed' => 'fast',
        ])->assertCreated();

        $this->assertDatabaseHas('chat_sessions', [
            'user_id' => $user->id,
            'topic' => 'Buying a train ticket',
            'pause_speed' => 'fast',
        ]);

        $this->actingAs($user)->postJson('/api/v1/chats', [
            'topic' => null,
            'skip_topic' => true,
            'pause_speed' => 'normal',
        ])->assertCreated();

        $this->assertDatabaseHas('chat_sessions', [
            'user_id' => $user->id,
            'topic' => null,
            'title' => 'Free conversation',
        ]);
    }

    public function test_users_cannot_open_someone_elses_chat(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $chat = ChatSession::query()->create([
            'user_id' => $owner->id,
            'title' => 'Job Interview',
            'topic' => 'Job Interview',
            'pause_speed' => 'normal',
        ]);

        $this->actingAs($other)->get("/chats/{$chat->id}")->assertNotFound();
        $this->actingAs($other)->patchJson("/api/v1/chats/{$chat->id}/settings", [
            'pause_speed' => 'fast',
        ])->assertNotFound();
    }

    public function test_authenticated_user_can_open_the_chat_page(): void
    {
        $this->withoutVite();

        $user = User::factory()->create();
        $chat = ChatSession::query()->create([
            'user_id' => $user->id,
            'title' => 'Travel & Airports',
            'topic' => 'Travel & Airports',
            'pause_speed' => 'slow',
        ]);

        $this->actingAs($user)
            ->get("/chats/{$chat->id}")
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('chats/show')
                ->where('chat.topic', 'Travel & Airports')
                ->where('chat.pause_speed', 'slow'));
    }
}
