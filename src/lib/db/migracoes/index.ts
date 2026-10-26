/**
 * Lista ordenada de migracoes. Para adicionar uma, crie o arquivo e importe
 * aqui. Nunca reordene nem edite uma migracao ja aplicada.
 */
import * as m001 from "./001_inicial";
import * as m002 from "./002_ausencias_nucleo";
import * as m003 from "./003_ausencias_sync";

export const MIGRACOES: { nome: string; sql: string }[] = [m001, m002, m003];
