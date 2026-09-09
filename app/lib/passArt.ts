/// Byte-identical mirror of `BenefitPass._renderSvg` in contracts/src/BenefitPass.sol.
///
/// The deployed pass renders its own art on-chain, and that stays the canonical token image. This
/// exists so the console can show a holder the *current* design without waiting on a redeploy —
/// VouchCore holds its BenefitPass address as an immutable, so re-cutting the art means moving
/// the whole protocol. Same inputs, same bytes: `pnpm pass:check` diffs the two renderers.

const PAPER = "#F7F4ED";
const INK = "#252A24";
const MUTED = "#6E7468";
const RULE = "#C8C9BD";

/// Tier ink. Graphite, then green, indigo, the house terracotta, and gold at the top.
export function tierOf(level: number): { accent: string; name: string } {
  if (level >= 5) return { accent: "#8A6A17", name: "FOUNDING MEMBER" };
  if (level === 4) return { accent: "#AD462C", name: "PATRON" };
  if (level === 3) return { accent: "#1F5670", name: "INSIDER" };
  if (level === 2) return { accent: "#286047", name: "REGULAR" };
  return { accent: "#6E7468", name: "NEWCOMER" };
}

/// Progress through the current tier and the line printed under the ledger bar.
function ladder(level: number, stars: bigint, thresholds: readonly bigint[]) {
  if (thresholds.length === 0) return { pct: 0, note: "AWAITING FIRST VERIFIED PURCHASE" };
  if (level === 0 || level - 1 >= thresholds.length) return { pct: 100, note: "HIGHEST TIER REACHED" };

  const next = thresholds[level - 1];
  const prev = level >= 2 ? thresholds[level - 2] : 0n;
  const note = `${stars >= next ? 0n : next - stars} STARS TO LEVEL ${level + 1}`;
  if (next <= prev || stars <= prev) return { pct: 0, note };
  const pct = Number(((stars - prev) * 100n) / (next - prev));
  return { pct: pct > 100 ? 100 : pct, note };
}

/// Engine turning. Two families of rotated ellipses interfere into a rosette — the same
/// construction a banknote lathe draws, and the reason it is hard to fake by hand.
function rosette(level: number, accent: string) {
  const capped = Math.min(level, 5);
  const outer = 24 + capped * 5;
  const inner = 12 + capped * 3;

  let out = `<g transform="translate(173,208)" fill="none" stroke="${accent}"><g stroke-width="0.45" opacity="0.38">`;
  for (let i = 0; i < outer; i++) {
    out += `<ellipse rx="88" ry="28" transform="rotate(${Math.floor((i * 180) / outer)})"/>`;
  }
  out += `</g><g stroke-width="0.4" opacity="0.3">`;
  for (let i = 0; i < inner; i++) {
    out += `<ellipse rx="54" ry="15" transform="rotate(${Math.floor((i * 180) / inner) + 7})"/>`;
  }
  return out + "</g></g>";
}

/// The tear-off stub. A pass that cannot be transferred still gets the anatomy of a ticket,
/// because that is the object it stands in for.
function stub(tokenId: bigint, accent: string) {
  return (
    `<path d="M326 20v520" stroke="${RULE}" stroke-width="1" stroke-dasharray="2 4"/>` +
    `<circle cx="326" cy="20" r="4" fill="${PAPER}" stroke="${RULE}" stroke-width="0.8"/>` +
    `<circle cx="326" cy="540" r="4" fill="${PAPER}" stroke="${RULE}" stroke-width="0.8"/>` +
    `<rect x="342" y="34" width="22" height="4" rx="2" fill="${accent}"/>` +
    `<g transform="translate(353,290) rotate(-90)" text-anchor="middle">` +
    `<text y="-6" font-family="Georgia, serif" font-size="16" fill="${INK}" letter-spacing="2">No. ${tokenId}</text>` +
    `<text y="9" font-family="monospace" font-size="7" fill="${MUTED}" letter-spacing="3.2">SOULBOUND</text></g>` +
    `<rect x="342" y="522" width="22" height="4" rx="2" fill="${accent}"/>`
  );
}

function header(tokenId: bigint, accent: string) {
  return (
    `<rect x="34" y="34" width="28" height="28" rx="8" fill="${accent}"/>` +
    `<text x="48" y="54" font-family="Georgia, serif" font-size="17" font-weight="bold" fill="${PAPER}" text-anchor="middle">V</text>` +
    `<text x="72" y="49" font-family="Georgia, serif" font-size="15" fill="${INK}" letter-spacing="3.4">VOUCH</text>` +
    `<text x="73" y="63" font-family="monospace" font-size="7.5" fill="${MUTED}" letter-spacing="2.4">BENEFIT PASS</text>` +
    `<text x="312" y="49" font-family="monospace" font-size="9" fill="${accent}" text-anchor="end" letter-spacing="1.4">CREDITCOIN CC3</text>` +
    `<text x="312" y="63" font-family="monospace" font-size="7.5" fill="${MUTED}" text-anchor="end" letter-spacing="1.4">NON-TRANSFERABLE</text>` +
    `<path d="M34 78h278" stroke="${RULE}" stroke-width="1"/>` +
    `<path d="M34 81h278" stroke="${RULE}" stroke-width="0.4"/>` +
    stub(tokenId, accent)
  );
}

/// The rules either side of the tier name stop short of it, so a long name never collides
/// with them. 9px per character is the width of this face at 14px.
function flankWidth(tierName: string) {
  const half = Math.floor((tierName.length * 9) / 2) + 12;
  return String(half >= 139 ? 10 : 139 - half);
}

/// The medallion: tier ink, engraved rules, and the level set in a book face.
function medallion(level: number, accent: string, tierName: string) {
  return (
    `<g transform="translate(173,208)">` +
    `<circle r="46" fill="${PAPER}" fill-opacity="0.94"/>` +
    `<circle r="46" fill="none" stroke="${accent}" stroke-width="1.2"/>` +
    `<circle r="40" fill="none" stroke="${accent}" stroke-width="0.5" stroke-dasharray="1 3"/>` +
    `<text y="-16" font-family="monospace" font-size="7" fill="${MUTED}" text-anchor="middle" letter-spacing="3.4">LEVEL</text>` +
    `<text y="22" font-family="Georgia, serif" font-size="46" fill="${accent}" text-anchor="middle">${level}</text></g>` +
    `<path d="M34 317h${flankWidth(tierName)}" stroke="${RULE}" stroke-width="0.6"/>` +
    `<text x="173" y="322" font-family="Georgia, serif" font-size="14" fill="${INK}" text-anchor="middle" letter-spacing="4">${tierName}</text>` +
    `<path d="M312 317h-${flankWidth(tierName)}" stroke="${RULE}" stroke-width="0.6"/>`
  );
}

/// The star count as a ledger bar: twenty engraved cells, filled to the tier's progress.
function ledger(stars: bigint, pct: number, accent: string, note: string) {
  let out =
    `<text x="34" y="358" font-family="monospace" font-size="7.5" fill="${MUTED}" letter-spacing="2.6">VERIFIED STARS</text>` +
    `<text x="312" y="360" font-family="Georgia, serif" font-size="18" fill="${accent}" text-anchor="end">${stars}</text><g>`;

  const filled = Math.floor((pct * 20 + 50) / 100);
  for (let i = 0; i < 20; i++) {
    out +=
      `<rect x="${34 + i * 14}" y="370" width="12" height="9" rx="1.5" ` +
      (i < filled ? `fill="${accent}"/>` : `fill="none" stroke="${RULE}" stroke-width="0.8"/>`);
  }
  return (
    out +
    `</g><text x="34" y="396" font-family="monospace" font-size="7.5" fill="${MUTED}" letter-spacing="1.8">${note}</text>`
  );
}

/// The route the stars travelled. Sepolia pays, Attestcoin proves, Creditcoin records — three
/// marks, drawn as three different things, because they are three different acts.
function rail(accent: string) {
  return (
    `<g transform="translate(0,420)">` +
    `<path d="M34 20h278" stroke="${RULE}" stroke-width="0.8"/>` +
    `<rect x="28" y="14" width="12" height="12" rx="2" fill="${PAPER}" stroke="${accent}" stroke-width="1.5"/>` +
    `<circle cx="173" cy="20" r="9" fill="${accent}"/>` +
    `<path d="M169 20l3 3 5-6" fill="none" stroke="${PAPER}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="312" cy="20" r="6" fill="${PAPER}" stroke="${accent}" stroke-width="1.5"/>` +
    `<g font-family="monospace" font-size="7" fill="${MUTED}" letter-spacing="1.6">` +
    `<text x="34" y="40">SEPOLIA</text>` +
    `<text x="173" y="40" text-anchor="middle" fill="${accent}">ATTESTCOIN</text>` +
    `<text x="312" y="40" text-anchor="end">CREDITCOIN</text></g>` +
    `<g font-family="monospace" font-size="6" fill="${RULE}" letter-spacing="1.2">` +
    `<text x="34" y="52">PAID</text>` +
    `<text x="173" y="52" text-anchor="middle">PROVEN</text>` +
    `<text x="312" y="52" text-anchor="end">RECORDED</text></g></g>`
  );
}

const MICROPRINT =
  "VOUCH*VERIFIED*COMMERCE*VOUCH*VERIFIED*COMMERCE*VOUCH*VERIFIED*COMMERCE*VOUCH*VERIFIED*COMMERCE*VOUCH*VERIFIED*COMMERCE*VOUCH*VERI";

/// Micro-print. Legible only when enlarged, which is the point of it.
function footer(user: string) {
  return (
    `<path d="M34 492h278" stroke="${RULE}" stroke-width="0.6"/>` +
    `<text x="34" y="510" font-family="monospace" font-size="8" fill="${INK}" letter-spacing="0.4">${user.toLowerCase()}</text>` +
    `<text x="34" y="523" font-family="monospace" font-size="6.5" fill="${MUTED}" letter-spacing="1.6">BEARER OF RECORD</text>` +
    `<text x="34" y="535" font-family="monospace" font-size="3.6" fill="${RULE}" letter-spacing="0.5">${MICROPRINT}</text>`
  );
}

export function renderPassSvg({
  tokenId,
  user,
  level,
  stars,
  thresholds,
}: {
  tokenId: bigint;
  user: string;
  level: number;
  stars: bigint;
  thresholds: readonly bigint[];
}) {
  const { accent, name } = tierOf(level);
  const { pct, note } = ladder(level, stars, thresholds);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560" viewBox="0 0 400 560">` +
    `<rect width="400" height="560" fill="#E7E2D6"/>` +
    `<rect x="10" y="10" width="380" height="540" rx="18" fill="${PAPER}" stroke="${RULE}" stroke-width="1"/>` +
    rosette(level, accent) +
    `<rect x="20" y="20" width="360" height="520" rx="12" fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="0.8"/>` +
    header(tokenId, accent) +
    medallion(level, accent, name) +
    ledger(stars, pct, accent, note) +
    rail(accent) +
    footer(user) +
    `</svg>`
  );
}

/// Same data: URI shape the contract returns, so the <img> src is interchangeable.
export const passDataUri = (svg: string) =>
  `data:image/svg+xml;base64,${typeof window === "undefined" ? Buffer.from(svg).toString("base64") : btoa(svg)}`;
