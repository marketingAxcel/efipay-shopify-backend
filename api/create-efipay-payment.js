// api/create-efipay-payment.js

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ error: 'Método no permitido' });
  }

  try {
    const { orderId, amount, currency, customer } = req.body || {};

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

    // 👉 Aquí va tu URL pública de Vercel para el webhook
    const webhookUrl = 'https://efipay-shopify-backend.vercel.app/api/efipay-webhook';

    // Payload para crear el checkout en Efipay.
    // Ajusta los campos si tu implementación actual usa otros nombres/campos adicionales.
    const payload = {
      amount: amountNumber,
      currency_type: currency || 'COP',
      office_id: Number(officeId),
      description: `Pedido Shopify #${orderId}`,
      // Referencias y URLs de resultado (según docs de Efipay)
      advanced_option: {
        // Guardamos el orderId de Shopify como referencia para leerlo luego en el webhook
        references: [String(orderId)],
        result_urls: {
          pending: 'https://payttontires.com/pago-pendiente', // opcional, cámbialo si quieres
          approved: 'https://payttontires.com/pago-aprobado', // opcional
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

    // ⚠️ Ajusta estas rutas según la respuesta REAL de tu API.
    // Te dejo varias opciones encadenadas para que no pete aunque la clave sea distinta.
    const paymentUrl =
      data?.checkout?.payment_gateway?.url || // ejemplo posible
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

    // En este punto podrías guardar en una BD: { orderId, transactionId, status: 'pending' }
    // pero como usamos "references" para guardar el orderId, podemos vivir sin BD por ahora.

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
