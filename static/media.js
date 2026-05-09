// ═══════════════════════════════════════════════════════════════
// MediaManager — Image Compression, Voice Recording, Validation
// ═══════════════════════════════════════════════════════════════

const MediaConfig = {
    image: {
        maxSizeMB: 5,
        maxWidth: 1280,
        maxHeight: 1280,
        quality: 0.7,
        allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    },
    voice: {
        maxDurationSec: 300, // 5 minutes
        maxSizeMB: 2,
        mimeType: 'audio/webm;codecs=opus',
        fallbackMimeType: 'audio/webm',
    },
};

// ── Image Compression ──────────────────────────────────────────

async function compressImage(file, maxWidth = 1280, maxHeight = 1280, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            let { width, height } = img;

            // Calculate new dimensions maintaining aspect ratio
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Image compression failed'));
                },
                'image/jpeg',
                quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };

        img.src = url;
    });
}

// ── Image Preview ──────────────────────────────────────────────

function createImagePreviewURL(blob) {
    return URL.createObjectURL(blob);
}

function revokeImagePreviewURL(url) {
    if (url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
}

// ── Voice Recorder ─────────────────────────────────────────────

class VoiceRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        this.startTime = null;
        this.timerInterval = null;
        this.isRecording = false;
        
        // Web Audio API properties
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.animationFrameId = null;
        this.volumes = []; // Volume history for waveform generation

        this.onDurationUpdate = null; // callback(seconds)
        this.onAmplitude = null;      // callback(normalizedVolume)
        this.onMaxDuration = null;    // callback(blob, waveform)
    }

    async start() {
        // getUserMedia will trigger the browser's permission prompt automatically
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        this.audioChunks = [];
        this.isRecording = true;
        this.startTime = Date.now();

        // Pick the best supported MIME type
        const mimeType = MediaRecorder.isTypeSupported(MediaConfig.voice.mimeType)
            ? MediaConfig.voice.mimeType
            : MediaConfig.voice.fallbackMimeType;

        this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.audioChunks.push(e.data);
        };

        this.mediaRecorder.start(250); // collect data every 250ms for smoother streaming

        // Setup Web Audio API for waveform extraction
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            const source = this.audioContext.createMediaStreamSource(this.stream);
            source.connect(this.analyser);
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            const drawWaveform = () => {
                if (!this.isRecording) return;
                this.analyser.getByteFrequencyData(this.dataArray);
                let sum = 0;
                for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
                const avg = sum / this.dataArray.length;
                this.volumes.push(avg);
                
                // Realtime callback for UI (0.0 to 1.0)
                if (this.onAmplitude) this.onAmplitude(avg / 255);
                
                this.animationFrameId = requestAnimationFrame(drawWaveform);
            };
            drawWaveform();
        } catch (e) {
            console.warn("Web Audio API not supported for waveform:", e);
        }

        // Duration timer
        this.timerInterval = setInterval(() => {
            const elapsed = this.getDuration();
            if (this.onDurationUpdate) this.onDurationUpdate(elapsed);

            if (elapsed >= MediaConfig.voice.maxDurationSec) {
                this.stop().then((result) => {
                    if (this.onMaxDuration) this.onMaxDuration(result.blob, result.waveform);
                });
            }
        }, 100);
    }

    stop() {
        return new Promise((resolve) => {
            if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                this.cleanup();
                resolve(null);
                return;
            }

            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
                
                // Compute 40-bar waveform data array
                let waveform = [];
                if (this.volumes.length > 0) {
                    const targetBars = 40;
                    const chunkSize = Math.max(1, Math.floor(this.volumes.length / targetBars));
                    for (let i = 0; i < targetBars; i++) {
                        const chunk = this.volumes.slice(i * chunkSize, (i + 1) * chunkSize);
                        if (chunk.length === 0) {
                            waveform.push(0.1);
                            continue;
                        }
                        const sum = chunk.reduce((a, b) => a + b, 0);
                        let avg = sum / chunk.length / 255;
                        avg = Math.max(0.1, Math.min(1.0, avg * 1.5)); // Boost low volumes slightly
                        waveform.push(parseFloat(avg.toFixed(2)));
                    }
                } else {
                    // Fallback flat waveform
                    waveform = Array(40).fill(0.1);
                }

                this.cleanup();
                resolve({ blob, waveform });
            };

            this.isRecording = false;
            this.mediaRecorder.stop();
        });
    }

    cancel() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.onstop = () => {};
            this.mediaRecorder.stop();
        }
        this.cleanup();
    }

    getDuration() {
        if (!this.startTime) return 0;
        return Math.floor((Date.now() - this.startTime) / 1000);
    }

    cleanup() {
        this.isRecording = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(()=>{});
        }
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach((t) => t.stop());
            this.stream = null;
        }
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.volumes = [];
        this.startTime = null;
    }
}

// ── Validation ─────────────────────────────────────────────────

function validateImageFile(file) {
    if (!MediaConfig.image.allowedTypes.includes(file.type)) {
        return { valid: false, error: `Desteklenmeyen format: ${file.type}. Kabul edilen: JPEG, PNG, GIF, WebP` };
    }
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MediaConfig.image.maxSizeMB) {
        return { valid: false, error: `Dosya çok büyük: ${sizeMB.toFixed(1)}MB. Maksimum: ${MediaConfig.image.maxSizeMB}MB` };
    }
    return { valid: true };
}

function validateVoiceBlob(blob) {
    const sizeMB = blob.size / (1024 * 1024);
    if (sizeMB > MediaConfig.voice.maxSizeMB) {
        return { valid: false, error: `Ses kaydı çok büyük: ${sizeMB.toFixed(1)}MB. Maksimum: ${MediaConfig.voice.maxSizeMB}MB` };
    }
    return { valid: true };
}

// ── Blob / ArrayBuffer Helpers ─────────────────────────────────

function blobToArrayBuffer(blob) {
    return blob.arrayBuffer();
}

function arrayBufferToBlob(buffer, mimeType) {
    return new Blob([buffer], { type: mimeType });
}

// ── Format Helpers ─────────────────────────────────────────────

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
