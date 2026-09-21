import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Fraunces({ variable: "--f-display", subsets: ["latin"], axes: ["opsz", "SOFT"] });
const sans = Instrument_Sans({ variable: "--f-sans", subsets: ["latin"] });
const mono = IBM_Plex_Mono({ variable: "--f-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "The Refund Ledger · Vireo Audio",
  description: "Monthly refunds by reason and by agent, cleaned, reconciled and ready for the board pack.",
};
export const viewport: Viewport = { themeColor: "#F2EDE2", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
