// api/create-efipay-payment.js
const axios = require("axios");

module.exports = async function (req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { orderId, amount, customer } = req.body;

    if (!orderId || !amount || !customer) {
      return res.status(400).json({
        success: false,
        error: "Faltan campos: orderId, amount o customer"
      });
    }

    // Mapeamos los datos del cliente que mandará Shopify
    const payer = {
      name: customer.name,
      address_1: customer.address1,
      address_2: customer.address2 || "",
      city: customer.city,
      state: customer.state,
      zip_code: customer.zip,
      country: customer.country || "COL"
    };

    const efipayResponse = await axios.post(
      `${process.env.EFIPAY_BASE_URL}/payment/generate-payment`,
      {
        payment: {
          amount: Math.round(amount),        // en COP
          currency: "COP",
          currency_type: "COP",
          description: `Pedido Shopify #${orderId}`,
          order_id: String(orderId),
          checkout_type: "redirect"
        },
        advanced_options: {
          customer_payer: payer
        },
        office: Number(process.env.EFIPAY_OFFICE_ID)
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${process.env.EFIPAY_API_TOKEN}`
        }
      }
    );

    const data = efipayResponse.data;

    return res.status(200).json({
      success: true,
      paymentId: data.payment_id,
      url: data.url
    });
  } catch (error) {
    console.error(
      "Error creando pago en EfiPay:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      error: "No se pudo generar el pago en EfiPay"
    });
  }
};
