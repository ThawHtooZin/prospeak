import { type ChatSummary, type PauseSpeed } from '@/types';

export interface ChatMessageItem {
    id: string;
    sender: 'user' | 'assistant';
    content: string;
    created_at: string | null;
}

export interface ChatDetail extends ChatSummary {
    websocket_url: string;
    messages: ChatMessageItem[];
}

export const PAUSE_OPTIONS: { id: PauseSpeed; label: string; hint: string }[] = [
    { id: 'fast', label: 'Fast', hint: 'A short breath, about 100ms' },
    { id: 'normal', label: 'Normal', hint: 'A conversational pause, about 350ms' },
    { id: 'slow', label: 'Slow / Beginner', hint: 'Room to listen, about 700ms' },
];
