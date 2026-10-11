import { my } from '@/lib/my';
import { capturePcm } from '@/lib/pcm-wav';
import { type PauseSpeed } from '@/types';
import { type VocabularyItem } from '@/types/chat';
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

const SILENCE_MS = 5000;
const SPEECH_THRESHOLD = 0.025;
const MIN_SPEECH_MS = 280;
const MAX_RECORD_MS = 20000;

interface UseAudioStreamOptions {
    websocketUrl: string;
    topic: string | null;
    pauseSpeed: PauseSpeed;
    greet: boolean;
    onTranscript: (role: 'user' | 'assistant', text: string, final: boolean, words?: VocabularyItem[]) => void;
    onVocabulary?: (messageId: string, words: VocabularyItem[]) => void;
    onError: (message: string) => void;
}

interface SpeechResultEvent {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0?: { transcript: string } }>;
}

interface LiveRecognition {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((event: SpeechResultEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
}

function closeAudioContext(context: AudioContext | null) {
    if (!context || context.state === 'closed') {
        return;
    }
    void context.close().catch(() => undefined);
}

function speechRecognition(): LiveRecognition | null {
    const host = window as Window & {
        SpeechRecognition?: new () => LiveRecognition;
        webkitSpeechRecognition?: new () => LiveRecognition;
    };
    const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Ctor) {
        return null;
    }
    const recognition = new Ctor();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    return recognition;
}

function spokenText(finalText: string, interim: string): string {
    return `${finalText} ${interim}`.replace(/\s+/g, ' ').trim();
}

function rms(analyser: AnalyserNode, data: Uint8Array): number {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let index = 0; index < data.length; index++) {
        const sample = (data[index] - 128) / 128;
        sum += sample * sample;
    }
    return Math.sqrt(sum / data.length);
}

export function useAudioStream({
    websocketUrl,
    topic,
    pauseSpeed,
    greet,
    onTranscript,
    onVocabulary,
    onError,
}: UseAudioStreamOptions) {
    const [phase, setPhase] = useState<VoicePhase>('idle');
    const [level, setLevel] = useState(0);
    const [connected, setConnected] = useState(false);

    const socketRef = useRef<WebSocket | null>(null);
    const phaseRef = useRef<VoicePhase>('idle');
    const pauseRef = useRef(pauseSpeed);
    const handlersRef = useRef({ onTranscript, onVocabulary, onError });
    const playbackRef = useRef<AudioContext | null>(null);
    const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
    const nextTimeRef = useRef(0);
    const playingRef = useRef(0);
    const turnDoneRef = useRef(false);
    const recorderStopRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        handlersRef.current = { onTranscript, onVocabulary, onError };
    }, [onTranscript, onVocabulary, onError]);

    useEffect(() => {
        pauseRef.current = pauseSpeed;
    }, [pauseSpeed]);

    const setPhaseBoth = useCallback((next: VoicePhase) => {
        phaseRef.current = next;
        setPhase(next);
    }, []);

    const stopPlayback = useCallback(() => {
        sourcesRef.current.forEach((source) => {
            try {
                source.stop();
            } catch {
                // already stopped
            }
        });
        sourcesRef.current = [];
        playingRef.current = 0;
        nextTimeRef.current = 0;
    }, []);

    const playbackContext = useCallback(() => {
        if (!playbackRef.current || playbackRef.current.state === 'closed') {
            playbackRef.current = new AudioContext();
        }
        return playbackRef.current;
    }, []);

    const enqueueWav = useCallback(
        async (encoded: string) => {
            const context = playbackContext();
            if (context.state === 'suspended') {
                await context.resume();
            }
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index++) {
                bytes[index] = binary.charCodeAt(index);
            }
            const audioBuffer = await context.decodeAudioData(bytes.buffer.slice(0));
            const source = context.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(context.destination);
            const startAt = Math.max(context.currentTime + 0.04, nextTimeRef.current);
            source.start(startAt);
            nextTimeRef.current = startAt + audioBuffer.duration;
            playingRef.current += 1;
            sourcesRef.current.push(source);
            setPhaseBoth('speaking');
            source.onended = () => {
                playingRef.current = Math.max(0, playingRef.current - 1);
                if (playingRef.current === 0 && turnDoneRef.current && phaseRef.current === 'speaking') {
                    setPhaseBoth('idle');
                }
            };
        },
        [playbackContext, setPhaseBoth],
    );

    useEffect(() => {
        let socket: WebSocket | null = null;
        const timer = window.setTimeout(() => {
            socket = new WebSocket(websocketUrl);
            socketRef.current = socket;

            socket.onopen = () => {
                setConnected(true);
                socket?.send(
                    JSON.stringify({
                        type: 'config',
                        topic,
                        pause_speed: pauseRef.current,
                        greet,
                    }),
                );
            };

            socket.onclose = () => {
                setConnected(false);
            };

            socket.onerror = () => {
                handlersRef.current.onError(my.voiceDown);
            };

            socket.onmessage = (event) => {
                const message = JSON.parse(event.data) as {
                    type: string;
                    role?: 'user' | 'assistant';
                    text?: string;
                    final?: boolean;
                    audio?: string;
                    message?: string;
                    empty?: boolean;
                    message_id?: string;
                    words?: VocabularyItem[];
                };

                if (message.type === 'transcript' && message.role && message.text !== undefined) {
                    handlersRef.current.onTranscript(message.role, message.text, Boolean(message.final), message.words);
                    if (message.role === 'assistant' && !message.final) {
                        setPhaseBoth('thinking');
                    }
                    return;
                }

                if (message.type === 'vocabulary' && message.message_id) {
                    handlersRef.current.onVocabulary?.(message.message_id, message.words ?? []);
                    return;
                }

                if (message.type === 'audio' && message.audio) {
                    void enqueueWav(message.audio).catch(() => {
                        handlersRef.current.onError(my.couldNotPlay);
                    });
                    return;
                }

                if (message.type === 'turn_complete') {
                    turnDoneRef.current = true;
                    if (message.empty || playingRef.current === 0) {
                        if (phaseRef.current !== 'listening') {
                            setPhaseBoth('idle');
                        }
                    }
                    return;
                }

                if (message.type === 'error' && message.message) {
                    handlersRef.current.onError(message.message);
                    setPhaseBoth('idle');
                    return;
                }

                if (message.type === 'interrupted') {
                    stopPlayback();
                }
            };
        }, 40);

        return () => {
            window.clearTimeout(timer);
            socket?.close();
            if (socket && socketRef.current === socket) {
                socketRef.current = null;
            }
        };
    }, [enqueueWav, greet, setPhaseBoth, stopPlayback, topic, websocketUrl]);

    const sendConfig = useCallback((speed: PauseSpeed) => {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'config', pause_speed: speed }));
        }
    }, []);

    const repeat = useCallback(
        (text: string) => {
            const socket = socketRef.current;
            if (!socket || socket.readyState !== WebSocket.OPEN || !text.trim()) {
                handlersRef.current.onError(my.voiceDown);
                return;
            }
            stopPlayback();
            turnDoneRef.current = false;
            setPhaseBoth('speaking');
            socket.send(JSON.stringify({ type: 'repeat', text }));
        },
        [setPhaseBoth, stopPlayback],
    );

    const annotate = useCallback((messageId: string, text: string) => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN || !messageId || !text.trim()) {
            return;
        }
        socket.send(JSON.stringify({ type: 'annotate', message_id: messageId, text }));
    }, []);

    const interrupt = useCallback(() => {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'interrupt' }));
        }
        stopPlayback();
        turnDoneRef.current = true;
    }, [stopPlayback]);

    const stopListening = useCallback(() => {
        recorderStopRef.current?.();
    }, []);

    const startListening = useCallback(async () => {
        if (phaseRef.current === 'listening') {
            stopListening();
            return;
        }

        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            handlersRef.current.onError(my.voiceDown);
            return;
        }

        if (phaseRef.current === 'speaking' || phaseRef.current === 'thinking') {
            interrupt();
        }

        let stream: MediaStream | null = null;
        let context: AudioContext | null = null;
        let frame = 0;
        let cancelled = false;
        let commitRequested = false;
        let committed = false;
        let recognitionFailed = false;
        let finalText = '';
        let interim = '';
        let takeWav: (() => Blob) | null = null;

        const releaseMic = () => {
            cancelAnimationFrame(frame);
            stream?.getTracks().forEach((track) => track.stop());
            closeAudioContext(context);
            setLevel(0);
            recorderStopRef.current = null;
        };

        const sendUtterance = (text: string) => {
            const active = socketRef.current;
            if (!active || active.readyState !== WebSocket.OPEN) {
                handlersRef.current.onError(my.lostBeforeSend);
                setPhaseBoth('idle');
                return;
            }
            setPhaseBoth('thinking');
            turnDoneRef.current = false;
            active.send(JSON.stringify({ type: 'utterance', text }));
        };

        const sendWav = (blob: Blob) => {
            if (blob.size < 1000) {
                setPhaseBoth('idle');
                return;
            }
            setPhaseBoth('thinking');
            turnDoneRef.current = false;
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = String(reader.result || '');
                const audio = result.includes(',') ? result.split(',')[1] : result;
                const active = socketRef.current;
                if (!active || active.readyState !== WebSocket.OPEN) {
                    handlersRef.current.onError(my.lostBeforeAudio);
                    setPhaseBoth('idle');
                    return;
                }
                active.send(JSON.stringify({ type: 'audio', audio, mime: 'audio/wav' }));
            };
            reader.readAsDataURL(blob);
        };

        const finishTurn = () => {
            if (committed || cancelled) {
                return;
            }
            committed = true;
            const blob = takeWav ? takeWav() : new Blob();
            releaseMic();
            const text = spokenText(finalText, interim);
            if (!recognitionFailed && text) {
                sendUtterance(text);
                return;
            }
            sendWav(blob);
        };

        const recognition = speechRecognition();
        if (recognition) {
            recognition.onresult = (event) => {
                let pending = '';
                for (let index = event.resultIndex; index < event.results.length; index++) {
                    const piece = event.results[index]?.[0]?.transcript ?? '';
                    if (event.results[index]?.isFinal) {
                        finalText = spokenText(finalText, piece);
                    } else {
                        pending += piece;
                    }
                }
                interim = pending;
                const text = spokenText(finalText, interim);
                if (text) {
                    handlersRef.current.onTranscript('user', text, false);
                }
            };
            recognition.onerror = (event) => {
                if (event.error === 'no-speech' || event.error === 'aborted') {
                    return;
                }
                recognitionFailed = true;
            };
            recognition.onend = () => {
                if (cancelled || committed) {
                    return;
                }
                if (!commitRequested) {
                    if (!recognitionFailed) {
                        try {
                            recognition.start();
                            return;
                        } catch {
                            recognitionFailed = true;
                        }
                    }
                    return;
                }
                finishTurn();
            };
            try {
                recognition.start();
            } catch {
                recognitionFailed = true;
            }
        } else {
            recognitionFailed = true;
        }

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
        } catch {
            cancelled = true;
            try {
                recognition?.abort();
            } catch {
                // not started
            }
            handlersRef.current.onError(my.needMic);
            return;
        }

        if (cancelled) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }

        setPhaseBoth('listening');
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        const meter = context.createMediaStreamSource(stream);
        const meterMute = context.createGain();
        meterMute.gain.value = 0;
        meter.connect(analyser);
        analyser.connect(meterMute);
        meterMute.connect(context.destination);
        try {
            takeWav = await capturePcm(context, context.createMediaStreamSource(stream));
        } catch {
            if (recognitionFailed) {
                releaseMic();
                handlersRef.current.onError(my.couldNotCapture);
                setPhaseBoth('idle');
                return;
            }
        }

        const samples = new Uint8Array(analyser.fftSize);
        let heardSpeech = false;
        let silenceStarted: number | null = null;
        let speechStartedAt = 0;

        const finish = () => {
            if (commitRequested || committed) {
                return;
            }
            commitRequested = true;
            cancelAnimationFrame(frame);
            if (recognition && !recognitionFailed) {
                try {
                    recognition.stop();
                    return;
                } catch {
                    // Send the words already recognized.
                }
            }
            finishTurn();
        };

        const watch = (now: number) => {
            const energy = rms(analyser, samples);
            setLevel(energy);
            if (energy > SPEECH_THRESHOLD) {
                if (!heardSpeech) {
                    speechStartedAt = now;
                }
                heardSpeech = true;
                silenceStarted = null;
            } else if (heardSpeech) {
                silenceStarted ??= now;
                if (now - silenceStarted > SILENCE_MS && now - speechStartedAt > MIN_SPEECH_MS) {
                    finish();
                    return;
                }
            }
            if (heardSpeech && now - speechStartedAt > MAX_RECORD_MS) {
                finish();
                return;
            }
            frame = requestAnimationFrame(watch);
        };

        recorderStopRef.current = finish;
        frame = requestAnimationFrame(watch);
    }, [interrupt, setPhaseBoth, stopListening]);

    useEffect(() => {
        return () => {
            recorderStopRef.current?.();
            stopPlayback();
            closeAudioContext(playbackRef.current);
        };
    }, [stopPlayback]);

    return {
        phase,
        level,
        connected,
        startListening,
        sendConfig,
        repeat,
        annotate,
    };
}
