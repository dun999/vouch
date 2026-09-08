/** Keep the original generated artwork intact; crop its transparent margins in CSS. */
export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-logo${compact ? " compact" : ""}`}>
      <img src="/brand/vouch-logo-v1.png" alt="Vouch" width={2041} height={771} />
    </span>
  );
}
