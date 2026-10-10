import { type VoicePhase } from '@/hooks/useAudioStream';

interface MicButtonProps {
    phase: VoicePhase;
    level: number;
    onClick: () => void;
}

const labels: Record<VoicePhase, string> = {
    idle: 'Start speaking',
    listening: 'Stop and send',
    thinking: 'Interrupt',
    speaking: 'Interrupt and speak',
};

export function MicButton({ phase, level, onClick }: MicButtonProps) {
    const pulse = phase === 'listening' ? 1 + Math.min(level * 6, 0.45) : phase === 'speaking' ? 1.08 : 1;

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={labels[phase]}
            className="relative grid size-24 place-items-center rounded-full text-[#1a140c] outline-none focus-visible:ring-4 focus-visible:ring-[#e8a04a]/40"
        >
            <span
                className="absolute inset-0 rounded-full bg-[#e8a04a]/30 transition-transform duration-100"
                style={{ transform: `scale(${pulse + 0.18})` }}
            />
            <span
                className={`absolute inset-1 rounded-full border-2 border-[#e8a04a] ${phase === 'speaking' ? 'animate-pulse' : ''}`}
                style={{ transform: `scale(${pulse})` }}
            />
            <span className="relative grid size-[4.5rem] place-items-center rounded-full bg-[#e8a04a] shadow-[0_12px_40px_rgba(232,160,74,0.35)]">
                {phase === 'listening' ? (
                    <span className="size-5 rounded-sm bg-[#1a140c]" />
                ) : (
                    <svg viewBox="0 0 24 24" className="size-8 fill-current" aria-hidden="true">
                        <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-7 0v5A3.5 3.5 0 0 0 12 15Z" />
                        <path d="M6.5 11.5a.75.75 0 0 0-1.5 0 7 7 0 0 0 6.25 6.95V20.5H9a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5h-2.25v-2.05A7 7 0 0 0 19 11.5a.75.75 0 0 0-1.5 0 5.5 5.5 0 0 1-11 0Z" />
                    </svg>
                )}
            </span>
        </button>
    );
}
