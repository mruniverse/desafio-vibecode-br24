import type { Metadata } from "next";
import { ShellAusencias } from "@/components/ausencias/shell";

export const metadata: Metadata = {
  title: "Férias e ausências",
};

export default function LayoutAusencias({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ShellAusencias>{children}</ShellAusencias>;
}
