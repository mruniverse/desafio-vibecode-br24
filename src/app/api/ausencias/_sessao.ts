/**
 * Sessao-demo local do C4 (BR24-005 v2.2). Troca pelo modulo de sessao do C2.
 *
 * - So existe com MODO_DEMO=1 (padrao 0). Lido a cada chamada, nao em cache.
 * - Cookie assinado por HMAC-SHA256 (chave derivada de APP_ENCRYPTION_KEY) com
 *   SO o `pessoaId` e a validade. O papel NUNCA viaja: vem do cadastro.
 * - Rotas ignoram pessoaId/papel de corpo, query e header.
 * - POST/PUT/DELETE conferem `Origin` e a criacao da sessao tem limite de taxa.
 */
import crypto from "node:crypto";
import type { NextResponse } from "next/server";
import type { SessaoDemo } from "@/lib/ausencias/tipos";
import { ErroAusencias, naoAutenticado, semPermissao } from "./_erros";
import { obterApoioDemo } from "./_servicos";

export const COOKIE_SESSAO = "revezza_sessao";
export const SELO_DEMO = "Modo demonstração — identidade não verificada";
const VALIDADE_SEGUNDOS = 8 * 60 * 60;
const LIMITE_CRIACOES_POR_MINUTO = 60;

export function modoDemoLigado(): boolean {
  return process.env.MODO_DEMO === "1";
}

function chave(): Buffer {
  const base = process.env.APP_ENCRYPTION_KEY;
  if (!base) throw new Error("APP_ENCRYPTION_KEY nao configurada");
  return crypto.createHmac("sha256", base).update("ausencias.sessao-demo.v1").digest();
}

function assinar(payload: string): string {
  return crypto.createHmac("sha256", chave()).update(payload).digest("base64url");
}

export function emitirValorCookie(pessoaId: string): string {
  const payload = Buffer.from(JSON.stringify({ p: pessoaId, e: Math.floor(Date.now() / 1000) + VALIDADE_SEGUNDOS })).toString("base64url");
  return `${payload}.${assinar(payload)}`;
}

function lerCookie(req: Request, nome: string): string | null {
  const bruto = req.headers.get("cookie");
  if (!bruto) return null;
  for (const parte of bruto.split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return null;
}

/** Devolve a sessao se o cookie for autentico, nao expirado e de pessoa cadastrada. */
export function lerSessao(req: Request): SessaoDemo | null {
  const valor = lerCookie(req, COOKIE_SESSAO);
  if (!valor) return null;
  const partes = valor.split(".");
  if (partes.length !== 2) return null;
  const [payload, assinatura] = partes;
  const esperado = Buffer.from(assinar(payload));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  try {
    const dados: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof dados !== "object" || dados === null) return null;
    const { p, e } = dados as { p?: unknown; e?: unknown };
    if (typeof p !== "string" || typeof e !== "number" || e < Date.now() / 1000) return null;
    const papel = obterApoioDemo().papelDe(p);
    return papel ? { pessoaId: p, papel } : null;
  } catch {
    return null;
  }
}

/** Bloqueia POST/PUT/DELETE vindos de outra origem (alem do SameSite=Lax do cookie). */
export function verificarOrigem(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origem = req.headers.get("origin");
  if (!origem) return;
  let hostOrigem: string;
  try {
    hostOrigem = new URL(origem).host;
  } catch {
    throw semPermissao("Origem da requisição não permitida.");
  }
  const aceitos = [req.headers.get("host"), req.headers.get("x-forwarded-host"), new URL(req.url).host];
  if (!aceitos.includes(hostOrigem)) throw semPermissao("Origem da requisição não permitida.");
}

export function exigirSessao(req: Request): SessaoDemo {
  if (!modoDemoLigado()) {
    throw naoAutenticado("O modo demonstração está desligado neste ambiente.");
  }
  verificarOrigem(req);
  const sessao = lerSessao(req);
  if (!sessao) throw naoAutenticado("Escolha quem você é para entrar na demonstração.");
  return sessao;
}

interface GlobalTaxa {
  __revezzaTaxa?: Map<string, number[]>;
}

export function limitarCriacaoDeSessao(req: Request): void {
  const glob = globalThis as unknown as GlobalTaxa;
  const mapa = (glob.__revezzaTaxa ??= new Map<string, number[]>());
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim().slice(0, 64);
  const agora = Date.now();
  const recentes = (mapa.get(ip) ?? []).filter((t) => agora - t < 60_000);
  if (recentes.length >= LIMITE_CRIACOES_POR_MINUTO) {
    throw new ErroAusencias("LIMITE_API", 429, "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.");
  }
  recentes.push(agora);
  mapa.set(ip, recentes);
}

export function reiniciarLimiteDeTaxa(): void {
  (globalThis as unknown as GlobalTaxa).__revezzaTaxa = undefined;
}

function seguro(): boolean {
  return (process.env.APP_BASE_URL ?? "").startsWith("https://");
}

export function gravarCookie(res: NextResponse, pessoaId: string): void {
  res.cookies.set({
    name: COOKIE_SESSAO,
    value: emitirValorCookie(pessoaId),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: VALIDADE_SEGUNDOS,
    secure: seguro(),
  });
}

export function apagarCookie(res: NextResponse): void {
  res.cookies.set({ name: COOKIE_SESSAO, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0, secure: seguro() });
}
