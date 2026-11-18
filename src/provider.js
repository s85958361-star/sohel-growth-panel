
const axios = require('axios');

async function submitOrder(order, service) {
  if (service.provider !== 'topsmm') {
    return {
      externalId: null,
      status: 'Pending'
    };
  }

  const apiUrl = process.env.PROVIDER_API_URL;
  const apiKey = process.env.PROVIDER_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error('Provider API की जानकारी Render में सेट नहीं है।');
  }

  const response = await axios.post(apiUrl, {
    key: apiKey,
    action: 'add',
    service: service.external_service_id,
    link: order.link,
    quantity: order.quantity
  });

  if (response.data.error) {
    throw new Error(response.data.error);
  }

  return {
    externalId: response.data.order || null,
    status: 'Pending'
  };
}

async function getOrderStatus(orderId) {
  const apiUrl = process.env.PROVIDER_API_URL;
  const apiKey = process.env.PROVIDER_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error('Provider API की जानकारी Render में सेट नहीं है।');
  }

  const response = await axios.post(apiUrl, {
    key: apiKey,
    action: 'status',
    order: orderId
  });

  if (response.data.error) {
    throw new Error(response.data.error);
  }

  return response.data;
}

async function getBalance() {
  const apiUrl = process.env.PROVIDER_API_URL;
  const apiKey = process.env.PROVIDER_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error('Provider API की जानकारी Render में सेट नहीं है।');
  }

  const response = await axios.post(apiUrl, {
    key: apiKey,
    action: 'balance'
  });

  if (response.data.error) {
    throw new Error(response.data.error);
  }

  return response.data;
}

module.exports = {
  submitOrder,
  getOrderStatus,
  getBalance
};
