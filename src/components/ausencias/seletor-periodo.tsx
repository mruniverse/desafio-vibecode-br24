"use client";

import { Button, FieldGroup, Input } from "@/components/ui";
import { diaDaSemana, plural, somarDias } from "./formatos";

export const MAX_DIAS = 366;

const MS_DIA = 86_400_000;
const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function dataValida(d: string): boolean {
  if (!FORMATO_DATA.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** Dias corridos entre duas datas, contando o primeiro e o último. */
export function diasCorridos(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / MS_DIA) + 1;
}

/** Estimativa: dia seguinte ao fim; se cair em sábado ou domingo, vai para a segunda. */
export function voltaAoTrabalho(fim: string): string {
  let d = somarDias(fim, 1);
  while (diaDaSemana(d) === 0 || diaDaSemana(d) === 6) d = somarDias(d, 1);
  return d;
}

interface Props {
  inicio: string;
  fim: string;
  /** Menor data permitida (hoje da demonstração). */
  min: string;
  onChange: (inicio: string, fim: string) => void;
}

/** Duas datas + botões −/+ para ajustar quantos dias. Sem biblioteca de calendário. */
export function SeletorPeriodo({ inicio, fim, min, onChange }: Props) {
  const temPeriodo = dataValida(inicio) && dataValida(fim) && fim >= inicio;
  const duracao = temPeriodo ? diasCorridos(inicio, fim) : 0;

  function limitar(i: string, f: string) {
    onChange(i, diasCorridos(i, f) > MAX_DIAS ? somarDias(i, MAX_DIAS - 1) : f);
  }

  function mudarInicio(v: string) {
    if (!dataValida(v)) return onChange(v, fim);
    limitar(v, dataValida(fim) && fim >= v ? fim : v);
  }

  function mudarFim(v: string) {
    if (!dataValida(v)) return onChange(inicio, v);
    if (!dataValida(inicio)) return onChange(v, v);
    limitar(inicio, v < inicio ? inicio : v);
  }

  function ajustar(delta: number) {
    if (!dataValida(inicio)) return;
    const nova = Math.min(Math.max((duracao || 1) + delta, 1), MAX_DIAS);
    onChange(inicio, somarDias(inicio, nova - 1));
  }

  return (
    <FieldGroup titulo="Escolha as datas">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          type="date"
          rotulo="Primeiro dia"
          value={inicio}
          min={min}
          onChange={(e) => mudarInicio(e.target.value)}
        />
        <Input
          type="date"
          rotulo="Último dia"
          value={fim}
          min={dataValida(inicio) ? inicio : min}
          onChange={(e) => mudarFim(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span id="rotulo-quantos-dias" className="text-sm font-medium text-strong">
          Quantos dias?
        </span>
        <div className="flex items-center gap-3" role="group" aria-labelledby="rotulo-quantos-dias">
          <Button
            variante="secondary"
            aria-label="Tirar um dia"
            className="w-11 px-0"
            disabled={duracao <= 1}
            onClick={() => ajustar(-1)}
          >
            −
          </Button>
          <output className="min-w-28 text-center text-base font-semibold text-strong" aria-live="polite">
            {duracao > 0 ? plural(duracao, "dia corrido", "dias corridos") : "—"}
          </output>
          <Button
            variante="secondary"
            aria-label="Somar um dia"
            className="w-11 px-0"
            disabled={!dataValida(inicio) || duracao >= MAX_DIAS}
            onClick={() => ajustar(1)}
          >
            +
          </Button>
        </div>
      </div>
    </FieldGroup>
  );
}
