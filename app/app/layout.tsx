import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Vouch — verified spending becomes progression",
  description: "Pay in USDC on Sepolia, prove it with Attestcoin, level up on Creditcoin.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Read the saved theme before first paint so dark mode never flashes light. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("vouch:theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
