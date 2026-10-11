import { MicButton } from '@/components/practice/MicButton';
import { PracticeShell } from '@/components/practice/PracticeShell';
import { SpeedControlSlider } from '@/components/practice/SpeedControlSlider';
import { useAudioStream } from '@/hooks/useAudioStream';
import { fetchMessages, saveVocabulary, storeMessage, updatePauseSpeed } from '@/lib/chat-api';
import { my, myTitle, myTopic } from '@/lib/my';
import { type ChatDetail, type ChatMessageItem, type VocabularyItem } from '@/types/chat';
import { type PauseSpeed } from '@/types';
import { Head, router } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

function messageKey(message: Pick<ChatMessageItem, 'sender' | 'content'>): string {
    return `${message.sender}:${message.content}`;
}

function mergeMessages(saved: ChatMessageItem[], local: ChatMessageItem[]): ChatMessageItem[] {
    const localByKey = new Map(local.map((message) => [messageKey(message), message]));
    const base = saved.map((message) => {
        const previous = localByKey.get(messageKey(message));
        if (message.vocabulary == null && previous?.vocabulary != null) {
            return { ...message, vocabulary: previous.vocabulary };
        }
        return message;
    });
    const seen = new Set(base.map(messageKey));
    const pending = local.filter((message) => !seen.has(messageKey(message)));
    return [...base, ...pending];
}

const phaseCopy = {
    idle: my.ready,
    listening: my.listening,
    thinking: my.thinking,
    speaking: my.speaking,
};

export default function ChatShow({ chat }: { chat: ChatDetail }) {
    const [messages, setMessages] = useState<ChatMessageItem[]>(chat.messages);
    const [userDraft, setUserDraft] = useState('');
    const [tutorDraft, setTutorDraft] = useState('');
    const [pauseSpeed, setPauseSpeed] = useState<PauseSpeed>(chat.pause_speed);
    const [error, setError] = useState<string | null>(null);
    const savedRef = useRef(new Set(chat.messages.map((message) => `${message.sender}:${message.content}`)));
    const scrollerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setPauseSpeed(chat.pause_speed);
    }, [chat.id, chat.pause_speed]);

    useEffect(() => {
        let cancelled = false;
        const remembered = chat.messages;
        setUserDraft('');
        setTutorDraft('');
        setMessages(remembered);
        savedRef.current = new Set(remembered.map(messageKey));

        void fetchMessages(chat.id)
            .then((detail) => {
                if (cancelled) {
                    return;
                }
                setMessages((current) => {
                    const merged = mergeMessages(detail.messages, current);
                    savedRef.current = new Set(merged.map(messageKey));
                    return merged;
                });
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
        // The saved thread is loaded by chat id. A later page prop must not replace lines already spoken.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chat.id]);

    const onTranscript = useCallback(
        (role: 'user' | 'assistant', text: string, final: boolean, words?: VocabularyItem[]) => {
            if (!final) {
                if (role === 'user') {
                    setUserDraft(text);
                } else {
                    setTutorDraft(text);
                }
                return;
            }

            if (role === 'user') {
                setUserDraft('');
            } else {
                setTutorDraft('');
            }
            const key = messageKey({ sender: role, content: text });
            const vocabulary = role === 'assistant' ? (words ?? null) : null;
            setMessages((current) => {
                if (savedRef.current.has(key) || current.some((message) => message.sender === role && message.content === text)) {
                    if (vocabulary == null) {
                        return current;
                    }
                    return current.map((message) =>
                        message.sender === role && message.content === text && message.vocabulary == null
                            ? { ...message, vocabulary }
                            : message,
                    );
                }
                return [
                    ...current,
                    {
                        id: crypto.randomUUID(),
                        sender: role,
                        content: text,
                        vocabulary,
                        created_at: new Date().toISOString(),
                    },
                ];
            });

            if (savedRef.current.has(key)) {
                return;
            }
            savedRef.current.add(key);
            void storeMessage(chat.id, role, text, vocabulary)
                .then(() => fetchMessages(chat.id))
                .then((detail) => {
                    setMessages((current) => {
                        const merged = mergeMessages(detail.messages, current);
                        savedRef.current = new Set(merged.map(messageKey));
                        return merged;
                    });
                    if (role === 'user') {
                        router.reload({ only: ['chats'] });
                    }
                })
                .catch((caught: unknown) => {
                    setError(caught instanceof Error ? caught.message : my.couldNotSave);
                });
        },
        [chat.id],
    );

    const onVocabulary = useCallback(
        (messageId: string, words: VocabularyItem[]) => {
            setMessages((current) =>
                current.map((message) => (message.id === messageId ? { ...message, vocabulary: words } : message)),
            );
            void saveVocabulary(chat.id, messageId, words).catch(() => undefined);
        },
        [chat.id],
    );

    const onError = useCallback((message: string) => setError(message), []);

    const voice = useAudioStream({
        websocketUrl: chat.websocket_url,
        topic: chat.topic,
        pauseSpeed,
        greet: chat.messages.length === 0,
        onTranscript,
        onVocabulary,
        onError,
    });

    const requestedWords = useRef(new Set<string>());

    useEffect(() => {
        if (!voice.connected) {
            return;
        }
        const missing = messages.filter((message) => message.sender === 'assistant' && message.vocabulary == null);
        for (const message of missing.slice(-8)) {
            if (requestedWords.current.has(message.id)) {
                continue;
            }
            requestedWords.current.add(message.id);
            voice.annotate(message.id, message.content);
        }
    }, [messages, voice.connected, voice.annotate]);

    useEffect(() => {
        scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
    }, [messages, userDraft, tutorDraft]);

    const changeSpeed = (next: PauseSpeed) => {
        setPauseSpeed(next);
        voice.sendConfig(next);
        void updatePauseSpeed(chat.id, next).catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : my.couldNotUpdatePause);
        });
    };

    return (
        <PracticeShell activeChatId={chat.id}>
            <Head title={myTitle(chat.title)} />
            <main className="flex min-h-0 flex-1 flex-col">
                <header className="flex items-center justify-between gap-4 border-b border-[#2b251f] px-6 py-4">
                    <div className="min-w-0">
                        <p className="text-xs text-[#a39888]">
                            {myTopic(chat.topic)}
                        </p>
                        <h1 className="truncate font-serif text-2xl">{myTitle(chat.title)}</h1>
                    </div>
                    <p className="shrink-0 text-sm text-[#a39888]">
                        {voice.connected ? phaseCopy[voice.phase] : my.connecting}
                    </p>
                </header>

                <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                    <div role="log" aria-live="polite" className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                        {messages.length === 0 && !userDraft && !tutorDraft && (
                            <p className="px-2 py-16 text-center text-sm text-[#a39888]">
                                {my.emptyThread}
                            </p>
                        )}
                        {messages.map((message) => (
                            <ChatBubble
                                key={message.id}
                                sender={message.sender}
                                content={message.content}
                                vocabulary={message.vocabulary}
                                onRepeat={message.sender === 'assistant' ? voice.repeat : undefined}
                            />
                        ))}
                        {userDraft && <ChatBubble sender="user" content={userDraft} pending />}
                        {tutorDraft && <ChatBubble sender="assistant" content={tutorDraft} pending />}
                    </div>
                </div>

                {error && <p className="px-6 pb-2 text-center text-sm text-[#ffb4a8]">{error}</p>}

                <footer className="border-t border-[#2b251f] px-4 py-4 sm:px-6">
                    <div className="mx-auto flex w-full max-w-3xl items-end justify-center gap-4">
                        <MicButton phase={voice.phase} level={voice.level} onClick={() => void voice.startListening()} />
                        <div className="w-56 pb-2">
                            <p className="mb-2 text-center text-xs text-[#a39888]">{my.pauseSpeed}</p>
                            <SpeedControlSlider compact value={pauseSpeed} onChange={changeSpeed} />
                        </div>
                    </div>
                </footer>
            </main>
        </PracticeShell>
    );
}

function phraseRanges(content: string, words: VocabularyItem[]): { start: number; end: number }[] {
    const ranges: { start: number; end: number }[] = [];
    const lower = content.toLowerCase();
    const sorted = [...words].sort((left, right) => right.phrase.length - left.phrase.length);

    for (const word of sorted) {
        const needle = word.phrase.trim().toLowerCase();
        if (needle.length < 4) {
            continue;
        }
        let from = 0;
        while (from < lower.length) {
            const index = lower.indexOf(needle, from);
            if (index < 0) {
                break;
            }
            const end = index + needle.length;
            const overlaps = ranges.some((range) => index < range.end && end > range.start);
            if (!overlaps) {
                ranges.push({ start: index, end });
            }
            from = end;
        }
    }

    return ranges.sort((left, right) => left.start - right.start);
}

function highlightedText(content: string, words: VocabularyItem[] | null | undefined) {
    const ranges = phraseRanges(content, words ?? []);
    if (ranges.length === 0) {
        return content;
    }

    const pieces: ReactNode[] = [];
    let cursor = 0;
    ranges.forEach((range, index) => {
        if (range.start > cursor) {
            pieces.push(content.slice(cursor, range.start));
        }
        pieces.push(
            <span key={index} className="underline decoration-[#e8a04a] decoration-2 underline-offset-4">
                {content.slice(range.start, range.end)}
            </span>,
        );
        cursor = range.end;
    });
    if (cursor < content.length) {
        pieces.push(content.slice(cursor));
    }
    return pieces;
}

function ChatBubble({
    sender,
    content,
    vocabulary = null,
    pending = false,
    onRepeat,
}: {
    sender: 'user' | 'assistant';
    content: string;
    vocabulary?: VocabularyItem[] | null;
    pending?: boolean;
    onRepeat?: (text: string) => void;
}) {
    const mine = sender === 'user';
    const words = vocabulary ?? [];

    return (
        <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] sm:max-w-[75%] ${pending ? 'opacity-80' : ''}`}>
                <div className={`mb-1 flex items-center gap-3 ${mine ? 'justify-end' : 'justify-start'}`}>
                    <p className="text-xs text-[#a39888]">{mine ? my.you : my.tutor}</p>
                    {!mine && !pending && onRepeat && (
                        <button
                            type="button"
                            onClick={() => onRepeat(content)}
                            className="text-xs text-[#e8a04a] hover:text-[#f4efe6]"
                        >
                            {my.repeat}
                        </button>
                    )}
                </div>
                <div
                    className={`rounded-3xl px-4 py-3 text-sm leading-relaxed ${
                        mine
                            ? 'rounded-br-md bg-[#e8a04a] text-[#1a140c]'
                            : 'rounded-bl-md border border-[#3a3228] bg-[#1c1814] text-[#f4efe6]'
                    }`}
                >
                    {mine ? content : highlightedText(content, words)}
                </div>
                {!mine && words.length > 0 && (
                    <dl className="mt-2 space-y-1 px-1">
                        {words.map((word) => (
                            <div key={word.phrase} className="text-xs leading-relaxed">
                                <dt className="inline font-medium text-[#e8a04a] underline decoration-[#e8a04a]/70 underline-offset-2">
                                    {word.phrase}
                                </dt>
                                <dd className="inline text-[#a39888]"> — {word.meaning}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>
        </div>
    );
}
