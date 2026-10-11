import { my } from '@/lib/my';
import { dashboard, login, register } from '@/routes';
import { type SharedData } from '@/types';
import { Head, Link, usePage } from '@inertiajs/react';

export default function Welcome({ canRegister = true }: { canRegister?: boolean }) {
    const { auth } = usePage<SharedData>().props;

    return (
        <>
            <Head title="ProSpeak">
                <link rel="preconnect" href="https://fonts.bunny.net" />
                <link href="https://fonts.bunny.net/css?family=fraunces:500,600|outfit:400,500,600|noto-sans-myanmar:400,500,600" rel="stylesheet" />
            </Head>
            <div className="min-h-screen bg-[#14110e] text-[#f4efe6]" style={{ fontFamily: '"Noto Sans Myanmar", "Myanmar Text", "Myanmar MN", Outfit, ui-sans-serif, system-ui, sans-serif' }}>
                <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
                    <span className="font-serif text-xl" style={{ fontFamily: 'Fraunces, "Noto Sans Myanmar", "Myanmar Text", ui-serif, Georgia, serif' }}>
                        ProSpeak
                    </span>
                    <nav className="flex items-center gap-3 text-sm">
                        {auth.user ? (
                            <Link href={dashboard()} className="rounded-full bg-[#e8a04a] px-4 py-2 font-medium text-[#1a140c]">
                                {my.continue}
                            </Link>
                        ) : (
                            <>
                                <Link href={login()} className="rounded-full px-4 py-2 text-[#d9d0c3] hover:text-white">
                                    {my.logIn}
                                </Link>
                                {canRegister && (
                                    <Link href={register()} className="rounded-full bg-[#e8a04a] px-4 py-2 font-medium text-[#1a140c]">
                                        {my.createAccount}
                                    </Link>
                                )}
                            </>
                        )}
                    </nav>
                </header>
                <main className="mx-auto grid max-w-5xl gap-12 px-6 py-16 lg:grid-cols-[1.2fr_0.8fr] lg:py-24">
                    <div>
                        <p className="text-sm text-[#e8a04a]">{my.spokenEnglish}</p>
                        <h1
                            className="mt-4 max-w-xl text-4xl leading-[1.7] text-[#f6f1e8] sm:text-5xl"
                            style={{ fontFamily: '"Noto Sans Myanmar", "Myanmar Text", "Myanmar MN", Fraunces, ui-serif, Georgia, serif' }}
                        >
                            {my.welcomeTitle}
                        </h1>
                        <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#a39888]">
                            {my.welcomeBody}
                        </p>
                    </div>
                    <ol className="space-y-4 self-end">
                        {[
                            ['01', my.stepTopic],
                            ['02', my.stepPause],
                            ['03', my.stepChat],
                        ].map(([index, line]) => (
                            <li key={index} className="rounded-3xl border border-[#3a3228] bg-[#1c1814] p-5">
                                <span className="text-xs tracking-[0.18em] text-[#e8a04a]">{index}</span>
                                <p className="mt-2 text-[#f4efe6]">{line}</p>
                            </li>
                        ))}
                    </ol>
                </main>
            </div>
        </>
    );
}
