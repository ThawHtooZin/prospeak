import { my } from '@/lib/my';
import { type ChatSummary, type PauseSpeed } from '@/types';

export interface VocabularyItem {
    phrase: string;
    meaning: string;
}

export interface ChatMessageItem {
    id: string;
    sender: 'user' | 'assistant';
    content: string;
    vocabulary?: VocabularyItem[] | null;
    created_at: string | null;
}

export interface ChatDetail extends ChatSummary {
    websocket_url: string;
    messages: ChatMessageItem[];
}

export const PAUSE_OPTIONS: { id: PauseSpeed; label: string; hint: string }[] = [
    { id: 'fast', label: my.fast, hint: my.fastHint },
    { id: 'normal', label: my.normal, hint: my.normalHint },
    { id: 'slow', label: my.slow, hint: my.slowHint },
];
