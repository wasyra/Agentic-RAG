import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { openAiSession, sealAiSession } from "@/server/ai-session-crypto";

const COOKIE = "rag_ai_session";

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function GET() {
  const secret = process.env.AI_SESSION_SECRET?.trim();
  const proxySecretsOk = Boolean(secret && secret.length >= 16);
  const jar = await cookies();
  const sealed = jar.get(COOKIE)?.value;
  if (!proxySecretsOk) {
    return NextResponse.json({ proxySecretsOk: false, cookieValid: false });
  }
  if (!sealed) {
    return NextResponse.json({ proxySecretsOk: true, cookieValid: false });
  }
  const creds = openAiSession(secret!, sealed);
  return NextResponse.json({ proxySecretsOk: true, cookieValid: Boolean(creds?.apiKey) });
}

export async function POST(request: Request) {
  const secret = process.env.AI_SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) {
    return NextResponse.json(
      { error: "AI_SESSION_SECRET no configurado (mín. 16 caracteres) en el servidor Next." },
      { status: 503 },
    );
  }
  let body: { provider?: string; apiKey?: string };
  try {
    body = (await request.json()) as { provider?: string; apiKey?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const apiKey = (body.apiKey ?? "").trim();
  const raw = (body.provider ?? "openai").trim().toLowerCase();
  const provider = raw === "google" ? "google" : "openai";
  if (!apiKey) {
    return NextResponse.json({ error: "apiKey requerida" }, { status: 400 });
  }
  const sealed = sealAiSession(secret, { provider, apiKey });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, sealed, cookieOptions(60 * 60 * 24 * 14));
  return res;
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(COOKIE);
  return NextResponse.json({ ok: true });
}
