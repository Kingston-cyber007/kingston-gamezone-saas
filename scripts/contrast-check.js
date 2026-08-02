// Audit contraste WCAG 2.0 AA sur les paires texte/fond de la palette Kingston.
// Calcule le ratio de contraste pour chaque paire et signale AA/AAA.
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}
function relLuminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(c1, c2) {
  const L1 = relLuminance(hexToRgb(c1));
  const L2 = relLuminance(hexToRgb(c2));
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
function verdict(ratio, large = false) {
  const aa = large ? 3.0 : 4.5;
  const aaa = large ? 4.5 : 7.0;
  if (ratio >= aaa) return 'AAA ✅';
  if (ratio >= aa) return 'AA ✅';
  return `❌ (need ${aa})`;
}

// Paires à vérifier (texte, fond)
const pairs = [
  // Tokens sémantiques
  ['#EDEFF3', '#0D0F14', 'text / bg'],
  ['#9098A8', '#0D0F14', 'text2 / bg'],
  ['#5C6373', '#0D0F14', 'text3 / bg'],
  ['#EDEFF3', '#131720', 'text / surface'],
  ['#EDEFF3', '#1E2330', 'text / surface3'],
  ['#9098A8', '#1E2330', 'text2 / surface3'],
  ['#5C6373', '#1E2330', 'text3 / surface3'],

  // Boutons ambrés
  ['#11141A', '#E8A33D', 'btn-start text / amber (LARGE)'],
  ['#11141A', '#C97E1F', 'btn-start text / amber-dim (LARGE)'],
  ['#11141A', 'linear-gradient(#E8A33D, #C97E1F)', 'btn-start text / amber gradient'],

  // Boutons KG
  ['#FFFFFF', '#7c3aed', 'btn-confirm text / kg-violet'],
  ['#FFFFFF', 'linear-gradient(#7c3aed, #22d3ee)', 'btn-confirm text / kg-gradient'],
  ['#11141A', '#22d3ee', 'btn-start-like text / kg-cyan'],
  ['#FFFFFF', '#5b21b6', 'btn-confirm text / kg-violet-deep'],

  // Valeurs monétaires KG
  ['#22d3ee', '#0D0F14', 't-value kg-cyan / bg'],
  ['#22d3ee', '#131720', 't-value kg-cyan / surface'],
  ['#22d3ee', '#1E2330', 't-value kg-cyan / surface3'],
  ['#22d3ee', '#161A22', 't-value kg-cyan / surface2'],

  // Code ticket ambre
  ['#E8A33D', '#0D0F14', 'code amber / bg'],
  ['#E8A33D', '#131720', 'code amber / surface'],
  ['#E8A33D', '#1E2330', 'code amber / surface3'],

  // Active states KG
  ['#7c3aed', '#0D0F14', 'nav-tab.active / bg'],
  ['#22d3ee', '#0D0F14', 'nav-tab.active cyan / bg'],
  ['#22d3ee', '#1E2330', 'ts-pill cyan / surface3'],

  // Hover KG
  ['#7c3aed', '#1E2330', 'day-btn.primary / surface3 (hover)'],
  ['#7c3aed', '#161A22', 'day-btn.primary / surface2 (hover)'],
  ['#FFFFFF', '#7c3aed', 'pay-btn.active white / kg-violet'],

  // Inputs KG focus
  ['#7c3aed', '#1E2330', 'field-input:focus kg-violet border / surface3'],
  ['#5C6373', '#1E2330', 'text3 placeholder / surface3'],

  // Landing warning
  ['#E8A33D', '#0a0614', 'kg-landing-warning-title amber / kg-bg'],

  // Topbar pill valeurs KG
  ['#22d3ee', '#1E2330', 'ts-pill .v cyan / surface3'],
  ['#EDEFF3', '#1E2330', 'text / surface3'],

  // Couleurs sémantiques
  ['#3DDC84', '#0D0F14', 'green / bg'],
  ['#5B9DFF', '#0D0F14', 'blue / bg'],
  ['#FF5C5C', '#0D0F14', 'red / bg'],
  ['#EDEFF3', '#FF5C5C', 'text / red (stop btn)'],

  // KG backgrounds
  ['#EDEFF3', '#0a0614', 'text / kg-bg'],
  ['#EDEFF3', '#1a0f2e', 'text / kg-bg-elev'],
];

console.log('| Texte | Fond | Description | Ratio | AA Normal | AA Large |');
console.log('|---|---|---|---|---|---|');
for (const [text, bg, label] of pairs) {
  if (bg.startsWith('linear-gradient')) {
    // Pour les gradients, on prend la couleur la plus défavorable (typiquement la plus sombre)
    const parts = bg.match(/#[0-9A-Fa-f]{6}/g);
    if (!parts) continue;
    const ratios = parts.map(c => contrastRatio(text, c));
    const minRatio = Math.min(...ratios);
    const ratio = minRatio;
    console.log(`| ${text} | gradient(${parts.join(', ')}) | ${label} | ${ratio.toFixed(2)}:1 | ${verdict(ratio)} | ${verdict(ratio, true)} |`);
  } else {
    const ratio = contrastRatio(text, bg);
    const isLarge = label.includes('LARGE') || label.includes('btn-start') || label.includes('btn-confirm') || label.includes('btn-create-ticket');
    console.log(`| ${text} | ${bg} | ${label} | ${ratio.toFixed(2)}:1 | ${verdict(ratio)} | ${verdict(ratio, true)} |`);
  }
}
