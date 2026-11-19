export const DEFAULT_SITE_CONFIG = {
  maintenance: false,
  heroHeadline: "Play beyond the ordinary.",
  heroTagline: "Discover fresh worlds made by independent creators. Find your next obsession, or bring your own game to the Sphere.",
  heroImageUrl: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1800&q=85",
  featuredImageUrls: [
    "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=800&q=80"
  ],
  colors: {
    background: "#090b16",
    panel: "#111425",
    text: "#f5f5fb",
    accent: "#9b75ff",
    highlight: "#63e6e2"
  }
};

function isHttpsUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isHexColor(value) {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}

export function validateSiteConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Settings must be a JSON object.");
  }
  if (typeof input.maintenance !== "boolean") {
    throw new Error("Maintenance mode must be enabled or disabled.");
  }
  if (typeof input.heroHeadline !== "string" || !input.heroHeadline.trim() || input.heroHeadline.length > 100) {
    throw new Error("Hero headline must contain 1–100 characters.");
  }
  if (typeof input.heroTagline !== "string" || input.heroTagline.length > 240) {
    throw new Error("Hero tagline must contain at most 240 characters.");
  }
  if (!isHttpsUrl(input.heroImageUrl)) {
    throw new Error("Hero image must use a valid HTTPS URL.");
  }
  if (!Array.isArray(input.featuredImageUrls) || input.featuredImageUrls.length !== 4 ||
      !input.featuredImageUrls.every(isHttpsUrl)) {
    throw new Error("Provide four valid HTTPS URLs for the featured images.");
  }
  const colors = input.colors;
  if (!colors || typeof colors !== "object" ||
      !["background", "panel", "text", "accent", "highlight"].every(key => isHexColor(colors[key]))) {
    throw new Error("All five theme colors must be six-digit hex colors.");
  }

  return {
    maintenance: input.maintenance,
    heroHeadline: input.heroHeadline.trim(),
    heroTagline: input.heroTagline.trim(),
    heroImageUrl: input.heroImageUrl,
    featuredImageUrls: [...input.featuredImageUrls],
    colors: {
      background: colors.background,
      panel: colors.panel,
      text: colors.text,
      accent: colors.accent,
      highlight: colors.highlight
    }
  };
}

export async function readSiteConfig(bucket) {
  const object = await bucket.get("site-config/settings.json");
  if (!object) return DEFAULT_SITE_CONFIG;

  let stored;
  try {
    stored = JSON.parse(await object.text());
  } catch (error) {
    console.error("Stored site settings are invalid JSON:", error);
    throw new Error("Stored site settings are invalid. Repair the settings before continuing.");
  }
  return validateSiteConfig(stored);
}
