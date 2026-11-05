const conversation = document.querySelector("#conversation");
const welcomeContent = document.querySelector("#welcome-content");
const messageList = document.querySelector("#message-list");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const newChatButton = document.querySelector("#new-chat");
const languageSelect = document.querySelector("#language-select");
const locationButton = document.querySelector("#location-button");
const locationStatus = document.querySelector("#location-status");
const cameraButton = document.querySelector("#camera-button");
const cameraDialog = document.querySelector("#camera-dialog");
const cameraVideo = document.querySelector("#camera-video");
const cameraCanvas = document.querySelector("#camera-canvas");
const cameraStatus = document.querySelector("#camera-status");
const cameraCapture = document.querySelector("#camera-capture");
const voiceButton = document.querySelector("#voice-button");
const speakToggle = document.querySelector("#speak-toggle");
const photoPreview = document.querySelector("#photo-preview");
const photoThumbnail = document.querySelector("#photo-thumbnail");
const removePhotoButton = document.querySelector("#remove-photo");
const assistantStatus = document.querySelector("#assistant-status");
const presenceDot = document.querySelector("#presence-dot");
const featureStatus = document.querySelector("#feature-status");
const setupBanner = document.querySelector("#setup-banner");
const setupDialog = document.querySelector("#setup-dialog");
const setupForm = document.querySelector("#setup-form");
const apiKeyInput = document.querySelector("#api-key-input");
const setupStatus = document.querySelector("#setup-status");
const setupSubmit = document.querySelector("#setup-submit");
const historyList = document.querySelector("#history-list");
const historyEmpty = document.querySelector("#history-empty");
const mobileHistoryButton = document.querySelector("#mobile-history-button");
const historyDialog = document.querySelector("#history-dialog");
const mobileHistoryList = document.querySelector("#mobile-history-list");
const mobileHistoryEmpty = document.querySelector("#mobile-history-empty");
const signInDialog = document.querySelector("#signin-dialog");
const signInButton = document.querySelector("#open-signin");
const continueAsGuestButton = document.querySelector("#continue-as-guest");

const HISTORY_STORAGE_KEY = "krishimitra-conversations";
const ACTIVE_CONVERSATION_KEY = "krishimitra-active-conversation";
const ACCESS_MODE_STORAGE_KEY = "krishimitra-access-mode";
const MAX_SAVED_CONVERSATIONS = 20;
const MAX_SAVED_MESSAGES = 30;
const MAX_SAVED_MESSAGE_LENGTH = 1600;
const MAX_SAVED_CONTEXT_MESSAGES = 6;
const recognitionLocaleByLanguage = {
  "en-IN": "en-IN",
  "hi-IN": "hi-IN",
  "bn-IN": "bn-IN",
  "gu-IN": "gu-IN",
  "kn-IN": "kn-IN",
  "ml-IN": "ml-IN",
  "mr-IN": "mr-IN",
  "or-IN": "or-IN",
  "pa-IN": "pa-IN",
  "ta-IN": "ta-IN",
  "te-IN": "te-IN",
  "ur-IN": "ur-IN"
};

let attachedPhoto = "";
let cameraStream = null;
let recognition = null;
let listening = false;
let speakReplies = false;
let lastLocation = null;
let cameraRequestId = 0;
let conversationHistory = [];
let isResponding = false;
let chatRequestId = 0;
let activeChatController = null;
let savedConversations = [];
let conversationId = createConversationId();
let conversationMessages = [];

try {
  const savedLanguage = localStorage.getItem("krishimitra-language");
  if ([...languageSelect.options].some((option) => option.value === savedLanguage)) {
    languageSelect.value = savedLanguage;
  }
  speakReplies = localStorage.getItem("krishimitra-speak-replies") === "true";
  speakToggle.setAttribute("aria-pressed", String(speakReplies));
  if (speakReplies) {
    speakToggle.setAttribute("aria-label", "Turn off spoken replies");
    speakToggle.title = "Turn off spoken replies";
  }
} catch (error) {
  showFeatureStatus(`Could not load saved preferences: ${error.message}`);
}

function createConversationId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function currentTime(timestamp = Date.now()) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" })
    .format(new Date(timestamp));
}

function loadSavedConversations() {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error("Saved chat history has an invalid format.");
    return parsed.filter((item) =>
      item
      && typeof item.id === "string"
      && typeof item.title === "string"
      && typeof item.updatedAt === "string"
      && Array.isArray(item.messages)
      && item.messages.every((message) =>
        message
        && (message.role === "user" || message.role === "assistant")
        && typeof message.text === "string"
        && typeof message.timestamp === "string"
      )
    ).slice(0, MAX_SAVED_CONVERSATIONS);
  } catch (error) {
    showFeatureStatus(`Could not load chat history: ${error.message}`);
    return [];
  }
}

function saveActiveConversation() {
  if (!conversationMessages.length) return;
  const firstUserMessage = conversationMessages.find((message) => message.role === "user");
  const title = firstUserMessage
    ? firstUserMessage.text.slice(0, 52)
    : "Crop photo question";
  const storedMessages = conversationMessages.slice(-MAX_SAVED_MESSAGES).map((message) => ({
    role: message.role,
    text: message.text.length > MAX_SAVED_MESSAGE_LENGTH
      ? `${message.text.slice(0, MAX_SAVED_MESSAGE_LENGTH)}…`
      : message.text,
    timestamp: message.timestamp
  }));
  const storedHistory = conversationHistory.slice(-MAX_SAVED_CONTEXT_MESSAGES).map((message) => ({
    role: message.role,
    text: message.text.length > MAX_SAVED_MESSAGE_LENGTH
      ? `${message.text.slice(0, MAX_SAVED_MESSAGE_LENGTH)}…`
      : message.text
  }));
  const conversationRecord = {
    id: conversationId,
    title,
    updatedAt: new Date().toISOString(),
    messages: storedMessages,
    history: storedHistory
  };
  savedConversations = [
    conversationRecord,
    ...savedConversations.filter((item) => item.id !== conversationId)
  ].slice(0, MAX_SAVED_CONVERSATIONS);

  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(savedConversations));
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
  } catch (error) {
    showFeatureStatus(`Could not save chat history in this browser: ${error.message}`);
  }
  renderConversationHistory();
}

function formatConversationDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved conversation";
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(date);
}

function createHistoryItem(item) {
  const button = document.createElement("button");
  button.className = "history-item";
  button.type = "button";
  button.dataset.conversationId = item.id;
  button.setAttribute("aria-label", `Open conversation: ${item.title}`);
  if (item.id === conversationId) {
    button.classList.add("active");
    button.setAttribute("aria-current", "page");
  }

  const icon = document.createElement("span");
  icon.className = "history-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "◷";
  const copy = document.createElement("span");
  copy.className = "history-copy";
  const title = document.createElement("strong");
  title.textContent = item.title || "Farm conversation";
  const date = document.createElement("small");
  date.textContent = formatConversationDate(item.updatedAt);
  copy.append(title, date);
  button.append(icon, copy);
  if (item.id === conversationId) {
    const activeDot = document.createElement("span");
    activeDot.className = "active-dot";
    activeDot.setAttribute("aria-label", "Active conversation");
    button.append(activeDot);
  }
  button.addEventListener("click", () => openSavedConversation(item.id));
  return button;
}

function renderConversationHistory() {
  const containers = [
    { list: historyList, empty: historyEmpty },
    { list: mobileHistoryList, empty: mobileHistoryEmpty }
  ];
  for (const { list, empty } of containers) {
    list.replaceChildren(...savedConversations.map(createHistoryItem));
    empty.hidden = savedConversations.length > 0;
  }
}

function renderConversationMessages() {
  messageList.replaceChildren();
  for (const message of conversationMessages) {
    appendMessage(message.role, message.text, "", {
      persist: false,
      timestamp: message.timestamp
    });
  }
  if (conversationMessages.length) {
    messageList.classList.add("has-messages");
    welcomeContent.classList.add("is-hidden");
  } else {
    messageList.classList.remove("has-messages");
    welcomeContent.classList.remove("is-hidden");
  }
}

function openSavedConversation(id) {
  if (isResponding) return;
  const selected = savedConversations.find((item) => item.id === id);
  if (!selected) return;
  saveActiveConversation();
  conversationId = selected.id;
  conversationMessages = selected.messages.map((message) => ({ ...message }));
  conversationHistory = Array.isArray(selected.history)
    ? selected.history
      .filter((message) =>
        message
        && (message.role === "user" || message.role === "model")
        && typeof message.text === "string"
      )
      .slice(-12)
    : [];
  attachedPhoto = "";
  photoThumbnail.removeAttribute("src");
  photoPreview.hidden = true;
  stopSharingLocation();
  renderConversationMessages();
  renderConversationHistory();
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
  } catch (error) {
    showFeatureStatus(`Could not save the selected conversation: ${error.message}`);
  }
  if (historyDialog.open) historyDialog.close();
}

function startNewConversation() {
  saveActiveConversation();
  chatRequestId += 1;
  if (activeChatController) activeChatController.abort();
  activeChatController = null;
  isResponding = false;
  conversationId = createConversationId();
  conversationHistory = [];
  conversationMessages = [];
  if (recognition && listening) recognition.stop();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  messageList.replaceChildren();
  messageList.classList.remove("has-messages");
  welcomeContent.classList.remove("is-hidden");
  input.value = "";
  input.style.height = "auto";
  clearAttachedPhoto();
  stopSharingLocation();
  renderConversationHistory();
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
  } catch (error) {
    showFeatureStatus(`Could not save your new conversation: ${error.message}`);
  }
  input.focus();
}

function showFeatureStatus(message) {
  featureStatus.textContent = message;
  featureStatus.hidden = false;
}

function updateLocationControls() {
  const sharingLocation = Boolean(lastLocation);
  locationButton.setAttribute("aria-label", sharingLocation ? "Stop sharing location" : "Use my location");
  locationButton.querySelector("span").textContent = sharingLocation ? "Stop sharing location" : "Use my location";
}

function showLocationReady() {
  locationStatus.replaceChildren();
  locationStatus.append(
    document.createTextNode(
      "Location ready. Approximate location will be shared with Google Gemini for this conversation. A new conversation turns sharing off. "
    )
  );
  const mapLink = document.createElement("a");
  mapLink.href = `https://maps.google.com/?q=${lastLocation.latitude},${lastLocation.longitude}`;
  mapLink.target = "_blank";
  mapLink.rel = "noopener noreferrer";
  mapLink.textContent = "View map";
  locationStatus.append(mapLink);
  locationStatus.hidden = false;
}

function stopSharingLocation() {
  const wasSharingLocation = Boolean(lastLocation);
  lastLocation = null;
  updateLocationControls();
  locationStatus.hidden = true;
  if (wasSharingLocation) {
    showFeatureStatus("Location sharing is off. Your next questions won’t include your location.");
  }
}

function showGeminiSetupStatus() {
  setupBanner.replaceChildren();
  setupBanner.append(
    document.createTextNode("Connect Gemini with your API key. It stays in the local server’s memory. Get a key from ")
  );
  const link = document.createElement("a");
  link.href = "https://aistudio.google.com/apikey";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Google AI Studio";
  const configureButton = document.createElement("button");
  configureButton.className = "setup-link-button";
  configureButton.type = "button";
  configureButton.textContent = "Connect Gemini";
  configureButton.addEventListener("click", openSetupDialog);
  setupBanner.append(link, document.createTextNode(". "), configureButton);
  setupBanner.hidden = false;
}

function openSetupDialog() {
  setupStatus.textContent = "Get a key from Google AI Studio. Don’t share it with anyone.";
  apiKeyInput.value = "";
  setupSubmit.disabled = false;
  setupDialog.showModal();
  apiKeyInput.focus();
}

async function refreshAssistantStatus() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();

    if (status.configured) {
      assistantStatus.textContent = `Gemini AI · ${status.model}`;
      presenceDot.classList.add("is-online");
      presenceDot.classList.remove("is-offline");
      setupBanner.hidden = true;
      return;
    }

    assistantStatus.textContent = "Gemini setup needed";
    presenceDot.classList.add("is-offline");
    showGeminiSetupStatus();
  } catch (error) {
    assistantStatus.textContent = "AI server unavailable";
    presenceDot.classList.add("is-offline");
    showFeatureStatus(`Could not check the Gemini server: ${error.message}`);
  }
}

function appendMessage(role, text, photo = "", options = {}) {
  const timestamp = options.timestamp || new Date().toISOString();
  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  if (role === "assistant") {
    const avatar = document.createElement("span");
    avatar.className = "bot-avatar";
    avatar.setAttribute("aria-label", "KrishiMitra");
    avatar.textContent = "KM";
    row.append(avatar);
  }

  const content = document.createElement("div");
  content.className = "message-content";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("strong");
  name.textContent = role === "assistant" ? "KrishiMitra" : "You";
  const time = document.createElement("span");
  time.textContent = currentTime(timestamp);
  meta.append(name, time);

  const body = document.createElement("div");
  body.className = "message-text";
  if (text) {
    for (const paragraph of text.split("\n\n")) {
      const element = document.createElement("p");
      element.textContent = paragraph;
      body.append(element);
    }
  }
  content.append(meta);
  if (photo) {
    const image = document.createElement("img");
    image.className = "message-photo";
    image.src = photo;
    image.alt = "Photo attached to your farming question";
    content.append(image);
  }
  if (text) content.append(body);
  row.append(content);
  messageList.append(row);
  messageList.classList.add("has-messages");
  welcomeContent.classList.add("is-hidden");
  conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });

  if (options.persist !== false) {
    conversationMessages.push({
      role,
      text: photo && !text ? "Shared a crop photo (the photo itself is not saved in history)." : text,
      timestamp
    });
    saveActiveConversation();
  }
}

async function getAIReply(message, history, photo, signal) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      message,
      history,
      photo: photo || null,
      location: lastLocation
        ? {
            latitude: Number(lastLocation.latitude.toFixed(2)),
            longitude: Number(lastLocation.longitude.toFixed(2))
          }
        : null,
      language: languageSelect.value
    })
  });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(`The AI server returned an invalid response: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(result.error || `The AI server returned HTTP ${response.status}.`);
  }
  if (typeof result.reply !== "string" || !result.reply.trim()) {
    throw new Error("Gemini returned an empty answer. Please try again.");
  }
  return result.reply.trim();
}

function showTypingIndicator() {
  const row = document.createElement("div");
  row.className = "message-row assistant";
  row.id = "typing-row";

  const avatar = document.createElement("span");
  avatar.className = "bot-avatar";
  avatar.textContent = "KM";
  avatar.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "message-content";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("strong");
  name.textContent = "KrishiMitra";
  meta.append(name);

  const dots = document.createElement("div");
  dots.className = "typing-indicator";
  dots.setAttribute("aria-label", "KrishiMitra is typing");
  for (let index = 0; index < 3; index += 1) {
    dots.append(document.createElement("span"));
  }
  content.append(meta, dots);
  row.append(avatar, content);
  messageList.append(row);
  conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
  return row;
}

function clearAttachedPhoto() {
  attachedPhoto = "";
  photoThumbnail.removeAttribute("src");
  photoPreview.hidden = true;
  updateSendButton();
}

function setAttachedPhoto(dataUrl) {
  attachedPhoto = dataUrl;
  photoThumbnail.src = dataUrl;
  photoPreview.hidden = false;
  updateSendButton();
  input.focus();
}

function updateSendButton() {
  sendButton.disabled = isResponding || (input.value.trim().length === 0 && !attachedPhoto);
}

async function sendMessage(message) {
  const trimmedMessage = message.trim();
  const photo = attachedPhoto;
  if ((!trimmedMessage && !photo) || isResponding) return;

  appendMessage("user", trimmedMessage, photo);
  clearAttachedPhoto();
  input.value = "";
  input.style.height = "auto";
  isResponding = true;
  updateSendButton();

  const typingRow = showTypingIndicator();
  const requestId = ++chatRequestId;
  activeChatController = new AbortController();
  try {
    const reply = await getAIReply(
      trimmedMessage,
      conversationHistory.slice(-12),
      photo,
      activeChatController.signal
    );
    if (requestId !== chatRequestId) return;
    conversationHistory.push(
      { role: "user", text: trimmedMessage || "The user shared a crop photo." },
      { role: "model", text: reply }
    );
    appendMessage("assistant", reply);
    if (speakReplies) speakText(reply);
  } catch (error) {
    if (requestId !== chatRequestId || error.name === "AbortError") return;
    appendMessage("assistant", `I couldn’t get an answer from Gemini. ${error.message}`);
  } finally {
    typingRow.remove();
    if (requestId === chatRequestId) {
      activeChatController = null;
      isResponding = false;
      updateSendButton();
    }
  }
}

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    showFeatureStatus("Spoken replies are not supported in this browser.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = languageSelect.value;
  window.speechSynthesis.speak(utterance);
}

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showFeatureStatus("Voice input is not supported in this browser. Try the latest version of Chrome.");
    return;
  }
  if (listening && recognition) {
    recognition.stop();
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = recognitionLocaleByLanguage[languageSelect.value] || "en-IN";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0].transcript)
      .join(" ");
    input.value = transcript;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  recognition.onerror = (event) => {
    const messages = {
      "not-allowed": "Microphone access was blocked. Allow it in Chrome’s site settings to use voice input.",
      "no-speech": "No speech was detected. Tap the microphone and try again.",
      "language-not-supported": "Voice recognition for this language is not available in your browser."
    };
    showFeatureStatus(messages[event.error] || `Voice input stopped: ${event.error}.`);
  };
  recognition.onstart = () => {
    listening = true;
    voiceButton.setAttribute("aria-pressed", "true");
    voiceButton.setAttribute("aria-label", "Stop speaking");
    showFeatureStatus("Listening… Speak your question, then tap the microphone again to stop.");
  };
  recognition.onend = () => {
    listening = false;
    voiceButton.setAttribute("aria-pressed", "false");
    voiceButton.setAttribute("aria-label", "Speak your question");
  };

  try {
    recognition.start();
  } catch (error) {
    showFeatureStatus(`Could not start voice input: ${error.message}`);
  }
}

function requestLocation() {
  if (lastLocation) {
    stopSharingLocation();
    return;
  }
  if (!("geolocation" in navigator)) {
    showFeatureStatus("Location access is not available in this browser.");
    return;
  }
  locationButton.setAttribute("aria-busy", "true");
  locationButton.disabled = true;
  showFeatureStatus("Requesting your location… Your browser will ask for permission.");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      lastLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      locationButton.setAttribute("aria-busy", "false");
      locationButton.disabled = false;
      featureStatus.hidden = true;
      updateLocationControls();
      showLocationReady();
    },
    (error) => {
      locationButton.setAttribute("aria-busy", "false");
      locationButton.disabled = false;
      const messages = {
        1: "Location permission was denied. You can allow it in Chrome’s site settings and try again.",
        2: "Your location could not be determined. Check that location services are enabled and try again.",
        3: "The location request timed out. Please try again."
      };
      showFeatureStatus(messages[error.code] || `Could not get your location: ${error.message}`);
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
  );
}

function stopCamera() {
  cameraRequestId += 1;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraCapture.disabled = true;
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = "Camera access requires Chrome on localhost or a secure HTTPS website.";
    cameraDialog.showModal();
    return;
  }

  cameraDialog.showModal();
  const requestId = ++cameraRequestId;
  cameraStatus.textContent = "Requesting camera permission…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } }
    });
    if (requestId !== cameraRequestId || !cameraDialog.open) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    cameraStream = stream;
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    cameraCapture.disabled = false;
    cameraStatus.textContent = "Live preview is on. Take a photo when you’re ready.";
  } catch (error) {
    if (requestId !== cameraRequestId || !cameraDialog.open) return;
    const messages = {
      "NotAllowedError": "Camera access was denied. Allow it in Chrome’s site settings and try again.",
      "NotFoundError": "No camera was found on this device.",
      "NotReadableError": "The camera is already in use by another application."
    };
    cameraStatus.textContent = messages[error.name] || `Could not start the camera: ${error.message}`;
    stopCamera();
  }
}

function capturePhoto() {
  if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    cameraStatus.textContent = "The camera is not ready yet. Please wait a moment and try again.";
    return;
  }
  const scale = Math.min(1, 1280 / Math.max(cameraVideo.videoWidth, cameraVideo.videoHeight));
  cameraCanvas.width = Math.round(cameraVideo.videoWidth * scale);
  cameraCanvas.height = Math.round(cameraVideo.videoHeight * scale);
  const context = cameraCanvas.getContext("2d");
  if (!context) {
    cameraStatus.textContent = "Could not capture the photo on this device.";
    return;
  }
  context.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);
  setAttachedPhoto(cameraCanvas.toDataURL("image/jpeg", 0.78));
  cameraDialog.close();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("input", () => {
  updateSendButton();
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll(".suggestion-card").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt || ""));
});

locationButton.addEventListener("click", requestLocation);
cameraButton.addEventListener("click", openCamera);
cameraCapture.addEventListener("click", capturePhoto);
languageSelect.addEventListener("change", () => {
  try {
    localStorage.setItem("krishimitra-language", languageSelect.value);
  } catch (error) {
    showFeatureStatus(`Could not save your language preference: ${error.message}`);
  }
  if (recognition && listening) recognition.stop();
});
document.querySelector("#camera-close").addEventListener("click", () => cameraDialog.close());
document.querySelector("#camera-cancel").addEventListener("click", () => cameraDialog.close());
cameraDialog.addEventListener("close", stopCamera);
voiceButton.addEventListener("click", startVoiceInput);
removePhotoButton.addEventListener("click", clearAttachedPhoto);

speakToggle.addEventListener("click", () => {
  speakReplies = !speakReplies;
  speakToggle.setAttribute("aria-pressed", String(speakReplies));
  speakToggle.setAttribute("aria-label", speakReplies ? "Turn off spoken replies" : "Read answers aloud");
  speakToggle.title = speakReplies ? "Turn off spoken replies" : "Read answers aloud";
  if (!speakReplies && "speechSynthesis" in window) window.speechSynthesis.cancel();
  try {
    localStorage.setItem("krishimitra-speak-replies", String(speakReplies));
  } catch (error) {
    showFeatureStatus(`Could not save your spoken-reply preference: ${error.message}`);
  }
  showFeatureStatus(speakReplies ? "Spoken replies are on." : "Spoken replies are off.");
});

newChatButton.addEventListener("click", startNewConversation);
mobileHistoryButton.addEventListener("click", () => historyDialog.showModal());
document.querySelector("#history-close").addEventListener("click", () => historyDialog.close());

savedConversations = loadSavedConversations()
  .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
try {
  const previousConversationId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  if (savedConversations.some((item) => item.id === previousConversationId)) {
    const activeConversation = savedConversations.find((item) => item.id === previousConversationId);
    conversationId = activeConversation.id;
    conversationMessages = activeConversation.messages.map((message) => ({ ...message }));
    conversationHistory = Array.isArray(activeConversation.history)
      ? activeConversation.history
        .filter((message) =>
          message
          && (message.role === "user" || message.role === "model")
          && typeof message.text === "string"
        )
        .slice(-12)
      : [];
    renderConversationMessages();
  }
} catch (error) {
  showFeatureStatus(`Could not restore your previous conversation: ${error.message}`);
}
renderConversationHistory();

try {
  if (localStorage.getItem(ACCESS_MODE_STORAGE_KEY) !== "guest") {
    signInDialog.showModal();
  }
} catch (error) {
  showFeatureStatus(`Could not load sign-in preference: ${error.message}`);
}

signInButton.addEventListener("click", () => signInDialog.showModal());
continueAsGuestButton.addEventListener("click", () => {
  try {
    localStorage.setItem(ACCESS_MODE_STORAGE_KEY, "guest");
  } catch (error) {
    showFeatureStatus(`Could not save your guest preference: ${error.message}`);
  }
  signInDialog.close();
});

refreshAssistantStatus();

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  if (apiKey.length < 20) {
    setupStatus.textContent = "Enter a valid Gemini API key.";
    return;
  }

  setupSubmit.disabled = true;
  setupStatus.textContent = "Connecting securely to this computer…";
  try {
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey })
    });
    const result = await response.json();
    apiKeyInput.value = "";
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    setupStatus.textContent = "Gemini is configured in local memory. Your key was not saved to the website.";
    window.setTimeout(() => {
      setupDialog.close();
      refreshAssistantStatus();
    }, 900);
  } catch (error) {
    setupStatus.textContent = `Could not connect Gemini: ${error.message}`;
    setupSubmit.disabled = false;
  } finally {
    apiKeyInput.value = "";
  }
});

document.querySelector("#setup-close").addEventListener("click", () => setupDialog.close());
document.querySelector("#setup-cancel").addEventListener("click", () => setupDialog.close());
setupDialog.addEventListener("close", () => {
  apiKeyInput.value = "";
  setupSubmit.disabled = false;
});
