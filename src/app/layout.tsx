import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "rmz-food-automation",
  description:
    "A local-first weekly meal planner and shopping-list assistant for two adults and a toddler."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
