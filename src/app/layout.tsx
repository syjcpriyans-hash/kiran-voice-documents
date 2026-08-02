import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "Kiran Memorandum Assistant",
  description: "Voice-based memorandum operations connected to Google Sheets",
  applicationName: "Kiran Memorandum Assistant",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#005090",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={poppins.variable}>{children}</body>
    </html>
  );
}
