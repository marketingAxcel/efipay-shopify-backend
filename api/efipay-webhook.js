// api/efipay-webhook.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // Algunos proveedores mandan JSON, otros string
    let event = req.body;
    if (!event) {
      event = {};
    } else if (typeof event === 'string') {
      try {
        event = JSON.parse(event);
      } catch (e) {
        console.error('No se pudo parsear el body string como JSON:', e);
        event = {};
      }
    }

    console.log('Webhook recibido de EfiPay (body parseado):', JSON.stringify(event, null, 2));
    console.log('Headers del webhook:', JSON.stringify(req.headers, null, 2));

    const payment = event.payment || event.data || event || {};

    const rawStatus = (payment.status || event.status || '').toString().toLowerCase();
    const approvedStatuses = ['approved', 'aprobado', 'paid', 'pagado', 'success', 'succeeded'];
    const isApproved = approvedStatuses.includes(rawStatus);

    // ==========================
    // OBTENER REFERENCIA DE PEDIDO
    // ==========================
    let referenceOrderId = null;

    // 1) Lo que intentábamos antes
    if (event.advanced_options && Array.isArray(event.advanced_options.references)) {
      referenceOrderId = event.advanced_options.references[0];
    } else if (event.references && Array.isArray(event.references)) {
      referenceOrderId = event.references[0];
    } else if (payment.references && Array.isArray(payment.references)) {
      referenceOrderId = payment.references[0];
    } else if (payment.reference) {
      referenceOrderId = payment.reference;
    }

    // 2) PLAN B → usar la descripción "Pedido 1006 - Paytton Tires"
    if (!referenceOrderId) {
      const desc = payment.description || event.description || '';
      console.log('Descripción recibida en el pago:', desc);

      const match = desc.match(/(\d+)/);  // primer número que aparezca
      if (match) {
        referenceOrderId = match[1];     // "1006"
      }
    }

    const amount = payment.amount || event.amount || null;

    console.log('Status crudo recibido:', rawStatus);
    console.log('¿Es aprobado según nuestra lista?:', isApproved);
    console.log('Referencia de pedido detectada:', referenceOrderId);
    console.log('Monto recibido:', amount);

    // Si NO hay referencia, no podemos mapear con Shopify
    if (!referenceOrderId) {
      console.error('No se pudo determinar referenceOrderId en el webhook');
      return res.status(400).json({ error: 'Evento inválido: falta referencia de pedido' });
    }

    // Si el pago no está aprobado, no tocamos Shopify
    if (!isApproved) {
      console.log('Evento EfiPay no aprobado. No se actualiza Shopify. Status:', rawStatus);
      return res.status(200).json({ received: true, approved: false });
    }

    console.log(`Pago APROBADO en EfiPay para referencia ${referenceOrderId} por valor ${amount}`);

    // ---- CONFIG SHOPIFY ----
    const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;         // ej: mvyu4p-em.myshopify.com
    const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;      // token admin
    const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || '2024-01';

    if (!shopDomain || !adminToken) {
      console.error('Faltan SHOPIFY_STORE_DOMAIN o SHOPIFY_ADMIN_API_TOKEN');
      return res.status(500).json({ error: 'Configuración de Shopify incompleta en backend' });
    }

    // referenceOrderId tipo "1006" → lo pasamos a "#1006"
    let orderName = String(referenceOrderId).trim();
    if (!orderName.startsWith('#')) {
      orderName = `#${orderName}`;
    }

    // 1) Buscar el pedido por name
    const searchUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders.json?name=${encodeURIComponent(orderName)}`;
    console.log('Buscando pedido en Shopify por name:', orderName, '→', searchUrl);

    const searchResp = await fetch(searchUrl, {
      headers: {
        'X-Shopify-Access-Token': adminToken,
        'Content-Type': 'application/json'
      }
    });

    const searchRaw = await searchResp.text();
    console.log('Respuesta cruda de Shopify (search order):', searchRaw);

    if (!searchResp.ok) {
      console.error('Error al buscar pedido en Shopify:', searchResp.status, searchRaw);
      return res.status(500).json({ error: 'No se pudo buscar el pedido en Shopify', raw: searchRaw });
    }

    let searchData;
    try {
      searchData = JSON.parse(searchRaw);
    } catch (e) {
      console.error('No se pudo parsear JSON de búsqueda de pedidos:', e);
      return res.status(500).json({ error: 'Respuesta inválida de Shopify al buscar pedido' });
    }

    const orders = searchData.orders || [];
    if (!orders.length) {
      console.error('No se encontró ningún pedido con name', orderName);
      return res.status(404).json({ error: `Pedido no encontrado en Shopify para name ${orderName}` });
    }

    const order = orders[0];
    const orderId = order.id;
    console.log('Pedido encontrado en Shopify:', orderId, order.name, 'financial_status:', order.financial_status);

    // Si ya está pagado, no repetimos
    if (order.financial_status === 'paid') {
      console.log('Pedido ya está marcado como pagado en Shopify. No se crea transacción nueva.');
      return res.status(200).json({ ok: true, alreadyPaid: true });
    }

    // 2) Crear transacción para marcarlo como pagado
    const txUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders/${orderId}/transactions.json`;

    const txPayload = {
      transaction: {
        kind: 'sale',
        status: 'success',
        amount: amount ? String(amount) : undefined
      }
    };

    console.log('Creando transacción en Shopify:', txUrl, txPayload);

    const shopifyResp = await fetch(txUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': adminToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(txPayload)
    });

    const shopifyRaw = await shopifyResp.text();
    console.log('Respuesta cruda de Shopify al crear transacción:', shopifyRaw);

    if (!shopifyResp.ok) {
      console.error('Error al registrar el pago en Shopify:', shopifyResp.status, shopifyRaw);
      return res.status(500).json({ error: 'No se pudo registrar el pago en Shopify', raw: shopifyRaw });
    }

    return res.status(200).json({ ok: true, approved: true });
  } catch (err) {
    console.error('Error general en efipay-webhook:', err);
    return res.status(500).json({ error: 'Error interno en webhook de EfiPay' });
  }
}
