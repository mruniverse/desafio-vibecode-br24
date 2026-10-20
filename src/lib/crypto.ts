/**
 * Cifragem simetrica dos segredos guardados no SQLite (tokens OAuth do
 * Bitrix24, client_secret informado no wizard).
 *
 * AES-256-GCM: confidencialidade + autenticacao. O formato serializado e
 * `v1.<iv_b64>.<tag_b64>.<ciphertext_b64>` para permitir rotacao futura de
 * algoritmo sem migrar os dados as cegas.
 */
import crypto from "node:crypto";
import { getEnv } from "./env";

const ALGORITMO = "aes-256-gcm";
const VERSAO = "v1";
const TAMANHO_IV = 12; // recomendado para GCM

function chaveMestra(): Buffer {
  const bruta = getEnv().APP_ENCRYPTION_KEY;

  // Aceita base64 (preferido) ou hex de 64 caracteres.
  let chave: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(bruta)) {
    chave = Buffer.from(bruta, "hex");
  } else {
    chave = Buffer.from(bruta, "base64");
  }

  if (chave.length !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY deve ter 32 bytes (base64 de 32 bytes ou hex de 64 caracteres). " +
        'Gere uma com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return chave;
}

export function encrypt(textoClaro: string): string {
  const iv = crypto.randomBytes(TAMANHO_IV);
  const cipher = crypto.createCipheriv(ALGORITMO, chaveMestra(), iv);
  const cifrado = Buffer.concat([
    cipher.update(textoClaro, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSAO,
    iv.toString("base64"),
    tag.toString("base64"),
    cifrado.toString("base64"),
  ].join(".");
}

export function decrypt(serializado: string): string {
  const partes = serializado.split(".");
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new Error("Segredo armazenado em formato desconhecido ou corrompido.");
  }
  const [, ivB64, tagB64, cifradoB64] = partes;
  const decipher = crypto.createDecipheriv(
    ALGORITMO,
    chaveMestra(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(cifradoB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Tag invalida = chave trocada ou dado adulterado.
    throw new Error(
      "Nao foi possivel decifrar o segredo. A chave APP_ENCRYPTION_KEY mudou? " +
        "Refaca a configuracao inicial do app.",
    );
  }
}

/** Mascara para exibir em tela/log sem revelar o valor. */
export function mask(valor: string | null | undefined): string {
  if (!valor) return "—";
  if (valor.length <= 8) return "••••••••";
  return `${valor.slice(0, 4)}••••••••${valor.slice(-4)}`;
}
