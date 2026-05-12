import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { openAiSession } from "@/server/ai-session-crypto";

export const runtime = "nodejs";

const COOKIE = "rag_ai_session";

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "cookie",
]);

async function proxy(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const internal = (
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    ""
  ).replace(/\/$/, "");
  if (!internal) {
    return NextResponse.json(
      {
        error:
          "Configura API_INTERNAL_URL (Docker) o NEXT_PUBLIC_API_URL (dev) en el servidor Next.",
      },
      { status: 503 },
    );
  }

  const subpath = pathSegments.length ? `/${pathSegments.join("/")}` : "";
  const target = new URL(`${internal}${subpath}`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (!HOP_HEADERS.has(k)) {
      headers.set(key, value);
    }
  });

  const secret = process.env.AI_SESSION_SECRET?.trim();
  if (secret && secret.length >= 16) {
    const jar = await cookies();
    const sealed = jar.get(COOKIE)?.value;
    if (sealed) {
      const creds = openAiSession(secret, sealed);
      if (creds?.apiKey) {
        headers.set("X-API-Key", creds.apiKey);
        headers.set("X-AI-Provider", creds.provider);
      }
    }
  }

  const method = request.method;
  if (method === "GET" || method === "HEAD") {
    return fetch(target, { method, headers, redirect: "manual" });
  }

  const buf = await request.arrayBuffer();
  return fetch(target, {
    method,
    headers,
    body: buf.byteLength ? buf : undefined,
    redirect: "manual",
  });
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path ?? []);
}

export async function HEAD(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path ?? []);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path ?? []);
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path ?? []);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path ?? []);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path ?? []);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    },
  });
}
