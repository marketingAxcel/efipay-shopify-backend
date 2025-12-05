export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { orderId, amount, currency = 'COP', customer = {} } = req.body || {};

    if (!orderId || !amount) {
      return res
        .status(400)
        .json({ error: 'orderId y amount son obligatorios.' });
    }

    const EFIPAY_TOKEN = process.env.EFIPAY_API_TOKEN;   
    const BASE_URL = process.env.EFIPAY_BASE_URL || 'https://sag.efipay.co/api/v1';
    const OFFICE_ID = process.env.EFIPAY_OFFICE_ID;

    const FRONTEND_BASE_URL =
      process.env.SHOPIFY_STOREFRONT_URL || 'https://tienda.payttontires.com';

    if (!EFIPAY_TOKEN || !OFFICE_ID) {
      console.error('Faltan variables de entorno EFIPAY_API_TOKEN o EFIPAY_OFFICE_ID');
      return res
        .status(500)
        .json({ error: 'Configuración de Efipay incompleta en el backend.' });
    }

    const description = `Pedido ${orderId} - Paytton Tires`;

    const payload = {
      payment: {
        description,
        amount,                  
        currency_type: currency, 
        checkout_type: 'redirect'
      },
      advanced_options: {
        
        references: [String(orderId)],

        result_urls: {
          approved: `${FRONTEND_BASE_URL}/pages/pago-exitoso`,
          rejected: `${FRONTEND_BASE_URL}/pages/pago-rechazado`,
          pending:  `${FRONTEND_BASE_URL}/pages/pago-pendiente`,
          webhook: 'https://efipay-shopify-backend.vercel.app/api/efipay-webhook'
        },

        has_comments: false
      },

      office: Number(OFFICE_ID)
    };

    console.log(
      'Llamando a Efipay en:',
      `${BASE_URL}/payment/generate-payment`
    );
    console.log('Payload a Efipay:', JSON.stringify(payload, null, 2));

    const response = await fetch(
      `${BASE_URL}/payment/generate-payment`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${EFIPAY_TOKEN}`
        },
        body: JSON.stringify(payload)
      }
    );

    const raw = await response.text();
    console.log('Respuesta cruda de Efipay generate-payment:', raw);

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('No se pudo parsear la respuesta JSON de Efipay:', e);
      return res.status(500).json({
        error: 'Respuesta inválida de Efipay',
        status: response.status,
        raw
      });
    }

    if (!response.ok || !data.url) {
      console.error('Error al generar pago en Efipay:', data);
      return res.status(500).json({
        error: 'No se pudo crear el pago en Efipay',
        status: response.status,
        raw: data
      });
    }

    return res.status(200).json({
      paymentUrl: data.url,
      paymentId: data.payment_id
    });
  } catch (err) {
    console.error('Error general en create-efipay-payment:', err);
    return res
      .status(500)
      .json({ error: 'Error interno en el backend de Efipay' });
  }
}
