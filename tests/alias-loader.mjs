/**
 * Resolve o alias `@/*` do tsconfig para o runner nativo do Node.
 *
 * O `node --test` nao le `paths` do tsconfig.json, entao os imports `@/lib/...`
 * dentro de src/ falham. Este hook traduz `@/x` para `<raiz>/src/x` e, como
 * ESM exige extensao explicita (o TypeScript nao), tenta `.ts` e `/index.ts`.
 *
 * Usado por: npm run test:seguranca
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const RAIZ_SRC = path.resolve(import.meta.dirname, "..", "src");

/** Primeiro caminho que existe no disco, na ordem que o TS resolveria. */
function resolverArquivo(base) {
  const candidatos = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidatos.find((c) => {
    try {
      return fs.statSync(c).isFile();
    } catch {
      return false;
    }
  });
}

export function resolve(especificador, contexto, proximo) {
  if (especificador.startsWith("@/")) {
    const alvo = resolverArquivo(path.join(RAIZ_SRC, especificador.slice(2)));
    if (alvo) return proximo(pathToFileURL(alvo).href, contexto);
  }

  // Imports relativos sem extensao dentro de src/ (estilo TypeScript).
  if (especificador.startsWith(".") && contexto.parentURL?.includes("/src/")) {
    const base = path.resolve(
      path.dirname(new URL(contexto.parentURL).pathname),
      especificador,
    );
    const alvo = resolverArquivo(base);
    if (alvo) return proximo(pathToFileURL(alvo).href, contexto);
  }

  return proximo(especificador, contexto);
}
