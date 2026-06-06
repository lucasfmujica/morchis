import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const GROUPS = ["comida", "bebidas", "snacks", "limpieza", "cuidado personal", "hogar", "mascotas", "otros"];
const CURRENCIES = ["ARS", "USD"];

interface ReceiptItem {
  name: string;
  qty: number;
  line_total: number;
  group: string;
}

interface ParsedReceipt {
  merchant: string;
  date: string;
  total: number;
  currency: string;
  suggested_category: string;
  items: ReceiptItem[];
}

// The function now reads ANY purchase proof, not just supermarket tickets:
// itemized receipts (super, kiosco, farmacia, ferretería) AND single-charge
// proofs like bank/wallet notification screenshots (DiDi, Uber, Mercado Pago,
// PedidosYa, debits, transfers). It detects the right category and currency,
// and only itemizes when there's an actual product list.
const SYSTEM_PROMPT = `Sos un asistente que lee COMPROBANTES DE GASTO argentinos y devuelve un único objeto JSON. El comprobante puede ser de dos tipos:

1) TICKET / FACTURA con detalle de productos (supermercado, kiosco, farmacia, ferretería, etc.).
2) COMPROBANTE de un único cargo SIN lista de productos: captura de una notificación o movimiento bancario/billetera (DiDi, Uber, Cabify, Mercado Pago, MODO, PedidosYa, Rappi, débito automático, transferencia, pago de servicio, restaurante, etc.).

Devolvé SIEMPRE este JSON:
- merchant: nombre del comercio o servicio (limpio). Ej: "DiDi", "Carrefour", "Farmacity", "Mercado Pago".
- date: fecha del comprobante en formato YYYY-MM-DD. Si no figura, usá la fecha de hoy.
- total: el MONTO total pagado, número positivo. Conservá decimales solo si el comprobante los muestra (sin símbolo de moneda).
- currency: la moneda del comprobante. "ARS" para pesos argentinos ($, AR$, ARS, "pesos"). "USD" solo si el comprobante está claramente en dólares (US$, U$S, USD, "dólares"). Ante la duda, usá "ARS".
- suggested_category: la categoría de gasto MÁS apropiada elegida EXACTAMENTE de la lista provista. Ej: un viaje en DiDi/Uber → la categoría de transporte; un súper → supermercado/comida; una farmacia → salud; un delivery de comida → restaurantes/delivery. Si ninguna encaja bien, elegí la más cercana de la lista.
- items: array con el detalle de productos.
    * Si es un TICKET con lista de productos, incluí cada producto:
        - name: nombre del producto, prolijo (ej: "Leche La Serenísima 1L").
        - qty: cantidad (número, 1 si no figura).
        - line_total: precio total de esa línea (unitario × cantidad), número positivo en la MISMA moneda que el total.
        - group: clasificá el producto en UNA de: ${GROUPS.join(", ")}.
            · comida = alimentos básicos y para cocinar (lácteos, carnes, verduras, fideos, arroz, pan, huevos, aceite).
            · bebidas = agua, jugos, gaseosas, bebidas alcohólicas.
            · snacks = golosinas, papas fritas, chocolates, helados, antojos.
            · limpieza = detergente, lavandina, esponjas, papel, artículos de limpieza del hogar.
            · cuidado personal = shampoo, jabón, pasta dental, desodorante, higiene.
            · hogar = pilas, lámparas, utensilios, cosas durables para la casa.
            · mascotas = alimento o artículos para mascotas.
            · otros = cualquier cosa que no encaje.
    * Si es un COMPROBANTE de un único cargo SIN detalle de productos (ej. una notificación de DiDi, una transferencia, un débito), devolvé items como un array VACÍO []. NO inventes productos ni los clasifiques en grupos de supermercado.

Reglas:
- Ignorá líneas que no sean productos (subtotales, descuentos generales, medios de pago, CUIT, etc.). Podés reflejar descuentos restando del line_total del producto si corresponde.
- Cuando haya productos, la suma de los line_total debería aproximarse al total. Si no cuadra exacto, priorizá el total real del comprobante.
- Devolvé SOLO el JSON, sin texto adicional ni markdown.`;

async function parseReceipt(
  fileBase64: string,
  mimeType: string,
  categories: string[],
): Promise<ParsedReceipt> {
  const isPdf = mimeType === "application/pdf";
  const mediaType = isPdf ? "application/pdf" : (mimeType as string);
  const today = new Date().toISOString().slice(0, 10);

  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${SYSTEM_PROMPT}\n\nCategorías de gasto disponibles (elegí suggested_category EXACTAMENTE de esta lista): ${categories.join(", ")}\n\nFecha de hoy: ${today}`,
          cache_control: { type: "ephemeral" },
        },
        isPdf
          ? { type: "document", source: { type: "base64", media_type: mediaType, data: fileBase64 } }
          : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } },
        { type: "text", text: "Leé este comprobante (ticket o captura de notificación bancaria) y devolvé el JSON." },
      ],
    },
  ];

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31,pdfs-2024-09-25",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4096, messages }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? "{}";
  const cleaned = text.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  const parsed = JSON.parse(cleaned) as ParsedReceipt;

  // Normalize. Money keeps up to 2 decimals (a USD proof may have cents); the
  // currency is constrained to what the app supports, defaulting to ARS.
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  parsed.total = round2(parsed.total);
  parsed.currency = CURRENCIES.includes(String(parsed.currency).toUpperCase())
    ? String(parsed.currency).toUpperCase()
    : "ARS";
  parsed.items = (parsed.items ?? []).map((it) => ({
    name: String(it.name ?? "").slice(0, 120),
    qty: Number(it.qty) || 1,
    line_total: round2(it.line_total),
    group: GROUPS.includes(String(it.group)) ? String(it.group) : "otros",
  }));
  if (!parsed.date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) parsed.date = today;
  if (!parsed.merchant) parsed.merchant = "";
  return parsed;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

    const { data: profile } = await supabase
      .from("profiles").select("household_id").eq("id", user.id).single();
    if (!profile?.household_id) return new Response(JSON.stringify({ error: "Sin hogar" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

    const { file_path } = await req.json();
    if (!file_path) return new Response(JSON.stringify({ error: "file_path requerido" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

    const { data: fileData, error: dlErr } = await serviceClient.storage.from("statements").download(file_path);
    if (dlErr || !fileData) throw new Error(`Error descargando archivo: ${dlErr?.message}`);

    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const base64 = btoa(binary);
    const mimeType = fileData.type || "image/jpeg";

    const { data: categories = [] } = await serviceClient
      .from("categories").select("name").eq("household_id", profile.household_id).eq("kind", "expense");
    const catNames = (categories ?? []).map((c: { name: string }) => c.name);

    const parsed = await parseReceipt(base64, mimeType, catNames);

    return new Response(JSON.stringify({ ok: true, receipt: parsed }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
