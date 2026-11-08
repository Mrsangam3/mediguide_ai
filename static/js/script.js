/**
 * MediGuide AI — Frontend Application Controller
 * High-reliability clinical chat interface, triage visualizer, voice I/O, and medicine guide.
 */

document.addEventListener("DOMContentLoaded", () => {
    // -------------------------------------------------------------------------
    // 1. APPLICATION STATE
    // -------------------------------------------------------------------------
    const state = {
        messages: [],
        currentTriageLevel: "routine",
        isWaiting: false,
        soundEnabled: localStorage.getItem("mediguide_sound") !== "false",
        theme: localStorage.getItem("mediguide_theme") || "light",
        autoTts: localStorage.getItem("mediguide_autotts") === "true",
        isRecording: false,
        medicinesCache: []
    };

    // -------------------------------------------------------------------------
    // 2. DOM ELEMENT REFERENCES
    // -------------------------------------------------------------------------
    const els = {
        // App Layout & Sidebar
        sidebar: document.getElementById("appSidebar"),
        sidebarBackdrop: document.getElementById("sidebarBackdrop"),
        mobileMenuBtn: document.getElementById("mobileMenuBtn"),
        sidebarCloseBtn: document.getElementById("sidebarCloseBtn"),
        themeToggleBtn: document.getElementById("themeToggleBtn"),
        themeIcon: document.getElementById("themeIcon"),
        soundToggleBtn: document.getElementById("soundToggleBtn"),
        soundIcon: document.getElementById("soundIcon"),
        globalTtsToggleBtn: document.getElementById("globalTtsToggleBtn"),
        globalTtsIcon: document.getElementById("globalTtsIcon"),

        // Chat Viewport & Messages
        chatViewport: document.getElementById("chatViewport"),
        welcomeHero: document.getElementById("welcomeHero"),
        messagesContainer: document.getElementById("messagesContainer"),
        typingIndicator: document.getElementById("typingIndicator"),
        typingText: document.getElementById("typingText"),
        sessionMessageCount: document.getElementById("sessionMessageCount"),
        currentTriagePill: document.getElementById("currentTriagePill"),
        currentTriageDesc: document.getElementById("currentTriageDesc"),

        // Input Dock
        messageInput: document.getElementById("messageInput"),
        sendBtn: document.getElementById("sendBtn"),
        sendIcon: document.getElementById("sendIcon"),
        sendSpinner: document.getElementById("sendSpinner"),
        clearTextBtn: document.getElementById("clearTextBtn"),
        micBtn: document.getElementById("micBtn"),
        voiceRecordingBanner: document.getElementById("voiceRecordingBanner"),
        stopVoiceBtn: document.getElementById("stopVoiceBtn"),

        // Modals
        sosModal: document.getElementById("sosModal"),
        headerSosBtn: document.getElementById("headerSosBtn"),
        sidebarSosModalBtn: document.getElementById("sidebarSosModalBtn"),
        medicineModal: document.getElementById("medicineModal"),
        headerMedBtn: document.getElementById("headerMedBtn"),
        openMedicineDirectoryBtn: document.getElementById("openMedicineDirectoryBtn"),
        medSearchInput: document.getElementById("medSearchInput"),
        medicinesDirectoryGrid: document.getElementById("medicinesDirectoryGrid"),
        triageModal: document.getElementById("triageModal"),
        openTriageGuideBtn: document.getElementById("openTriageGuideBtn"),
        disclaimerModal: document.getElementById("disclaimerModal"),
        openDisclaimerBtn: document.getElementById("openDisclaimerBtn"),

        // Toast
        toast: document.getElementById("toastNotification"),
        toastMessage: document.getElementById("toastMessage"),
        toastIcon: document.getElementById("toastIcon")
    };

    // -------------------------------------------------------------------------
    // 3. SYNTHETIC WEB AUDIO CUES (Offline, Zero Assets Needed)
    // -------------------------------------------------------------------------
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) audioCtx = new AudioContext();
        }
        if (audioCtx && audioCtx.state === "suspended") {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playSound(type) {
        if (!state.soundEnabled) return;
        try {
            const ctx = getAudioContext();
            if (!ctx) return;

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === "send") {
                // Gentle upward blip
                osc.type = "sine";
                osc.frequency.setValueAtTime(440, now);
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
            } else if (type === "receive") {
                // Pleasant medical chime (two-tone)
                osc.type = "triangle";
                osc.frequency.setValueAtTime(587.33, now); // D5
                osc.frequency.setValueAtTime(880, now + 0.08); // A5
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
                osc.start(now);
                osc.stop(now + 0.25);
            } else if (type === "emergency") {
                // Urgent warning pulse (3 short tones)
                const playBeep = (time, freq) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.connect(g);
                    g.connect(ctx.destination);
                    o.type = "sawtooth";
                    o.frequency.setValueAtTime(freq, time);
                    g.gain.setValueAtTime(0.12, time);
                    g.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
                    o.start(time);
                    o.stop(time + 0.12);
                };
                playBeep(now, 700);
                playBeep(now + 0.15, 700);
                playBeep(now + 0.30, 850);
            }
        } catch (e) {
            console.debug("Audio play error:", e);
        }
    }

    // -------------------------------------------------------------------------
    // 4. SPEECH SYNTHESIS (TTS)
    // -------------------------------------------------------------------------
    let currentUtterance = null;
    let activeSpeakingBtn = null;

    function stopSpeaking() {
        if ("speechSynthesis" in window) {
            window.speechSynthesis.cancel();
        }
        if (activeSpeakingBtn) {
            activeSpeakingBtn.classList.remove("playing");
            activeSpeakingBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i> Listen';
            activeSpeakingBtn = null;
        }
    }

    function speakText(text, btnElement = null) {
        if (!("speechSynthesis" in window)) {
            showToast("Text-to-speech is not supported by your browser", "warning");
            return;
        }

        // If clicking the currently playing button, toggle off
        if (activeSpeakingBtn === btnElement && window.speechSynthesis.speaking) {
            stopSpeaking();
            return;
        }

        stopSpeaking();

        // Strip markdown formatting for cleaner speech
        const cleanText = text
            .replace(/[#*_`~\[\]]/g, "")
            .replace(/\(.*?\)/g, "")
            .replace(/⚠️|🚨|🩺|💊|🤒|🤧/g, "")
            .trim();

        if (!cleanText) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Choose a clear English voice if available
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => v.lang.startsWith("en") && (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Medical")));
        if (preferredVoice) utterance.voice = preferredVoice;

        if (btnElement) {
            activeSpeakingBtn = btnElement;
            btnElement.classList.add("playing");
            btnElement.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
        }

        utterance.onend = () => stopSpeaking();
        utterance.onerror = () => stopSpeaking();

        currentUtterance = utterance;
        window.speechSynthesis.speak(utterance);
    }

    // -------------------------------------------------------------------------
    // 5. SPEECH RECOGNITION (Voice Input STT)
    // -------------------------------------------------------------------------
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onstart = () => {
            state.isRecording = true;
            els.micBtn.classList.add("recording");
            els.voiceRecordingBanner.style.display = "flex";
            showToast("Listening... Speak your symptoms or question", "info");
        };

        recognition.onresult = (event) => {
            let finalTranscript = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                els.messageInput.value = (els.messageInput.value ? els.messageInput.value + " " : "") + finalTranscript;
                adjustTextareaHeight();
                els.clearTextBtn.style.display = "flex";
            }
        };

        recognition.onerror = (event) => {
            console.warn("Speech recognition error:", event.error);
            stopVoiceRecognition();
            if (event.error !== "no-speech") {
                showToast("Microphone error: " + event.error, "warning");
            }
        };

        recognition.onend = () => {
            stopVoiceRecognition();
        };
    }

    function toggleVoiceRecognition() {
        if (!recognition) {
            showToast("Speech recognition is not supported in this browser. Try Chrome/Edge.", "warning");
            return;
        }

        if (state.isRecording) {
            stopVoiceRecognition();
        } else {
            try {
                recognition.start();
            } catch (err) {
                console.error("Mic start failed:", err);
            }
        }
    }

    function stopVoiceRecognition() {
        state.isRecording = false;
        els.micBtn.classList.remove("recording");
        els.voiceRecordingBanner.style.display = "none";
        if (recognition) {
            try { recognition.stop(); } catch (e) {}
        }
    }

    // -------------------------------------------------------------------------
    // 6. UI HELPERS & THEME
    // -------------------------------------------------------------------------
    function initTheme() {
        document.documentElement.setAttribute("data-theme", state.theme);
        updateThemeIcon();
    }

    function toggleTheme() {
        state.theme = state.theme === "light" ? "dark" : "light";
        localStorage.setItem("mediguide_theme", state.theme);
        document.documentElement.setAttribute("data-theme", state.theme);
        updateThemeIcon();
        showToast(`Theme switched to ${state.theme} mode`, "info");
    }

    function updateThemeIcon() {
        if (state.theme === "dark") {
            els.themeIcon.className = "fa-solid fa-sun";
        } else {
            els.themeIcon.className = "fa-solid fa-moon";
        }
    }

    function toggleSound() {
        state.soundEnabled = !state.soundEnabled;
        localStorage.setItem("mediguide_sound", state.soundEnabled);
        els.soundIcon.className = state.soundEnabled ? "fa-solid fa-volume-high" : "fa-solid fa-volume-xmark";
        showToast(state.soundEnabled ? "Audio cues enabled" : "Audio cues muted", "info");
    }

    function toggleGlobalTts() {
        state.autoTts = !state.autoTts;
        localStorage.setItem("mediguide_autotts", state.autoTts);
        if (state.autoTts) {
            els.globalTtsToggleBtn.classList.add("active");
            showToast("Assistant auto-read aloud enabled", "info");
        } else {
            els.globalTtsToggleBtn.classList.remove("active");
            stopSpeaking();
            showToast("Assistant auto-read aloud disabled", "info");
        }
    }

    function showToast(message, type = "success") {
        els.toastMessage.textContent = message;
        if (type === "warning") {
            els.toastIcon.className = "fa-solid fa-triangle-exclamation text-warning";
        } else if (type === "danger") {
            els.toastIcon.className = "fa-solid fa-circle-xmark text-danger";
        } else if (type === "info") {
            els.toastIcon.className = "fa-solid fa-circle-info text-teal";
        } else {
            els.toastIcon.className = "fa-solid fa-circle-check text-success";
        }

        els.toast.classList.add("active");
        setTimeout(() => {
            els.toast.classList.remove("active");
        }, 3200);
    }

    function adjustTextareaHeight() {
        els.messageInput.style.height = "auto";
        const newHeight = Math.min(els.messageInput.scrollHeight, 130);
        els.messageInput.style.height = `${newHeight}px`;

        if (els.messageInput.value.trim().length > 0) {
            els.clearTextBtn.style.display = "flex";
        } else {
            els.clearTextBtn.style.display = "none";
        }
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            els.chatViewport.scrollTop = els.chatViewport.scrollHeight;
        });
    }

    function updateSessionCount() {
        if (els.sessionMessageCount) {
            els.sessionMessageCount.textContent = state.messages.length;
        }
    }

    function updateTriageSidebarBadge(level) {
        state.currentTriageLevel = level || "routine";
        const pill = els.currentTriagePill;
        const desc = els.currentTriageDesc;

        pill.className = "triage-pill";

        if (level === "emergency") {
            pill.classList.add("triage-emergency");
            pill.innerHTML = '<span class="status-dot"></span><span class="triage-pill-text">Level: Emergency Active</span>';
            desc.textContent = "CRITICAL RED FLAG DETECTED. Immediate emergency medical care required.";
        } else if (level === "urgent") {
            pill.classList.add("triage-urgent");
            pill.innerHTML = '<span class="status-dot"></span><span class="triage-pill-text">Level: Urgent Advisory</span>';
            desc.textContent = "Symptoms warrant prompt clinical evaluation by a medical professional.";
        } else if (level === "caution") {
            pill.classList.add("triage-caution");
            pill.innerHTML = '<span class="status-dot"></span><span class="triage-pill-text">Level: Caution Triage</span>';
            desc.textContent = "Step-by-step symptom assessment active. Analyzing duration & severity.";
        } else {
            pill.classList.add("triage-routine");
            pill.innerHTML = '<span class="status-dot"></span><span class="triage-pill-text">Level: Routine Guard</span>';
            desc.textContent = "Continuous monitoring of symptom severity, urgent red flags, and drug contraindications.";
        }
    }

    // -------------------------------------------------------------------------
    // 7. MODALS LOGIC
    // -------------------------------------------------------------------------
    function openModal(modalEl) {
        if (!modalEl) return;
        modalEl.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    function closeModal(modalEl) {
        if (!modalEl) return;
        modalEl.classList.remove("active");
        document.body.style.overflow = "";
    }

    // Attach all data-close buttons
    document.querySelectorAll("[data-close]").forEach(btn => {
        btn.addEventListener("click", () => {
            const modalId = btn.getAttribute("data-close");
            closeModal(document.getElementById(modalId));
        });
    });

    // Close on clicking backdrop
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal(overlay);
        });
    });

    // ESC key closes modals
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            document.querySelectorAll(".modal-overlay.active").forEach(closeModal);
            if (els.sidebar.classList.contains("open")) closeSidebar();
        }
    });

    // Sidebar drawer for mobile
    function openSidebar() {
        els.sidebar.classList.add("open");
        els.sidebarBackdrop.classList.add("active");
    }
    function closeSidebar() {
        els.sidebar.classList.remove("open");
        els.sidebarBackdrop.classList.remove("active");
    }

    els.mobileMenuBtn.addEventListener("click", openSidebar);
    els.sidebarCloseBtn.addEventListener("click", closeSidebar);
    els.sidebarBackdrop.addEventListener("click", closeSidebar);

    // -------------------------------------------------------------------------
    // 8. MEDICINE DIRECTORY DATA & SEARCH
    // -------------------------------------------------------------------------
    const FALLBACK_DIRECTORY = [
        {
            name: "Paracetamol",
            generic_name: "Acetaminophen",
            category: "Analgesic & Antipyretic",
            common_uses: "Relief of mild to moderate pain (headaches, muscular aches, toothaches) and reducing fever.",
            common_side_effects: "Rare at recommended doses. High doses can cause acute liver toxicity.",
            precautions: "Maximum safe adult daily limit is 4000mg. Avoid combining with other acetaminophen products and avoid alcohol."
        },
        {
            name: "Ibuprofen",
            generic_name: "Ibuprofen",
            category: "NSAID (Non-Steroidal Anti-Inflammatory Drug)",
            common_uses: "Reduces inflammation, swelling, fever, and relieves pain from headaches, arthritis, or injuries.",
            common_side_effects: "Stomach upset, indigestion, mild nausea, dizziness.",
            precautions: "Take with food or milk to protect stomach lining. Avoid if you have active stomach ulcers, serious renal disease, or unmanaged heart disease."
        },
        {
            name: "Cetirizine",
            generic_name: "Cetirizine Hydrochloride",
            category: "Antihistamine (2nd Generation)",
            common_uses: "Relief of allergy symptoms including allergic rhinitis, hay fever, sneezing, itching, runny nose, and hives.",
            common_side_effects: "Mild drowsiness, dry mouth, tiredness, headache.",
            precautions: "Exercise caution when driving or operating machinery. Avoid heavy alcohol consumption while taking."
        },
        {
            name: "Aspirin",
            generic_name: "Acetylsalicylic Acid",
            category: "NSAID & Antiplatelet",
            common_uses: "Pain relief, fever reduction, anti-inflammatory, and doctor-prescribed cardiovascular protection.",
            common_side_effects: "Stomach irritation, increased bleeding risk, heartburn.",
            precautions: "Never give to children or teenagers recovering from viral infections (risk of Reye's syndrome). Avoid with active ulcers."
        },
        {
            name: "Omeprazole",
            generic_name: "Omeprazole",
            category: "Proton Pump Inhibitor (PPI)",
            common_uses: "Treatment of gastroesophageal reflux disease (GERD), frequent heartburn, and stomach acid reduction.",
            common_side_effects: "Headache, abdominal pain, nausea, diarrhea.",
            precautions: "Best taken in the morning before eating. Intended for short-term course unless directed by a physician."
        }
    ];

    async function loadMedicines() {
        try {
            const res = await fetch("/api/medicines");
            if (res.ok) {
                const data = await res.json();
                if (data.medicines && data.medicines.length > 0) {
                    state.medicinesCache = data.medicines;
                    renderMedicinesDirectory(state.medicinesCache);
                    return;
                }
            }
        } catch (e) {
            console.debug("Medicines API lookup notice:", e);
        }
        state.medicinesCache = FALLBACK_DIRECTORY;
        renderMedicinesDirectory(state.medicinesCache);
    }

    function renderMedicinesDirectory(meds) {
        els.medicinesDirectoryGrid.innerHTML = "";
        if (!meds || meds.length === 0) {
            els.medicinesDirectoryGrid.innerHTML = `<p class="text-muted" style="text-align: center; padding: 20px;">No matching medicines found.</p>`;
            return;
        }

        meds.forEach(med => {
            const card = document.createElement("div");
            card.className = "med-dir-card";
            card.innerHTML = `
                <div class="med-dir-header">
                    <div class="med-dir-name">
                        <h4>${med.name}</h4>
                        <span>${med.generic_name} • <strong>${med.category}</strong></span>
                    </div>
                    <button class="med-dir-btn" data-ask="${med.name}">
                        <i class="fa-solid fa-comment-medical"></i> Ask MediGuide
                    </button>
                </div>
                <div class="med-info-item">
                    <strong>Common Uses:</strong>
                    <span>${med.common_uses}</span>
                </div>
                <div class="med-info-item">
                    <strong>Side Effects:</strong>
                    <span>${med.common_side_effects}</span>
                </div>
                <div class="med-info-item">
                    <strong>Precautions:</strong>
                    <span>${med.precautions}</span>
                </div>
            `;

            card.querySelector("[data-ask]").addEventListener("click", () => {
                closeModal(els.medicineModal);
                handleQuickInput(`Tell me about ${med.name}: uses, side effects, and precautions.`);
            });

            els.medicinesDirectoryGrid.appendChild(card);
        });
    }

    els.medSearchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase().trim();
        const filtered = state.medicinesCache.filter(m =>
            m.name.toLowerCase().includes(query) ||
            m.generic_name.toLowerCase().includes(query) ||
            m.category.toLowerCase().includes(query) ||
            m.common_uses.toLowerCase().includes(query)
        );
        renderMedicinesDirectory(filtered);
    });

    // -------------------------------------------------------------------------
    // 9. RENDERING MESSAGE CARDS
    // -------------------------------------------------------------------------
    function appendUserMessage(text) {
        els.welcomeHero.style.display = "none";

        const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        state.messages.push({ sender: "user", text, time: timeStr });
        updateSessionCount();

        const messageEl = document.createElement("div");
        messageEl.className = "message-item user-message";
        messageEl.innerHTML = `
            <div class="user-bubble">
                <div class="user-text">${escapeHtml(text)}</div>
                <div class="user-meta">
                    <span>${timeStr}</span>
                    <i class="fa-solid fa-check"></i>
                </div>
            </div>
        `;

        els.messagesContainer.appendChild(messageEl);
        scrollToBottom();
        playSound("send");
    }

    function appendBotMessage(data) {
        els.welcomeHero.style.display = "none";

        const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const replyText = data.reply || "Sorry, I could not process your query.";
        const triageLevel = data.triage_level || "routine";
        const signals = data.signals || [];
        const isEmergency = triageLevel === "emergency";
        const isUrgent = triageLevel === "urgent";
        const isCaution = triageLevel === "caution";
        const medicineInfo = data.medicine_info || null;

        state.messages.push({
            sender: "bot",
            text: replyText,
            triageLevel,
            time: timeStr
        });
        updateSessionCount();
        updateTriageSidebarBadge(triageLevel);

        // Sound cue according to triage severity
        if (isEmergency) {
            playSound("emergency");
        } else {
            playSound("receive");
        }

        const messageEl = document.createElement("div");
        messageEl.className = "message-item bot-message";

        // Parse markdown safely
        let renderedHtml = replyText;
        if (window.marked && window.DOMPurify) {
            try {
                renderedHtml = DOMPurify.sanitize(marked.parse(replyText));
            } catch (err) {
                console.warn("Markdown parse error:", err);
                renderedHtml = `<p>${escapeHtml(replyText)}</p>`;
            }
        } else {
            renderedHtml = `<p>${escapeHtml(replyText)}</p>`;
        }

        // 1. Triage Banner HTML
        let triageBannerHtml = "";
        if (isEmergency) {
            const signalsHtml = signals.map(s => {
                const name = typeof s === "object" ? (s.signal || JSON.stringify(s)) : s;
                return `<span class="signal-tag">${escapeHtml(name.replace(/_/g, " "))}</span>`;
            }).join("");

            triageBannerHtml = `
                <div class="triage-alert-banner alert-emergency">
                    <i class="fa-solid fa-triangle-exclamation triage-banner-icon"></i>
                    <div class="triage-banner-text">
                        <strong>EMERGENCY SYMPTOM DETECTED</strong>
                        <span>Your symptoms may indicate a medical emergency requiring immediate evaluation.</span>
                        ${signalsHtml ? `<div class="signals-tag-list">${signalsHtml}</div>` : ""}
                    </div>
                </div>

                <div class="emergency-call-card">
                    <div class="emergency-call-card-text">
                        <strong>Immediate Medical Assistance Required</strong>
                        <p>Call local emergency response or go to the nearest emergency room.</p>
                    </div>
                    <a href="tel:911" class="call-911-btn">
                        <i class="fa-solid fa-phone-volume"></i> Call 911 / 112
                    </a>
                </div>
            `;
        } else if (isUrgent) {
            triageBannerHtml = `
                <div class="triage-alert-banner alert-urgent">
                    <i class="fa-solid fa-bell triage-banner-icon"></i>
                    <div class="triage-banner-text">
                        <strong>PROMPT PROFESSIONAL MEDICAL EVALUATION RECOMMENDED</strong>
                        <span>Please contact an urgent care clinic or doctor promptly.</span>
                    </div>
                </div>
            `;
        } else if (isCaution) {
            triageBannerHtml = `
                <div class="triage-alert-banner alert-caution">
                    <i class="fa-solid fa-clipboard-question triage-banner-icon"></i>
                    <div class="triage-banner-text">
                        <strong>SYMPTOM ASSESSMENT IN PROGRESS</strong>
                        <span>Answer the follow-up question to help evaluate duration and severity.</span>
                    </div>
                </div>
            `;
        }

        // 2. Medicine Info Card HTML
        let medicineCardHtml = "";
        if (medicineInfo) {
            medicineCardHtml = `
                <div class="medicine-info-card">
                    <div class="med-card-header">
                        <div class="med-card-title">
                            <i class="fa-solid fa-capsules text-teal"></i>
                            <h4>${escapeHtml(medicineInfo.name)}</h4>
                            <span class="med-category-badge">${escapeHtml(medicineInfo.category || "Medication")}</span>
                        </div>
                    </div>
                    <div class="med-card-grid">
                        <div class="med-info-item">
                            <strong>Generic Name:</strong>
                            <span>${escapeHtml(medicineInfo.generic_name || medicineInfo.name)}</span>
                        </div>
                        <div class="med-info-item">
                            <strong>Common Uses:</strong>
                            <span>${escapeHtml(medicineInfo.common_uses || "N/A")}</span>
                        </div>
                        <div class="med-info-item">
                            <strong>Side Effects:</strong>
                            <span>${escapeHtml(medicineInfo.common_side_effects || "N/A")}</span>
                        </div>
                        <div class="med-info-item">
                            <strong>Precautions:</strong>
                            <span>${escapeHtml(medicineInfo.precautions || "N/A")}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        // 3. Quick Choice Chips for Caution Assessment
        let quickChoicesHtml = "";
        if (isCaution && (data.assessment_active || !data.assessment_complete)) {
            quickChoicesHtml = `
                <div class="quick-replies-wrap">
                    <span class="quick-replies-label">Quick Answer Options:</span>
                    <div class="quick-replies-chips">
                        <button class="reply-choice-chip" data-choice="Mild">Mild</button>
                        <button class="reply-choice-chip" data-choice="Moderate">Moderate</button>
                        <button class="reply-choice-chip" data-choice="Severe">Severe</button>
                        <button class="reply-choice-chip" data-choice="Started today">Started today</button>
                        <button class="reply-choice-chip" data-choice="2 to 3 days">2-3 days</button>
                        <button class="reply-choice-chip" data-choice="Yes">Yes</button>
                        <button class="reply-choice-chip" data-choice="No">No</button>
                    </div>
                </div>
            `;
        }

        messageEl.innerHTML = `
            <div class="bot-avatar">
                <i class="fa-solid fa-stethoscope"></i>
            </div>
            <div class="bot-bubble">
                ${triageBannerHtml}
                <div class="markdown-body">
                    ${renderedHtml}
                </div>
                ${medicineCardHtml}
                ${quickChoicesHtml}
                <div class="bot-action-bar">
                    <div class="bot-actions-left">
                        <button class="action-tool-btn copy-btn" title="Copy message text">
                            <i class="fa-solid fa-copy"></i> Copy
                        </button>
                        <button class="action-tool-btn tts-btn" title="Read message aloud">
                            <i class="fa-solid fa-volume-high"></i> Listen
                        </button>
                    </div>
                    <span class="bot-time">${timeStr}</span>
                </div>
            </div>
        `;

        // Attach action handlers
        const copyBtn = messageEl.querySelector(".copy-btn");
        copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(replyText).then(() => {
                copyBtn.innerHTML = '<i class="fa-solid fa-check text-success"></i> Copied!';
                showToast("Message copied to clipboard");
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy';
                }, 2200);
            });
        });

        const ttsBtn = messageEl.querySelector(".tts-btn");
        ttsBtn.addEventListener("click", () => {
            speakText(replyText, ttsBtn);
        });

        // Attach quick choice clicks
        messageEl.querySelectorAll(".reply-choice-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                const choice = chip.getAttribute("data-choice");
                handleQuickInput(choice);
            });
        });

        els.messagesContainer.appendChild(messageEl);
        scrollToBottom();

        // Auto TTS if user enabled it
        if (state.autoTts) {
            speakText(replyText, ttsBtn);
        }
    }

    // -------------------------------------------------------------------------
    // 11. API CHAT INTERACTION
    // -------------------------------------------------------------------------
    async function sendMessage(textToSend = null) {
        const text = textToSend || els.messageInput.value.trim();
        if (!text || state.isWaiting) return;

        // Reset input field
        els.messageInput.value = "";
        adjustTextareaHeight();
        stopVoiceRecognition();

        // Add user message to UI
        appendUserMessage(text);

        // Show typing indicator
        setLoadingState(true);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ message: text })
            });

            const data = await response.json();

            setLoadingState(false);

            if (response.ok && data) {
                appendBotMessage(data);
            } else {
                appendBotMessage({
                    reply: `⚠️ **Error:** ${data.error || "Unable to reach medical intelligence service. Please check your network or try again."}`,
                    triage_level: "routine"
                });
                showToast(data.error || "Request failed", "danger");
            }
        } catch (error) {
            console.error("Chat API error:", error);
            setLoadingState(false);
            appendBotMessage({
                reply: "⚠️ **Network Error:** Unable to connect to the MediGuide AI server. Please verify the application is running.",
                triage_level: "routine"
            });
            showToast("Connection failed", "danger");
        }
    }

    function setLoadingState(isLoading) {
        state.isWaiting = isLoading;
        els.sendBtn.disabled = isLoading;

        if (isLoading) {
            els.sendIcon.style.display = "none";
            els.sendSpinner.style.display = "block";
            els.typingIndicator.style.display = "flex";
            scrollToBottom();
        } else {
            els.sendIcon.style.display = "block";
            els.sendSpinner.style.display = "none";
            els.typingIndicator.style.display = "none";
            els.messageInput.focus();
        }
    }

    function handleQuickInput(text) {
        sendMessage(text);
    }

    function escapeHtml(str) {
        if (!str) return "";
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // -------------------------------------------------------------------------
    // 12. EVENT LISTENERS SETUP
    // -------------------------------------------------------------------------
    // Send Message
    els.sendBtn.addEventListener("click", () => sendMessage());

    els.messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    els.messageInput.addEventListener("input", adjustTextareaHeight);

    // Clear Text
    els.clearTextBtn.addEventListener("click", () => {
        els.messageInput.value = "";
        adjustTextareaHeight();
        els.messageInput.focus();
    });

    // Voice recognition
    els.micBtn.addEventListener("click", toggleVoiceRecognition);
    els.stopVoiceBtn.addEventListener("click", stopVoiceRecognition);

    // Prompt cards on welcome hero
    document.querySelectorAll(".prompt-card").forEach(card => {
        card.addEventListener("click", () => {
            const prompt = card.getAttribute("data-prompt");
            if (prompt) handleQuickInput(prompt);
        });
    });

    // Quick tag pills above input dock
    document.querySelectorAll(".tag-pill").forEach(pill => {
        pill.addEventListener("click", () => {
            const text = pill.getAttribute("data-insert");
            if (text) handleQuickInput(text);
        });
    });

    // Sidebar medicine chips
    document.querySelectorAll(".med-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const med = chip.getAttribute("data-med");
            if (med) {
                if (els.sidebar.classList.contains("open")) closeSidebar();
                handleQuickInput(`Tell me about ${med}: common uses, side effects, and precautions.`);
            }
        });
    });

    // Controls
    els.themeToggleBtn.addEventListener("click", toggleTheme);
    els.soundToggleBtn.addEventListener("click", toggleSound);
    els.globalTtsToggleBtn.addEventListener("click", toggleGlobalTts);

    // Modals Triggers
    els.headerSosBtn.addEventListener("click", () => openModal(els.sosModal));
    els.sidebarSosModalBtn.addEventListener("click", () => {
        if (els.sidebar.classList.contains("open")) closeSidebar();
        openModal(els.sosModal);
    });

    els.headerMedBtn.addEventListener("click", () => openModal(els.medicineModal));
    els.openMedicineDirectoryBtn.addEventListener("click", () => {
        if (els.sidebar.classList.contains("open")) closeSidebar();
        openModal(els.medicineModal);
    });

    els.openTriageGuideBtn.addEventListener("click", () => {
        if (els.sidebar.classList.contains("open")) closeSidebar();
        openModal(els.triageModal);
    });

    els.openDisclaimerBtn.addEventListener("click", () => openModal(els.disclaimerModal));

    // Initializations
    initTheme();
    loadMedicines();
    adjustTextareaHeight();
    updateTriageSidebarBadge("routine");

    if (state.autoTts) {
        els.globalTtsToggleBtn.classList.add("active");
    }
    if (!state.soundEnabled) {
        els.soundIcon.className = "fa-solid fa-volume-xmark";
    }

    console.log("MediGuide AI Front-End initialized successfully.");
});
