import { PAUSE_OPTIONS } from '@/types/chat';
import { type PauseSpeed } from '@/types';

interface SpeedControlSliderProps {
    value: PauseSpeed;
    onChange: (value: PauseSpeed) => void;
    compact?: boolean;
}

export function SpeedControlSlider({ value, onChange, compact = false }: SpeedControlSliderProps) {
    return (
        <div className={compact ? 'flex flex-col gap-2' : 'grid gap-3'}>
            {!compact && <p className="text-sm text-[#a39888]">Pause between sentences</p>}
            <div className={`grid gap-2 ${compact ? 'grid-cols-3' : 'sm:grid-cols-3'}`}>
                {PAUSE_OPTIONS.map((option) => {
                    const selected = option.id === value;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => onChange(option.id)}
                            aria-pressed={selected}
                            className={`rounded-2xl border px-3 py-2 text-left transition ${
                                selected
                                    ? 'border-[#e8a04a] bg-[#e8a04a]/15 text-[#f4efe6]'
                                    : 'border-[#3a3228] bg-[#221c17] text-[#d9d0c3] hover:border-[#6a5c4b]'
                            } ${compact ? 'px-2 py-2 text-center' : ''}`}
                        >
                            <span className={`block font-medium ${compact ? 'text-xs' : 'text-sm'}`}>{option.label}</span>
                            {!compact && <span className="mt-1 block text-xs text-[#a39888]">{option.hint}</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
