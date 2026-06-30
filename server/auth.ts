import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config";

const cookieName = "rs_session";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", config.sessionSecret || "dev-session-secret").update(payload).digest("base64url");
}

function timingSafeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const index = part.indexOf("=");
      if (index < 0) return [part.trim(), ""];
      return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    })
  );
}

export function authRequired(): boolean {
  return Boolean(config.appPassword);
}

export function verifyPassword(password: string): boolean {
  if (!config.appPassword) return true;
  return timingSafeEqualText(password, config.appPassword);
}

export function createSessionCookie(): string {
  const payload = JSON.stringify({ exp: Date.now() + sessionTtlMs });
  const encoded = base64Url(payload);
  const secure = config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
  return `${cookieName}=${encoded}.${sign(encoded)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure}`;
}

export function clearSessionCookie(): string {
  return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function isAuthenticated(request: FastifyRequest): boolean {
  if (!authRequired()) return true;
  const token = parseCookies(request.headers.cookie)[cookieName];
  if (!token) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || !timingSafeEqualText(signature, sign(encoded))) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function requireWorkerToken(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = config.workerToken;
  if (!expected) {
    reply.code(503).send({ error: "WORKER_TOKEN is not configured" });
    return false;
  }
  const value = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (!value || !timingSafeEqualText(value, expected)) {
    reply.code(401).send({ error: "invalid worker token" });
    return false;
  }
  return true;
}

