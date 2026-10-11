import { type ChatMessageItem, type VocabularyItem } from '@/types/chat';
import { type PauseSpeed } from '@/types';

function csrfToken(): string {
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
    const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-XSRF-TOKEN': csrfToken(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const errors = payload.errors as Record<string, string[]> | undefined;
        const first = errors ? Object.values(errors)[0]?.[0] : undefined;
        throw new Error(first || payload.message || 'Request failed.');
    }

    return payload as T;
}

export function createChat(input: {
    topic: string | null;
    custom_topic: boolean;
    skip_topic: boolean;
    pause_speed: PauseSpeed;
}) {
    return request<{ chat_id: string; status: string; websocket_url: string }>('/api/v1/chats', 'POST', input);
}

export function deleteChat(chatId: string) {
    return request<{ status?: string }>(`/api/v1/chats/${chatId}`, 'DELETE');
}

export function updatePauseSpeed(chatId: string, pauseSpeed: PauseSpeed) {
    return request<{ chat_id: string; pause_speed: PauseSpeed }>(`/api/v1/chats/${chatId}/settings`, 'PATCH', {
        pause_speed: pauseSpeed,
    });
}

export function fetchMessages(chatId: string) {
    return request<{ messages: ChatMessageItem[] }>(`/api/v1/chats/${chatId}`, 'GET');
}

export function storeMessage(
    chatId: string,
    sender: 'user' | 'assistant',
    content: string,
    vocabulary?: VocabularyItem[] | null,
) {
    return request<{ id: string }>(`/api/v1/chats/${chatId}/messages`, 'POST', {
        sender,
        content,
        ...(vocabulary != null ? { vocabulary } : {}),
    });
}

export function saveVocabulary(chatId: string, messageId: string, vocabulary: VocabularyItem[]) {
    return request<ChatMessageItem>(`/api/v1/chats/${chatId}/messages/${messageId}/vocabulary`, 'PATCH', {
        vocabulary,
    });
}
