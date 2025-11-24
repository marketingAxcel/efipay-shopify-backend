// api/efipay-webhook.js

// Función utilitaria: recorre un objeto y llama a cb(key, value) por cada par
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
      } catch (e) {
        console.error('No se pudo parsear body string como JSON:', e);
        event = {};
      }
    }

    console.log('=== EVENTO RECIBIDO DE EFIPAY ===');
    console.log(JSON.stringify(event, null, 2));

    // --------------------------
    // 1) Detectar STATUS APROBADO
    // --------------------------
    let rawStatus = null;
    deepScan(event, (key, value) => {
      if (!rawStatus && key === 'status' && typeof value === 'string') {
        rawStatus = value.toLowerCase();
      }
    });

    const approvedStatuses = ['approved', 'aprobado', 'paid', 'pagado', 'success', 'succeeded'];
    const isApproved = approvedStatuses.includes(rawStatus || '');

    console.log('STATUS DETECTADO:', rawStatus);
    console.log('¿ES APROBADO?:', isApproved);

    if (!isApproved) {
      console.log('Pago no aprobado. No se actualiza Shopify.');
      return res.status(200).json({ ok: true, approved: false });
    }

    // --------------------------
    // 2) Detectar MONTO
    // --------------------------
    let amount = null;
    deepScan(event, (key, value) => {
      if (amount != null) return;
      const keyLower = key.toLowerCase();
      if (
        (keyLower === 'total' || keyLower === 'amount' || keyLower === 'value') &&
        typeof value === 'number' &&
        value > 0
      ) {
        amount = value;
      }
    });

    console.log('MONTO DETECTADO:', amount);

    // --------------------------
    // 3) Detectar NÚMERO DE PEDIDO
    //    - buscamos textos tipo "Pedido 1007 - Paytton Tires"
    // --------------------------
    let referenceOrderId = null;

    // primero textos que contengan "Pedido"
    deepScan(event, (key, value) => {
      if (referenceOrderId) return;
      if (typeof value === 'string' && value.toLowerCase().includes('pedido')) {
        const match = value.match(/(\d+)/);
        if (match) {
          referenceOrderId = match[1]; // "1007"
        }
      }
    });

    // si aún no encontramos, cualquier string que sea solo dígitos y de pocos caracteres
    if (!referenceOrderId) {
      deepScan(event, (key, value) => {
        if (referenceOrderId) return;
        if (typeof value === 'string' && /^\d{3,10}$/.test(value)) {
          referenceOrderId = value;
        }
      });
    }

    console.log('REFERENCIA DE PEDIDO DETECTADA:', referenceOrderId);

    if (!referenceOrderId || !amount) {
      console.error('Falta referencia o monto. No se puede actualizar Shopify.');
      return res
        .status(400)
        .json({ error: 'Falta referencia o monto para actualizar Shopify', referenceOrderId, amount });
    }

    // --------------------------
    // 4) Llamar a Shopify
    // --------------------------
    const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;         // ej: mvyu4p-em.myshopify.com
    const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;      // token admin
    const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || '2024-01';

    if (!shopDomain || !adminToken) {
      console.error('Faltan SHOPIFY_STORE_DOMAIN o SHOPIFY_ADMIN_API_TOKEN');
      return res.status(500).json({ error: 'Configuración de Shopify incompleta en backend' });
    }

    let orderName = String(referenceOrderId).trim();
    if (!orderName.startsWith('#')) {
      orderName = `#${orderName}`;
    }

    // 4.1 Buscar pedido por name
    const searchUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders.json?name=${encodeURIComponent(
      orderName
    )}`;

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

    // si ya está pagado, no duplicamos
    if (order.financial_status === 'paid') {
      console.log('Pedido ya está marcado como pagado en Shopify. No se crea transacción nueva.');
      return res.status(200).json({ ok: true, alreadyPaid: true });
    }

    // 4.2 Crear transacción de venta ENVIANDO EL MONTO
    const txUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders/${orderId}/transactions.json`;

    const txPayload = {
      transaction: {
        kind: 'sale',
        status: 'success',
        amount: amount.toString()
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
