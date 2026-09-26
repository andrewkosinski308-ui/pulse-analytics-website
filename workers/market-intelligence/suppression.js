const SUPPRESSION = {
  D: "Not disclosed",
  S: "Not disclosed",
  N: "Not available",
  X: "Not applicable"
};

const NOISE = new Set(["G", "H", "J"]);

export function parseBusinessMeasure(raw, flag = "", noiseFlag = "") {
  const token = String(raw ?? "").trim();
  const flagToken = cleanFlag(flag);
  const noiseToken = cleanFlag(noiseFlag);
  const embedded = token.match(/^(-?\d+(?:\.\d+)?)[\s(]*([GHJ])\)?$/i);
  const rawToken = token.toUpperCase();
  const suppression = SUPPRESSION[rawToken] ? rawToken : SUPPRESSION[flagToken] ? flagToken : "";
  if (suppression) {
    return {
      available: false,
      suppression_code: suppression,
      display_value: SUPPRESSION[suppression]
    };
  }
  const numeric = embedded ? embedded[1] : token;
  if (!/^-?\d+(\.\d+)?$/.test(numeric)) return { missing: true };
  const value = Number(numeric);
  if (!Number.isFinite(value)) return { missing: true };
  const measure = { available: true, value };
  const noise = NOISE.has(noiseToken)
    ? noiseToken
    : embedded
      ? embedded[2].toUpperCase()
      : NOISE.has(flagToken)
        ? flagToken
        : "";
  if (noise) measure.noise_code = noise;
  return measure;
}

export function calculationValue(measure) {
  if (!measure || measure.available !== true || measure.suppression_code) return null;
  if (typeof measure.value !== "number" || !Number.isFinite(measure.value)) return null;
  return measure.value;
}

export function payrollFromMeasure(measure) {
  const value = calculationValue(measure);
  if (value == null) return null;
  return value * 1000;
}

function cleanFlag(value) {
  return String(value ?? "").trim().toUpperCase();
}
