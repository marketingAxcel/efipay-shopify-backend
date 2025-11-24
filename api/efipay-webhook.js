// api/efipay-webhook.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    let event = req.body;
    if (typeof event === 'string') {
      try { event = JSON.parse(event); } catch (e) {}
    }

    console.log("EVENTO RECIBIDO WEBHOOK:", JSON.stringify(event, null, 2));

    const payment = event.payment || {};

    // ✔ Nuevo: extraemos el monto REAL
    const amount =
      payment.total ||
      payment.amount ||
      event.total ||
      null;

    console.log("MONTO DETECTADO:", amount);

    // ✔ Extraemos status
    const rawStatus = (payment.status || '').toLowerCase();
    const approved = ['approved', 'success', 'paid'].includes(rawStatus);

    // ✔ Extraemos referencia del número de pedido desde la descripción
    let referenceOrderId = null;
    if (payment.description) {
      const match = payment.description.match(/(\d+)/);
      if (match) referenceOrderId = match[1];
    }

    console.log("REFERENCIA DETECTADA:", referenceOrderId);

    if (!approved) {
      console.log("Pago NO aprobado. No se actualiza Shopify.");
      return res.status(200).json({ ok: true, approved: false });
    }

    if (!referenceOrderId || !amount) {
      console.log("No hay referencia o monto. Abortando.");
      return res.status(400).json({ error: "Falta referencia o monto" });
    }

    // ---- SHOPIFY ----
    const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
    const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || '2024-01';

    let orderName = `#${referenceOrderId}`;

    // 1) Buscar pedido
    const searchUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders.json?name=${orderName}`;
    const searchResp = await fetch(searchUrl, {
      headers: {
        "X-Shopify-Access-Token": adminToken,
        "Content-Type": "application/json"
      }
    });

    const searchData = await searchResp.json();
    const order = searchData.orders?.[0];

    if (!order) {
      console.log("Pedido NO encontrado en Shopify");
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    // 2) Crear transacción ENVIANDO EL MONTO REAL
    const txUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders/${order.id}/transactions.json`;

    const txPayload = {
      transaction: {
        kind: "sale",
        status: "success",
        amount: amount.toString()
      }
    };

    console.log("CREANDO TRANSACCIÓN:", txPayload);

    const shopifyResp = await fetch(txUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": adminToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(txPayload)
    });

    const shopifyRaw = await shopifyResp.text();
    console.log("RESPUESTA SHOPIFY:", shopifyRaw);

    return res.status(200).json({ ok: true, approved: true });

  } catch (err) {
    console.error("ERROR EN WEBHOOK:", err);
    return res.status(500).json({ error: "Error Webhook" });
  }
}
