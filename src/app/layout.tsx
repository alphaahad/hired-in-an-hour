import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { TopBar } from "@/components/TopBar";

// IBM Plex: sturdy strokes that render well on Windows and read as enterprise/finance.
// Mono only for genuinely technical content (field names, raw JSON, logs); numbers use Plex Sans with tabular figures.
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Hired in an Hour · an AP digital employee",
  description: "A prototype that takes a finance team from zero to a working AP digital employee in under an hour. All data is synthetic mock data.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <TopBar />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
