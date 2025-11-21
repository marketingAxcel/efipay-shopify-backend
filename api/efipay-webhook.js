// api/efipay-webhook.js

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ error: 'Método no permitido' });
  }

  try {
    const payload = req.body || {};
    console.log('Webhook Efipay:', JSON.stringify(payload));

    // Si Efipay manda un token de seguridad en header
    // const tokenHeader = req.headers['x-efipay-token'];
    // if (process.env.EFIPAY_WEBHOOK_TOKEN && tokenHeader !== process.env.EFIPAY_WEBHOOK_TOKEN) {
    //   res.statusCode = 401;
    //   return res.end();
    // }

    const transactionId = payload.transaction_id || payload?.data?.id;
    const status = payload.status || payload?.data?.status;

    if (!transactionId) {
      res.statusCode = 400;
      return res.json({ error: 'Falta transaction_id en webhook' });
    }

    // TODO: aquí deberías buscar en tu DB el pedido asociado
    // const payment = await findPaymentByEfipayId(transactionId);

    // Por ahora lo dejaremos HARDCODEADO para pruebas
    const payment = {
      shopifyOrderId: 123456789 // 👉 cuando conectemos BD, este vendrá dinámico
    };

    if (!payment) {
      res.statusCode = 404;
      return res.json({ error: 'Pago no encontrado' });
    }

    const normalizedStatus = String(status || '').toUpperCase();

    if (['PAID', 'CONFIRMADO', 'APPROVED'].includes(normalizedStatus)) {
      await markOrderAsPaid(payment.shopifyOrderId);
    }

    res.statusCode = 200;
    return res.end();
  } catch (error) {
    console.error('Error en webhook Efipay:', error);
    res.statusCode = 500;
    return res.json({ error: 'Error procesando webhook' });
  }
};

async function markOrderAsPaid(orderId) {
  const token = process.env.SHOPIFY_ADMIN_API_TOKEN;
  const store = process.env.SHOPIFY_STORE_DOMAIN;

  const url = `https://${store}/admin/api/2024-01/orders/${orderId}.json`;

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      order: {
        id: orderId,
        financial_status: 'paid'
      }
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error('Error actualizando pedido en Shopify:', text);
    throw new Error('No se pudo marcar la orden como pagada');
  }
}
