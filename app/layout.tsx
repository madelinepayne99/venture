import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Venture HQ",
  description: "The founders' desk for Venture HQ.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body antialiased">{children}</body>
    </html>
  );
}
