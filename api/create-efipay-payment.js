// api/create-efipay-payment.js

module.exports = async (req, res) => {
  // ===== CORS DINÁMICO =====
  const allowedOrigins = [
    'https://myu4p-em.myshopify.com',
    'https://payttontires.com'
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // por si abres desde otro sitio en pruebas, al menos no reviente
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type'
  );

  // Responder el preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // ===== SOLO ACEPTAMOS POST =====
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ error: 'Método no permitido' });
  }

  try {
    // ---- parseo seguro del body ----
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error('Error parseando body como JSON:', e);
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

    const webhookUrl = 'https://efipay-shopify-backend.vercel.app/api/efipay-webhook';

    const payload = {
      amount: amountNumber,
      currency_type: currency || 'COP',
      ...(officeId ? { office_id: Number(officeId) } : {}),
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

    console.log('Payload a Efipay /checkout:', JSON.stringify(payload));

    const response = await fetch(`${baseUrl}/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const raw = await response.text();
    console.log('Respuesta cruda de Efipay /checkout:', raw);

    if (!response.ok) {
      res.statusCode = 500;
      return res.json({
        error: 'No se pudo crear el pago en Efipay',
        status: response.status,
        raw
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('No se pudo parsear JSON de Efipay:', e);
      res.statusCode = 500;
      return res.json({
        error: 'Respuesta de Efipay no es JSON válido',
        raw
      });
    }

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
        error: 'Efipay no devolvió una URL de pago',
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
