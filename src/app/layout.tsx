import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlueprintLens",
  description: "Turn process blueprint documents into interactive visual experiences",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
