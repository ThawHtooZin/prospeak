import { PracticeShell, useNewChat } from '@/components/practice/PracticeShell';
import { my } from '@/lib/my';
import { Head } from '@inertiajs/react';

export default function Dashboard() {
    return (
        <PracticeShell>
            <Head title={my.practice} />
            <EmptyStage />
        </PracticeShell>
    );
}

function EmptyStage() {
    const openNewChat = useNewChat();

    return (
        <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
            <p className="font-serif text-4xl leading-[1.6] text-[#f4efe6] sm:text-5xl">{my.yourTurn}</p>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[#a39888]">
                {my.yourTurnBody}
            </p>
            <button
                type="button"
                onClick={openNewChat}
                className="mt-8 rounded-full bg-[#e8a04a] px-6 py-3 text-sm font-medium text-[#1a140c]"
            >
                {my.newChat}
            </button>
        </main>
    );
}
