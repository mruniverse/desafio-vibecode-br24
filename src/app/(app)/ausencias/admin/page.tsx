import type { Metadata } from "next";
import { TelaAdmin } from "@/components/ausencias/tela-admin";

export const metadata: Metadata = { title: "Painel e configurações" };

export default function Pagina() {
  return <TelaAdmin />;
}
