"use client";

import dynamic from "next/dynamic";
import { SolanaProviders } from "../components/SolanaProviders";

// EscrowApp uses browser APIs (localStorage, wallet) — load without SSR
const EscrowApp = dynamic(
  () =>
    import("../components/EscrowApp").then((mod) => ({ default: mod.EscrowApp })),
  { ssr: false }
);

export default function Home() {
  return (
    <SolanaProviders>
      <EscrowApp />
    </SolanaProviders>
  );
}
