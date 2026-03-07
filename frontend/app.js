// NoFee-Music Audio App Engine using Web Audio API

class NeuralAudioEngine {
    constructor() {
        this.ctx = null;
        this.isPlaying = false;

        this.masterGain = null;
        this.binauralGain = null;
        this.musicGain = null;
        this.analyser = null;
        this.dataArray = null;

        // Binaural sources
        this.leftOscSynth = null;
        this.rightOscSynth = null;
        this.leftPanner = null;
        this.rightPanner = null;

        // Music Streaming Elements
        this.audioElement = new Audio();
        this.audioElement.crossOrigin = "anonymous";
        this.musicSource = null; // MediaElementAudioSourceNode

        // Environment Effects
        this.effects = {
            rain: { gain: null, sliderVol: 0, currentVol: 0, nodes: [] },
            thunder: { gain: null, sliderVol: 0, currentVol: 0, nodes: [] },
            wind: { gain: null, sliderVol: 0, currentVol: 0, nodes: [] },
            river: { gain: null, sliderVol: 0, currentVol: 0, nodes: [] },
            space: { gain: null, sliderVol: 0, currentVol: 0, nodes: [] },
            ocean: { gain: null, sliderVol: 0, currentVol: 0, nodes: [] },
            fire: { gain: null, sliderVol: 0, currentVol: 0, nodes: [] }
        };
        this.noiseBuffer = null;
        this.crackleBuffer = null;

        this.isSmartCycle = true;
        this.smartCycleInterval = null;

        // Queueing state
        this.playlist = [];
        this.trackIndex = -1;

        // Tremolo Nodes
        this.tremoloGain = null;
        this.lfo = null;
        this.lfoGain = null;

        // Session State
        this.sessionTimer = null;
        this.sessionEndTime = 0;
        this.sessionDurationMinutes = 0; // 0 = infinite

        // State
        this.currentMode = 'focus';
        this.isShuffle = true; // Enabled by default for variety
        this.isLoop = false;

        // Config
        this.modes = {
            focus: { carrierFreq: 220, beatFreq: 15 },
            relax: { carrierFreq: 170, beatFreq: 10 },
            sleep: { carrierFreq: 110, beatFreq: 3 }
        };

        // Volumes
        this.vols = { master: 0.7, binaural: 0.3, music: 0.7, tremoloDepth: 0.5 };

        // Event handlers
        this.onTrackChange = null;
    }

    async init() {
        if (this.ctx) return;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        // Master Gain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.vols.master;
        this.masterGain.connect(this.ctx.destination);

        // Binaural mixing
        this.binauralGain = this.ctx.createGain();
        this.binauralGain.gain.value = 0;
        this.binauralGain.connect(this.masterGain);

        // Music mixing
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0;
        this.musicGain.connect(this.masterGain);

        // Setup Media Element Source
        this.musicSource = this.ctx.createMediaElementSource(this.audioElement);

        // Setup Tremolo chain for the streaming element
        this.tremoloGain = this.ctx.createGain();
        this.tremoloGain.gain.value = 1.0;

        this.lfo = this.ctx.createOscillator();
        this.lfo.type = 'sine';
        this.lfo.frequency.value = this.modes[this.currentMode].beatFreq;
        this.lfo.start();

        this.lfoGain = this.ctx.createGain();
        this.updateTremoloDepth(this.vols.tremoloDepth);

        this.lfo.connect(this.lfoGain);
        this.lfoGain.connect(this.tremoloGain.gain);

        // Setup Analyser for visualizer
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 64;
        const bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(bufferLength);

        this.musicSource.connect(this.tremoloGain);
        this.tremoloGain.connect(this.musicGain);
        this.musicGain.connect(this.analyser);

        // Setup Ambient sources (Pure Synthesis)
        const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 5, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseBuffer.length; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = noiseBuffer;

        const crackleBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 5, this.ctx.sampleRate);
        const crackleData = crackleBuffer.getChannelData(0);
        for (let i = 0; i < crackleData.length; i++) {
            if (Math.random() < 0.0004) {
                const amp = (Math.random() * 1.5) + 0.2;
                crackleData[i] = amp;
                if (i + 1 < crackleData.length) crackleData[i + 1] = -amp * 0.8;
                if (i + 2 < crackleData.length) crackleData[i + 2] = amp * 0.5;
                i += 2;
            }
        }
        this.crackleBuffer = crackleBuffer;

        // Initialize gain nodes for each effect
        for (let key in this.effects) {
            let ef = this.effects[key];
            ef.gain = this.ctx.createGain();
            ef.gain.gain.value = 0;
            ef.gain.connect(this.masterGain);
        }

        this.setupSynthChains();

        // Auto-next track
        this.audioElement.onended = () => {
            if (this.isPlaying) {
                if (this.isLoop) {
                    this.audioElement.currentTime = 0;
                    this.audioElement.play();
                } else {
                    this.playNextTrack();
                }
            }
        };

        await this.syncPlaylist();
    }

    setupSynthChains() {
        if (!this.noiseBuffer) return;
        const ctx = this.ctx;

        const createNoise = () => {
            const node = ctx.createBufferSource();
            node.buffer = this.noiseBuffer;
            node.loop = true;
            node.start();
            return node;
        };

        // 1. Rain (Pinkish noise)
        const rainNoise = createNoise();
        const rainLP = ctx.createBiquadFilter();
        rainLP.type = 'lowpass';
        rainLP.frequency.value = 1000;
        const rainHP = ctx.createBiquadFilter();
        rainHP.type = 'highpass';
        rainHP.frequency.value = 300;
        rainNoise.connect(rainLP).connect(rainHP).connect(this.effects.rain.gain);

        // 2. Thunder (Deep brown noise + random rumbling LFO)
        const thunderNoise = createNoise();
        const thunderLP = ctx.createBiquadFilter();
        thunderLP.type = 'lowpass';
        thunderLP.frequency.value = 120;
        const thunderLFO = ctx.createOscillator();
        thunderLFO.type = 'sine';
        thunderLFO.frequency.value = 0.5; // slow rumble
        const thunderLFOGain = ctx.createGain();
        thunderLFOGain.gain.value = 50;
        thunderLFO.connect(thunderLFOGain).connect(thunderLP.frequency);
        thunderLFO.start();
        thunderNoise.connect(thunderLP).connect(this.effects.thunder.gain);

        // 3. Wind (Sweeping lowpass)
        const windNoise = createNoise();
        const windLP = ctx.createBiquadFilter();
        windLP.type = 'lowpass';
        windLP.frequency.value = 500;
        const windLFO = ctx.createOscillator();
        windLFO.type = 'sine';
        windLFO.frequency.value = 0.15; // Windy sweep
        const windLFOGain = ctx.createGain();
        windLFOGain.gain.value = 300;
        windLFO.connect(windLFOGain).connect(windLP.frequency);
        windLFO.start();
        windNoise.connect(windLP).connect(this.effects.wind.gain);

        // 4. River (Mid-range noise)
        const riverNoise = createNoise();
        const riverLP = ctx.createBiquadFilter();
        riverLP.type = 'lowpass';
        riverLP.frequency.value = 800;
        const riverHP = ctx.createBiquadFilter();
        riverHP.type = 'highpass';
        riverHP.frequency.value = 200;
        riverNoise.connect(riverLP).connect(riverHP).connect(this.effects.river.gain);

        // 5. Space (Drones)
        const spaceOsc1 = ctx.createOscillator();
        spaceOsc1.type = 'sine';
        spaceOsc1.frequency.value = 55;
        const spaceOsc2 = ctx.createOscillator();
        spaceOsc2.type = 'sine';
        spaceOsc2.frequency.value = 55.5; // beating
        const spaceOsc3 = ctx.createOscillator();
        spaceOsc3.type = 'triangle';
        spaceOsc3.frequency.value = 110;
        const spaceMix = ctx.createGain();
        spaceMix.gain.value = 0.3; // quiet drones
        spaceOsc1.connect(spaceMix);
        spaceOsc2.connect(spaceMix);
        spaceOsc3.connect(spaceMix);
        spaceOsc1.start(); spaceOsc2.start(); spaceOsc3.start();
        spaceMix.connect(this.effects.space.gain);

        // 6. Ocean (Slow wave modulation)
        const oceanNoise = createNoise();
        const oceanLP = ctx.createBiquadFilter();
        oceanLP.type = 'lowpass';
        oceanLP.frequency.value = 400;
        const oceanAmp = ctx.createGain();
        oceanAmp.gain.value = 0.5;
        const oceanLFO = ctx.createOscillator();
        oceanLFO.type = 'sine';
        oceanLFO.frequency.value = 0.08; // slow waves
        const oceanLFOGain = ctx.createGain();
        oceanLFOGain.gain.value = 0.4;
        oceanLFO.connect(oceanLFOGain).connect(oceanAmp.gain);
        oceanLFO.start();
        oceanNoise.connect(oceanLP).connect(oceanAmp).connect(this.effects.ocean.gain);

        // 7. Fire (Campfire roar + random crackling)
        const fireRoarNoise = createNoise();
        const roarLP = ctx.createBiquadFilter();
        roarLP.type = 'lowpass';
        roarLP.frequency.value = 400;
        const roarGain = ctx.createGain();
        roarGain.gain.value = 0.5;
        fireRoarNoise.connect(roarLP).connect(roarGain);

        const crackleNode = ctx.createBufferSource();
        crackleNode.buffer = this.crackleBuffer;
        crackleNode.loop = true;
        crackleNode.start();
        const crackleLP = ctx.createBiquadFilter();
        crackleLP.type = 'lowpass';
        crackleLP.frequency.value = 6000;
        const crackleHP = ctx.createBiquadFilter();
        crackleHP.type = 'highpass';
        crackleHP.frequency.value = 1000;
        const crackleGain = ctx.createGain();
        crackleGain.gain.value = 1.5;
        crackleNode.connect(crackleLP).connect(crackleHP).connect(crackleGain);

        roarGain.connect(this.effects.fire.gain);
        crackleGain.connect(this.effects.fire.gain);
    }

    async syncPlaylist() {
        console.log("Syncing playlist. Tauri detected:", !!window.__TAURI__);
        try {
            if (window.__TAURI__) {
                const data = await window.__TAURI__.core.invoke('get_playlist', { mood: this.currentMode });
                console.log("Tauri data received:", data);
                this.playlist = data.tracks.map(t => ({
                    ...t,
                    url: window.__TAURI__.core.convertFileSrc(t.url)
                })) || [];
            } else {
                console.error("No Tauri environment detected. Offline mode only.");
                this.playlist = [];
            }
        } catch (err) {
            console.error("Failed to sync playlist", err);
        }
    }

    async playNextTrack() {
        if (this.playlist.length === 0) {
            await this.syncPlaylist();
        }

        if (this.playlist.length === 0) {
            // No local files found
            this.audioElement.src = "lofi-track.mp3";
            if (this.onTrackChange) this.onTrackChange({ title: "Default Lo-Fi loop" });
        } else {
            if (this.isShuffle && this.playlist.length > 1) {
                let nextIdx = Math.floor(Math.random() * this.playlist.length);
                while (nextIdx === this.trackIndex) {
                    nextIdx = Math.floor(Math.random() * this.playlist.length);
                }
                this.trackIndex = nextIdx;
            } else {
                this.trackIndex = (this.trackIndex + 1) % this.playlist.length;
            }

            const track = this.playlist[this.trackIndex];
            this.audioElement.src = track.url;
            if (this.onTrackChange) this.onTrackChange(track.metadata);
        }

        try {
            await this.audioElement.play();
        } catch (e) { console.error("Play failed", e); }
    }

    async playPrevTrack() {
        if (this.playlist.length === 0) return;

        // If played more than 3 seconds, just restart track
        if (this.audioElement.currentTime > 3) {
            this.audioElement.currentTime = 0;
            return;
        }

        if (this.playlist.length > 1) {
            if (this.isShuffle) {
                let nextIdx = Math.floor(Math.random() * this.playlist.length);
                while (nextIdx === this.trackIndex) {
                    nextIdx = Math.floor(Math.random() * this.playlist.length);
                }
                this.trackIndex = nextIdx;
            } else {
                this.trackIndex = (this.trackIndex - 1 + this.playlist.length) % this.playlist.length;
            }
        }

        const track = this.playlist[this.trackIndex];
        this.audioElement.src = track.url;
        if (this.onTrackChange) this.onTrackChange(track.metadata);

        try {
            await this.audioElement.play();
        } catch (e) { console.error("Play failed", e); }
    }

    toggleLoop() {
        this.isLoop = !this.isLoop;
        return this.isLoop;
    }

    startMusic() {
        this.musicGain.gain.setTargetAtTime(this.vols.music, this.ctx.currentTime, 1);

        if (this.audioElement.paused) {
            if (!this.audioElement.src) {
                this.playNextTrack();
            } else {
                this.audioElement.play();
            }
        }
    }

    stopMusic() {
        this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
        setTimeout(() => {
            this.audioElement.pause();
        }, 500);
    }

    startBinaural() {
        const specs = this.modes[this.currentMode];
        const leftF = specs.carrierFreq - (specs.beatFreq / 2);
        const rightF = specs.carrierFreq + (specs.beatFreq / 2);

        this.leftOscSynth = this.ctx.createOscillator();
        this.leftOscSynth.type = 'sine';
        this.leftOscSynth.frequency.value = leftF;

        this.rightOscSynth = this.ctx.createOscillator();
        this.rightOscSynth.type = 'sine';
        this.rightOscSynth.frequency.value = rightF;

        this.leftPanner = this.ctx.createStereoPanner();
        this.leftPanner.pan.value = -1;

        this.rightPanner = this.ctx.createStereoPanner();
        this.rightPanner.pan.value = 1;

        this.leftOscSynth.connect(this.leftPanner);
        this.leftPanner.connect(this.binauralGain);

        this.rightOscSynth.connect(this.rightPanner);
        this.rightPanner.connect(this.binauralGain);

        this.leftOscSynth.start();
        this.rightOscSynth.start();

        this.binauralGain.gain.setTargetAtTime(this.vols.binaural, this.ctx.currentTime, 2);
    }

    stopBinaural() {
        if (this.leftOscSynth && this.rightOscSynth) {
            this.binauralGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
            setTimeout(() => {
                if (this.leftOscSynth) { try { this.leftOscSynth.stop(); } catch (e) { } this.leftOscSynth = null; }
                if (this.rightOscSynth) { try { this.rightOscSynth.stop(); } catch (e) { } this.rightOscSynth = null; }
            }, 600);
        }
    }

    setTargetVolume(ef, vol, fadeTime = 0.5) {
        ef.currentVol = vol;
        if (ef.gain && this.ctx) ef.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, fadeTime);
    }

    updateEffectsVolumes() {
        if (!this.ctx || !this.isPlaying) return;

        const active = Object.keys(this.effects).filter(k => this.effects[k].sliderVol > 0);

        if (!this.isSmartCycle || active.length <= 1) {
            // Direct playback
            Object.keys(this.effects).forEach(key => {
                this.setTargetVolume(this.effects[key], this.effects[key].sliderVol, 0.5);
            });
        } else {
            // Need to cycle them if multiple. Let the cycle loop handle it
            this.cycleEffectsStep();
        }
    }

    cycleEffectsStep() {
        if (!this.ctx || !this.isPlaying || !this.isSmartCycle) return;
        const active = Object.keys(this.effects).filter(k => this.effects[k].sliderVol > 0);

        if (active.length <= 1) return; // handled by updateEffectsVolumes

        // Shuffle and pick 2
        const shuffled = [...active].sort(() => 0.5 - Math.random());
        const a = shuffled[0];
        const b = shuffled[1];

        Object.keys(this.effects).forEach(key => {
            const ef = this.effects[key];
            if (ef.sliderVol === 0) {
                this.setTargetVolume(ef, 0, 2.0);
            } else if (key === a) {
                // High volume (60-100% of slider)
                const vol = ef.sliderVol * (0.6 + Math.random() * 0.4);
                this.setTargetVolume(ef, vol, 4.0); // Slow 4s fade
            } else if (key === b) {
                // Low volume (10-40% of slider)
                const vol = ef.sliderVol * (0.1 + Math.random() * 0.3);
                this.setTargetVolume(ef, vol, 4.0);
            } else {
                // Enabled but zeroed
                this.setTargetVolume(ef, 0, 3.0);
            }
        });
    }

    startAmbiance() {
        this.updateEffectsVolumes();
        if (this.isSmartCycle && !this.smartCycleInterval) {
            this.smartCycleInterval = setInterval(() => this.cycleEffectsStep(), 15000); // 15 seconds
        }
    }

    stopAmbiance() {
        if (this.smartCycleInterval) {
            clearInterval(this.smartCycleInterval);
            this.smartCycleInterval = null;
        }
        Object.keys(this.effects).forEach(key => {
            const ef = this.effects[key];
            if (ef.gain && this.ctx) ef.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
        });
    }

    async setMode(mode) {
        this.currentMode = mode;
        this.trackIndex = -1; // reset playlist index
        this.audioElement.src = ''; // Clear current track

        await this.syncPlaylist();

        if (this.isPlaying) {
            if (this.lfo) {
                this.lfo.frequency.setTargetAtTime(this.modes[mode].beatFreq, this.ctx.currentTime, 0.5);
            }
            this.stopBinaural();
            setTimeout(() => {
                if (this.isPlaying) this.startBinaural();
                if (this.isPlaying) this.playNextTrack();
            }, 600);
        }
    }

    setSessionDuration(minutes) {
        this.sessionDurationMinutes = minutes;
        if (minutes <= 0 && this.sessionTimer) {
            clearTimeout(this.sessionTimer);
            this.sessionTimer = null;
        }
        else if (minutes > 0 && this.isPlaying) {
            this.startSessionTimer();
        }
    }

    startSessionTimer() {
        if (this.sessionTimer) clearTimeout(this.sessionTimer);
        this.sessionEndTime = Date.now() + (this.sessionDurationMinutes * 60000);

        const tick = () => {
            if (!this.isPlaying) return;
            const now = Date.now();
            if (now >= this.sessionEndTime) {
                // Time up! Emulate a pause button click essentially
                document.getElementById('play-btn').click();
                if (this.onTrackChange) this.onTrackChange({ title: "Session Completed" });
            } else {
                this.sessionTimer = setTimeout(tick, 1000);
            }
        };
        tick();
    }

    async togglePlay() {
        if (!this.ctx) await this.init();

        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        this.isPlaying = !this.isPlaying;

        if (this.isPlaying) {
            this.startMusic();
            this.startBinaural();
            this.startAmbiance();
            if (this.sessionDurationMinutes > 0) this.startSessionTimer();
        } else {
            this.stopMusic();
            this.stopBinaural();
            this.stopAmbiance();
            if (this.sessionTimer) clearTimeout(this.sessionTimer);
        }
        return this.isPlaying;
    }

    setMasterVolume(val) {
        this.vols.master = val;
        if (this.masterGain) this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.1);
    }
    setBinauralVolume(val) {
        this.vols.binaural = val;
        if (this.binauralGain && this.isPlaying) this.binauralGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.1);
    }
    setMusicVolume(val) {
        this.vols.music = val;
        if (this.musicGain && this.isPlaying) this.musicGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.1);
    }
    setTremoloDepth(val) {
        this.vols.tremoloDepth = val;
        this.updateTremoloDepth(val);
    }
    updateTremoloDepth(val) {
        if (this.lfoGain) this.lfoGain.gain.setTargetAtTime(val * 0.5, this.ctx ? this.ctx.currentTime : 0, 0.1);
    }
    toggleShuffle() {
        this.isShuffle = !this.isShuffle;
        return this.isShuffle;
    }
    setEffectVolume(effectName, val) {
        if (this.effects[effectName]) {
            this.effects[effectName].sliderVol = val;
            this.updateEffectsVolumes();

            // Auto-update master toggle button state
            this.updateMasterToggleButton();
        }
    }

    updateMasterToggleButton() {
        const anyActive = Object.values(this.effects).some(ef => ef.sliderVol > 0);
        const btn = document.getElementById('master-ambiance-toggle');
        if (btn) btn.classList.toggle('active', anyActive);
    }

    toggleAllAmbiance() {
        const anyActive = Object.values(this.effects).some(ef => ef.sliderVol > 0);

        if (anyActive) {
            // Save state and turn off
            this.savedAmbianceState = {};
            Object.keys(this.effects).forEach(key => {
                this.savedAmbianceState[key] = this.effects[key].sliderVol;
                this.setEffectVolume(key, 0);
                const slider = document.querySelector(`.env-slider[data-effect="${key}"]`);
                if (slider) slider.value = 0;
            });
        } else {
            // Restore state (default to 0.3 if none saved or if all were 0)
            Object.keys(this.effects).forEach(key => {
                const vol = (this.savedAmbianceState && this.savedAmbianceState[key]) ? this.savedAmbianceState[key] : 0.3;
                this.setEffectVolume(key, vol);
                const slider = document.querySelector(`.env-slider[data-effect="${key}"]`);
                if (slider) slider.value = vol;
            });
        }
    }

    setSmartCycle(val) {
        this.isSmartCycle = val;
        if (!val && this.smartCycleInterval) {
            clearInterval(this.smartCycleInterval);
            this.smartCycleInterval = null;
        } else if (val && this.isPlaying) {
            if (!this.smartCycleInterval) this.smartCycleInterval = setInterval(() => this.cycleEffectsStep(), 15000);
        }
        this.updateEffectsVolumes();
    }

    getBeatIntensity() {
        if (!this.analyser || !this.isPlaying) return 0;
        this.analyser.getByteFrequencyData(this.dataArray);

        // Focus on low frequencies for the "beat"
        let sum = 0;
        const bassEnd = Math.floor(this.dataArray.length * 0.4);
        for (let i = 0; i < bassEnd; i++) {
            sum += this.dataArray[i];
        }
        return sum / bassEnd / 255;
    }
}

// UI Controllers
document.addEventListener('DOMContentLoaded', () => {
    const engine = new NeuralAudioEngine();

    const playBtn = document.getElementById('play-btn');
    const playIcon = document.getElementById('play-icon');
    const modeBtns = document.querySelectorAll('.mode-btn');
    const visualizerOrb = document.getElementById('visualizer-orb');
    const statusText = document.getElementById('status-text');
    const statusIndicator = document.querySelector('.status-indicator');
    const metaTitle = document.getElementById('meta-title');
    const metaTags = document.getElementById('meta-tags');

    const root = document.documentElement;

    engine.onTrackChange = (meta) => {
        if (metaTitle) metaTitle.textContent = meta.title || "Unknown Track";
        if (metaTags) metaTags.textContent = "NoFee Creation Team";
    };

    const updateTheme = (mode) => {
        let colors = { focus: '3b82f6', relax: '10b981', sleep: '8b5cf6' };
        const hex = colors[mode];
        root.style.setProperty('--accent', `#${hex}`);
        root.style.setProperty('--accent-glow', `rgba(${parseInt(hex.substr(0, 2), 16)}, ${parseInt(hex.substr(2, 2), 16)}, ${parseInt(hex.substr(4, 2), 16)}, 0.4)`);
    };

    // Frame-based visualizer loop
    function animate() {
        if (engine.isPlaying) {
            const intensity = engine.getBeatIntensity();
            // Scale between 0.95 and 1.35 based on intensity
            const scale = 0.95 + (intensity * 0.4);
            // Opacity between 0.4 and 1.0 (brighter)
            const opacity = 0.4 + (intensity * 0.6);
            // Much more intense glow on peaks
            const glow = 30 + (intensity * 120);

            visualizerOrb.style.transform = `scale(${scale})`;
            visualizerOrb.style.opacity = opacity;
            visualizerOrb.style.boxShadow = `0 0 ${glow}px var(--accent-glow), 0 0 ${glow / 2}px var(--accent), inset 0 0 ${glow / 2}px var(--accent-glow)`;

            // Influence the inner orb blur/brightness too
            const innerOrb = visualizerOrb.querySelector('.orb-inner');
            if (innerOrb) {
                innerOrb.style.filter = `blur(${20 - (intensity * 10)}px)`;
                innerOrb.style.opacity = 0.5 + (intensity * 0.5);
            }
        } else {
            visualizerOrb.style.transform = 'scale(1)';
            visualizerOrb.style.opacity = '0.6';
            visualizerOrb.style.boxShadow = '';
            const innerOrb = visualizerOrb.querySelector('.orb-inner');
            if (innerOrb) {
                innerOrb.style.filter = 'blur(25px)';
                innerOrb.style.opacity = '0.5';
            }
        }
        requestAnimationFrame(animate);
    }
    animate();

    modeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            modeBtns.forEach(b => b.classList.remove('active'));
            let target = e.currentTarget;
            target.classList.add('active');

            const mode = target.dataset.mode;
            engine.setMode(mode);
            updateTheme(mode);
            statusText.textContent = `${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode`;
            metaTitle.textContent = "Select a mode";
        });
    });

    playBtn.addEventListener('click', async () => {
        const isPlaying = await engine.togglePlay();

        if (isPlaying) {
            playIcon.classList.remove('fa-play');
            playIcon.classList.add('fa-pause');
            visualizerOrb.classList.add('playing');
            statusIndicator.classList.add('playing');
            statusText.textContent = "Audio Active";
            updateTheme(engine.currentMode);
        } else {
            playIcon.classList.remove('fa-pause');
            playIcon.classList.add('fa-play');
            visualizerOrb.classList.remove('playing');
            statusIndicator.classList.remove('playing');
            statusText.textContent = "Paused";
            visualizerOrb.style.animationDuration = '';
        }
    });

    const shuffleBtn = document.getElementById('shuffle-btn');
    if (shuffleBtn) {
        shuffleBtn.addEventListener('click', () => {
            const isShuffle = engine.toggleShuffle();
            if (isShuffle) {
                shuffleBtn.classList.add('active');
            } else {
                shuffleBtn.classList.remove('active');
            }
        });
    }

    const loopBtn = document.getElementById('loop-btn');
    if (loopBtn) {
        loopBtn.addEventListener('click', () => {
            const isLoop = engine.toggleLoop();
            if (isLoop) {
                loopBtn.classList.add('active');
            } else {
                loopBtn.classList.remove('active');
            }
        });
    }

    const prevBtn = document.getElementById('prev-btn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (engine.isPlaying) engine.playPrevTrack();
        });
    }

    const nextBtn = document.getElementById('next-btn');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (engine.isPlaying) engine.playNextTrack();
        });
    }

    const progressBar = document.getElementById('progress-bar');
    const timeCurrent = document.getElementById('time-current');
    const timeTotal = document.getElementById('time-total');

    function formatTime(secs) {
        if (isNaN(secs)) return "0:00";
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    engine.audioElement.addEventListener('timeupdate', () => {
        const current = engine.audioElement.currentTime;
        const total = engine.audioElement.duration;
        if (!isNaN(total) && total > 0) {
            progressBar.value = (current / total) * 100;
            timeCurrent.textContent = formatTime(current);
            timeTotal.textContent = formatTime(total);
        }
    });

    progressBar.addEventListener('input', (e) => {
        const total = engine.audioElement.duration;
        if (!isNaN(total) && total > 0) {
            engine.audioElement.currentTime = (e.target.value / 100) * total;
        }
    });

    // Sliders
    document.getElementById('master-volume').addEventListener('input', e => engine.setMasterVolume(parseFloat(e.target.value)));
    document.getElementById('binaural-volume').addEventListener('input', e => engine.setBinauralVolume(parseFloat(e.target.value)));
    document.getElementById('music-volume').addEventListener('input', e => engine.setMusicVolume(parseFloat(e.target.value)));
    document.getElementById('tremolo-depth').addEventListener('input', e => engine.setTremoloDepth(parseFloat(e.target.value)));

    const sessionSlider = document.getElementById('session-time');
    const sessionVal = document.getElementById('session-val');
    if (sessionSlider) {
        sessionSlider.addEventListener('input', e => {
            const val = parseInt(e.target.value);
            sessionVal.textContent = val === 0 ? "Infinite" : `${val} mins`;
            engine.setSessionDuration(val);
        });
    }

    const settingsToggle = document.getElementById('settings-toggle');
    const effectsToggle = document.getElementById('effects-toggle');
    const mainPanel = document.getElementById('main-panel');

    if (settingsToggle && mainPanel) {
        settingsToggle.addEventListener('click', () => {
            mainPanel.classList.remove('effects-open');
            mainPanel.classList.toggle('settings-open');
        });
    }

    if (effectsToggle && mainPanel) {
        effectsToggle.addEventListener('click', () => {
            mainPanel.classList.remove('settings-open');
            mainPanel.classList.toggle('effects-open');
        });
    }

    document.querySelectorAll('.env-slider').forEach(slider => {
        slider.addEventListener('input', e => {
            const effectName = e.target.getAttribute('data-effect');
            engine.setEffectVolume(effectName, parseFloat(e.target.value));
        });
    });

    const smartCycleToggle = document.getElementById('smart-cycle-toggle');
    if (smartCycleToggle) {
        smartCycleToggle.addEventListener('change', e => {
            engine.setSmartCycle(e.target.checked);
        });
    }

    const masterAmbianceToggle = document.getElementById('master-ambiance-toggle');
    if (masterAmbianceToggle) {
        masterAmbianceToggle.addEventListener('click', () => {
            engine.toggleAllAmbiance();
        });
    }

    const hypnotizeBtn = document.getElementById('hypnotize-btn');
    if (hypnotizeBtn) {
        hypnotizeBtn.addEventListener('click', async () => {
            const isHypnotize = document.body.classList.toggle('hypnotize-mode');
            hypnotizeBtn.classList.toggle('active', isHypnotize);

            try {
                if (window.__TAURI__ && window.__TAURI__.window) {
                    const currentWindow = window.__TAURI__.window.getCurrentWindow();
                    await currentWindow.setFullscreen(isHypnotize);
                }
            } catch (e) {
                console.log("Fullscreen toggle failed", e);
            }
        });
    }

    // --- Custom Tooltip Logic ---
    const tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    document.body.appendChild(tooltip);

    const showTooltip = (e) => {
        const text = e.currentTarget.getAttribute('data-tooltip');
        if (!text) return;

        tooltip.textContent = text;
        tooltip.classList.add('visible');
        updateTooltipPosition(e);
    };

    const updateTooltipPosition = (e) => {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        const tooltipRect = tooltip.getBoundingClientRect();

        let x = mouseX + 15;
        let y = mouseY + 15;

        // Boundary checks
        if (x + tooltipRect.width > window.innerWidth - 20) {
            x = mouseX - tooltipRect.width - 15;
        }
        if (y + tooltipRect.height > window.innerHeight - 20) {
            y = mouseY - tooltipRect.height - 15;
        }

        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
    };

    const hideTooltip = () => {
        tooltip.classList.remove('visible');
    };

    // Attach to all elements with data-tooltip
    const attachTooltips = () => {
        document.querySelectorAll('[data-tooltip]').forEach(el => {
            el.removeEventListener('mouseenter', showTooltip);
            el.removeEventListener('mousemove', updateTooltipPosition);
            el.removeEventListener('mouseleave', hideTooltip);

            el.addEventListener('mouseenter', showTooltip);
            el.addEventListener('mousemove', updateTooltipPosition);
            el.addEventListener('mouseleave', hideTooltip);
        });
    };

    attachTooltips();

    // Some buttons might be dynamic or change attributes, but for now static is fine.
    // If the play button text changes (it doesn't, but icon does), we might want to update tooltip text.
    // However, the current prompt just asks for explanations on all buttons.
});
