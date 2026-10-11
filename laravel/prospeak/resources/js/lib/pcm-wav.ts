const TARGET_RATE = 16000;
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

export async function capturePcm(context: AudioContext, source: MediaStreamAudioSourceNode) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await context.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const node = new AudioWorkletNode(context, 'pcm-capture');
    const mute = context.createGain();
    mute.gain.value = 0;
    const chunks: Float32Array[] = [];
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        chunks.push(event.data);
    };
    source.connect(node);
    node.connect(mute);
    mute.connect(context.destination);

    return () => {
        node.disconnect();
        mute.disconnect();
        const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Float32Array(length);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
        }
        return samplesToWav(merged, context.sampleRate);
    };
}

export function samplesToWav(samples: Float32Array, sampleRate: number): Blob {
    const speech = trimSilence(downsample(samples, sampleRate, TARGET_RATE), TARGET_RATE);
    return encodeWav(speech, TARGET_RATE);
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate || input.length === 0) {
        return input;
    }
    const ratio = fromRate / toRate;
    const length = Math.floor(input.length / ratio);
    const result = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        const start = Math.floor(index * ratio);
        const end = Math.min(input.length, Math.floor((index + 1) * ratio));
        let sum = 0;
        let count = 0;
        for (let sample = start; sample < end; sample++) {
            sum += input[sample];
            count += 1;
        }
        result[index] = count ? sum / count : 0;
    }
    return result;
}

function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
    const windowSize = Math.max(1, Math.floor(sampleRate * 0.02));
    const threshold = 0.015;
    let start = 0;
    let end = samples.length;

    for (let index = 0; index + windowSize <= samples.length; index += windowSize) {
        if (windowRms(samples, index, windowSize) > threshold) {
            start = index;
            break;
        }
    }
    for (let index = samples.length - windowSize; index >= start; index -= windowSize) {
        if (windowRms(samples, index, windowSize) > threshold) {
            end = Math.min(samples.length, index + windowSize);
            break;
        }
    }

    if (end - start < sampleRate * 0.2) {
        return new Float32Array();
    }
    return samples.subarray(start, end);
}

function windowRms(samples: Float32Array, offset: number, size: number): number {
    let sum = 0;
    const end = Math.min(samples.length, offset + size);
    for (let index = offset; index < end; index++) {
        sum += samples[index] * samples[index];
    }
    return Math.sqrt(sum / Math.max(1, end - offset));
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let index = 0; index < samples.length; index++) {
        const sample = Math.max(-1, Math.min(1, samples[index]));
        view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, value: string) {
    for (let index = 0; index < value.length; index++) {
        view.setUint8(offset + index, value.charCodeAt(index));
    }
}
