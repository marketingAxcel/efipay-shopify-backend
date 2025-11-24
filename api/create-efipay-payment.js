export default async function handler(req, res) {
  // 🔥 CONFIGURAR CORS
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "https://myu4p-em.myshopify.com"); 
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { amount, orderId } = req.body;

    if (!amount || !orderId) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    const response = await fetch("https://sag.efipay.co/api/v2/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.EFIPAY_API_KEY}`,
      },
      body: JSON.stringify({
        amount,
        currency: "COP",
        reference: orderId,
        response_urls: {
          approved: "https://payttontires.com/pages/pago-exitoso",
          pending: "https://payttontires.com/pages/pago-pendiente",
          webhook: `${process.env.WEBHOOK_URL}/api/efipay-webhook`,
        }
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ error: "Error creando link", details: data });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error("ERROR:", error);
    return res.status(500).json({ error: "Error interno", details: error.message });
  }
}
