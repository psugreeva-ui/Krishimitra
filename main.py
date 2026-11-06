
import json
import os
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from google import genai
from google.genai import types

import knowledge_base as kb

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
FRONTEND_DIR = Path(__file__).resolve().parent
MAX_IMAGE_BYTES = 5 * 1024 * 1024

LANG_NAMES = {
    "en": "English", "hi": "Hindi", "pa": "Punjabi",
    "mr": "Marathi", "te": "Telugu", "ta": "Tamil",
}

SYSTEM_PROMPT = (
    "You are KrishiMitra, a practical agricultural advisor for small and marginal "
    "farmers in India. Give short, simple, actionable advice (max ~120 words), "
    "using plain words and local units (acre, quintal, litre per acre). "
    "Prefer low-cost and organic/IPM options first; mention chemical doses only "
    "with safety precautions. If unsure, say so and recommend contacting the local "
    "Krishi Vigyan Kendra (KVK) or agriculture officer. Reply ONLY in {language}."
)

app = FastAPI(title="KrishiMitra API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_client: Optional[genai.Client] = None

def get_client() -> Optional[genai.Client]:
    """Lazily build the Gemini client; returns None if no key is configured."""
    global _client
    key = os.getenv("GEMINI_API_KEY")
    if _client is None and key:
        _client = genai.Client(api_key=key)
    return _client

class ChatTurn(BaseModel):
    role: str
    text: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = []
    lang: str = "en"


class KeyRequest(BaseModel):
    api_key: str

@app.get("/api/health")
async def health():
    return {"status": "ok", "ai_configured": bool(os.getenv("GEMINI_API_KEY")), "model": MODEL}


@app.post("/api/set-key")
async def set_key(req: KeyRequest):
    """Store the key in process memory only (not written to disk). Resets the client."""
    global _client
    key = req.api_key.strip()
    if len(key) < 20:
        raise HTTPException(400, "That doesn't look like a valid API key.")
    os.environ["GEMINI_API_KEY"] = key
    _client = None
    return {"ok": True}

@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Multi-turn advisor. The frontend sends the running history each time (stateless server)."""
    client = get_client()
    if client is None:
        return {"reply": kb.fallback_chat_reply(req.message, req.lang),
                "reply_key": kb.fallback_chat_reply_key(req.message), "source": "offline"}

    language = LANG_NAMES.get(req.lang, "English")
    contents = [
        types.Content(role="user" if t.role == "user" else "model",
                      parts=[types.Part.from_text(text=t.text)])
        for t in req.history[-10:]
    ]
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=req.message)]))

    try:
        resp = await client.aio.models.generate_content(
            model=MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT.format(language=language),
                temperature=0.4,
                max_output_tokens=600,
            ),
        )
        return {"reply": resp.text, "source": "ai"}
    except Exception:
        return {"reply": kb.fallback_chat_reply(req.message, req.lang),
                "reply_key": kb.fallback_chat_reply_key(req.message), "source": "offline"}

DIAG_PROMPT = (
    "Analyse this crop/leaf photo. Respond ONLY with JSON using exactly these keys: "
    '{{"crop": str, "disease": str, "confidence": "low|medium|high", "severity": "low|medium|high", '
    '"symptoms": [str], "organic_remedy": [str], "chemical_remedy": [str], "prevention": [str], '
    '"healthy": bool}}. Write all string values in {language}. '
    "If the image is not a plant, set disease to \"not a plant\" and confidence to low."
)


@app.post("/api/diagnose")
async def diagnose(
    image: UploadFile = File(...),
    lang: str = Form("en"),
    crop_hint: str = Form(""),
):
    if not (image.content_type or "").startswith("image/"):
        raise HTTPException(400, "Please upload an image file.")
    data = await image.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image too large (max 5 MB). Please retake a smaller photo.")

    client = get_client()
    if client is None:
        return {"diagnosis": kb.fallback_diagnosis(crop_hint), "source": "offline"}

    prompt = DIAG_PROMPT.format(language=LANG_NAMES.get(lang, "English"))
    if crop_hint:
        prompt += f" The farmer says the crop is: {crop_hint}."
    try:
        resp = await client.aio.models.generate_content(
            model=MODEL,
            contents=[types.Part.from_bytes(data=data, mime_type=image.content_type), prompt],
            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.2),
        )
        diagnosis = json.loads(resp.text)
        diagnosis["disclaimer"] = "AI guess from a photo. Confirm with your KVK / agriculture officer before spraying."
        return {"diagnosis": diagnosis, "source": "ai"}
    except Exception:
        return {"diagnosis": kb.fallback_diagnosis(crop_hint), "source": "offline"}

def spray_advice(temp: float, humidity: float, wind: float, rain_next_24h: float) -> dict:
    """Rule-of-thumb spray window check. Thresholds are common extension-advice heuristics."""
    reasons = []
    if wind > 15:
        reasons.append("wind_high")      # drift risk
    if rain_next_24h >= 2:
        reasons.append("rain_expected")  # washes off product
    if temp > 35:
        reasons.append("too_hot")        # evaporation / leaf burn
    if humidity > 90:
        reasons.append("humidity_high")  # poor drying, disease pressure
    return {"safe": not reasons, "reasons": reasons}


@app.get("/api/weather")
async def weather(lat: float = 13.08, lon: float = 80.27):
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": 5,
        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m",
        "daily": "precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min",
    }
    try:
        async with httpx.AsyncClient(timeout=8) as http:
            r = await http.get(url, params=params)
            r.raise_for_status()
            d = r.json()
    except Exception:
        return {"available": False, "source": "offline", "message": "Weather unavailable. Check the sky and wind before spraying."}

    cur, daily = d["current"], d["daily"]
    forecast = [
        {"date": daily["time"][i], "rain_mm": daily["precipitation_sum"][i],
         "rain_chance": daily["precipitation_probability_max"][i],
         "max_c": daily["temperature_2m_max"][i], "min_c": daily["temperature_2m_min"][i]}
        for i in range(len(daily["time"]))
    ]
    return {
        "available": True,
        "current": {"temp_c": cur["temperature_2m"], "humidity": cur["relative_humidity_2m"], "wind_kmh": cur["wind_speed_10m"]},
        "forecast": forecast,
        "spray": spray_advice(cur["temperature_2m"], cur["relative_humidity_2m"], cur["wind_speed_10m"], forecast[0]["rain_mm"] or 0),
    }

@app.get("/api/mandi")
async def mandi(crop: str = "", state: str = ""):
    """Prices vs MSP. Uses offline indicative data; swap in the data.gov.in AGMARKNET API for live rates."""
    return {"items": kb.mandi_with_msp(crop, state), "note": kb.MANDI_NOTE}


@app.get("/api/schemes")
async def schemes(state: str = ""):
    return {"schemes": kb.get_schemes(state)}

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
