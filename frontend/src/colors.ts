const AUTHOR_PALETTE = [
  // Vivid reds / pinks
  '#ff4444', '#ff4da6', '#e84393', '#c44569',
  // Vivid oranges / yellows
  '#ff8c00', '#ffa502', '#eccc68', '#fdcb6e',
  // Greens
  '#2ed573', '#20bf6b', '#44bd32', '#6ab04c',
  // Cyans / teals
  '#00cec9', '#00d2d3', '#1289a7', '#22a6b3',
  // Blues
  '#1e90ff', '#0984e3', '#4a69bd', '#0652dd',
  // Indigos / violets
  '#5352ed', '#6c5ce7', '#8854d0', '#7e57c2',
  // Purples / magentas
  '#9c88ff', '#f368e0', '#a29bfe', '#da77f2',
  // Classic Kelly colors (dark-bg friendly)
  '#e6194b', '#3cb44b', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45',
  '#469990', '#9A6324', '#aaffc3', '#808000',
  '#ffd8b1', '#a9a9a9', '#dcbeff', '#fabed4',
  // Additional distinctive
  '#ff6b81', '#7bed9f', '#70a1ff', '#b8e994',
  '#55efc4', '#fd79a8', '#e17055', '#00b894',
  '#d63031', '#74b9ff', '#a3cb38', '#ff7675',
];

// Color by email (unique identity)
const emailColorMap = new Map<string, string>();

export function getAuthorColorByEmail(email: string): string {
  const key = email.toLowerCase();
  let color = emailColorMap.get(key);
  if (!color) {
    color = AUTHOR_PALETTE[emailColorMap.size % AUTHOR_PALETTE.length];
    emailColorMap.set(key, color);
  }
  return color;
}
