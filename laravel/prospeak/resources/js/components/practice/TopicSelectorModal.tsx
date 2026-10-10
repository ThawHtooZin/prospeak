import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SpeedControlSlider } from '@/components/practice/SpeedControlSlider';
import { type PauseSpeed } from '@/types';
import { useState } from 'react';

interface TopicSelectorModalProps {
    open: boolean;
    topics: string[];
    busy: boolean;
    error: string | null;
    onClose: () => void;
    onCreate: (input: { topic: string | null; custom_topic: boolean; skip_topic: boolean; pause_speed: PauseSpeed }) => void;
}

export function TopicSelectorModal({ open, topics, busy, error, onClose, onCreate }: TopicSelectorModalProps) {
    const [step, setStep] = useState<'topic' | 'speed'>('topic');
    const [preset, setPreset] = useState<string | null>(null);
    const [customOn, setCustomOn] = useState(false);
    const [customText, setCustomText] = useState('');
    const [skip, setSkip] = useState(false);
    const [pauseSpeed, setPauseSpeed] = useState<PauseSpeed>('normal');

    const reset = () => {
        setStep('topic');
        setPreset(null);
        setCustomOn(false);
        setCustomText('');
        setSkip(false);
        setPauseSpeed('normal');
    };

    const customReady = customOn && customText.trim().length > 0;
    const canContinue = customReady || (!customOn && preset !== null);

    const goToSpeed = (skipTopic: boolean) => {
        setSkip(skipTopic);
        setStep('speed');
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !busy) {
                    reset();
                    onClose();
                }
            }}
        >
            <DialogContent className="max-h-[85vh] overflow-y-auto border-[#3a3228] bg-[#1c1814] text-[#f4efe6] sm:max-w-2xl">
                {step === 'topic' ? (
                    <>
                        <DialogHeader>
                            <DialogTitle className="font-serif text-2xl text-[#f4efe6]">What do you want to practice?</DialogTitle>
                            <DialogDescription className="text-[#a39888]">
                                Pick a situation, write your own, or let the tutor notice the topic as you talk.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {topics.map((topic) => {
                                const selected = !customOn && preset === topic;
                                return (
                                    <button
                                        key={topic}
                                        type="button"
                                        onClick={() => {
                                            setCustomOn(false);
                                            setPreset(topic);
                                        }}
                                        className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                                            selected
                                                ? 'border-[#e8a04a] bg-[#e8a04a]/15'
                                                : 'border-[#3a3228] bg-[#14110e] hover:border-[#6a5c4b]'
                                        }`}
                                    >
                                        {topic}
                                    </button>
                                );
                            })}
                        </div>
                        <label className="flex items-start gap-3 rounded-2xl border border-[#3a3228] bg-[#14110e] px-4 py-3">
                            <input
                                type="checkbox"
                                checked={customOn}
                                onChange={(event) => {
                                    setCustomOn(event.target.checked);
                                    if (event.target.checked) {
                                        setPreset(null);
                                    }
                                }}
                                className="mt-1 size-4 accent-[#e8a04a]"
                            />
                            <span className="grid flex-1 gap-2">
                                <span className="text-sm">Custom topic</span>
                                {customOn && (
                                    <input
                                        value={customText}
                                        onChange={(event) => setCustomText(event.target.value)}
                                        placeholder="Ordering coffee at a busy counter"
                                        className="h-10 rounded-xl border border-[#3a3228] bg-[#1c1814] px-3 text-sm outline-none focus:border-[#e8a04a]"
                                    />
                                )}
                            </span>
                        </label>
                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                            <button
                                type="button"
                                onClick={() => goToSpeed(true)}
                                className="rounded-full px-4 py-2 text-sm text-[#d9d0c3] hover:bg-white/5"
                            >
                                Skip topic
                            </button>
                            <button
                                type="button"
                                disabled={!canContinue}
                                onClick={() => goToSpeed(false)}
                                className="rounded-full bg-[#e8a04a] px-5 py-2 text-sm font-medium text-[#1a140c] disabled:opacity-40"
                            >
                                Continue
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="font-serif text-2xl text-[#f4efe6]">How much space between sentences?</DialogTitle>
                            <DialogDescription className="text-[#a39888]">
                                This pause is inserted after each spoken sentence so you can catch the words.
                            </DialogDescription>
                        </DialogHeader>
                        <SpeedControlSlider value={pauseSpeed} onChange={setPauseSpeed} />
                        {error && <p className="text-sm text-[#ffb4a8]">{error}</p>}
                        <div className="flex justify-between gap-2">
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setStep('topic')}
                                className="rounded-full px-4 py-2 text-sm text-[#d9d0c3] hover:bg-white/5"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                    onCreate({
                                        topic: skip ? null : customOn ? customText.trim() : preset,
                                        custom_topic: customOn && !skip,
                                        skip_topic: skip,
                                        pause_speed: pauseSpeed,
                                    })
                                }
                                className="rounded-full bg-[#e8a04a] px-5 py-2 text-sm font-medium text-[#1a140c] disabled:opacity-40"
                            >
                                {busy ? 'Starting…' : 'Start conversation'}
                            </button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
