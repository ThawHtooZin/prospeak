import { TopicSelectorModal } from '@/components/practice/TopicSelectorModal';
import { my, myTitle, myTopic } from '@/lib/my';
import { useAppearance } from '@/hooks/use-appearance';
import { createChat, deleteChat } from '@/lib/chat-api';
import { logout } from '@/routes';
import { type SharedData, type PauseSpeed } from '@/types';
import { Link, router, usePage } from '@inertiajs/react';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

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
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const { updateAppearance } = useAppearance();

    useEffect(() => {
        updateAppearance('dark');
    }, [updateAppearance]);

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
            setError(caught instanceof Error ? caught.message : my.couldNotStart);
            setBusy(false);
        }
    };

    const removeChat = async (chatId: string, title: string) => {
        if (!window.confirm(my.deleteAsk(myTitle(title)))) {
            return;
        }
        setDeletingId(chatId);
        setError(null);
        try {
            await deleteChat(chatId);
            if (chatId === activeChatId) {
                router.visit('/dashboard');
                return;
            }
            router.reload({ only: ['chats'] });
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : my.couldNotDelete);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <NewChatContext.Provider value={() => {
            setError(null);
            setOpen(true);
        }}>
        <div className="flex h-dvh overflow-hidden bg-[#14110e] text-[#f4efe6]">
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
                            <span className="text-xs text-[#a39888]">{my.tagline}</span>
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
                        {my.newChat}
                    </button>
                    {error && !open && <p className="px-2 pt-2 text-xs text-[#ffb4a8]">{error}</p>}
                </div>
                <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
                    {chats.length === 0 && <p className="px-3 py-6 text-sm text-[#a39888]">{my.emptyChats}</p>}
                    {chats.map((chat) => (
                        <div
                            key={chat.id}
                            className={`flex items-center rounded-xl ${
                                chat.id === activeChatId ? 'bg-white/10 text-white' : 'text-[#d9d0c3] hover:bg-white/5'
                            }`}
                        >
                            <Link
                                href={`/chats/${chat.id}`}
                                onClick={() => setMenuOpen(false)}
                                className="min-w-0 flex-1 px-3 py-2.5 text-sm"
                            >
                                <span className="block truncate">{myTitle(chat.title)}</span>
                                <span className="mt-0.5 block truncate text-xs text-[#a39888]">{chat.topic ? myTopic(chat.topic) : my.topicFollows}</span>
                            </Link>
                            <button
                                type="button"
                                aria-label={my.deleteNamed(myTitle(chat.title))}
                                disabled={deletingId === chat.id}
                                onClick={() => void removeChat(chat.id, chat.title)}
                                className="mr-2 rounded-full px-2 py-1 text-xs text-[#a39888] hover:text-[#ffb4a8] disabled:opacity-40"
                            >
                                {my.delete}
                            </button>
                        </div>
                    ))}
                </nav>
                <div className="border-t border-[#2b251f] p-3 text-sm">
                    <p className="truncate px-2 pb-2 text-[#d9d0c3]">{auth.user.name}</p>
                    <div className="flex gap-2">
                        <Link
                            href={logout()}
                            as="button"
                            className="rounded-full px-3 py-1.5 text-[#a39888] hover:bg-white/5 hover:text-white"
                        >
                            {my.logOut}
                        </Link>
                    </div>
                </div>
            </aside>
            {menuOpen && <button type="button" aria-label={my.closeMenu} className="absolute inset-0 z-20 bg-black/50 md:hidden" onClick={() => setMenuOpen(false)} />}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between px-4 py-3 md:hidden">
                    <button type="button" onClick={() => setMenuOpen(true)} className="rounded-full border border-[#3a3228] px-3 py-1.5 text-sm">
                        {my.chats}
                    </button>
                    <span className="font-serif">ProSpeak</span>
                    <button type="button" onClick={() => setOpen(true)} className="rounded-full bg-[#e8a04a] px-3 py-1.5 text-sm text-[#1a140c]">
                        {my.newShort}
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
