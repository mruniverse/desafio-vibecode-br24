import type { Metadata } from "next";
import { TelaAprovar } from "@/components/ausencias/tela-aprovar";

export const metadata: Metadata = { title: "Pedidos para aprovar" };

export default function Pagina() {
  return <TelaAprovar />;
}
