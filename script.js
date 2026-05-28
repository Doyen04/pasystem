// ============ State Management ============
let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let analyserNode = null;
let gainNode = null;
let animFrameId = null;
let isLive = false;

// ============ UI Elements ============
const micButton = document.getElementById('micButton');
const statusPill = document.querySelector('.status-pill');
const statusText = document.querySelector('.status-text');
const statusDot = document.querySelector('.status-dot');
const vuCanvas = document.getElementById('vuMeter');
const vuCtx = vuCanvas.getContext('2d');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');
const echoCancelToggle = document.getElementById('echoCancelToggle');
const noiseSuppressToggle = document.getElementById('noiseSuppressToggle');
const warningBox = document.getElementById('warningBox');
const errorBox = document.getElementById('errorBox');

// ============ Canvas Setup ============
function setupCanvasDPR() {
    const dpr = window.devicePixelRatio || 1;
    const width = vuCanvas.offsetWidth;
    const height = vuCanvas.offsetHeight;
    vuCanvas.width = width * dpr;
    vuCanvas.height = height * dpr;
    vuCtx.scale(dpr, dpr);
}

setupCanvasDPR();
window.addEventListener('resize', setupCanvasDPR);

// ============ VU Meter Drawing ============
const BAR_COUNT = 34;
const frequencyData = new Uint8Array(256);

function drawVUMeter(isActive) {
    const width = vuCanvas.offsetWidth;
    const height = vuCanvas.offsetHeight;

    // Clear canvas
    vuCtx.fillStyle = '#0a0a0a';
    vuCtx.fillRect(0, 0, width, height);

    if (!analyserNode || !isActive) {
        // Draw faint placeholder bars
        drawBars(true);
        return;
    }

    // Get frequency data
    analyserNode.getByteFrequencyData(frequencyData);
    drawBars(false);
}

function drawBars(isPlaceholder) {
    const width = vuCanvas.offsetWidth;
    const height = vuCanvas.offsetHeight;
    const barWidth = width / BAR_COUNT;
    const bufferLength = frequencyData.length;
    const step = Math.floor(bufferLength / BAR_COUNT);

    for (let i = 0; i < BAR_COUNT; i++) {
        const value = isPlaceholder ? 0.15 : frequencyData[i * step] / 255;
        const barHeight = value * height;

        // Determine color
        let color;
        if (isPlaceholder) {
            color = '#333';
        } else if (value < 0.5) {
            color = 'rgb(46, 164, 79)'; // green
        } else if (value < 0.82) {
            color = 'rgb(186, 117, 23)'; // amber
        } else {
            color = 'rgb(226, 75, 74)'; // red
        }

        vuCtx.fillStyle = color;
        vuCtx.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
    }
}

// ============ Animation Loop ============
function animateVU() {
    drawVUMeter(isLive);
    animFrameId = requestAnimationFrame(animateVU);
}

// ============ UI Updates ============
function updateStatusPill() {
    if (isLive) {
        statusPill.classList.add('live');
        statusText.textContent = 'live';
    } else {
        statusPill.classList.remove('live');
        statusText.textContent = 'standby';
    }
}

function updateMicButton() {
    const label = micButton.querySelector('.mic-label');
    if (isLive) {
        micButton.classList.add('live');
        label.textContent = 'on air';
    } else {
        micButton.classList.remove('live');
        label.textContent = 'broadcast';
    }
}

function updateWarningVisibility() {
    const showWarning = isLive && !echoCancelToggle.checked;
    warningBox.classList.toggle('show', showWarning);
}

function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('show');
    setTimeout(() => {
        errorBox.classList.remove('show');
    }, 5000);
}

// ============ Audio Setup ============
async function startBroadcast() {
    try {
        // Create AudioContext if needed
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'interactive'
            });
        }

        // Resume if suspended
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        // Get constraints
        const audioConstraints = {
            echoCancellation: echoCancelToggle.checked,
            noiseSuppression: noiseSuppressToggle.checked,
            autoGainControl: false
        };

        // Get user media
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints
        });

        // Create nodes
        sourceNode = audioCtx.createMediaStreamSource(mediaStream);
        analyserNode = audioCtx.createAnalyser();
        gainNode = audioCtx.createGain();

        // Set analyser FFT size
        analyserNode.fftSize = 512;

        // Set initial gain
        gainNode.gain.value = volumeSlider.value / 100;

        // Connect: source -> analyser & source -> gain -> destination
        sourceNode.connect(analyserNode);
        sourceNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        // Update UI
        isLive = true;
        updateStatusPill();
        updateMicButton();
        updateWarningVisibility();
        micButton.disabled = false;

        // Start animation loop
        animateVU();

    } catch (error) {
        isLive = false;
        updateStatusPill();
        updateMicButton();
        micButton.disabled = false;

        // Show appropriate error
        if (error.name === 'NotAllowedError') {
            showError('Microphone permission denied. Please allow access to use PA system.');
        } else if (error.name === 'NotFoundError') {
            showError('No microphone found. Please connect a microphone and try again.');
        } else {
            showError(`Error: ${error.message}`);
        }

        console.error('Broadcast error:', error);
    }
}

function stopBroadcast() {
    // Stop animation
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }

    // Stop all tracks
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    // Close audio context
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }

    // Clear nodes
    sourceNode = null;
    analyserNode = null;
    gainNode = null;

    // Update UI
    isLive = false;
    updateStatusPill();
    updateMicButton();
    updateWarningVisibility();
    micButton.disabled = false;

    // Draw placeholder bars
    drawVUMeter(false);
}

// ============ Event Listeners ============
micButton.addEventListener('click', async () => {
    micButton.disabled = true;
    if (isLive) {
        stopBroadcast();
    } else {
        await startBroadcast();
    }
});

volumeSlider.addEventListener('input', () => {
    const value = volumeSlider.value;
    volumeValue.textContent = value;
    if (gainNode) {
        gainNode.gain.value = value / 100;
    }
});

echoCancelToggle.addEventListener('change', () => {
    updateWarningVisibility();
});

// ============ Initial Draw ============
drawVUMeter(false);
