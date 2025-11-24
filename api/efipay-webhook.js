// api/efipay-webhook.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const event = req.body || {};
    console.log('Webhook recibido de EfiPay:', JSON.stringify(event, null, 2));

    // Aquí intentamos ser lo más flexibles posible con la estructura
    const payment = event.payment || event.data || {};
    const status = payment.status || event.status || null;

    // Buscar la referencia (orderId de Shopify que tú mandaste)
    let referenceOrderId = null;
    if (event.advanced_options && Array.isArray(event.advanced_options.references)) {
      referenceOrderId = event.advanced_options.references[0];
    } else if (event.references && Array.isArray(event.references)) {
      referenceOrderId = event.references[0];
    } else if (payment.references && Array.isArray(payment.references)) {
      referenceOrderId = payment.references[0];
    }

    const amount = payment.amount || null;

    if (!status || !referenceOrderId) {
      console.error('Evento de EfiPay sin status o referencia:', { status, referenceOrderId });
      return res.status(400).json({ error: 'Evento inválido: falta status o referencia' });
    }

    // Solo procesamos pagos aprobados
    if (status !== 'approved') {
      console.log('Evento EfiPay ignorado, status no es approved:', status);
      return res.status(200).json({ received: true, ignored: true });
    }

    console.log(`Pago APROBADO en EfiPay para referencia ${referenceOrderId} por valor ${amount}`);

    // ---- CONFIG SHOPIFY ----
    const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;         // ej: mvyu4p-em.myshopify.com
    const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;      // tu token admin
    const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || '2024-01';

    if (!shopDomain || !adminToken) {
      console.error('Faltan SHOPIFY_STORE_DOMAIN o SHOPIFY_ADMIN_API_TOKEN');
      return res.status(500).json({ error: 'Configuración de Shopify incompleta en backend' });
    }

    // referenceOrderId viene como "1005" → lo convertimos a "#1005" para buscar por name
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

    // Si ya está pagado, no hacemos nada
    if (order.financial_status === 'paid') {
      console.log('Pedido ya está marcado como pagado en Shopify. No se crea transacción nueva.');
      return res.status(200).json({ ok: true, alreadyPaid: true });
    }

    // 2) Crear transacción de venta en Shopify para marcarlo como pagado
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

    // Si llegamos aquí, Shopify debería marcar el pedido como pagado
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error general en efipay-webhook:', err);
    return res.status(500).json({ error: 'Error interno en webhook de EfiPay' });
  }
}
