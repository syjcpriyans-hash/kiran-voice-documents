import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kiran Voice Documents",
  description: "Voice-driven approval note generation from an Excel workbook",
  applicationName: "Kiran Voice Documents",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#183a70",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
