import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipPronto — Editor de vídeos por modelos",
  description: "Crie vídeos verticais repetíveis com modelos salvos, produtos e corte local de pausas.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
