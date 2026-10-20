/**
 * Registra o hook de resolucao do alias `@/*` antes de carregar os testes.
 * Usado via `node --import ./tests/registrar-alias.mjs`.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(import.meta.filename));
