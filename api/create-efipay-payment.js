// api/create-efipay-payment.js

module.exports = async (req, res) => {
  // 🔹 CORS: permitir llamadas desde tu tienda Shopify
  res.setHeader('Access-Control-Allow-Origin', 'https://myu4p-em.myshopify.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Responder rápido las preflight OPTIONS
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ error: 'Método no permitido' });
  }

  try {
    // En Vercel, req.body puede venir como string si es JSON
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }

    const { orderId, amount, currency, customer } = body || {};

    if (!orderId || amount == null) {
      res.statusCode = 400;
      return res.json({ error: 'orderId y amount son obligatorios' });
    }

    const amountNumber = Number(amount);
    if (Number.isNaN(amountNumber) || amountNumber <= 0) {
      res.statusCode = 400;
      return res.json({ error: 'amount debe ser un número mayor a 0' });
    }

    const baseUrl = process.env.EFIPAY_BASE_URL || 'https://app.efipay.co/api/v1';
    const apiToken = process.env.EFIPAY_API_TOKEN;
    const officeId = process.env.EFIPAY_OFFICE_ID;

    if (!apiToken) {
      res.statusCode = 500;
      return res.json({ error: 'Falta EFIPAY_API_TOKEN en las variables de entorno' });
    }

    // 👉 URL del webhook (ya desplegado en Vercel)
    const webhookUrl = 'https://efipay-shopify-backend.vercel.app/api/efipay-webhook';

    const payload = {
      amount: amountNumber,
      currency_type: currency || 'COP',
      office_id: officeId ? Number(officeId) : undefined,
      description: `Pedido Shopify #${orderId}`,
      advanced_option: {
        references: [String(orderId)],
        result_urls: {
          pending: 'https://payttontires.com/pago-pendiente',
          approved: 'https://payttontires.com/pago-aprobado',
          webhook: webhookUrl
        }
      },
      customer: {
        name: customer?.name || 'Cliente Shopify',
        email: customer?.email || ''
      }
    };

    const response = await fetch(`${baseUrl}/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Error respuesta Efipay /checkout:', text);
      res.statusCode = 500;
      return res.json({ error: 'No se pudo crear el pago en Efipay' });
    }

    const data = await response.json();
    console.log('Respuesta Efipay /checkout:', JSON.stringify(data));

    const paymentUrl =
      data?.checkout?.payment_gateway?.url ||
      data?.checkout?.url ||
      data?.checkout_url ||
      data?.url;

    const transactionId =
      data?.transaction?.transaction_id ||
      data?.transaction_id ||
      data?.checkout?.id;

    if (!paymentUrl) {
      res.statusCode = 500;
      return res.json({
        error: 'Efipay no devolvió una URL de pago (revisa los logs para ver la respuesta completa)',
        raw: data
      });
    }

    res.statusCode = 200;
    return res.json({
      paymentUrl,
      efipayTransactionId: transactionId || null
    });
  } catch (error) {
    console.error('Error en create-efipay-payment:', error);
    res.statusCode = 500;
    return res.json({ error: 'Error interno creando pago en Efipay' });
  }
};
