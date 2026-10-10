import { TopicSelectorModal } from '@/components/practice/TopicSelectorModal';
import { createChat } from '@/lib/chat-api';
import { edit } from '@/routes/profile';
import { logout } from '@/routes';
import { type SharedData, type PauseSpeed } from '@/types';
import { Link, router, usePage } from '@inertiajs/react';
import { createContext, type ReactNode, useContext, useState } from 'react';

const NewChatContext = createContext<() => void>(() => {});

export function useNewChat(): () => void {
    return useContext(NewChatContext);
}

interface PracticeShellProps {
    children: ReactNode;
    activeChatId?: string;
}

export function PracticeShell({ children, activeChatId }: PracticeShellProps) {
    const { auth, chats, topics } = usePage<SharedData>().props;
    const [open, setOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const startChat = async (input: {
        topic: string | null;
        custom_topic: boolean;
        skip_topic: boolean;
        pause_speed: PauseSpeed;
    }) => {
        setBusy(true);
        setError(null);
        try {
            const created = await createChat(input);
            setOpen(false);
            router.visit(`/chats/${created.chat_id}`);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not start the chat.');
            setBusy(false);
        }
    };

    return (
        <NewChatContext.Provider value={() => {
            setError(null);
            setOpen(true);
        }}>
        <div className="flex min-h-screen bg-[#14110e] text-[#f4efe6]">
            <aside className={`${menuOpen ? 'flex' : 'hidden'} absolute inset-y-0 z-30 w-72 flex-col border-r border-[#2b251f] bg-[#1c1814] md:static md:flex`}>
                <div className="flex items-center justify-between px-4 py-5">
                    <Link href="/dashboard" className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-xl bg-[#e8a04a] text-[#1a140c]">
                            <svg viewBox="0 0 32 32" className="size-5 fill-current" aria-hidden="true">
                                <rect x="3" y="13" width="4" height="6" rx="2" />
                                <rect x="10" y="8" width="4" height="16" rx="2" />
                                <rect x="17" y="5" width="4" height="22" rx="2" />
                                <rect x="24" y="10" width="4" height="12" rx="2" />
                            </svg>
                        </span>
                        <span>
                            <span className="block font-serif text-lg leading-none">ProSpeak</span>
                            <span className="text-xs text-[#a39888]">Speak. Listen. Repeat.</span>
                        </span>
                    </Link>
                </div>
                <div className="px-3">
                    <button
                        type="button"
                        onClick={() => {
                            setError(null);
                            setOpen(true);
                            setMenuOpen(false);
                        }}
                        className="w-full rounded-full bg-[#e8a04a] px-4 py-2.5 text-sm font-medium text-[#1a140c]"
                    >
                        New chat
                    </button>
                </div>
                <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
                    {chats.length === 0 && <p className="px-3 py-6 text-sm text-[#a39888]">Your conversations will sit here.</p>}
                    {chats.map((chat) => (
                        <Link
                            key={chat.id}
                            href={`/chats/${chat.id}`}
                            onClick={() => setMenuOpen(false)}
                            className={`block rounded-xl px-3 py-2.5 text-sm ${
                                chat.id === activeChatId ? 'bg-white/10 text-white' : 'text-[#d9d0c3] hover:bg-white/5'
                            }`}
                        >
                            <span className="block truncate">{chat.title}</span>
                            <span className="mt-0.5 block truncate text-xs text-[#a39888]">{chat.topic ?? 'Topic follows the talk'}</span>
                        </Link>
                    ))}
                </nav>
                <div className="border-t border-[#2b251f] p-3 text-sm">
                    <p className="truncate px-2 pb-2 text-[#d9d0c3]">{auth.user.name}</p>
                    <div className="flex gap-2">
                        <Link href={edit()} className="rounded-full px-3 py-1.5 text-[#a39888] hover:bg-white/5 hover:text-white">
                            Settings
                        </Link>
                        <Link
                            href={logout()}
                            as="button"
                            className="rounded-full px-3 py-1.5 text-[#a39888] hover:bg-white/5 hover:text-white"
                        >
                            Log out
                        </Link>
                    </div>
                </div>
            </aside>
            {menuOpen && <button type="button" aria-label="Close menu" className="absolute inset-0 z-20 bg-black/50 md:hidden" onClick={() => setMenuOpen(false)} />}
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between px-4 py-3 md:hidden">
                    <button type="button" onClick={() => setMenuOpen(true)} className="rounded-full border border-[#3a3228] px-3 py-1.5 text-sm">
                        Chats
                    </button>
                    <span className="font-serif">ProSpeak</span>
                    <button type="button" onClick={() => setOpen(true)} className="rounded-full bg-[#e8a04a] px-3 py-1.5 text-sm text-[#1a140c]">
                        New
                    </button>
                </div>
                {children}
            </div>
            <TopicSelectorModal
                open={open}
                topics={topics}
                busy={busy}
                error={error}
                onClose={() => setOpen(false)}
                onCreate={startChat}
            />
        </div>
        </NewChatContext.Provider>
    );
}
