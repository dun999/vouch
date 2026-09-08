import { UserShell } from "@/components/UserShell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <UserShell>{children}</UserShell>;
}
