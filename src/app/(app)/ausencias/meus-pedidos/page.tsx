import type { Metadata } from "next";
import { TelaMeusPedidos } from "@/components/ausencias/tela-meus-pedidos";

export const metadata: Metadata = { title: "Meus pedidos" };

export default function Pagina() {
  return <TelaMeusPedidos />;
}
