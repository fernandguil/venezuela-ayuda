import { NextResponse } from "next/server";
import OpenAI from "openai";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { classifyHeuristic, type Classification } from "@/lib/classifyHeuristic";
import { HELP_CATEGORIES, URGENCY_LEVELS } from "@/lib/constants";
import { logWarn, logDebug } from "@/lib/log.mjs";

export const runtime = "nodejs";
export const maxDuration = 15;

// Classify a free-text emergency message into a structured help request.
// Uses OpenAI when configured; otherwise (or on any error/timeout) falls back
// to a deterministic Spanish keyword classifier so the feature never blocks.

const SYSTEM = `Eres un clasificador de emergencias para Venezuela tras un terremoto.
Dado un mensaje en español, responde SOLO con JSON válido:
{"category": one of ["medical","food","water","shelter","transportation","electricity","rescue"],
 "urgency": one of ["LOW","MEDIUM","HIGH","CRITICAL"],
 "keywords": array of up to 6 short english tags,
 "location": city name string or null}
Reglas: personas atrapadas, sin oxígeno o heridas graves = "critical".
Niños, ancianos, embarazadas o heridos = al menos "high".`;

function sanitize(input: unknown, fallback: Classification): Classification {
  const obj = (input ?? {}) as Record<string, unknown>;
  const category =
    typeof obj.category === "string" && obj.category in HELP_CATEGORIES
      ? (obj.category as Classification["category"])
      : fallback.category;
  const urgency =
    typeof obj.urgency === "string" && obj.urgency in URGENCY_LEVELS
      ? (obj.urgency as Classification["urgency"])
      : fallback.urgency;
  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.filter((k) => typeof k === "string").slice(0, 6).map((k) => String(k).slice(0, 30))
    : fallback.keywords;
  const location =
    typeof obj.location === "string" && obj.location.trim()
      ? obj.location.trim().slice(0, 80)
      : null;
  return { category, urgency, keywords, location, source: "ai" };
}

export async function POST(req: Request) {
  const limited = await rateLimit(await clientKey("classify"), { limit: 20, windowSec: 60 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 1000).trim();
  } catch {
    // El texto libre puede contener PII → jamás se loguea; sólo el evento.
    logDebug("classify_bad_json", { scope: "api.classify.POST" });
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }
  if (text.length < 4) {
    return NextResponse.json({ error: "Texto demasiado corto." }, { status: 400 });
  }

  const fallback = classifyHeuristic(text);

  // No API key → deterministic fallback.
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(fallback);
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create(
      {
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text },
        ],
      },
      { timeout: 10000 }
    );
    const raw = completion.choices[0]?.message?.content ?? "{}";
    return NextResponse.json(sanitize(JSON.parse(raw), fallback));
  } catch (err) {
    // Any failure (timeout, quota, network) → graceful fallback. Se degrada sin
    // PII (el `text` del usuario nunca entra al log), pero queda traza del fallo.
    logWarn("classify_openai_fallback", { scope: "api.classify.POST" }, err);
    return NextResponse.json(fallback);
  }
}
