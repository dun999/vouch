import { MerchantShell } from "@/components/MerchantShell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <MerchantShell>{children}</MerchantShell>;
}
