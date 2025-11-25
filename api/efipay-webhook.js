// api/efipay-webhook.js

// Recorre un objeto profundo y ejecuta cb(key, value)
function deepScan(obj, cb) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    cb(key, value);
    if (value && typeof value === 'object') {
      deepScan(value, cb);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    let event = req.body;
    if (typeof event === 'string') {
      try {
        event = JSON.parse(event);
      } catch {
        event = {};
      }
    }

    console.log('=== EVENTO RECIBIDO DE EFIPAY ===');
    console.log(JSON.stringify(event, null, 2));

    // 1) STATUS
    let rawStatus = null;
    deepScan(event, (key, value) => {
      if (!rawStatus && key === 'status' && typeof value === 'string') {
        rawStatus = value.toLowerCase();
      }
    });

    const approvedStatuses = [
      'approved',
      'aprobado',
      'aprobada',
      'paid',
      'pagado',
      'pagada',
      'success',
      'succeeded',
    ];
    const isApproved = approvedStatuses.includes(rawStatus || '');
    console.log('STATUS DETECTADO:', rawStatus, '→ aprobado?:', isApproved);

    if (!isApproved) {
      console.log('Pago no aprobado. No se actualiza Shopify.');
      return res.status(200).json({ ok: true, approved: false });
    }

    // 2) NÚMERO DE PEDIDO (order_number)
    let referenceOrderId = null;

    // primero textos que contengan "Pedido"
    deepScan(event, (key, value) => {
      if (referenceOrderId) return;
      if (typeof value === 'string' && value.toLowerCase().includes('pedido')) {
        const match = value.match(/(\d+)/);
        if (match) referenceOrderId = match[1]; // "1006"
      }
    });

    // fallback: cualquier string sólo numérica
    if (!referenceOrderId) {
      deepScan(event, (key, value) => {
        if (referenceOrderId) return;
        if (typeof value === 'string' && /^\d{3,10}$/.test(value)) {
          referenceOrderId = value;
        }
      });
    }

    console.log('REFERENCIA DE PEDIDO DETECTADA:', referenceOrderId);

    if (!referenceOrderId) {
      console.error('Falta referencia de pedido. No se puede actualizar Shopify.');
      return res
        .status(400)
        .json({ error: 'Falta referencia de pedido para actualizar Shopify' });
    }

    const orderNumberInt = Number(referenceOrderId);

    // 3) CONFIG SHOPIFY
    const shopDomain = process.env.SHOPIFY_STORE_DOMAIN; // mvyu4p-em.myshopify.com
    const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
    const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || '2024-01';

    if (!shopDomain || !adminToken) {
      console.error('Faltan SHOPIFY_STORE_DOMAIN o SHOPIFY_ADMIN_API_TOKEN');
      return res.status(500).json({ error: 'Configuración de Shopify incompleta en backend' });
    }

    // 4) Buscar pedido POR order_number en los pedidos recientes
    const listUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders.json?status=any&limit=100&order=created_at+desc&fields=id,name,order_number,financial_status,total_price`;
    console.log('Buscando pedido en Shopify (lista reciente):', listUrl);

    const listResp = await fetch(listUrl, {
      headers: {
        'X-Shopify-Access-Token': adminToken,
        'Content-Type': 'application/json',
      },
    });

    const listRaw = await listResp.text();
    console.log('Respuesta cruda de Shopify (lista pedidos):', listRaw);

    if (!listResp.ok) {
      console.error('Error al listar pedidos en Shopify:', listResp.status, listRaw);
      return res.status(500).json({ error: 'No se pudo listar pedidos en Shopify', raw: listRaw });
    }

    let listData;
    try {
      listData = JSON.parse(listRaw);
    } catch (e) {
      console.error('No se pudo parsear JSON de lista de pedidos:', e);
      return res.status(500).json({ error: 'Respuesta inválida de Shopify al listar pedidos' });
    }

    const orders = listData.orders || [];
    const order = orders.find((o) => o.order_number === orderNumberInt);

    if (!order) {
      console.error('No se encontró pedido con order_number', orderNumberInt);
      return res
        .status(404)
        .json({ error: `Pedido no encontrado para order_number ${orderNumberInt}` });
    }

    console.log(
      'Pedido encontrado en Shopify:',
      order.id,
      order.name,
      'order_number:',
      order.order_number,
      'financial_status:',
      order.financial_status,
      'total_price:',
      order.total_price
    );

    if (order.financial_status === 'paid') {
      console.log('Pedido ya está marcado como pagado. No se actualiza.');
      return res.status(200).json({ ok: true, alreadyPaid: true });
    }

    // 5) Actualizar directamente el pedido a "paid"
    const updateUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders/${order.id}.json`;

    const updatePayload = {
      order: {
        id: order.id,
        financial_status: 'paid',
      },
    };

    console.log('Actualizando pedido en Shopify a paid:', updateUrl, updatePayload);

    const updateResp = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': adminToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
    });

    const updateRaw = await updateResp.text();
    console.log('Respuesta cruda de Shopify al actualizar pedido:', updateRaw);

    if (!updateResp.ok) {
      console.error(
        'Error al actualizar el estado del pedido en Shopify:',
        updateResp.status,
        updateRaw
      );
      return res.status(500).json({
        error: 'No se pudo actualizar el estado del pedido en Shopify',
        raw: updateRaw,
      });
    }

    return res.status(200).json({ ok: true, approved: true });
  } catch (err) {
    console.error('Error general en efipay-webhook:', err);
    return res.status(500).json({ error: 'Error interno en webhook de EfiPay' });
  }
}
