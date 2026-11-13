import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
    title: "Prima Colazione · Stabilimento",
    description: "Il tuo spazio di lavoro per magazzino, produzione e ordini.",
    icons: { icon: "/favicon.svg" },
    robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#10283c" };
export default function RootLayout({ children }: Readonly<{
    children: React.ReactNode;
}>) {
    return <html lang="it"><body>{children}</body></html>;
}
