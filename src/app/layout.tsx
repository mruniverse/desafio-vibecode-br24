import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // O nome definitivo entra quando o tema for sorteado.
  title: {
    default: "Aplicativo Br24",
    template: "%s · Aplicativo Br24",
  },
  description:
    "Aplicativo integrado ao Bitrix24 pela API REST oficial, hospedado na Onnira Cloud AI.",
  applicationName: "Aplicativo Br24",
  robots: { index: false, follow: false }, // app interno de cliente
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // nunca bloqueie o zoom: acessibilidade
  themeColor: "#2d7ff9",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh antialiased">
        {/* Atalho de teclado para quem navega sem mouse. */}
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Pular para o conteudo
        </a>
        {children}
      </body>
    </html>
  );
}
