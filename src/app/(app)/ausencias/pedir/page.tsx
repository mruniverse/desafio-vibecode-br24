import type { Metadata } from "next";
import { TelaPedir } from "@/components/ausencias/tela-pedir";

export const metadata: Metadata = { title: "Pedir ausência" };

export default function Pagina() {
  return <TelaPedir />;
}
