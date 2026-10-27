import type { Metadata } from "next";
import { TelaEquipe } from "@/components/ausencias/tela-equipe";

export const metadata: Metadata = { title: "Equipe disponível" };

export default function Pagina() {
  return <TelaEquipe />;
}
