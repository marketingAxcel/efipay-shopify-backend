// api/efipay-webhook.js

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ error: 'Método no permitido' });
  }

  try {
    const payload = req.body || {};
    console.log('Webhook Efipay recibido:', JSON.stringify(payload));

    const transaction = payload.transaction || {};
    const checkout = payload.checkout || {};

    const transactionId = transaction.transaction_id;
    const status = transaction.status; // ejemplo: "Aprobada", "Rechazada", etc.

    if (!transactionId) {
      res.statusCode = 400;
      return res.json({ error: 'Falta transaction.transaction_id en el webhook' });
    }

    // Recuperamos el orderId de Shopify desde advanced_option.references
    let references = [];

    // Según el ejemplo de docs, advanced_option está dentro de payment_gateway
    if (checkout.payment_gateway?.advanced_option?.references) {
      references = checkout.payment_gateway.advanced_option.references;
    } else if (checkout.advanced_option?.references) {
      references = checkout.advanced_option.references;
    }

    const shopifyOrderId = references && references.length > 0 ? Number(references[0]) : null;

    if (!shopifyOrderId) {
      console.warn(
        'Webhook Efipay recibido pero no se encontró orderId en advanced_option.references. Payload:',
        JSON.stringify(payload)
      );
      // Respondemos 200 para que Efipay no siga reintentando eternamente.
      res.statusCode = 200;
      return res.json({ message: 'Webhook recibido pero sin orderId mapeado' });
    }

    const normalizedStatus = String(status || '').toUpperCase();

    console.log(
      `Procesando webhook Efipay. transactionId=${transactionId}, status=${normalizedStatus}, shopifyOrderId=${shopifyOrderId}`
    );

    // Ajusta la lógica de estados según lo que envíe Efipay:
    // En la docs el ejemplo usa "Aprobada" para pagos correctos.
    if (['APROBADA', 'PAID', 'CONFIRMADO'].includes(normalizedStatus)) {
      await markOrderAsPaid(shopifyOrderId);
      console.log(`Orden Shopify ${shopifyOrderId} marcada como pagada.`);
    } else {
      console.log(
        `Webhook Efipay con estado no pagado (${normalizedStatus}) para orden Shopify ${shopifyOrderId}. No se actualiza.`
      );
    }

    res.statusCode = 200;
    return res.end();
  } catch (error) {
    console.error('Error en efipay-webhook:', error);
    res.statusCode = 500;
    return res.json({ error: 'Error interno procesando webhook de Efipay' });
  }
};

async function markOrderAsPaid(orderId) {
  const token = process.env.SHOPIFY_ADMIN_API_TOKEN;
  const store = process.env.SHOPIFY_STORE_DOMAIN;

  if (!token || !store) {
    throw new Error('Faltan SHOPIFY_ADMIN_API_TOKEN o SHOPIFY_STORE_DOMAIN en las variables de entorno');
  }

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
    throw new Error('No se pudo marcar la orden como pagada en Shopify');
  }
}
