// api/create-efipay-payment.js

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ error: 'Method not allowed' });
  }

  try {
    const { orderId, amount, currency, customer } = req.body;

    if (!orderId || !amount) {
      res.statusCode = 400;
      return res.json({ error: 'orderId y amount son obligatorios' });
    }

    const baseUrl = process.env.EFIPAY_BASE_URL;    // https://app.efipay.co/api/v1
    const apiToken = process.env.EFIPAY_API_TOKEN;  // tu token Efipay
    const officeId = process.env.EFIPAY_OFFICE_ID;  // 2052

    // 👇 Ajusta el endpoint exacto según tu integración actual
    const url = `${baseUrl}/checkout`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,                        // ajusta formato (enteros/centavos) según Efipay
        currency: currency || 'COP',
        description: `Pedido Shopify #${orderId}`,
        office_id: Number(officeId),
        customer: {
          name: customer?.name,
          email: customer?.email,
        },
        // aquí puedes añadir los demás campos que YA usas hoy con Efipay
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Error respuesta Efipay:', text);
      res.statusCode = 500;
      return res.json({ error: 'No se pudo crear el pago en Efipay' });
    }

    const data = await response.json();

    // 👇 Ajusta a la respuesta REAL de Efipay
    const paymentUrl = data?.data?.url || data?.checkout_url;
    const transactionId = data?.data?.id || data?.transaction_id;

    if (!paymentUrl) {
      res.statusCode = 500;
      return res.json({ error: 'Efipay no devolvió URL de pago' });
    }

    // TODO: aquí idealmente guardas en una BD:
    // { shopifyOrderId: orderId, efipayTransactionId: transactionId, status: 'pending' }

    res.statusCode = 200;
    return res.json({
      paymentUrl,
      efipayTransactionId: transactionId,
    });
  } catch (error) {
    console.error('Error en create-efipay-payment:', error);
    res.statusCode = 500;
    return res.json({ error: 'Error interno creando pago' });
  }
};
