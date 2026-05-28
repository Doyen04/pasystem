// ============ State Management ============
let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let analyserNode = null;
let gainNode = null;
let animFrameId = null;
let isLive = false;
let lastFrequencyMax = 0;
let smoothingFactor = 0.85;

// ============ VU Meter Constants ============
const BAR_COUNT = 34;
const frequencyData = new Uint8Array(256);
const smoothedFrequencyData = new Array(BAR_COUNT).fill(0);

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
    // Redraw placeholder if not live
    if (!isLive) {
        drawVUMeter(false);
    }
}

setupCanvasDPR();
window.addEventListener('resize', () => {
    requestAnimationFrame(setupCanvasDPR);
});

// ============ VU Meter Drawing ============
function drawVUMeter(isActive) {
    const width = vuCanvas.offsetWidth;
    const height = vuCanvas.offsetHeight;

    // Clear canvas with subtle gradient
    const gradient = vuCtx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0a0a0a');
    gradient.addColorStop(1, '#0d0d0d');
    vuCtx.fillStyle = gradient;
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
        let value;
        if (isPlaceholder) {
            value = 0.12;
        } else {
            const rawValue = frequencyData[i * step] / 255;
            smoothedFrequencyData[i] = smoothedFrequencyData[i] * smoothingFactor + rawValue * (1 - smoothingFactor);
            value = smoothedFrequencyData[i];
        }

        const barHeight = value * height;

        // Determine color with smoother transitions
        let color;
        if (isPlaceholder) {
            color = 'rgba(80, 80, 80, 0.4)';
        } else if (value < 0.3) {
            // Deep green
            color = 'rgb(46, 164, 79)';
        } else if (value < 0.5) {
            // Green to amber transition
            const t = (value - 0.3) / 0.2;
            const r = Math.round(46 + (186 - 46) * t);
            const g = Math.round(164 + (117 - 164) * t);
            const b = Math.round(79 + (23 - 79) * t);
            color = `rgb(${r}, ${g}, ${b})`;
        } else if (value < 0.82) {
            // Amber
            color = 'rgb(186, 117, 23)';
        } else {
            // Amber to red transition
            const t = (value - 0.82) / 0.18;
            const r = Math.round(186 + (226 - 186) * t);
            const g = Math.round(117 + (75 - 117) * t);
            const b = Math.round(23 + (74 - 23) * t);
            color = `rgb(${r}, ${g}, ${b})`;
        }

        vuCtx.fillStyle = color;
        vuCtx.shadowColor = isPlaceholder ? 'transparent' : color.replace('rgb', 'rgba').replace(')', ', 0.3)');
        vuCtx.shadowBlur = isPlaceholder ? 0 : 4;
        vuCtx.fillRect(i * barWidth, height - barHeight, barWidth - 1.5, barHeight);
    }

    vuCtx.shadowColor = 'transparent';
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
    
    // Fade out after delay
    const fadeOutTimeout = setTimeout(() => {
        errorBox.style.opacity = '0';
        errorBox.style.transform = 'translateY(-8px)';
        
        const removeTimeout = setTimeout(() => {
            errorBox.classList.remove('show');
            errorBox.style.opacity = '1';
            errorBox.style.transform = 'translateY(0)';
        }, 300);
        
        return removeTimeout;
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
