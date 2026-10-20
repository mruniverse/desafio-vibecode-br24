import type { Metadata } from "next";

import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "Configuração inicial",
};

/**
 * Moldura do assistente de configuração.
 *
 * Coluna única e centrada, com largura confortável para leitura (~52rem): a
 * decisão da etapa 1 compara dois modos lado a lado no desktop sem virar
 * parede de texto, e empilha no celular sem rolagem lateral.
 */
export default function LayoutSetup({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ToastProvider>
      <main
        id="conteudo"
        className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12 lg:py-16"
      >
        {children}
      </main>
    </ToastProvider>
  );
}
