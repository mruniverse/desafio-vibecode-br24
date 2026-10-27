import type { Metadata } from "next";
import { TelaCalendario } from "@/components/ausencias/tela-calendario";

export const metadata: Metadata = { title: "Calendário da equipe" };

export default function Pagina() {
  return <TelaCalendario />;
}
