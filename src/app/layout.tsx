import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist_Mono, Outfit } from "next/font/google";
import { CleoSvgDefs } from "@/components/cleo/svg-defs";
import "./globals.css";

// Tipografías de Cleo (docs/diseno-plan.md §2). next/font las sirve desde el propio
// dominio: el navegador no le pide nada a Google.
// Serif elegante (parecida al logotipo) para títulos, nombres de estudio y números.
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Sans moderna para textos, botones y formularios.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Sin título por defecto: cada sección define el suyo. Así nunca se filtra "Cleo"
// (ni nada genérico) en el título del sitio o el panel de un estudio.
export const metadata: Metadata = {};

export const viewport: Viewport = { themeColor: "#0d0a09", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-AR"
      // La bienvenida marca data-welcome-seen antes de pintar (welcome.tsx).
      suppressHydrationWarning
      className={`${cormorant.variable} ${outfit.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <CleoSvgDefs />
        {children}
      </body>
    </html>
  );
}
