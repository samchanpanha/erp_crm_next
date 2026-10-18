import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DoliNext — ERP & CRM",
  description:
    "Open-source style ERP & CRM rebuilt from the Dolibarr feature set: third parties, proposals, sale orders, invoices, purchasing, stock, projects, HR, tickets, bank and agenda.",
  keywords: ["ERP", "CRM", "Dolibarr", "invoicing", "stock", "projects", "HR"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "DoliNext — ERP & CRM",
    description: "One web suite to manage all of your business",
    siteName: "DoliNext",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        {/* Sonner toasts — used by newer modules (users, coffee, import-export) */}
        <SonnerToaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
