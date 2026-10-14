import axios from "axios";

export async function transferGlobal(currency: string): Promise<number | null> {
  const base = (process.env.PRODUIT_API_URL || "http://localhost:8080").replace(/\/$/, "");
  const code = String(currency || "").trim().toUpperCase();
  if (!code) return null;
  try {
    const { data } = await axios.get(`${base}/api/payment-plafonds/${encodeURIComponent(code)}`, {
      timeout: 8000,
      headers: { Accept: "application/json" },
    });
    const cap = Number(data?.transferGlobal);
    return Number.isFinite(cap) ? cap : null;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}
