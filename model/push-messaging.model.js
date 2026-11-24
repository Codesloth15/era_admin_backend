// Firebase Cloud Messaging adapter: sends one message to many phones.
function createPushMessaging(messaging) {
  return {
    // Returns one result per token, in the same order: { token, ok, errorCode }.
    async send(message, tokens) {
      const response = await messaging.sendEachForMulticast({ ...message, tokens });
      return response.responses.map((item, index) => ({ token: tokens[index], ok: item.success, errorCode: item.error?.code || null }));
    },
  };
}

export { createPushMessaging };
