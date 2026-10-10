import { PracticeShell, useNewChat } from '@/components/practice/PracticeShell';
import { Head } from '@inertiajs/react';

export default function Dashboard() {
    return (
        <PracticeShell>
            <Head title="Practice" />
            <EmptyStage />
        </PracticeShell>
    );
}

function EmptyStage() {
    const openNewChat = useNewChat();

    return (
        <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
            <p className="font-serif text-4xl tracking-tight text-[#f4efe6] sm:text-5xl">Your turn to speak.</p>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[#a39888]">
                Talk about a real moment. The tutor answers out loud, then leaves a pause so you can hear the shape of the sentence.
            </p>
            <button
                type="button"
                onClick={openNewChat}
                className="mt-8 rounded-full bg-[#e8a04a] px-6 py-3 text-sm font-medium text-[#1a140c]"
            >
                New chat
            </button>
        </main>
    );
}
