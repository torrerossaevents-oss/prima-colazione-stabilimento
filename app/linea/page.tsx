import type { Metadata, Viewport } from "next";
import LineApp from "../../components/line-app";

export const dynamic = "force-dynamic";
// Installable on the iPad: Safari → Condividi → «Aggiungi alla schermata Home».
export const metadata: Metadata = {
    title: "Linea · Prima Colazione",
    description: "Avvio della produzione dall’etichetta, contatore e chiusura con carico.",
    manifest: "/linea.webmanifest",
    appleWebApp: { capable: true, title: "Linea", statusBarStyle: "black-translucent" },
    icons: { icon: "/favicon.svg", apple: "/icons/linea-180.png" },
    robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#10283c", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function Linea() { return <LineApp />; }
