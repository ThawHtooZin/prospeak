import { MicButton } from '@/components/practice/MicButton';
import { PracticeShell } from '@/components/practice/PracticeShell';
import { SpeedControlSlider } from '@/components/practice/SpeedControlSlider';
import { useAudioStream } from '@/hooks/useAudioStream';
import { storeMessage, updatePauseSpeed } from '@/lib/chat-api';
import { type ChatDetail, type ChatMessageItem } from '@/types/chat';
import { type PauseSpeed } from '@/types';
import { Head, router } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState } from 'react';

const phaseCopy = {
    idle: 'Tap the microphone and start speaking.',
    listening: 'Listening… a short pause will send what you said.',
    thinking: 'Working out a reply.',
    speaking: 'Speaking. The pause after each sentence follows your speed.',
};

export default function ChatShow({ chat }: { chat: ChatDetail }) {
    const [messages, setMessages] = useState<ChatMessageItem[]>(chat.messages);
    const [draft, setDraft] = useState('');
    const [pauseSpeed, setPauseSpeed] = useState<PauseSpeed>(chat.pause_speed);
    const [showTranscript, setShowTranscript] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const savedRef = useRef(new Set(chat.messages.map((message) => `${message.sender}:${message.content}`)));
    const scrollerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setMessages(chat.messages);
        setDraft('');
        setPauseSpeed(chat.pause_speed);
        savedRef.current = new Set(chat.messages.map((message) => `${message.sender}:${message.content}`));
    }, [chat.id, chat.messages, chat.pause_speed]);

    const onTranscript = useCallback(
        (role: 'user' | 'assistant', text: string, final: boolean) => {
            if (!final) {
                if (role === 'assistant') {
                    setDraft(text);
                }
                return;
            }

            setDraft('');
            const key = `${role}:${text}`;
            setMessages((current) => {
                if (savedRef.current.has(key) || current.some((message) => message.sender === role && message.content === text)) {
                    return current;
                }
                return [
                    ...current,
                    {
                        id: crypto.randomUUID(),
                        sender: role,
                        content: text,
                        created_at: new Date().toISOString(),
                    },
                ];
            });

            if (savedRef.current.has(key)) {
                return;
            }
            savedRef.current.add(key);
            void storeMessage(chat.id, role, text)
                .then(() => {
                    if (role === 'user') {
                        router.reload({ only: ['chats'], preserveState: true, preserveScroll: true });
                    }
                })
                .catch((caught: unknown) => {
                    setError(caught instanceof Error ? caught.message : 'Could not save that line.');
                });
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
        onError,
    });

    useEffect(() => {
        scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
    }, [messages, draft, showTranscript]);

    const changeSpeed = (next: PauseSpeed) => {
        setPauseSpeed(next);
        voice.sendConfig(next);
        void updatePauseSpeed(chat.id, next).catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : 'Could not update the pause speed.');
        });
    };

    return (
        <PracticeShell activeChatId={chat.id}>
            <Head title={chat.title} />
            <main className="flex min-h-0 flex-1 flex-col">
                <header className="flex items-center justify-between gap-4 px-6 pt-6">
                    <div>
                        <p className="text-xs tracking-[0.18em] text-[#a39888] uppercase">
                            {chat.topic ?? 'Open conversation'}
                        </p>
                        <h1 className="font-serif text-2xl">{chat.title}</h1>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowTranscript((current) => !current)}
                        aria-pressed={showTranscript}
                        className="rounded-full border border-[#3a3228] px-4 py-2 text-sm text-[#d9d0c3] hover:border-[#6a5c4b]"
                    >
                        {showTranscript ? 'Hide transcript' : 'Show transcript'}
                    </button>
                </header>

                <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                    <p className="max-w-md font-serif text-3xl leading-snug text-[#f6f1e8]">{phaseCopy[voice.phase]}</p>
                    <p className="mt-3 text-sm text-[#a39888]">
                        {voice.connected ? 'Voice engine connected' : 'Connecting to the voice engine…'}
                    </p>
                    {error && <p className="mt-4 max-w-md text-sm text-[#ffb4a8]">{error}</p>}
                </section>

                {showTranscript && (
                    <div ref={scrollerRef} className="mx-auto mb-4 max-h-56 w-full max-w-2xl overflow-y-auto rounded-3xl border border-[#3a3228] bg-[#1c1814] px-5 py-4 text-left">
                        {messages.length === 0 && !draft && <p className="text-sm text-[#a39888]">Nothing written down yet. Listen first if you can.</p>}
                        <ul className="space-y-3">
                            {messages.map((message) => (
                                <li key={message.id} className="text-sm leading-relaxed">
                                    <span className="mr-2 text-xs tracking-wide text-[#a39888] uppercase">
                                        {message.sender === 'user' ? 'You' : 'Tutor'}
                                    </span>
                                    {message.content}
                                </li>
                            ))}
                            {draft && (
                                <li className="text-sm leading-relaxed text-[#d9d0c3]">
                                    <span className="mr-2 text-xs tracking-wide text-[#a39888] uppercase">Tutor</span>
                                    {draft}
                                </li>
                            )}
                        </ul>
                    </div>
                )}

                <footer className="flex flex-col items-center gap-5 px-6 pt-2 pb-10">
                    <div className="flex items-end gap-4">
                        <MicButton phase={voice.phase} level={voice.level} onClick={() => void voice.startListening()} />
                        <div className="w-56 pb-2">
                            <p className="mb-2 text-center text-xs tracking-wide text-[#a39888] uppercase">Pause speed</p>
                            <SpeedControlSlider compact value={pauseSpeed} onChange={changeSpeed} />
                        </div>
                    </div>
                </footer>
            </main>
        </PracticeShell>
    );
}
