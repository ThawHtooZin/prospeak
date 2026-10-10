import { type PauseSpeed } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

const SILENCE_MS = 800;
const SPEECH_THRESHOLD = 0.025;
const MIN_SPEECH_MS = 280;
const MAX_RECORD_MS = 20000;

interface UseAudioStreamOptions {
    websocketUrl: string;
    topic: string | null;
    pauseSpeed: PauseSpeed;
    greet: boolean;
    onTranscript: (role: 'user' | 'assistant', text: string, final: boolean) => void;
    onError: (message: string) => void;
}

function preferredMime(): string {
    if (typeof MediaRecorder === 'undefined') {
        return 'audio/webm';
    }
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'audio/webm';
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
    onError,
}: UseAudioStreamOptions) {
    const [phase, setPhase] = useState<VoicePhase>('idle');
    const [level, setLevel] = useState(0);
    const [connected, setConnected] = useState(false);

    const socketRef = useRef<WebSocket | null>(null);
    const phaseRef = useRef<VoicePhase>('idle');
    const pauseRef = useRef(pauseSpeed);
    const handlersRef = useRef({ onTranscript, onError });
    const playbackRef = useRef<AudioContext | null>(null);
    const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
    const nextTimeRef = useRef(0);
    const playingRef = useRef(0);
    const turnDoneRef = useRef(false);
    const recorderStopRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        handlersRef.current = { onTranscript, onError };
    }, [onTranscript, onError]);

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
        if (!playbackRef.current) {
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
                handlersRef.current.onError('The voice engine is not connected. Start the Python service on port 8001.');
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
                };

                if (message.type === 'transcript' && message.role && message.text !== undefined) {
                    handlersRef.current.onTranscript(message.role, message.text, Boolean(message.final));
                    if (message.role === 'assistant' && !message.final) {
                        setPhaseBoth('thinking');
                    }
                    return;
                }

                if (message.type === 'audio' && message.audio) {
                    void enqueueWav(message.audio).catch(() => {
                        handlersRef.current.onError('The browser could not play the tutor audio.');
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
            handlersRef.current.onError('The voice engine is not connected. Start the Python service on port 8001.');
            return;
        }

        if (phaseRef.current === 'speaking' || phaseRef.current === 'thinking') {
            interrupt();
        }

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true },
            });
        } catch {
            handlersRef.current.onError('Microphone permission is required to practice speaking.');
            return;
        }

        const mime = preferredMime();
        const recorder = new MediaRecorder(stream, { mimeType: mime });
        const chunks: Blob[] = [];
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let frame = 0;
        let heardSpeech = false;
        let silenceStarted: number | null = null;
        let speechStartedAt = 0;
        let stopped = false;

        const finish = () => {
            if (stopped) {
                return;
            }
            stopped = true;
            cancelAnimationFrame(frame);
            recorderStopRef.current = null;
            if (recorder.state !== 'inactive') {
                recorder.stop();
            }
        };

        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                chunks.push(event.data);
            }
        };

        recorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            void context.close();
            setLevel(0);
            const blob = new Blob(chunks, { type: mime });
            if (!heardSpeech || blob.size < 800) {
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
                    handlersRef.current.onError('Lost the voice engine before the audio was sent.');
                    setPhaseBoth('idle');
                    return;
                }
                active.send(JSON.stringify({ type: 'audio', audio, mime }));
            };
            reader.readAsDataURL(blob);
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
        recorder.start();
        setPhaseBoth('listening');
        frame = requestAnimationFrame(watch);
    }, [interrupt, setPhaseBoth, stopListening]);

    useEffect(() => {
        return () => {
            recorderStopRef.current?.();
            stopPlayback();
            void playbackRef.current?.close();
        };
    }, [stopPlayback]);

    return {
        phase,
        level,
        connected,
        startListening,
        sendConfig,
    };
}
