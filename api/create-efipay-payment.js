// api/create-efipay-payment.js

export default async function handler(req, res) {
  // ---------------------------------------------
  // 🔥 CORS – permitir llamadas desde la tienda Shopify
  // ---------------------------------------------
  const ALLOWED_ORIGIN = "https://mvyu4p-em.myshopify.com";

  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  // Preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ---------------------------------------------
  // 🚫 Solo permitir POST
  // ---------------------------------------------
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { orderId, amount, currency = "COP", customer = {} } = req.body || {};

    if (!orderId || !amount) {
      return res
        .status(400)
        .json({ error: "orderId y amount son obligatorios." });
    }

    const EFIPAY_TOKEN = process.env.EFIPAY_API_TOKEN;   // ACCESS_TOKEN de Efipay
    const BASE_URL =
      process.env.EFIPAY_BASE_URL || "https://sag.efipay.co/api/v1";
    const OFFICE_ID = process.env.EFIPAY_OFFICE_ID;

    if (!EFIPAY_TOKEN || !OFFICE_ID) {
      console.error(
        "Faltan variables de entorno EFIPAY_API_TOKEN o EFIPAY_OFFICE_ID"
      );
      return res
        .status(500)
        .json({ error: "Configuración de Efipay incompleta en el backend." });
    }

    // Descripción que se verá en Efipay
    const description = `Pedido ${orderId} - Paytton Tires`;

    // Payload según doc de "Transacciones" (generate-payment)
    const payload = {
      payment: {
        description,
        amount,                  // número, ej: 120000
        currency_type: currency, // 'COP'
        checkout_type: "redirect",
      },
      advanced_options: {
        // referencia para que luego puedas identificar la trx
        references: [String(orderId)],

        // URLs de retorno que mostrará Efipay según el resultado
        result_urls: {
          approved:
            "https://mvyu4p-em.myshopify.com/pages/pago-exitoso",
          rejected:
            "https://mvyu4p-em.myshopify.com/pages/pago-rechazado",
          pending:
            "https://mvyu4p-em.myshopify.com/pages/pago-pendiente",
          // webhook opcional
          webhook:
            "https://efipay-shopify-backend.vercel.app/api/efipay-webhook",
        },

        has_comments: false,
      },

      // sucursal (office) que te muestra Efipay en el panel
      office: Number(OFFICE_ID),
    };

    console.log(
      "Llamando a Efipay en:",
      `${BASE_URL}/payment/generate-payment`
    );
    console.log("Payload a Efipay:", JSON.stringify(payload, null, 2));

    const response = await fetch(`${BASE_URL}/payment/generate-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${EFIPAY_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    console.log("Respuesta cruda de Efipay generate-payment:", raw);

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error("No se pudo parsear la respuesta JSON de Efipay:", e);
      return res.status(500).json({
        error: "Respuesta inválida de Efipay",
        status: response.status,
        raw,
      });
    }

    // En redirect debemos recibir { saved, payment_id, url }
    if (!response.ok || !data.url) {
      console.error("Error al generar pago en Efipay:", data);
      return res.status(500).json({
        error: "No se pudo crear el pago en Efipay",
        status: response.status,
        raw: data,
      });
    }

    // ✅ Devolvemos el link de pago a Shopify
    return res.status(200).json({
      paymentUrl: data.url,
      paymentId: data.payment_id,
    });
  } catch (err) {
    console.error("Error general en create-efipay-payment:", err);
    return res
      .status(500)
      .json({ error: "Error interno en el backend de Efipay" });
  }
}
